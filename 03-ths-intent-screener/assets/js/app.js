import {
  FACTORS, FACTOR_ORDER, describeCondition, makeCondition, formatFactorValue,
  screen, validateConditions, conditionImpact, buildExplanation, riskFlags,
  complianceCheck, qualityCards,
} from './engine.js';
import {
  parseQuery, normalizeLLMResult, applyPresetVariant, applyChoice, PRESETS,
} from './parser.js';
import { runSelfTests } from './selftest.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const LS_KEY = 'intent_screener_saved_v1';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${fmt(v, 2)}%`);
const pctClass = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const nowIso = () => new Date().toISOString();

const state = {
  meta: null,
  stocks: [],
  parsed: null,
  conditions: [],
  options: { excludeST: true, excludeSuspended: true, board: 'all' },
  result: null,
  activeTab: 'matched',
  sortKey: 'score',
  filterText: '',
  showAll: false,
  compare: new Set(),
  saved: loadSaved(),
  audit: [],
  llmAvailable: false,
  busy: false,
  runTimer: null,
};

function loadSaved() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function persistSaved() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state.saved)); } catch { /* ignore quota */ }
}
function addAudit(action, detail) {
  state.audit.unshift({ time: nowIso(), action, detail });
  state.audit = state.audit.slice(0, 200);
}
let toastTimer = null;
function toast(message, ms = 2600) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
function setBusy(busy) {
  state.busy = busy;
  const btn = $('#parse-btn');
  btn.disabled = busy;
  btn.innerHTML = busy ? '解析中…' : '解析意图 <span class="arrow">→</span>';
}

async function init() {
  bindEvents();
  try {
    const res = await fetch('data/snapshot.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`snapshot ${res.status}`);
    const snap = await res.json();
    state.meta = snap.meta;
    state.stocks = snap.stocks;
    const date = state.meta.trade_date || '—';
    const time = (state.meta.generated_at || '').slice(11, 16);
    $('#snapshot-status').textContent = `快照 ${date}${time ? ' ' + time : ''} · ${state.meta.stock_count.toLocaleString('zh-CN')} 只`;
    $('#footer-date').textContent = `${date}${time ? ' ' + time : ''}`;
    document.title = `意图选股器 · ${state.meta.stock_count.toLocaleString('zh-CN')} 只 A 股快照`;
    checkLLM();
    if (state.meta.generated_at) $('#snapshot-pill').title = `数据生成：${state.meta.generated_at}｜行情、财务、日K均为公开接口快照`;
    const demoParams = new URLSearchParams(location.search);
    const demoQuery = demoParams.get('q');
    if (demoQuery) {
      $('#query-input').value = demoQuery;
      const demoTab = demoParams.get('tab');
      const demoDetail = demoParams.get('detail');
      const demoPanel = demoParams.get('panel');
      setTimeout(async () => {
        await parseIntent();
        if (demoTab) { state.activeTab = demoTab; renderResults(); }
        if (demoDetail) setTimeout(() => openDetail(demoDetail), 250);
        if (demoPanel === 'data') setTimeout(openDataModal, 350);
        if (demoPanel === 'audit') setTimeout(openAuditModal, 350);
        if (demoPanel === 'selftest') setTimeout(openSelfTest, 350);
        if (demoPanel === 'saved') setTimeout(openSavedModal, 350);
      }, 120);
    }
  } catch (err) {
    console.error(err);
    $('#snapshot-status').textContent = '数据加载失败';
    $('#snapshot-pill').classList.add('error');
    $('#query-input').disabled = true;
    $('#parse-btn').disabled = true;
    toast('数据加载失败：请通过本地服务器打开，或确认 data/snapshot.json 存在', 6000);
  }
}

async function checkLLM() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 900);
    const res = await fetch('/api/health', { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const data = await res.json();
    state.llmAvailable = Boolean(data?.llm?.configured);
  } catch { state.llmAvailable = false; }
}

function bindEvents() {
  $('#parse-btn').addEventListener('click', parseIntent);
  $('#query-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); parseIntent(); }
  });
  $('#examples').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-query]');
    if (!btn) return;
    $('#query-input').value = btn.dataset.query;
    parseIntent();
  });
  $('#run-btn').addEventListener('click', () => runScreen());
  $('#reset-btn').addEventListener('click', resetAll);
  $('#exclude-st').addEventListener('change', (e) => { state.options.excludeST = e.target.checked; scheduleRun(); });
  $('#exclude-suspended').addEventListener('change', (e) => { state.options.excludeSuspended = e.target.checked; scheduleRun(); });
  $('#board-select').addEventListener('change', (e) => { state.options.board = e.target.value; scheduleRun(); });
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    state.activeTab = btn.dataset.tab;
    renderResults();
  });
  $('#save-btn').addEventListener('click', openSavedModal);
  $('#compare-btn').addEventListener('click', openCompareModal);
  $('#export-btn').addEventListener('click', exportJson);
  document.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'close-drawer') closeDrawer();
    if (action === 'close-modal') closeModal();
    if (action === 'open-data') openDataModal();
    if (action === 'open-audit') openAuditModal();
    if (action === 'selftest') openSelfTest();
    if (action === 'edit-query') { $('#hero').classList.remove('compact'); $('#query-input').focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });
  $('#conditions-list').addEventListener('click', onConditionClick);
  $('#conditions-list').addEventListener('change', onConditionChange);
  $('#conditions-list').addEventListener('input', onConditionInput);
  $('#assumptions').addEventListener('click', onAmbiguityClick);
  $('#ambiguities').addEventListener('click', onAmbiguityClick);
  $('#validation').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="soften-first"]')) softenFirst();
  });
  $('#tab-content').addEventListener('click', onResultClick);
  $('#tab-content').addEventListener('change', onResultChange);
  $('#tab-content').addEventListener('input', onImpactInput);
  $('#tab-content').addEventListener('change', onImpactChange);
  $('#drawer').addEventListener('click', onDrawerClick);
  $('#modal').addEventListener('click', onModalClick);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDrawer(); closeModal(); }
  });
}

