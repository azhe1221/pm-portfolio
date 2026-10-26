/**
 * 意图选股器 · 确定性筛选与解释引擎
 *
 * 设计边界：
 * - 本模块只做确定性计算：条件求值、硬/软过滤、综合分、敏感性、冲突检查。
 * - 不做自然语言理解（由 parser.js / 可选 LLM 负责）。
 * - 不补缺失值：缺失返回 MISSING，不当作 0 或 false。
 * - 不输出买卖建议：只输出「入选 / 排除 / 观察」与可回溯理由。
 */

export const FACTORS = {
  pe_ttm: {
    key: 'pe_ttm', label: 'PE（TTM）', short: 'PE', unit: '倍', type: 'number',
    direction: 'lower', min: 0, max: 2000, step: 0.5, decimals: 2, group: '估值',
    source: '行情 f115，缺失回退 f9',
    description: '市盈率（TTM）。亏损股的 PE 为负，不能视为“便宜”；本产品按缺失处理并标记。',
  },
  pb: {
    key: 'pb', label: 'PB（市净率）', short: 'PB', unit: '倍', type: 'number',
    direction: 'lower', min: 0, max: 100, step: 0.1, decimals: 2, group: '估值',
    source: '行情 f23',
    description: '市净率。负 PB 按缺失处理。',
  },
  pe_industry_pct: {
    key: 'pe_industry_pct', label: 'PE 行业分位', short: 'PE分位', unit: '%', type: 'number',
    direction: 'lower', min: 0, max: 100, step: 5, decimals: 1, group: '估值',
    source: '本快照内同行业正 PE 排名',
    description: '同行业内 PE 由低到高的分位，越低越便宜。行业有效样本少于 8 只时为空。',
  },
  pb_industry_pct: {
    key: 'pb_industry_pct', label: 'PB 行业分位', short: 'PB分位', unit: '%', type: 'number',
    direction: 'lower', min: 0, max: 100, step: 5, decimals: 1, group: '估值',
    source: '本快照内同行业正 PB 排名',
    description: '同行业内 PB 由低到高的分位，越低越便宜。',
  },
  market_cap: {
    key: 'market_cap', label: '总市值', short: '市值', unit: '亿元', type: 'number',
    direction: 'neutral', min: 0, max: 100000, step: 10, decimals: 1, group: '规模',
    source: '行情 f20',
    description: '总市值（亿元）。大小盘本身无优劣，取决于策略。',
  },
  market_cap_industry_pct: {
    key: 'market_cap_industry_pct', label: '市值行业分位', short: '市值分位', unit: '%', type: 'number',
    direction: 'higher', min: 0, max: 100, step: 5, decimals: 1, group: '规模',
    source: '本快照内同行业市值排名',
    description: '同行业内市值由小到大的分位；越高越接近行业龙头。',
  },
  turnover: {
    key: 'turnover', label: '换手率', short: '换手', unit: '%', type: 'number',
    direction: 'neutral', min: 0, max: 100, step: 0.1, decimals: 2, group: '交易',
    source: '行情 f8',
    description: '当日换手率。过高可能意味着交易拥挤，过低可能流动性不足。',
  },
  volume_ratio: {
    key: 'volume_ratio', label: '量比', short: '量比', unit: '', type: 'number',
    direction: 'neutral', min: 0, max: 50, step: 0.1, decimals: 2, group: '交易',
    source: '行情 f10',
    description: '当日量比。',
  },
  pct_chg: {
    key: 'pct_chg', label: '当日涨跌幅', short: '涨跌', unit: '%', type: 'number',
    direction: 'neutral', min: -20, max: 20, step: 0.1, decimals: 2, group: '交易', signed: true,
    source: '行情 f3',
    description: '当日涨跌幅（盘中快照会变化）。',
  },
  ret_20d: {
    key: 'ret_20d', label: '近20日涨跌幅', short: '20日', unit: '%', type: 'number',
    direction: 'neutral', min: -100, max: 300, step: 1, decimals: 2, group: '走势', signed: true,
    source: '日K收盘价',
    description: '近 20 个交易日收盘涨跌幅。',
  },
  ret_60d: {
    key: 'ret_60d', label: '近60日涨跌幅', short: '60日', unit: '%', type: 'number',
    direction: 'neutral', min: -100, max: 500, step: 1, decimals: 2, group: '走势', signed: true,
    source: '日K收盘价',
    description: '近 60 个交易日收盘涨跌幅。',
  },
  vol_60d: {
    key: 'vol_60d', label: '近60日年化波动率', short: '波动率', unit: '%', type: 'number',
    direction: 'lower', min: 0, max: 300, step: 1, decimals: 1, group: '走势',
    source: '日K对数收益 × √252',
    description: '近 60 个交易日对数收益的年化标准差。越低越稳定。',
  },
  max_dd_60d: {
    key: 'max_dd_60d', label: '近60日最大回撤', short: '回撤', unit: '%', type: 'number',
    direction: 'higher', min: -100, max: 0, step: 1, decimals: 1, group: '走势', signed: true,
    source: '日K区间峰值到谷值',
    description: '近 60 个交易日最大回撤，负值越大回撤越深；-15% 优于 -30%。',
  },
  above_ma60: {
    key: 'above_ma60', label: '站上60日均线', short: 'MA60', unit: '', type: 'boolean',
    direction: 'higher', group: '走势',
    source: '日K收盘价与 MA60',
    description: '最新收盘价是否高于 60 日均线。历史不足 60 日时为空。',
  },
  ma20_gt_ma60: {
    key: 'ma20_gt_ma60', label: '20日均线高于60日均线', short: '均线多头', unit: '', type: 'boolean',
    direction: 'higher', group: '走势',
    source: '日K MA20/MA60',
    description: '短期均线是否高于长期均线。',
  },
  roe: {
    key: 'roe', label: 'ROE（报告期加权）', short: 'ROE', unit: '%', type: 'number',
    direction: 'higher', min: -100, max: 100, step: 0.5, decimals: 2, group: '盈利', signed: true,
    source: 'F10 ROEJQ',
    description: '最新报告期加权 ROE，未年化。中报/三季报不可与年报直接横比。',
  },
  rev_growth: {
    key: 'rev_growth', label: '营收同比', short: '营收增速', unit: '%', type: 'number',
    direction: 'higher', min: -100, max: 500, step: 1, decimals: 2, group: '成长', signed: true,
    source: 'F10 TOTALOPERATEREVETZ',
    description: '最新报告期营业总收入同比。基数异常时标记 GROWTH_OUTLIER。',
  },
  profit_growth: {
    key: 'profit_growth', label: '归母净利同比', short: '净利增速', unit: '%', type: 'number',
    direction: 'higher', min: -300, max: 1000, step: 1, decimals: 2, group: '成长', signed: true,
    source: 'F10 PARENTNETPROFITTZ',
    description: '最新报告期归母净利润同比。基数异常时标记 GROWTH_OUTLIER。',
  },
  gross_margin: {
    key: 'gross_margin', label: '销售毛利率', short: '毛利率', unit: '%', type: 'number',
    direction: 'higher', min: -50, max: 100, step: 1, decimals: 2, group: '盈利', signed: true,
    source: 'F10 XSMLL',
    description: '销售毛利率。银行/保险/证券等金融行业通常不适用。',
  },
  gross_margin_chg: {
    key: 'gross_margin_chg', label: '毛利率同比变化', short: '毛利率变化', unit: '%', type: 'number',
    direction: 'higher', min: -200, max: 200, step: 1, decimals: 2, group: '盈利', signed: true,
    source: 'F10 XSMLL_TB（相对变化）',
    description: '毛利率同比相对变化，不等同于百分点变化；使用时需看原始报告。',
  },
  debt_ratio: {
    key: 'debt_ratio', label: '资产负债率', short: '负债率', unit: '%', type: 'number',
    direction: 'lower', min: 0, max: 100, step: 1, decimals: 2, group: '质量', signed: true,
    source: 'F10 ZCFZL',
    description: '资产负债率。银行/保险/证券天然高负债，不可与制造业直接比较。',
  },
  ocf_ps: {
    key: 'ocf_ps', label: '每股经营现金流', short: '每股现金流', unit: '元', type: 'number',
    direction: 'higher', min: -100, max: 100, step: 0.1, decimals: 2, group: '质量', signed: true,
    source: 'F10 MGJYXJJE',
    description: '每股经营活动现金流净额。',
  },
  eps: {
    key: 'eps', label: '每股收益', short: 'EPS', unit: '元', type: 'number',
    direction: 'higher', min: -100, max: 100, step: 0.1, decimals: 2, group: '盈利', signed: true,
    source: 'F10 EPSJB',
    description: '基本每股收益。',
  },
  bps: {
    key: 'bps', label: '每股净资产', short: 'BPS', unit: '元', type: 'number',
    direction: 'higher', min: -100, max: 1000, step: 0.1, decimals: 2, group: '质量', signed: true,
    source: 'F10 BPS',
    description: '每股净资产。为负时 PE/PB 等估值指标失效。',
  },
  roic: {
    key: 'roic', label: 'ROIC', short: 'ROIC', unit: '%', type: 'number',
    direction: 'higher', min: -100, max: 100, step: 0.5, decimals: 2, group: '质量', signed: true,
    source: 'F10 ROIC',
    description: '投入资本回报率。部分行业为空。',
  },
  industry: {
    key: 'industry', label: '所属行业', short: '行业', unit: '', type: 'string', group: '分类',
    source: '行情 f100',
    description: '东方财富行业分类。',
  },
};

export const OPERATORS = {
  '>=': '≥', '<=': '≤', '>': '>', '<': '<', '==': '=', between: '介于',
  is: '为', contains: '包含', not_contains: '不包含', in: '属于',
};

export const FACTOR_ORDER = [
  'pe_ttm', 'pe_industry_pct', 'pb', 'pb_industry_pct', 'market_cap', 'market_cap_industry_pct',
  'roe', 'rev_growth', 'profit_growth', 'gross_margin', 'gross_margin_chg', 'debt_ratio',
  'ocf_ps', 'eps', 'roic', 'vol_60d', 'max_dd_60d', 'ret_20d', 'ret_60d', 'above_ma60',
  'ma20_gt_ma60', 'turnover', 'volume_ratio', 'pct_chg', 'industry',
];

const DIST_CACHE = new WeakMap();

export function formatNumber(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  return n.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatFactorValue(key, value, options = {}) {
  const factor = FACTORS[key];
  if (!factor) return value === null || value === undefined ? '—' : String(value);
  if (value === null || value === undefined) return '—';
  if (factor.type === 'number' && Number.isNaN(Number(value))) return '—';
  if (factor.type === 'boolean') return value ? '是' : '否';
  if (factor.type === 'string') return String(value);
  const n = Number(value);
  const decimals = options.decimals ?? factor.decimals ?? 2;
  const sign = options.signed !== false && factor.signed && n > 0 ? '+' : '';
  if (factor.unit === '%') return `${sign}${formatNumber(n, decimals)}%`;
  if (factor.unit === '倍') return `${formatNumber(n, decimals)}x`;
  if (factor.unit === '亿元') return `${formatNumber(n, decimals)}亿`;
  if (factor.unit === '元') return `${formatNumber(n, decimals)}元`;
  return `${sign}${formatNumber(n, decimals)}${factor.unit || ''}`;
}

export function describeCondition(condition) {
  const factor = FACTORS[condition.factor];
  if (!factor) return `未知条件：${condition.factor}`;
  const op = condition.op === 'is' ? '=' : (OPERATORS[condition.op] || condition.op);
  let rhs = '';
  if (condition.op === 'between') {
    rhs = `${formatFactorValue(condition.factor, condition.value, { signed: false })} ~ ${formatFactorValue(condition.factor, condition.value2, { signed: false })}`;
  } else if (condition.op === 'is') {
    rhs = condition.value ? '是' : '否';
  } else if (condition.op === 'in') {
    rhs = Array.isArray(condition.value) ? condition.value.join('、') : String(condition.value);
  } else {
    rhs = formatFactorValue(condition.factor, condition.value, { signed: false });
  }
  return `${factor.label} ${op} ${rhs}`;
}

export function makeCondition(partial) {
  const factor = FACTORS[partial.factor];
  const cond = {
    id: partial.id || `c_${Math.random().toString(36).slice(2, 9)}`,
    factor: partial.factor,
    op: partial.op || '>=',
    value: partial.value,
    value2: partial.value2 ?? null,
    label: '',
    source: partial.source || 'user',
    presetId: partial.presetId || null,
    confidence: partial.confidence ?? 1,
    note: partial.note || '',
    mode: partial.mode || 'hard',
    weight: partial.weight ?? 1,
    enabled: partial.enabled !== false,
  };
  cond.label = describeCondition(cond);
  if (factor && factor.type === 'number' && cond.value !== null && cond.value !== undefined) {
    cond.value = Number(cond.value);
    if (cond.value2 !== null && cond.value2 !== undefined) cond.value2 = Number(cond.value2);
  }
  return cond;
}

export function missingReason(stock, factorKey) {
  const flags = stock?.quality_flags || [];
  if (factorKey === 'pe_ttm') {
    if (flags.includes('NEGATIVE_PE')) return 'PE 为负（亏损），估值条件不适用；不能把负 PE 当作便宜';
    if (flags.includes('MISSING_PE')) return 'PE 缺失（可能无盈利数据）';
  }
  if (factorKey === 'pb') {
    if (flags.includes('NEGATIVE_PB')) return 'PB 为负，估值条件不适用';
    if (flags.includes('MISSING_PB')) return 'PB 缺失';
  }
  if (['roe', 'rev_growth', 'profit_growth', 'eps', 'bps', 'ocf_ps', 'roic'].includes(factorKey)) {
    if (flags.includes('MISSING_FIN')) return '财务数据缺失';
    if (flags.includes('STALE_FIN')) return '财务报告期早于 2026 中报，已标记过期';
  }
  if (['vol_60d', 'max_dd_60d', 'ret_20d', 'ret_60d', 'above_ma60', 'ma20_gt_ma60'].includes(factorKey)) {
    if (flags.includes('MISSING_KLINE')) return '历史行情不足，无法计算走势指标';
    if (flags.includes('NEW_LISTING_OR_SHORT_HISTORY')) return '上市/交易历史不足 60 日';
  }
  if (factorKey === 'gross_margin' && ['银行', '保险', '证券'].some((x) => String(stock?.org_type || '').includes(x))) {
    return '该行业不适用毛利率';
  }
  if (factorKey.endsWith('_industry_pct')) {
    if (flags.includes('INDUSTRY_SMALL')) return '行业有效样本不足 8 只，行业分位不可用';
    if (flags.includes('NEGATIVE_PE') || flags.includes('MISSING_PE')) return 'PE 缺失/为负，无法计算行业分位';
  }
  if (factorKey === 'industry' && (!stock?.industry || stock.industry === '未分类')) return '行业分类缺失';
  return '数据缺失';
}

export function evaluateCondition(stock, condition) {
  const factor = FACTORS[condition.factor];
  if (!factor) {
    return { status: 'na', value: null, display: '—', reason: `不支持的因子：${condition.factor}` };
  }
  const raw = stock?.[condition.factor];
  if (raw === null || raw === undefined || (typeof raw === 'number' && Number.isNaN(raw))) {
    return {
      status: 'missing',
      value: null,
      display: '—',
      reason: missingReason(stock, condition.factor),
    };
  }
  if (factor.type === 'boolean') {
    const expected = condition.value === true || condition.value === 'true';
    const pass = Boolean(raw) === expected;
    return {
      status: pass ? 'pass' : 'fail',
      value: raw,
      display: raw ? '是' : '否',
      reason: pass ? '' : `实际为「${raw ? '是' : '否'}」，要求「${expected ? '是' : '否'}」`,
    };
  }
  if (factor.type === 'string') {
    const actual = String(raw);
    let pass = false;
    if (condition.op === 'contains') pass = actual.includes(String(condition.value));
    else if (condition.op === 'not_contains') pass = !actual.includes(String(condition.value));
    else if (condition.op === 'in') {
      const list = Array.isArray(condition.value) ? condition.value : String(condition.value).split(/[、,，|]/);
      pass = list.some((x) => actual.includes(String(x).trim()));
    } else if (condition.op === '==') pass = actual === String(condition.value);
    return {
      status: pass ? 'pass' : 'fail',
      value: raw,
      display: actual,
      reason: pass ? '' : `实际为「${actual}」`,
    };
  }

  const actual = Number(raw);
  let target = Number(condition.value);
  let target2 = condition.value2 === null || condition.value2 === undefined ? null : Number(condition.value2);
  if (condition.op === 'between') {
    if (target2 === null || Number.isNaN(target2)) {
      return { status: 'na', value: actual, display: formatFactorValue(condition.factor, actual), reason: '区间条件缺少第二个阈值' };
    }
    if (target > target2) [target, target2] = [target2, target];
  }
  let pass = false;
  switch (condition.op) {
    case '>=': pass = actual >= target; break;
    case '<=': pass = actual <= target; break;
    case '>': pass = actual > target; break;
    case '<': pass = actual < target; break;
    case '==': pass = Math.abs(actual - target) < 1e-9; break;
    case 'between': pass = actual >= target && actual <= target2; break;
    default: return { status: 'na', value: actual, display: formatFactorValue(condition.factor, actual), reason: `不支持的运算符：${condition.op}` };
  }
  return {
    status: pass ? 'pass' : 'fail',
    value: actual,
    display: formatFactorValue(condition.factor, actual),
    reason: pass ? '' : `实际为 ${formatFactorValue(condition.factor, actual)}`,
  };
}

export function buildDistribution(stocks) {
  if (DIST_CACHE.has(stocks)) return DIST_CACHE.get(stocks);
  const keys = Object.keys(FACTORS);
  const dist = {};
  for (const key of keys) {
    const factor = FACTORS[key];
    if (factor.type !== 'number') continue;
    const values = [];
    for (const s of stocks) {
      const v = s[key];
      if (v === null || v === undefined || Number.isNaN(Number(v))) continue;
      if ((key === 'pe_ttm' || key === 'pb') && Number(v) <= 0) continue;
      values.push(Number(v));
    }
    values.sort((a, b) => a - b);
    dist[key] = values;
  }
  DIST_CACHE.set(stocks, dist);
  return dist;
}

function percentileRank(sorted, v) {
  if (!sorted || sorted.length === 0) return 50;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return (lo / sorted.length) * 100;
}

export function scoreStock(stock, conditions, distribution) {
  let weighted = 0;
  let weightSum = 0;
  const parts = [];
  for (const cond of conditions) {
    if (!cond.enabled || cond.mode !== 'hard' && cond.mode !== 'soft') continue;
    const result = evaluateCondition(stock, cond);
    if (result.status !== 'pass') continue;
    const factor = FACTORS[cond.factor];
    let normalized = 50;
    if (factor?.type === 'number') {
      const arr = distribution[cond.factor] || [];
      const pct = percentileRank(arr, Number(result.value));
      if (factor.direction === 'lower') normalized = 100 - pct;
      else if (factor.direction === 'higher') normalized = pct;
      else normalized = 50;
    } else if (factor?.type === 'boolean') {
      normalized = result.value ? 100 : 0;
    } else if (factor?.type === 'string') {
      normalized = 100;
    }
    const weight = Number(cond.weight ?? 1);
    weighted += normalized * weight;
    weightSum += weight;
    parts.push({ condition: cond, normalized: Math.round(normalized) });
  }
  return {
    score: weightSum > 0 ? Math.round((weighted / weightSum) * 10) / 10 : 0,
    scored: parts.length,
    parts,
  };
}

export function screen(stocks, conditions, options = {}, context = {}) {
  const started = performance.now();
  const active = conditions.filter((c) => c.enabled !== false);
  const hard = active.filter((c) => c.mode === 'hard');
  const soft = active.filter((c) => c.mode === 'soft');
  const distribution = context.distribution || buildDistribution(stocks);
  const excludeST = options.excludeST !== false;
  const excludeSuspended = options.excludeSuspended !== false;
  const board = options.board || 'all';

  const prefiltered = [];
  const matched = [];
  const excluded = [];

  const boardOk = (stock) => {
    if (board === 'all') return true;
    const code = stock.code;
    if (board === 'main') return code.startsWith('60') || code.startsWith('00');
    if (board === 'gem') return code.startsWith('30');
    if (board === 'star') return code.startsWith('68');
    return true;
  };

  for (const stock of stocks) {
    if (!boardOk(stock)) {
      prefiltered.push({ stock, reason: '板块范围外', code: 'BOARD' });
      continue;
    }
    if (excludeST && (stock.quality_flags || []).includes('ST')) {
      prefiltered.push({ stock, reason: 'ST/*ST/退市风险，按设置排除', code: 'ST' });
      continue;
    }
    if (excludeSuspended && ((stock.quality_flags || []).includes('SUSPENDED_OR_NO_PRICE') || (stock.quality_flags || []).includes('NO_VOLUME'))) {
      prefiltered.push({ stock, reason: '停牌/无成交，按设置排除', code: 'SUSPENDED' });
      continue;
    }

    const results = active.map((cond) => ({ condition: cond, ...evaluateCondition(stock, cond) }));
    const hardFails = results.filter((r) => r.condition.mode === 'hard' && r.status !== 'pass');
    if (hardFails.length > 0) {
      excluded.push({
        stock,
        results,
        hardFails,
        reasons: hardFails.map((r) => ({ condition: r.condition, status: r.status, reason: r.reason, display: r.display })),
      });
      continue;
    }
    const scored = scoreStock(stock, active, distribution);
    matched.push({
      stock,
      results,
      score: scored.score,
      scoredCount: scored.scored,
      passCount: results.filter((r) => r.status === 'pass').length,
      hardPassCount: results.filter((r) => r.condition.mode === 'hard' && r.status === 'pass').length,
      hardCount: hard.length,
      softFailCount: results.filter((r) => r.condition.mode === 'soft' && r.status !== 'pass').length,
    });
  }

  matched.sort((a, b) => (b.score - a.score) || ((b.stock.market_cap || 0) - (a.stock.market_cap || 0)) || a.stock.code.localeCompare(b.stock.code));
  excluded.sort((a, b) => ((b.stock.market_cap || 0) - (a.stock.market_cap || 0)) || a.stock.code.localeCompare(b.stock.code));

  const byIndustry = {};
  for (const m of matched) {
    byIndustry[m.stock.industry] = (byIndustry[m.stock.industry] || 0) + 1;
  }
  const missingByFactor = {};
  for (const e of excluded) {
    for (const r of e.results) {
      if (r.status === 'missing' || r.status === 'na') {
        missingByFactor[r.condition.factor] = (missingByFactor[r.condition.factor] || 0) + 1;
      }
    }
  }

  return {
    matched,
    excluded,
    prefiltered,
    stats: {
      universe: stocks.length,
      afterPrefilter: stocks.length - prefiltered.length,
      matched: matched.length,
      excluded: excluded.length,
      prefiltered: prefiltered.length,
      hardConditions: hard.length,
      softConditions: soft.length,
      conditionCount: active.length,
      elapsedMs: Math.round((performance.now() - started) * 10) / 10,
      runAt: new Date().toISOString(),
      byIndustry,
      missingByFactor,
      excludeST,
      excludeSuspended,
      board,
    },
  };
}

export function conditionImpact(stocks, conditions, index, next, options = {}) {
  const before = screen(stocks, conditions, options);
  const afterConditions = conditions.map((c, i) => (i === index ? { ...c, ...next, label: describeCondition({ ...c, ...next }) } : c));
  const after = screen(stocks, afterConditions, options);
  const beforeCodes = new Set(before.matched.map((m) => m.stock.code));
  const afterCodes = new Set(after.matched.map((m) => m.stock.code));
  const entrants = after.matched.filter((m) => !beforeCodes.has(m.stock.code));
  const leavers = before.matched.filter((m) => !afterCodes.has(m.stock.code));
  const byIndustry = {};
  for (const m of entrants) byIndustry[m.stock.industry] = (byIndustry[m.stock.industry] || 0) + 1;
  return {
    beforeCount: before.matched.length,
    afterCount: after.matched.length,
    delta: after.matched.length - before.matched.length,
    entrants: entrants.slice(0, 30),
    leavers: leavers.slice(0, 30),
    entrantCount: entrants.length,
    leaverCount: leavers.length,
    byIndustry,
    afterResult: after,
    afterConditions,
  };
}

function intervalOf(condition) {
  const factor = FACTORS[condition.factor];
  if (!factor || factor.type !== 'number') return null;
  const v = Number(condition.value);
  const v2 = condition.value2 === null || condition.value2 === undefined ? null : Number(condition.value2);
  const eps = 1e-9;
  switch (condition.op) {
    case '>=': return [v, Infinity];
    case '>': return [v + eps, Infinity];
    case '<=': return [-Infinity, v];
    case '<': return [-Infinity, v - eps];
    case '==': return [v, v];
    case 'between': {
      if (v2 === null || Number.isNaN(v2)) return null;
      return v <= v2 ? [v, v2] : [v2, v];
    }
    default: return null;
  }
}

export function validateConditions(conditions, result = null) {
  const errors = [];
  const warnings = [];
  const infos = [];
  const active = conditions.filter((c) => c.enabled !== false);
  const byFactor = {};
  for (const c of active) {
    (byFactor[c.factor] ||= []).push(c);
  }

  for (const [factorKey, list] of Object.entries(byFactor)) {
    const factor = FACTORS[factorKey];
    if (!factor) {
      errors.push({ code: 'UNKNOWN_FACTOR', message: `不支持的因子：${factorKey}` });
      continue;
    }
    if (factor.type === 'number') {
      const ranges = list.map(intervalOf).filter(Boolean);
      if (ranges.length > 1) {
        const lo = Math.max(...ranges.map((r) => r[0]));
        const hi = Math.min(...ranges.map((r) => r[1]));
        if (lo > hi) {
          errors.push({
            code: 'CONFLICT',
            factor: factorKey,
            message: `${factor.label} 的条件互斥：${list.map(describeCondition).join('；')}`,
          });
        }
      }
      for (const c of list) {
        if (factor.min !== undefined && Number(c.value) < factor.min) {
          warnings.push({ code: 'OUT_OF_RANGE', factor: factorKey, message: `${factor.label} 阈值 ${c.value} 低于可解释范围 ${factor.min}` });
        }
        if (factor.max !== undefined && Number(c.value) > factor.max) {
          warnings.push({ code: 'OUT_OF_RANGE', factor: factorKey, message: `${factor.label} 阈值 ${c.value} 高于可解释范围 ${factor.max}` });
        }
      }
    }
    if (factor.type === 'boolean') {
      const values = new Set(list.map((c) => Boolean(c.value)));
      if (values.size > 1) errors.push({ code: 'CONFLICT', factor: factorKey, message: `${factor.label} 同时要求“是”和“否”` });
    }
    if (factor.type === 'string') {
      for (const c of list) {
        if (c.op === 'contains' && list.some((x) => x.op === 'not_contains' && x.value === c.value)) {
          errors.push({ code: 'CONFLICT', factor: factorKey, message: `行业同时要求包含和不包含「${c.value}」` });
        }
      }
    }
  }

  const get = (key) => active.find((c) => c.factor === key && c.op !== 'is');
  const pe = get('pe_ttm');
  const growth = get('profit_growth') || get('rev_growth');
  if (pe && growth) {
    const peMax = pe.op === '<=' || pe.op === '<' ? Number(pe.value) : null;
    const growthMin = growth.op === '>=' || growth.op === '>' ? Number(growth.value) : null;
    if (peMax !== null && growthMin !== null && peMax <= 20 && growthMin >= 25) {
      warnings.push({ code: 'TENSION', message: '低 PE + 高增长同时满足的股票通常很少；建议把其中一个改为“加分项”，或放宽阈值' });
    }
  }
  const vol = get('vol_60d');
  const ret = get('ret_60d');
  if (vol && ret) {
    const volMax = vol.op === '<=' || vol.op === '<' ? Number(vol.value) : null;
    const retMin = ret.op === '>=' || ret.op === '>' ? Number(ret.value) : null;
    if (volMax !== null && retMin !== null && volMax <= 25 && retMin >= 25) {
      warnings.push({ code: 'TENSION', message: '低波动 + 高涨幅可能互相矛盾；建议先看“低波动”，再用“加分项”表达涨幅偏好' });
    }
  }
  const cap = get('market_cap');
  const capPct = get('market_cap_industry_pct');
  if (cap && capPct) {
    const capMax = cap.op === '<=' || cap.op === '<' ? Number(cap.value) : null;
    const pctMin = capPct.op === '>=' || capPct.op === '>' ? Number(capPct.value) : null;
    if (capMax !== null && pctMin !== null && capMax <= 150 && pctMin >= 80) {
      warnings.push({ code: 'TENSION', message: '小市值 + 行业龙头分位可能矛盾；龙头通常是行业内市值较大的公司' });
    }
  }
  const hardCount = active.filter((c) => c.mode === 'hard').length;
  if (hardCount > 6) {
    infos.push({ code: 'TOO_MANY_HARD', message: `当前有 ${hardCount} 个硬条件；硬条件越多，结果越可能为 0。可把部分条件改为“加分项”。` });
  }
  if (result && result.matched.length === 0 && active.length > 0) {
    warnings.push({ code: 'ZERO_RESULT', message: '当前条件下没有股票通过。建议先放宽一个硬条件，或把“估值/走势”改为加分项。' });
  }
  return { errors, warnings, infos };
}

export function riskFlags(stock) {
  const map = {
    NEGATIVE_PE: 'PE 为负（亏损）',
    MISSING_PE: 'PE 缺失',
    NEGATIVE_PB: 'PB 为负',
    MISSING_PB: 'PB 缺失',
    MISSING_FIN: '财务数据缺失',
    STALE_FIN: '财务报告期偏旧',
    FUTURE_REPORT: '报告期晚于快照日',
    NEGATIVE_EQUITY: '每股净资产为负',
    GROWTH_OUTLIER: '增速基数异常（|同比|>300%）',
    MISSING_KLINE: '历史行情缺失',
    NEW_LISTING_OR_SHORT_HISTORY: '上市/交易历史不足 60 日',
    KLINE_STALE: '最新 K 线非快照日',
    LONG_SUSPENSION: '超过 7 天无 K 线，可能长期停牌',
    SUSPENDED_OR_NO_PRICE: '停牌/无价格',
    NO_VOLUME: '无成交',
    ST: 'ST/*ST/退市风险',
    INDUSTRY_SMALL: '行业样本不足 8 只',
  };
  const flags = (stock.quality_flags || []).map((f) => ({ code: f, label: map[f] || f }));
  if (stock.pe_ttm !== null && stock.pe_ttm !== undefined && Number(stock.pe_ttm) > 1000) {
    flags.push({ code: 'PE_EXTREME', label: 'PE 极高（盈利接近 0，估值指标失真）' });
  }
  return flags;
}

export function buildExplanation(stock, entry, conditions) {
  const matched = entry?.matched !== false;
  const results = entry?.results || conditions.map((c) => ({ condition: c, ...evaluateCondition(stock, c) }));
  const passes = results.filter((r) => r.status === 'pass');
  const fails = results.filter((r) => r.status === 'fail');
  const missing = results.filter((r) => r.status === 'missing' || r.status === 'na');
  const headline = matched
    ? `入选：${passes.length}/${results.length} 个条件通过，综合分 ${entry?.score ?? '—'}`
    : `排除：${(entry?.hardFails || fails).slice(0, 2).map((r) => `${r.condition.label}（${r.reason}）`).join('；') || '未通过硬条件'}`;
  const bullets = results.map((r) => {
    const status = r.status === 'pass' ? '通过' : r.status === 'fail' ? '未通过' : '数据不足';
    const detail = r.status === 'pass' ? `实际 ${r.display}` : r.reason;
    return `${r.condition.label}：${status}，${detail}`;
  });
  const risks = riskFlags(stock);
  return { headline, bullets, risks, passes, fails, missing };
}

export function complianceCheck(text) {
  const banned = ['买入', '卖出', '推荐买入', '推荐卖出', '必涨', '保证收益', '稳赚', '目标价'];
  const hits = banned.filter((w) => String(text).includes(w));
  return { pass: hits.length === 0, hits };
}

export function qualityCards(meta) {
  const q = meta?.quality || {};
  return [
    { label: '股票池', value: q.universe_count ?? '—', note: `行情原始 ${q.quote_total ?? '—'} 只，剔除无价格/退市后` },
    { label: 'K线覆盖', value: `${q.kline_coverage_pct ?? '—'}%`, note: `${q.kline_ok ?? '—'} 只有日K` },
    { label: 'PE 缺失/为负', value: `${q.negative_pe_count ?? '—'}`, note: '负 PE 按缺失处理，不当作便宜' },
    { label: '财务缺失', value: `${q.missing_fin_count ?? '—'}`, note: `过期 ${q.stale_fin_count ?? '—'} 只` },
    { label: '行业数', value: `${q.industry_count ?? '—'}`, note: `未分类 ${q.unclassified_industry ?? '—'} 只` },
    { label: '增速异常', value: `${q.growth_outlier_count ?? '—'}`, note: '|同比|>300%，需看基数' },
  ];
}