function resetAll() {
  state.parsed = null;
  state.conditions = [];
  state.result = null;
  state.compare.clear();
  state.activeTab = 'matched';
  state.filterText = '';
  state.showAll = false;
  $('#hero').classList.remove('compact');
  $('#workspace').classList.add('hidden');
  $('#conditions-list').innerHTML = '';
  $('#assumptions').innerHTML = '';
  $('#ambiguities').innerHTML = '';
  $('#validation').innerHTML = '';
  $('#tab-content').innerHTML = '';
  $('#query-input').value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function parseIntent() {
  const query = $('#query-input').value.trim();
  if (!query) { toast('先写一句选股意图，或点一个示例'); return; }
  if (!state.stocks.length) { toast('数据尚未加载完成'); return; }
  setBusy(true);
  try {
    let parsed = parseQuery(query, { stocks: state.stocks });
    if (state.llmAvailable) {
      try {
        const res = await fetch('/api/parse', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
        });
        if (res.ok) {
          const data = await res.json();
          const normalized = normalizeLLMResult({ ...data, query }, { stocks: state.stocks });
          if (normalized.conditions.length > 0) parsed = normalized;
        }
      } catch { /* local fallback */ }
    }
    state.parsed = parsed;
    state.conditions = parsed.conditions.map((c) => makeCondition(c));
    state.options = { excludeST: true, excludeSuspended: true, board: 'all', ...(parsed.options || {}) };
    $('#exclude-st').checked = state.options.excludeST !== false;
    $('#exclude-suspended').checked = state.options.excludeSuspended !== false;
    $('#board-select').value = state.options.board || 'all';
    state.compare.clear();
    state.activeTab = 'matched';
    state.filterText = '';
    state.showAll = false;
    $('#hero').classList.add('compact');
    $('#workspace').classList.remove('hidden');
    renderConditions();
    runScreen();
    addAudit('解析意图', `${parsed.source === 'llm' ? 'LLM' : '本地规则'}：${query}`);
    if (!parsed.conditions.length && !parsed.ambiguities.length && !parsed.unparsed.length) {
      toast('识别完成，但还没有可执行条件；可以继续补充阈值');
    } else if (parsed.unparsed.length) {
      toast('部分语句未可靠识别，已列在条件卡中，请确认');
    }
    if (window.innerWidth < 1040) $('#workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    toast('解析失败，请检查输入或重试');
  } finally {
    setBusy(false);
  }
}

function scheduleRun() {
  clearTimeout(state.runTimer);
  state.runTimer = setTimeout(() => runScreen(), 220);
}

function runScreen() {
  if (!state.stocks.length) return;
  const result = screen(state.stocks, state.conditions, state.options);
  state.result = result;
  state.showAll = false;
  addAudit('运行筛选', `${result.matched.length} 入选 / ${result.excluded.length} 排除 / ${result.stats.elapsedMs}ms`);
  renderResults();
}

function renderConditions() {
  const parsed = state.parsed;
  if (!parsed) return;
  $('#query-summary').innerHTML = `<b>原始意图</b>${esc(parsed.query)} <button class="ghost small" data-action="edit-query" style="margin-left:6px;padding:2px 6px;font-size:10px">修改</button>`;
  const presetTags = (parsed.presets || []).map((p) => `<span class="tag">${esc(p.label)}·${esc(PRESETS[p.id]?.variants?.[p.variant]?.label || p.variant)}</span>`).join('');
  $('#parse-meta').innerHTML = `
    <span class="tag ${parsed.source === 'llm' ? 'ai' : 'local'}">${parsed.source === 'llm' ? 'LLM 解析' : '本地规则解析'}</span>
    <span class="tag">${state.conditions.length} 个条件</span>
    <span class="tag">置信度 ${Math.round((parsed.confidence || 0) * 100)}%</span>
    ${presetTags}`;

  const cards = state.conditions.map((c, index) => conditionCard(c, index)).join('');
  const addOptions = FACTOR_ORDER.filter((k) => k !== 'industry').map((k) => `<option value="${k}">${esc(FACTORS[k].label)}</option>`).join('');
  $('#conditions-list').innerHTML = `${cards || '<div class="empty-state" style="padding:24px 8px"><b>还没有可执行条件</b>可以补充“PE 低于 30”“ROE 大于 15%”等具体条件。</div>'}
    <div class="add-condition" style="display:flex;gap:6px;margin-top:2px">
      <select id="add-factor" style="flex:1;padding:7px 8px;font-size:11px">${addOptions}</select>
      <button class="ghost small" data-action="add-condition">+ 添加</button>
    </div>`;

  renderAssumptions();
  renderAmbiguities();
  renderValidation();
}

function conditionCard(c, index) {
  const factor = FACTORS[c.factor];
  if (!factor) return '';
  const isIndustry = factor.type === 'string';
  const isBool = factor.type === 'boolean';
  const opOptions = isBool
    ? '<option value="is">为</option>'
    : isIndustry
      ? '<option value="contains">包含</option><option value="not_contains">不包含</option><option value="in">属于</option>'
      : ['>=', '<=', '>', '<', '==', 'between'].map((op) => `<option value="${op}" ${c.op === op ? 'selected' : ''}>${op === 'between' ? '介于' : op}</option>`).join('');
  const valueControl = isBool
    ? `<select data-cond-field="value"><option value="true" ${c.value === true ? 'selected' : ''}>是</option><option value="false" ${c.value === false ? 'selected' : ''}>否</option></select>`
    : isIndustry
      ? `<span class="tag">${esc(Array.isArray(c.value) ? c.value.join(' / ') : c.value)}</span>`
      : `<input type="number" step="${factor.step || 1}" value="${c.value ?? ''}" data-cond-field="value">
         ${c.op === 'between' ? `<span class="unit">到</span><input type="number" step="${factor.step || 1}" value="${c.value2 ?? ''}" data-cond-field="value2">` : ''}`;
  return `<div class="condition ${c.mode}" data-cond-id="${c.id}" data-cond-index="${index}">
    <div class="condition-top">
      <div>
        <div class="condition-label">${esc(describeCondition(c))}</div>
        <div class="condition-sub">${esc(factor.label)} · ${esc(factor.source)}${c.source === 'preset' ? ' · 来自预设' : ''}</div>
      </div>
      <div class="condition-actions">
        <div class="mode-toggle">
          <button data-cond-mode="hard" class="${c.mode === 'hard' ? 'active' : ''}" title="必须通过">硬性</button>
          <button data-cond-mode="soft" class="${c.mode === 'soft' ? 'active soft' : ''}" title="只影响综合分，不直接排除">加分</button>
        </div>
        <button class="icon-btn" data-cond-remove title="删除条件">×</button>
      </div>
    </div>
    <div class="condition-controls">
      ${isIndustry ? '' : `<select data-cond-field="op">${opOptions}</select>`}
      ${valueControl}
      ${isIndustry ? '' : `<span class="unit">${esc(factor.unit || '')}</span>`}
      <label class="weight-label">权重 <input type="number" min="0.1" max="5" step="0.1" value="${c.weight ?? 1}" data-cond-field="weight"></label>
    </div>
  </div>`;
}

function renderAssumptions() {
  const list = state.parsed?.assumptions || [];
  if (!list.length) { $('#assumptions').innerHTML = ''; return; }
  $('#assumptions').innerHTML = `<div class="assumption-box"><b>AI 的口径假设（可改）</b><ul>${list.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>`;
}

function renderAmbiguities() {
  const list = [...(state.parsed?.ambiguities || [])];
  if (state.parsed?.unparsed?.length) {
    list.push({ id: 'unparsed', kind: 'unsupported', question: `未可靠识别：${state.parsed.unparsed.join('；')}。可以换一种说法，或手动添加条件。`, options: [] });
  }
  if (!list.length) { $('#ambiguities').innerHTML = ''; return; }
  $('#ambiguities').innerHTML = `<div class="ambiguity-box"><b>需要你确认的口径</b>${list.map((a) => `
    <div class="amb-item">
      <div>${esc(a.question)}</div>
      ${(a.options || []).length ? `<div class="amb-options">${a.options.map((o) => `<button data-amb-id="${esc(a.id)}" data-amb-value="${esc(o.value)}" data-amb-kind="${esc(a.kind || '')}" title="${esc(o.description || '')}">${esc(o.label)}</button>`).join('')}</div>` : ''}
    </div>`).join('')}</div>`;
}

function renderValidation() {
  const v = validateConditions(state.conditions, state.result);
  const blocks = [];
  for (const e of v.errors) blocks.push(`<li><b>冲突：</b>${esc(e.message)}</li>`);
  for (const w of v.warnings) blocks.push(`<li><b>提醒：</b>${esc(w.message)}</li>`);
  for (const i of v.infos) blocks.push(`<li>${esc(i.message)}</li>`);
  if (!blocks.length) { $('#validation').innerHTML = ''; return; }
  const cls = v.errors.length ? 'error' : v.warnings.length ? 'warn' : 'info';
  const fix = state.result && state.result.matched.length === 0 && state.conditions.some((c) => c.mode === 'hard')
    ? '<button class="fix-btn" data-action="soften-first">把第一个硬条件改为加分项，看看会发生什么</button>' : '';
  $('#validation').innerHTML = `<div class="validation-box ${cls}"><b>条件体检</b><ul>${blocks.join('')}</ul>${fix}</div>`;
}

function onConditionClick(e) {
  if (e.target.closest('[data-action="add-condition"]')) { addConditionFromSelect(); return; }
  const card = e.target.closest('[data-cond-id]');
  if (!card) return;
  const index = Number(card.dataset.condIndex);
  const condition = state.conditions[index];
  if (!condition) return;
  if (e.target.closest('[data-cond-remove]')) {
    state.conditions.splice(index, 1);
    renderConditions(); runScreen(); return;
  }
  const mode = e.target.closest('[data-cond-mode]')?.dataset.condMode;
  if (mode) {
    condition.mode = mode;
    renderConditions(); runScreen(); return;
  }
  if (e.target.closest('[data-action="add-condition"]')) {
    addConditionFromSelect();
  }
}
function onConditionChange(e) {
  const card = e.target.closest('[data-cond-id]');
  if (!card) {
    if (e.target.closest('[data-action="add-condition"]')) addConditionFromSelect();
    return;
  }
  const index = Number(card.dataset.condIndex);
  const condition = state.conditions[index];
  const field = e.target.dataset.condField;
  if (!condition || !field) return;
  if (field === 'value') {
    if (condition.factor === 'above_ma60' || condition.factor === 'ma20_gt_ma60') condition.value = e.target.value === 'true';
    else condition.value = Number(e.target.value);
  } else if (field === 'value2') {
    condition.value2 = Number(e.target.value);
  } else if (field === 'op') {
    condition.op = e.target.value;
    if (condition.op === 'between' && condition.value2 === null) condition.value2 = condition.value;
  } else if (field === 'weight') {
    condition.weight = Math.max(0.1, Math.min(5, Number(e.target.value) || 1));
  }
  condition.label = describeCondition(condition);
  renderConditions(); scheduleRun();
}
function onConditionInput() { /* 等 change 再重算，避免每次按键都跑全市场 */ }

function addConditionFromSelect() {
  const key = $('#add-factor')?.value;
  if (!key) return;
  const factor = FACTORS[key];
  const defaults = {
    pe_ttm: 30, pb: 3, pe_industry_pct: 50, pb_industry_pct: 50, market_cap: 100,
    market_cap_industry_pct: 80, roe: 10, rev_growth: 10, profit_growth: 10,
    gross_margin: 30, debt_ratio: 50, ocf_ps: 0, eps: 0, roic: 10, vol_60d: 30,
    max_dd_60d: -15, ret_20d: 5, ret_60d: 10, turnover: 1, volume_ratio: 1,
  };
  const op = factor.type === 'boolean' ? 'is' : ['pe_ttm', 'pb', 'pe_industry_pct', 'pb_industry_pct', 'vol_60d', 'debt_ratio'].includes(key) ? '<=' : '>=';
  const c = makeCondition({
    factor: key,
    op,
    value: factor.type === 'boolean' ? true : (defaults[key] ?? factor.min ?? 0),
    source: 'user',
    mode: 'hard',
    weight: 1,
  });
  state.conditions.push(c);
  renderConditions(); runScreen();
}

function onAmbiguityClick(e) {
  const btn = e.target.closest('[data-amb-id]');
  if (!btn) return;
  const id = btn.dataset.ambId;
  const value = btn.dataset.ambValue;
  const ambiguity = (state.parsed?.ambiguities || []).find((a) => a.id === id);
  if (!ambiguity) return;
  if (ambiguity.kind === 'preset_variant') {
    state.conditions = applyPresetVariant(state.conditions, ambiguity.presetId, value);
  } else {
    state.conditions = applyChoice(state.conditions, id, value, ambiguity);
  }
  state.parsed.ambiguities = (state.parsed.ambiguities || []).filter((a) => a.id !== id);
  state.conditions = state.conditions.map((c) => makeCondition(c));
  renderConditions(); runScreen(); toast('已按你的口径更新条件');
  addAudit('确认口径', `${ambiguity.question} → ${value}`);
}

function softenFirst() {
  const idx = state.conditions.findIndex((c) => c.mode === 'hard' && c.enabled !== false);
  if (idx < 0) { toast('没有可调整的硬条件'); return; }
  const c = state.conditions[idx];
  c.mode = 'soft';
  renderConditions(); runScreen();
  toast(`已把「${c.label}」改为加分项`);
  addAudit('调整条件', `硬性 → 加分：${c.label}`);
}

function renderResults() {
  if (!state.result) return;
  const { matched, excluded, prefiltered, stats } = state.result;
  const excludedTotal = excluded.length + prefiltered.length;
  $('#tab-matched-count').textContent = matched.length;
  $('#tab-excluded-count').textContent = excluded.length;
  $('#result-title').textContent = state.conditions.length ? '筛选结果' : '股票池概览';
  $('#summary-cards').innerHTML = `
    <div class="summary-card accent"><div class="label">入选</div><div class="value">${matched.length.toLocaleString('zh-CN')}</div><div class="note">硬条件全部通过</div></div>
    <div class="summary-card"><div class="label">排除 / 预过滤</div><div class="value">${excludedTotal.toLocaleString('zh-CN')}</div><div class="note">${excluded.length} 条件未通过 · ${prefiltered.length} 预过滤</div></div>
    <div class="summary-card"><div class="label">条件结构</div><div class="value">${stats.hardConditions}<span style="font-size:12px;color:var(--muted)"> 硬 / </span>${stats.softConditions}<span style="font-size:12px;color:var(--muted)"> 加分</span></div><div class="note">${stats.conditionCount} 个启用条件</div></div>
    <div class="summary-card"><div class="label">引擎耗时</div><div class="value">${stats.elapsedMs > 0 ? stats.elapsedMs : '<1'}<span style="font-size:12px;color:var(--muted)"> ms</span></div><div class="note">${state.stocks.length.toLocaleString('zh-CN')} 只全量扫描</div></div>`;
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.activeTab));
  $('#tab-content').innerHTML = state.activeTab === 'matched' ? renderMatched()
    : state.activeTab === 'excluded' ? renderExcluded()
      : state.activeTab === 'impact' ? renderImpact()
        : renderQuality();
  if (state.activeTab === 'impact') bindImpactInitial();
  renderValidation();
}

function filteredMatched() {
  const q = state.filterText.trim().toLowerCase();
  let list = state.result.matched;
  if (q) list = list.filter((m) => `${m.stock.name} ${m.stock.code} ${m.stock.industry}`.toLowerCase().includes(q));
  if (state.sortKey === 'market_cap') list = [...list].sort((a, b) => (b.stock.market_cap || 0) - (a.stock.market_cap || 0));
  else if (state.sortKey === 'roe') list = [...list].sort((a, b) => (b.stock.roe ?? -999) - (a.stock.roe ?? -999));
  else if (state.sortKey === 'pe_ttm') list = [...list].sort((a, b) => (a.stock.pe_ttm ?? 1e9) - (b.stock.pe_ttm ?? 1e9));
  else if (state.sortKey === 'rev_growth') list = [...list].sort((a, b) => (b.stock.rev_growth ?? -999) - (a.stock.rev_growth ?? -999));
  return list;
}

function renderMatched() {
  if (!state.result) return '';
  if (!state.result.matched.length) {
    return `<div class="empty-state"><b>没有股票通过当前硬条件</b>可以放宽一个阈值，或把“走势稳定/估值合理”改为加分项。条件越少，结果越多；建议保留 2–3 个硬约束。</div>`;
  }
  const list = filteredMatched();
  const shown = state.showAll ? list : list.slice(0, 50);
  const rows = shown.map((m, i) => stockRow(m, i)).join('');
  return `<div class="toolbar">
    <div class="left"><input class="search-input" id="filter-input" placeholder="搜索名称 / 代码 / 行业" value="${esc(state.filterText)}">
      <select id="sort-select" class="search-input" style="width:140px">
        <option value="score" ${state.sortKey === 'score' ? 'selected' : ''}>按综合分</option>
        <option value="market_cap" ${state.sortKey === 'market_cap' ? 'selected' : ''}>按市值</option>
        <option value="roe" ${state.sortKey === 'roe' ? 'selected' : ''}>按 ROE</option>
        <option value="pe_ttm" ${state.sortKey === 'pe_ttm' ? 'selected' : ''}>按 PE 升序</option>
        <option value="rev_growth" ${state.sortKey === 'rev_growth' ? 'selected' : ''}>按营收增速</option>
      </select></div>
    <div class="right"><span style="color:var(--muted);font-size:10.5px">显示 ${shown.length} / ${list.length} 只</span></div>
  </div>
  <div class="table-wrap"><table><thead><tr>
    <th style="width:34px"></th><th>#</th><th>股票</th><th>行业</th><th>现价</th><th>涨跌</th><th>市值</th><th>PE</th><th>PB</th><th>ROE</th><th>营收增速</th><th>净利增速</th><th>波动率</th><th>回撤</th><th>综合分</th><th>质量</th>
  </tr></thead><tbody>${rows}</tbody></table></div>
  <div class="table-foot"><span>点击任意行查看逐股解释；勾选左侧可加入对比（最多 3 只）</span>${list.length > 50 ? `<button data-action="toggle-all">${state.showAll ? '收起' : `显示全部 ${list.length} 只`}</button>` : ''}</div>`;
}

function stockRow(m, i) {
  const s = m.stock;
  const flags = riskFlags(s).filter((f) => !['INDUSTRY_SMALL', 'MISSING_PB', 'MISSING_PE'].includes(f.code));
  const flagHtml = flags.slice(0, 2).map((f) => `<span class="flag ${f.code === 'ST' || f.code === 'NEGATIVE_PE' ? 'red' : ''}">${esc(f.label)}</span>`).join('') + (flags.length > 2 ? `<span class="flag gray">+${flags.length - 2}</span>` : '');
  return `<tr data-detail="${s.code}">
    <td><input type="checkbox" data-compare="${s.code}" ${state.compare.has(s.code) ? 'checked' : ''} aria-label="加入对比"></td>
    <td style="color:var(--muted);font-family:var(--mono)">${i + 1}</td>
    <td><div class="stock-cell"><b>${esc(s.name)}</b><small>${s.code} · ${s.market}</small></div></td>
    <td><span class="industry-chip">${esc(s.industry)}</span></td>
    <td>${fmt(s.price, 2)}</td>
    <td class="${pctClass(s.pct_chg)}">${pct(s.pct_chg)}</td>
    <td>${fmt(s.market_cap, 0)}亿</td>
    <td>${s.pe_ttm === null ? '<span class="flag red">亏损/缺失</span>' : fmt(s.pe_ttm, 1)}</td>
    <td>${fmt(s.pb, 2)}</td>
    <td>${fmt(s.roe, 1)}%</td>
    <td>${pct(s.rev_growth)}</td>
    <td>${pct(s.profit_growth)}</td>
    <td>${fmt(s.vol_60d, 1)}%</td>
    <td>${fmt(s.max_dd_60d, 1)}%</td>
    <td><span class="score">${m.score}</span></td>
    <td>${flagHtml || '<span class="flag gray">正常</span>'}</td>
  </tr>`;
}

function renderExcluded() {
  if (!state.result) return '';
  let list = state.result.excluded;
  const q = state.filterText.trim().toLowerCase();
  if (q) list = list.filter((e) => `${e.stock.name} ${e.stock.code} ${e.stock.industry}`.toLowerCase().includes(q));
  if (!list.length) return `<div class="empty-state"><b>没有“条件未通过”的股票</b>当前硬条件全部通过，或全部在预过滤阶段被排除。</div>`;
  const shown = list.slice(0, 80);
  const rows = shown.map((e) => {
    const fails = (e.hardFails || []).slice(0, 2);
    const reasons = fails.map((f) => `<span><b>${esc(f.condition.label)}</b>：${esc(f.reason || f.display)}</span>`).join('');
    const first = e.hardFails?.[0];
    return `<tr data-detail="${e.stock.code}">
      <td><div class="stock-cell"><b>${esc(e.stock.name)}</b><small>${e.stock.code} · ${e.stock.industry}</small></div></td>
      <td>${fmt(e.stock.price, 2)}</td>
      <td>${e.stock.pe_ttm === null ? '—' : fmt(e.stock.pe_ttm, 1)}</td>
      <td>${e.stock.roe === null ? '—' : fmt(e.stock.roe, 1) + '%'}</td>
      <td><div class="reason-list">${reasons}</div></td>
      <td>${first ? `<button class="ghost small" data-soften-cond="${esc(first.condition.id)}">改为加分项</button>` : ''}</td>
    </tr>`;
  }).join('');
  return `<div class="toolbar"><div class="left"><input class="search-input" id="filter-input" placeholder="搜索名称 / 代码 / 行业" value="${esc(state.filterText)}"><span style="color:var(--muted);font-size:10.5px">按市值展示前 ${shown.length} 只</span></div></div>
  <div class="table-wrap"><table><thead><tr><th>股票</th><th>现价</th><th>PE</th><th>ROE</th><th>未通过条件与原因</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>
  <div class="table-foot"><span>排除原因优先展示“条件未通过”；数据缺失会显示为“数据不足”，不会被当作 0。</span></div>`;
}

function renderImpact() {
  const numeric = state.conditions.map((c, i) => ({ c, i })).filter(({ c }) => c.enabled !== false && FACTORS[c.factor]?.type === 'number');
  if (!numeric.length) return `<div class="empty-state"><b>没有可滑动的数值条件</b>先在条件卡里加一个 PE、ROE、波动率之类的阈值条件。</div>`;
  return `<p style="color:var(--muted);font-size:11px;line-height:1.6;margin:0 0 10px">只改一个阈值、其他条件不变；拖动预览入选数量变化，松手后应用到条件卡。它回答的是“条件变化会带来什么影响”，不是收益回测。</p>
  <div class="impact-list">${numeric.map(({ c, i }) => {
    const factor = FACTORS[c.factor];
    const max = factor.key === 'pe_ttm' ? Math.min(factor.max, 200) : factor.key === 'pb' ? Math.min(factor.max, 30) : factor.key === 'market_cap' ? Math.min(factor.max, 20000) : factor.max;
    return `<div class="impact-card" data-impact-index="${i}">
      <div class="impact-head"><b>${esc(c.label)}</b><span class="delta" data-impact-delta>—</span></div>
      <div class="impact-slider"><input type="range" min="${factor.min ?? 0}" max="${max}" step="${factor.step || 1}" value="${Math.max(factor.min ?? 0, Math.min(max, Number(c.value) || 0))}" data-impact-range="${i}"><span class="val" data-impact-val>${formatFactorValue(c.factor, c.value)}</span></div>
      <div class="impact-meta"><span>当前 ${state.result.matched.length} 只</span><span data-impact-count>拖动查看变化</span></div>
      <div class="impact-chips" data-impact-chips></div>
    </div>`;
  }).join('')}</div>`;
}

function bindImpactInitial() {
  // 初始化每个滑块的 delta 为 0，避免空白
  $$('#tab-content [data-impact-index]').forEach((card) => {
    const delta = $('[data-impact-delta]', card);
    if (delta && delta.textContent === '—') delta.textContent = '±0';
  });
}

function onImpactInput(e) {
  const input = e.target.closest('[data-impact-range]');
  if (!input) return;
  const index = Number(input.dataset.impactRange);
  const card = input.closest('[data-impact-index]');
  const c = state.conditions[index];
  if (!c) return;
  const value = Number(input.value);
  $('[data-impact-val]', card).textContent = formatFactorValue(c.factor, value);
  const impact = conditionImpact(state.stocks, state.conditions, index, { value }, state.options);
  const delta = $('[data-impact-delta]', card);
  delta.textContent = `${impact.delta > 0 ? '+' : ''}${impact.delta} 只`;
  delta.className = `delta ${impact.delta > 0 ? 'up' : impact.delta < 0 ? 'down' : ''}`;
  $('[data-impact-count]', card).textContent = `→ ${impact.afterCount} 只`;
  const chips = $('[data-impact-chips]', card);
  const entrants = impact.entrants.slice(0, 6).map((m) => `<span class="chip">+ ${esc(m.stock.name)}</span>`).join('');
  const leavers = impact.leavers.slice(0, 4).map((m) => `<span class="chip">− ${esc(m.stock.name)}</span>`).join('');
  chips.innerHTML = `${entrants}${leavers}${impact.entrantCount + impact.leaverCount > 10 ? `<span class="chip">…共 ${impact.entrantCount} 进 / ${impact.leaverCount} 出</span>` : ''}`;
}

function onImpactChange(e) {
  const input = e.target.closest('[data-impact-range]');
  if (!input) return;
  const index = Number(input.dataset.impactRange);
  const c = state.conditions[index];
  if (!c) return;
  c.value = Number(input.value);
  c.label = describeCondition(c);
  renderConditions(); runScreen();
  toast(`已把「${c.label}」应用到条件卡`);
}

function renderQuality() {
  const q = state.meta?.quality || {};
  const cards = qualityCards(state.meta);
  const missing = Object.entries(q.missing_rate_pct || {});
  const sources = state.meta?.data_sources || [];
  const limitations = state.meta?.limitations || [];
  return `<div class="quality-grid">${cards.map((c) => `<div class="quality-card"><div class="k">${esc(c.label)}</div><div class="v">${esc(String(c.value))}</div><div class="n">${esc(c.note)}</div></div>`).join('')}</div>
  <div style="margin-top:12px;color:var(--muted);font-size:10.5px;line-height:1.6">数据快照：${esc(state.meta?.generated_at || '—')}｜交易日期：${esc(state.meta?.trade_date || '—')}｜财务报告期分布：${esc(JSON.stringify(q.report_date_distribution || {}))}</div>
  <table class="quality-table"><thead><tr><th>字段</th><th>缺失率</th><th>口径 / 说明</th></tr></thead><tbody>
    ${missing.map(([k, v]) => `<tr><td>${esc(FACTORS[k]?.label || k)}</td><td>${v}%</td><td>${esc(FACTORS[k]?.description || '—')}</td></tr>`).join('')}
  </tbody></table>
  <div class="source-list">${sources.map((s) => `<div class="source-item"><b>${esc(s.name)}</b> · ${esc(s.endpoint)}<br>${Object.entries(s.fields || {}).slice(0, 5).map(([k, v]) => `${esc(k)}=${esc(v)}`).join('；')}</div>`).join('')}</div>
  <div class="detail-note" style="margin-top:10px"><b>已知边界</b><br>${limitations.map((x) => `· ${esc(x)}`).join('<br>')}</div>`;
}

function onResultClick(e) {
  const soften = e.target.closest('[data-soften-cond]');
  if (soften) {
    const id = soften.dataset.softenCond;
    const c = state.conditions.find((x) => x.id === id);
    if (c) { c.mode = 'soft'; renderConditions(); runScreen(); toast(`已把「${c.label}」改为加分项`); }
    return;
  }
  if (e.target.closest('[data-action="toggle-all"]')) {
    state.showAll = !state.showAll;
    renderResults();
    return;
  }
  const row = e.target.closest('[data-detail]');
  if (row && !e.target.closest('input')) {
    openDetail(row.dataset.detail);
  }
}
function onResultChange(e) {
  const cb = e.target.closest('[data-compare]');
  if (cb) {
    const code = cb.dataset.compare;
    if (cb.checked && state.compare.size >= 3) { cb.checked = false; toast('最多对比 3 只'); return; }
    if (cb.checked) state.compare.add(code); else state.compare.delete(code);
    $('#compare-count').textContent = state.compare.size;
    return;
  }
  const filter = e.target.closest('#filter-input');
  if (filter) { state.filterText = filter.value; renderResults(); return; }
  const sort = e.target.closest('#sort-select');
  if (sort) { state.sortKey = sort.value; renderResults(); }
}

function findEntry(code) {
  const m = state.result?.matched.find((x) => x.stock.code === code);
  if (m) return { ...m, matched: true };
  const e = state.result?.excluded.find((x) => x.stock.code === code);
  if (e) return { ...e, matched: false };
  const s = state.stocks.find((x) => x.code === code);
  if (!s) return null;
  return { stock: s, matched: false, results: state.conditions.map((c) => ({ condition: c, status: 'na', value: null, display: '—', reason: '尚未运行筛选' })) };
}

function openDetail(code) {
  const entry = findEntry(code);
  if (!entry) return;
  const s = entry.stock;
  const exp = buildExplanation(s, entry, state.conditions);
  const results = entry.results || [];
  const statusBadge = (st) => st === 'pass' ? '<span class="badge pass">通过</span>' : st === 'fail' ? '<span class="badge fail">未通过</span>' : '<span class="badge missing">数据不足</span>';
  const rows = results.map((r) => `<tr>
    <td>${esc(r.condition.label)}</td>
    <td>${statusBadge(r.status)}</td>
    <td class="num">${esc(r.display ?? '—')}</td>
    <td>${esc(r.reason || '—')}</td>
    <td>${esc(FACTORS[r.condition.factor]?.source || '')}</td>
  </tr>`).join('');
  const risks = exp.risks || [];
  const report = s.report_date ? `${s.report_name || ''}（${s.report_date}）` : '缺失';
  $('#drawer-title').innerHTML = `<h3>${esc(s.name)}</h3><small>${s.code} · ${esc(s.industry)} · ${s.market}</small>`;
  $('#drawer-body').innerHTML = `
    <div class="detail-hero">
      <div><div class="price">${fmt(s.price, 2)} <span class="${pctClass(s.pct_chg)}" style="font-size:12px">${pct(s.pct_chg)}</span></div><div class="sub">总市值 ${fmt(s.market_cap, 0)} 亿 · ${esc(s.industry)}</div></div>
      <div class="detail-score"><div class="v">${entry.matched ? (entry.score ?? '—') : '—'}</div><div class="k">${entry.matched ? '综合分' : '未入选'}</div></div>
    </div>
    <div class="detail-section"><h4>结论</h4><div class="detail-note">${esc(exp.headline)}</div></div>
    <div class="detail-section"><h4>逐条件解释</h4>
      <table class="detail-table"><thead><tr><th>条件</th><th>状态</th><th>实际值</th><th>原因</th><th>数据源</th></tr></thead><tbody>${rows || '<tr><td colspan="5" style="color:var(--muted)">还没有条件</td></tr>'}</tbody></table>
    </div>
    <div class="detail-section"><h4>数据口径</h4><div class="detail-note">
      PE：${s.pe_ttm === null ? '缺失/为负（按缺失处理）' : `${fmt(s.pe_ttm, 2)}x（${s.pe_source || '行情'}）`}；PB：${s.pb === null ? '缺失/为负' : `${fmt(s.pb, 2)}x`}<br>
      财务：${esc(report)}；披露日：${esc(s.notice_date || '—')}；ROE 为报告期加权，未年化<br>
      走势：近 60 日年化波动 ${fmt(s.vol_60d, 1)}% / 最大回撤 ${fmt(s.max_dd_60d, 1)}% / MA60 ${s.above_ma60 === null ? '—' : s.above_ma60 ? '上方' : '下方'}<br>
      行业样本：${s.industry_n ?? '—'} 只；PE 行业分位 ${s.pe_industry_pct === null ? '不可用' : fmt(s.pe_industry_pct, 1) + '%'}
    </div></div>
    <div class="detail-section"><h4>风险与不确定</h4><div class="detail-risks">${risks.length ? risks.map((r) => `<span class="flag ${r.code === 'ST' || r.code === 'NEGATIVE_PE' ? 'red' : ''}">${esc(r.label)}</span>`).join('') : '<span class="flag gray">当前快照未触发显著风险标记</span>'}</div>
      ${s.quality_flags?.includes('GROWTH_OUTLIER') ? '<div class="detail-note" style="margin-top:8px">增速绝对值 >300%，可能来自低基数/一次性收益；请回到原始报告核对，不要把同比直接当持续性。</div>' : ''}
    </div>
    <div class="detail-actions">
      <button class="ghost small" data-drawer-compare="${s.code}">${state.compare.has(s.code) ? '移出对比' : '加入对比'}</button>
      <button class="ghost small" data-action="close-drawer">关闭</button>
    </div>`;
  $('#drawer').classList.remove('hidden');
  addAudit('查看详情', `${s.code} ${s.name}`);
}

function onDrawerClick(e) {
  const btn = e.target.closest('[data-drawer-compare]');
  if (btn) {
    const code = btn.dataset.drawerCompare;
    if (state.compare.has(code)) state.compare.delete(code);
    else if (state.compare.size < 3) state.compare.add(code);
    else { toast('最多对比 3 只'); return; }
    $('#compare-count').textContent = state.compare.size;
    openDetail(code);
  }
}

function closeDrawer() { $('#drawer').classList.add('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }

function openCompareModal() {
  const codes = [...state.compare];
  if (codes.length < 2) { toast('至少选择 2 只股票再对比'); return; }
  const entries = codes.map((c) => findEntry(c)).filter(Boolean);
  const stocks = entries.map((e) => e.stock);
  const rows = [
    ['现价', (s) => fmt(s.price, 2), null],
    ['涨跌幅', (s) => pct(s.pct_chg), 'pct'],
    ['总市值(亿)', (s) => fmt(s.market_cap, 0), 'higher'],
    ['PE', (s) => (s.pe_ttm === null ? '—' : fmt(s.pe_ttm, 1)), 'lower'],
    ['PB', (s) => fmt(s.pb, 2), 'lower'],
    ['ROE', (s) => (s.roe === null ? '—' : fmt(s.roe, 1) + '%'), 'higher'],
    ['营收增速', (s) => pct(s.rev_growth), 'higher'],
    ['净利增速', (s) => pct(s.profit_growth), 'higher'],
    ['波动率', (s) => fmt(s.vol_60d, 1) + '%', 'lower'],
    ['最大回撤', (s) => fmt(s.max_dd_60d, 1) + '%', 'higher'],
    ['综合分', (s) => { const e = entries.find((x) => x.stock.code === s.code); return e?.matched ? e.score : '—'; }, 'higher'],
  ];
  const body = `<table class="compare-table"><thead><tr><th>指标</th>${stocks.map((s) => `<th>${esc(s.name)}<br><small style="color:var(--muted);font-weight:400">${s.code}</small></th>`).join('')}</tr></thead><tbody>
    ${rows.map(([label, fn, dir]) => {
      const vals = stocks.map((s) => fn(s));
      const nums = vals.map((v, i) => ({ v, i })).filter((x) => x.v !== '—' && !Number.isNaN(Number(String(x.v).replace(/[%+,]/g, ''))));
      let best = -1, worst = -1;
      if (dir && nums.length >= 2) {
        const sorted = [...nums].sort((a, b) => Number(String(a.v).replace(/[%+,]/g, '')) - Number(String(b.v).replace(/[%+,]/g, '')));
        best = dir === 'lower' ? sorted[0].i : sorted[sorted.length - 1].i;
        worst = dir === 'lower' ? sorted[sorted.length - 1].i : sorted[0].i;
      }
      return `<tr><td>${label}</td>${vals.map((v, i) => `<td class="${i === best ? 'best' : i === worst ? 'worst' : ''}">${esc(v)}</td>`).join('')}</tr>`;
    }).join('')}
  </tbody></table>
  <div class="compare-note">${new Set(stocks.map((s) => s.industry)).size > 1 ? '跨行业对比：PE/PB、负债率、毛利率的行业基准不同，结论不可直接横比。' : '同行业对比：估值与盈利指标更具可比性。'}<br>${new Set(stocks.map((s) => s.report_date)).size > 1 ? '报告期不同：增速与 ROE 不可直接横比，请先看各自的报告期。' : '报告期一致，可直接比较。'}<br>绿色为相对更优、红色为相对更弱；仅在当前指标方向下成立，不代表投资建议。</div>`;
  $('#modal-title').textContent = `对比 ${stocks.length} 只股票`;
  $('#modal-body').innerHTML = body;
  $('#modal').classList.remove('hidden');
  addAudit('对比股票', stocks.map((s) => s.name).join(' / '));
}

function openSavedModal() {
  const items = state.saved || [];
  $('#modal-title').textContent = '保存的策略';
  $('#modal-body').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
      <div style="color:var(--muted);font-size:11px">保存在浏览器 localStorage；只保存条件与选项，不保存数据快照。</div>
      <button class="primary" id="save-current">保存当前策略</button>
    </div>
    <div class="saved-list">${items.length ? items.map((it) => `<div class="saved-item"><div><b>${esc(it.name)}</b><small>${esc(it.query)} · ${new Date(it.createdAt).toLocaleString('zh-CN')} · ${it.resultCount ?? '—'} 只入选</small></div><div style="display:flex;gap:4px"><button data-saved-load="${esc(it.id)}">加载</button><button data-saved-delete="${esc(it.id)}">删除</button></div></div>`).join('') : '<div class="empty-state" style="padding:26px"><b>还没有保存的策略</b>运行筛选后，点“保存当前策略”即可。</div>'}</div>
    <div class="detail-note" style="margin-top:12px">下一步可以接“定时刷新 + 新进/移出监控”，当前版本只保存条件，监控留作未做事项。</div>`;
  $('#modal').classList.remove('hidden');
}

function saveCurrent() {
  if (!state.conditions.length && !state.parsed) { toast('还没有可保存的条件'); return; }
  const name = window.prompt('策略名称', (state.parsed?.query || '未命名策略').slice(0, 24));
  if (!name) return;
  const item = {
    id: `s_${Date.now()}`,
    name: name.trim(),
    query: state.parsed?.query || '',
    conditions: state.conditions.map((c) => ({ ...c })),
    options: { ...state.options },
    createdAt: nowIso(),
    resultCount: state.result?.matched.length ?? null,
  };
  state.saved.unshift(item);
  state.saved = state.saved.slice(0, 30);
  persistSaved();
  addAudit('保存策略', name);
  closeModal();
  toast('策略已保存');
}

function onModalClick(e) {
  const save = e.target.closest('#save-current');
  if (save) { saveCurrent(); return; }
  const load = e.target.closest('[data-saved-load]');
  if (load) {
    const item = state.saved.find((x) => x.id === load.dataset.savedLoad);
    if (!item) return;
    state.parsed = { query: item.query, conditions: [], options: item.options, assumptions: [], ambiguities: [], unparsed: [], presets: [], source: 'saved', confidence: 1 };
    state.conditions = (item.conditions || []).map((c) => makeCondition(c));
    state.options = { excludeST: true, excludeSuspended: true, board: 'all', ...(item.options || {}) };
    $('#query-input').value = item.query || '';
    $('#exclude-st').checked = state.options.excludeST !== false;
    $('#exclude-suspended').checked = state.options.excludeSuspended !== false;
    $('#board-select').value = state.options.board || 'all';
    $('#hero').classList.add('compact');
    $('#workspace').classList.remove('hidden');
    closeModal();
    renderConditions(); runScreen();
    toast(`已加载「${item.name}」`);
    addAudit('加载策略', item.name);
    return;
  }
  const del = e.target.closest('[data-saved-delete]');
  if (del) {
    state.saved = state.saved.filter((x) => x.id !== del.dataset.savedDelete);
    persistSaved(); openSavedModal(); toast('已删除');
  }
}

function exportJson() {
  if (!state.result) { toast('先运行一次筛选'); return; }
  const payload = {
    exportedAt: nowIso(),
    meta: { trade_date: state.meta?.trade_date, generated_at: state.meta?.generated_at, stock_count: state.meta?.stock_count, sources: state.meta?.data_sources },
    query: state.parsed?.query || '',
    conditions: state.conditions,
    options: state.options,
    stats: state.result.stats,
    matched: state.result.matched.slice(0, 100).map((m) => ({ code: m.stock.code, name: m.stock.name, industry: m.stock.industry, score: m.score, price: m.stock.price, pe_ttm: m.stock.pe_ttm, pb: m.stock.pb, roe: m.stock.roe, rev_growth: m.stock.rev_growth, profit_growth: m.stock.profit_growth, vol_60d: m.stock.vol_60d, max_dd_60d: m.stock.max_dd_60d, flags: m.stock.quality_flags })),
    excluded: state.result.excluded.slice(0, 50).map((e) => ({ code: e.stock.code, name: e.stock.name, reasons: e.reasons })),
    disclaimer: '仅用于信息筛选与研究，不构成投资建议，不预测涨跌，不承诺收益。',
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `intent-screener-${(state.meta?.trade_date || 'snapshot').replaceAll('-', '')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  addAudit('导出结果', `${state.result.matched.length} 入选`);
}

function openDataModal() {
  $('#modal-title').textContent = '数据口径与职责边界';
  const sources = state.meta?.data_sources || [];
  const defs = state.meta?.definitions || [];
  $('#modal-body').innerHTML = `
    <div class="detail-note"><b>一句话边界：</b>AI 只负责“把话听懂、把口径说清楚、把理由写出来”；阈值求值、排序、敏感性都由确定性引擎完成；数字只来自快照字段，缺失不会被当成 0。</div>
    <div class="detail-section"><h4>数据源</h4><div class="source-list">${sources.map((s) => `<div class="source-item"><b>${esc(s.name)}</b> · ${esc(s.endpoint)}<br>时点：${esc(String(s.as_of))}<br>${Object.entries(s.fields || {}).map(([k, v]) => `${esc(k)}=${esc(v)}`).join('；')}</div>`).join('')}</div></div>
    <div class="detail-section"><h4>字段口径</h4><table class="detail-table"><thead><tr><th>字段</th><th>单位</th><th>说明</th></tr></thead><tbody>${defs.map((d) => `<tr><td>${esc(d.label)}</td><td>${esc(d.unit)}</td><td>${esc(d.note)}</td></tr>`).join('')}</tbody></table></div>
    <div class="detail-section"><h4>已知边界 / 未做事项</h4><div class="detail-note">${(state.meta?.limitations || []).map((x) => `· ${esc(x)}`).join('<br>')}<br>· 未接入实时行情推送、公告原文、研报、回测和定时监控；当前“监控”只保留为保存策略/后续扩展。</div></div>
    <div class="detail-section"><h4>职责边界</h4><table class="detail-table"><thead><tr><th>角色</th><th>做</th><th>不做</th></tr></thead><tbody>
      <tr><td>AI / 解析器</td><td>理解意图、提出条件、解释口径、生成可读理由</td><td>不计算因子、不排序、不补缺失值、不输出买卖建议</td></tr>
      <tr><td>确定性引擎</td><td>条件求值、硬/软过滤、综合分、敏感性、冲突检查</td><td>不猜意图、不生成没有数据支撑的结论</td></tr>
      <tr><td>数据层</td><td>提供字段、来源、时点、缺失标记</td><td>不判断意图、不做推荐</td></tr>
    </tbody></table></div>`;
  $('#modal').classList.remove('hidden');
}

function openAuditModal() {
  $('#modal-title').textContent = '审计记录';
  const rows = state.audit.length ? state.audit.map((a) => `<div class="audit-row"><time>${new Date(a.time).toLocaleString('zh-CN')}</time><div><b>${esc(a.action)}</b><br><span style="color:var(--muted)">${esc(a.detail)}</span></div></div>`).join('') : '<div class="empty-state" style="padding:24px"><b>还没有操作记录</b>解析、运行、保存、对比等动作会记录在这里。</div>';
  $('#modal-body').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><span style="color:var(--muted);font-size:11px">仅保存在当前页面内存，刷新后清空；用于说明可追溯性。</span><button class="ghost small" id="export-audit">导出审计 JSON</button></div><div class="audit-list">${rows}</div>`;
  $('#modal').classList.remove('hidden');
  $('#export-audit')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.audit, null, 2)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'intent-screener-audit.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}

function openSelfTest() {
  const results = runSelfTests({ stocks: state.stocks, meta: state.meta, conditions: state.conditions, options: state.options });
  const pass = results.filter((r) => r.pass).length;
  $('#modal-title').textContent = `自检：${pass}/${results.length} 通过`;
  $('#modal-body').innerHTML = `<div class="test-list">${results.map((r) => `<div class="test-row"><span class="${r.pass ? 'ok' : 'no'}">${r.pass ? 'PASS' : 'FAIL'}</span><div><b>${esc(r.name)}</b><small>${esc(r.detail || '')}</small></div></div>`).join('')}</div>
    <div class="detail-note" style="margin-top:10px">自检使用当前快照与前端的真实引擎函数，覆盖解析、缺失值、负 PE、冲突、软条件、敏感性、合规文案。命令行版本：<code>npm test</code>。</div>`;
  $('#modal').classList.remove('hidden');
  addAudit('运行自检', `${pass}/${results.length} 通过`);
}

init();
