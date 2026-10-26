/**
 * 意图选股器 · 本地自然语言解析器（零依赖、可离线运行）
 *
 * 职责：
 * - 把中文意图拆成可检查的条件卡（factor / op / value / unit）。
 * - 把“经营改善、估值合理、走势稳定”等模糊词展开为明确的代理口径，并把口径作为“假设”展示。
 * - 识别不了的词进入 unparsed / ambiguities，不静默编造条件。
 *
 * 非职责：
 * - 不做筛选计算（engine.js）。
 * - 不生成投资结论；所有条件执行前都要经过用户确认/可编辑。
 *
 * 可选 LLM：server/server.js 的 /api/parse 可返回同样的 JSON 结构；
 * 本文件同时提供 normalizeLLMResult() 做二次校验与兜底。
 */
import { FACTORS, describeCondition, makeCondition } from './engine.js';

export const PRESETS = {
  operating_improvement: {
    id: 'operating_improvement',
    label: '经营改善',
    aliases: ['经营改善', '基本面改善', '业绩改善', '盈利改善', '经营变好', '业绩变好', '基本面变好', '盈利能力改善'],
    description: '用最新报告期的营收同比、归母净利同比、ROE 作为“经营改善”的可检查代理。',
    caveat: '同比是报告期数据，不等于未来会继续改善；银行/保险的 ROE 与负债率口径不同。',
    defaultVariant: 'balanced',
    variants: {
      strict: {
        label: '严格',
        note: '营收/净利同比 ≥20%，ROE ≥15%，结果更少但更强。',
        conditions: [
          { factor: 'rev_growth', op: '>=', value: 20 },
          { factor: 'profit_growth', op: '>=', value: 20 },
          { factor: 'roe', op: '>=', value: 15 },
        ],
      },
      balanced: {
        label: '均衡',
        note: '营收/净利同比 ≥10%，ROE ≥10%，兼顾覆盖度与质量。',
        conditions: [
          { factor: 'rev_growth', op: '>=', value: 10 },
          { factor: 'profit_growth', op: '>=', value: 10 },
          { factor: 'roe', op: '>=', value: 10 },
        ],
      },
      loose: {
        label: '宽松',
        note: '营收/净利同比 ≥5%，ROE ≥5%，用于先看覆盖面。',
        conditions: [
          { factor: 'rev_growth', op: '>=', value: 5 },
          { factor: 'profit_growth', op: '>=', value: 5 },
          { factor: 'roe', op: '>=', value: 5 },
        ],
      },
    },
  },
  valuation_reasonable: {
    id: 'valuation_reasonable',
    label: '估值合理',
    aliases: ['估值合理', '估值不贵', '估值便宜', '低估值', '便宜', '估值适中', '估值不高', '估值偏低'],
    description: '用 PE(TTM) 绝对值 + 同行业 PE 分位表达“估值合理”，避免只看一个绝对值。',
    caveat: '亏损股 PE 为负，不能视为便宜；本产品按缺失处理，不进入估值条件。',
    defaultVariant: 'balanced',
    variants: {
      strict: {
        label: '严格',
        note: 'PE ≤20 且 行业 PE 分位 ≤30%。',
        conditions: [
          { factor: 'pe_ttm', op: '<=', value: 20 },
          { factor: 'pe_industry_pct', op: '<=', value: 30 },
        ],
      },
      balanced: {
        label: '均衡',
        note: 'PE ≤30 且 行业 PE 分位 ≤50%。',
        conditions: [
          { factor: 'pe_ttm', op: '<=', value: 30 },
          { factor: 'pe_industry_pct', op: '<=', value: 50 },
        ],
      },
      loose: {
        label: '宽松',
        note: 'PE ≤40 且 行业 PE 分位 ≤70%。',
        conditions: [
          { factor: 'pe_ttm', op: '<=', value: 40 },
          { factor: 'pe_industry_pct', op: '<=', value: 70 },
        ],
      },
    },
  },
  price_stable: {
    id: 'price_stable',
    label: '走势相对稳定',
    aliases: ['走势相对稳定', '走势稳定', '股价稳定', '波动小', '低波动', '走势平稳', '价格稳定', '波动较低'],
    description: '用近 60 日年化波动率、最大回撤和 MA60 趋势表达“稳定”，不用单日涨跌判断。',
    caveat: '波动率与回撤是历史统计，不代表未来；低波动也不等于低风险。',
    defaultVariant: 'balanced',
    variants: {
      strict: {
        label: '严格',
        note: '波动率 ≤22%、最大回撤 ≥-10%、站上 MA60。',
        conditions: [
          { factor: 'vol_60d', op: '<=', value: 22 },
          { factor: 'max_dd_60d', op: '>=', value: -10 },
          { factor: 'above_ma60', op: 'is', value: true },
        ],
      },
      balanced: {
        label: '均衡',
        note: '波动率 ≤30%、最大回撤 ≥-15%、站上 MA60。',
        conditions: [
          { factor: 'vol_60d', op: '<=', value: 30 },
          { factor: 'max_dd_60d', op: '>=', value: -15 },
          { factor: 'above_ma60', op: 'is', value: true },
        ],
      },
      loose: {
        label: '宽松',
        note: '波动率 ≤40%、最大回撤 ≥-25%，不要求站上 MA60。',
        conditions: [
          { factor: 'vol_60d', op: '<=', value: 40 },
          { factor: 'max_dd_60d', op: '>=', value: -25 },
        ],
      },
    },
  },
  high_growth: {
    id: 'high_growth',
    label: '高成长',
    aliases: ['高成长', '成长性好', '高增长', '成长股', '业绩高增长'],
    description: '营收与归母净利同比同时高增长。',
    caveat: '高增长可能来自低基数或一次性收益，必须结合 GROWTH_OUTLIER 标记与原始报告。',
    defaultVariant: 'balanced',
    variants: {
      strict: {
        label: '严格',
        note: '营收/净利同比 ≥30%。',
        conditions: [
          { factor: 'rev_growth', op: '>=', value: 30 },
          { factor: 'profit_growth', op: '>=', value: 30 },
        ],
      },
      balanced: {
        label: '均衡',
        note: '营收/净利同比 ≥20%。',
        conditions: [
          { factor: 'rev_growth', op: '>=', value: 20 },
          { factor: 'profit_growth', op: '>=', value: 20 },
        ],
      },
      loose: {
        label: '宽松',
        note: '营收/净利同比 ≥15%。',
        conditions: [
          { factor: 'rev_growth', op: '>=', value: 15 },
          { factor: 'profit_growth', op: '>=', value: 15 },
        ],
      },
    },
  },
  quality: {
    id: 'quality',
    label: '质量好',
    aliases: ['质量好', '高质量', '基本面扎实', '盈利质量', '现金流好'],
    description: '用 ROE、资产负债率、每股经营现金流表达“质量”。',
    caveat: '金融行业负债率不可与制造业直接比较；现金流为报告期数据。',
    defaultVariant: 'balanced',
    variants: {
      strict: {
        label: '严格',
        note: 'ROE ≥15%、负债率 ≤40%、每股经营现金流 >0。',
        conditions: [
          { factor: 'roe', op: '>=', value: 15 },
          { factor: 'debt_ratio', op: '<=', value: 40 },
          { factor: 'ocf_ps', op: '>', value: 0 },
        ],
      },
      balanced: {
        label: '均衡',
        note: 'ROE ≥12%、负债率 ≤55%、每股经营现金流 >0。',
        conditions: [
          { factor: 'roe', op: '>=', value: 12 },
          { factor: 'debt_ratio', op: '<=', value: 55 },
          { factor: 'ocf_ps', op: '>', value: 0 },
        ],
      },
      loose: {
        label: '宽松',
        note: 'ROE ≥8%、负债率 ≤65%、每股经营现金流 >0。',
        conditions: [
          { factor: 'roe', op: '>=', value: 8 },
          { factor: 'debt_ratio', op: '<=', value: 65 },
          { factor: 'ocf_ps', op: '>', value: 0 },
        ],
      },
    },
  },
  momentum: {
    id: 'momentum',
    label: '近期强势',
    aliases: ['近期强势', '强势', '动量', '趋势向上', '走势强'],
    description: '用近 20 日涨幅 + 均线多头表达“强势”。',
    caveat: '强势可能是追高；与“走势稳定/低波动”同时使用容易互相矛盾。',
    defaultVariant: 'balanced',
    variants: {
      balanced: {
        label: '均衡',
        note: '近20日涨幅 ≥5% 且 20日均线高于60日均线。',
        conditions: [
          { factor: 'ret_20d', op: '>=', value: 5 },
          { factor: 'ma20_gt_ma60', op: 'is', value: true },
        ],
      },
      strict: {
        label: '严格',
        note: '近20日涨幅 ≥10% 且 均线多头。',
        conditions: [
          { factor: 'ret_20d', op: '>=', value: 10 },
          { factor: 'ma20_gt_ma60', op: 'is', value: true },
        ],
      },
    },
  },
};

const PRESET_ALIAS_INDEX = Object.values(PRESETS)
  .flatMap((p) => p.aliases.map((a) => ({ alias: a, preset: p })))
  .sort((a, b) => b.alias.length - a.alias.length);

const INDUSTRY_ALIASES = {
  半导体: ['半导体', '元件', '电子化学品'],
  芯片: ['半导体', '元件'],
  白酒: ['酿酒行业', '酿酒'],
  银行: ['银行'],
  证券: ['证券'],
  保险: ['保险'],
  新能源: ['电池', '光伏设备', '风电设备', '能源金属', '电力行业'],
  光伏: ['光伏设备'],
  储能: ['电池', '光伏设备', '电力行业'],
  医药: ['化学制药', '中药', '生物制品', '医疗器械', '医疗服务', '医药商业'],
  医疗: ['医疗器械', '医疗服务'],
  军工: ['航天航空', '船舶制造', '兵器兵装', '军工电子'],
  汽车: ['汽车整车', '汽车零部件', '汽车服务'],
  房地产: ['房地产开发', '房地产服务'],
  家电: ['家电行业', '白色家电', '黑色家电', '小家电'],
  食品饮料: ['食品饮料', '酿酒行业', '饮料制造', '食品加工'],
  计算机: ['软件开发', '计算机设备', 'IT服务'],
  通信: ['通信设备', '通信服务'],
  电子: ['电子元件', '半导体', '消费电子', '光学光电子'],
  化工: ['化学制品', '化学原料', '化学纤维', '塑料制品', '橡胶制品'],
  有色: ['有色金属', '小金属', '贵金属', '能源金属'],
  煤炭: ['煤炭行业'],
  钢铁: ['钢铁行业'],
  电力: ['电力行业'],
  传媒: ['文化传媒', '游戏', '广告包装'],
  农业: ['农牧饲渔', '种植业', '养殖业'],
  机械: ['专用设备', '通用设备', '工程机械', '仪器仪表'],
  环保: ['环保行业'],
  交通: ['交通运输', '物流行业', '航空机场', '港口水运'],
};

const FACTOR_ALIASES = {
  pe_industry_pct: ['PE行业分位', '市盈率行业分位', 'PE分位', '估值行业分位'],
  pb_industry_pct: ['PB行业分位', '市净率行业分位', 'PB分位'],
  market_cap_industry_pct: ['市值行业分位', '行业市值分位', '行业排名', '行业分位'],
  gross_margin_chg: ['毛利率同比变化', '毛利率变化', '毛利率同比'],
  market_cap: ['总市值', '市值'],
  pe_ttm: ['市盈率', 'PE', 'pe'],
  pb: ['市净率', 'PB', 'pb'],
  roe: ['净资产收益率', 'ROE', 'roe'],
  rev_growth: ['营业收入同比', '营收同比', '营收增速', '营收增长', '收入增速', '营收'],
  profit_growth: ['归母净利润同比', '净利润同比', '净利同比', '净利增速', '净利润增速', '利润增速', '净利增长'],
  gross_margin: ['销售毛利率', '毛利率'],
  debt_ratio: ['资产负债率', '负债率'],
  ocf_ps: ['每股经营现金流', '每股现金流', '经营现金流'],
  eps: ['每股收益', 'EPS', 'eps'],
  bps: ['每股净资产', 'BPS', 'bps'],
  roic: ['ROIC', 'roic', '投入资本回报率'],
  volatility: [],
  vol_60d: ['近60日波动率', '60日波动率', '年化波动率', '波动率', '波动'],
  max_dd_60d: ['近60日最大回撤', '最大回撤', '回撤'],
  ret_20d: ['近20日涨幅', '20日涨幅', '近一个月涨幅', '月涨幅'],
  ret_60d: ['近60日涨幅', '60日涨幅', '近两个月涨幅', '两个月涨幅'],
  pct_chg: ['当日涨跌幅', '今日涨跌幅', '涨跌幅', '涨幅'],
  turnover: ['换手率', '换手'],
  volume_ratio: ['量比'],
  above_ma60: ['站上60日均线', '站上60日线', '60日均线之上', '站上MA60'],
  ma20_gt_ma60: ['20日均线高于60日均线', '均线多头', 'MA20高于MA60'],
  industry: ['所属行业', '行业'],
};
for (const key of Object.keys(FACTOR_ALIASES)) {
  FACTOR_ALIASES[key] = [...new Set(FACTOR_ALIASES[key])].sort((a, b) => b.length - a.length);
}

const OP_PATTERNS = [
  { re: /(大于等于|不低于|不少于|至少|>=|≥)/, op: '>=' },
  { re: /(小于等于|不超过|不高于|至多|<=|≤)/, op: '<=' },
  { re: /(大于|高于|超过|多于|>)/, op: '>' },
  { re: /(小于|低于|少于|不到|<)/, op: '<' },
  { re: /(等于|==|=)/, op: '==' },
  { re: /(介于|之间)/, op: 'between' },
  { re: /(以上)/, op: '>=' },
  { re: /(以下)/, op: '<=' },
];

const DEFAULT_DIRECTION = {
  pe_ttm: '<=', pb: '<=', pe_industry_pct: '<=', pb_industry_pct: '<=',
  vol_60d: '<=', debt_ratio: '<=', max_dd_60d: '>=',
  roe: '>=', rev_growth: '>=', profit_growth: '>=', gross_margin: '>=',
  gross_margin_chg: '>=', ocf_ps: '>=', eps: '>=', bps: '>=', roic: '>=',
  market_cap: '>=', market_cap_industry_pct: '>=', ret_20d: '>=', ret_60d: '>=',
  turnover: '>=', volume_ratio: '>=',
};

function normalizeText(text) {
  return String(text || '')
    .replace(/[，、；;。]/g, ',')
    .replace(/：/g, ':')
    .replace(/％/g, '%')
    .replace(/＋/g, '+')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitClauses(text) {
  return normalizeText(text)
    .split(/[,]|并且|且|同时|以及|还要|再|并(?![A-Za-z])|和(?=[^)]*$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findOperator(clause) {
  for (const p of OP_PATTERNS) {
    const m = clause.match(p.re);
    if (m) return { op: p.op, index: m.index, text: m[0] };
  }
  return null;
}

function parseNumbers(text) {
  const out = [];
  const re = /(-?\d+(?:\.\d+)?)\s*(%|亿|万|倍|x|X|元)?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ value: Number(m[1]), unit: m[2] || '', index: m.index, raw: m[0] });
  }
  return out;
}

function normalizeUnitValue(factorKey, value, unit, assumptions) {
  const factor = FACTORS[factorKey];
  if (!factor) return value;
  if (factor.type !== 'number') return value;
  if (factorKey === 'market_cap') {
    if (unit === '万') return value / 10000;
    if (unit === '元') return value / 1e8;
    if (unit === '亿' || unit === '') {
      if (unit === '') assumptions.push('市值未写单位，按“亿元”处理');
      return value;
    }
  }
  if (factor.unit === '%') {
    if (unit === '' || unit === '%') {
      if (unit === '') assumptions.push(`${factor.label} 未写单位，按百分比处理`);
      return value;
    }
    if (unit === '倍' || unit === 'x' || unit === 'X') return value;
  }
  if (factor.unit === '倍') return value;
  return value;
}

function addCondition(list, partial, groupId = null, source = 'local') {
  const cond = makeCondition({ ...partial, source, id: `${source}_${list.length}_${Math.random().toString(36).slice(2, 6)}` });
  if (groupId) cond.groupId = groupId;
  const key = `${cond.factor}|${cond.op}|${JSON.stringify(cond.value)}|${cond.value2}`;
  if (list.some((c) => `${c.factor}|${c.op}|${JSON.stringify(c.value)}|${c.value2}` === key)) return null;
  list.push(cond);
  return cond;
}

function presetConditions(preset, variantId, source = 'local') {
  const variant = preset.variants[variantId] || preset.variants[preset.defaultVariant];
  return variant.conditions.map((c) => makeCondition({ ...c, source, presetId: preset.id, confidence: 0.82, note: variant.note }));
}

function matchIndustry(clause, industries) {
  const hits = new Set();
  let matchedAlias = null;
  for (const [alias, targets] of Object.entries(INDUSTRY_ALIASES)) {
    if (!clause.includes(alias)) continue;
    matchedAlias = alias;
    // 先找精确/包含该词的行业名，避免把“半导体”扩成元件、电子化学品等一整条链。
    const direct = industries.filter((actual) => actual.includes(alias) || alias.includes(actual));
    if (direct.length > 0) {
      direct.forEach((actual) => hits.add(actual));
      continue;
    }
    for (const target of targets) {
      for (const actual of industries) {
        if (actual.includes(target) || target.includes(actual)) hits.add(actual);
      }
    }
  }
  for (const actual of industries) {
    if (actual !== '未分类' && clause.includes(actual)) hits.add(actual);
  }
  return { hits: [...hits], alias: matchedAlias };
}

function matchFactor(clause) {
  let best = null;
  for (const [key, aliases] of Object.entries(FACTOR_ALIASES)) {
    for (const alias of aliases) {
      const idx = clause.indexOf(alias);
      if (idx === -1) continue;
      if (!best || alias.length > best.alias.length || (alias.length === best.alias.length && idx < best.index)) {
        best = { key, alias, index: idx, end: idx + alias.length };
      }
    }
  }
  return best;
}

function parseNumericClause(clause, assumptions, ambiguities) {
  const factorMatch = matchFactor(clause);
  if (!factorMatch) return null;
  const factor = FACTORS[factorMatch.key];
  if (!factor || factor.type !== 'number') return null;

  const after = clause.slice(factorMatch.end);
  const before = clause.slice(0, factorMatch.index);
  const opAfter = findOperator(after);
  const opBefore = opAfter ? null : findOperator(clause);
  let searchText = after;
  if (opAfter) {
    searchText = after.slice(opAfter.index + opAfter.text.length);
  } else if (opBefore) {
    // 少数写法把比较词放在因子前，例如“大于15%的ROE”
    searchText = clause.slice(opBefore.index + opBefore.text.length, factorMatch.index);
  }
  let numbers = parseNumbers(searchText);
  if (numbers.length === 0) numbers = parseNumbers(after);
  if (numbers.length === 0) numbers = parseNumbers(before);
  if (numbers.length === 0) return null;

  const opMatch = opAfter || opBefore;
  let op = opMatch?.op || DEFAULT_DIRECTION[factorMatch.key] || '>=';
  if (!opMatch) assumptions.push(`「${clause}」未写比较方向，按 ${factor.label} 的默认方向「${op}」处理`);
  let value = numbers[0].value;
  let value2 = null;
  if (op === 'between') {
    if (numbers.length < 2) {
      ambiguities.push({
        id: `amb_between_${factorMatch.key}`,
        kind: 'unsupported',
        question: `「${clause}」看起来是区间条件，但只识别到一个数字。请补成“介于 A 到 B”。`,
        options: [],
      });
      return null;
    }
    value = numbers[0].value;
    value2 = numbers[1].value;
  }
  const unit = numbers[0].unit;
  value = normalizeUnitValue(factorMatch.key, value, unit, assumptions);
  if (value2 !== null) value2 = normalizeUnitValue(factorMatch.key, value2, unit, assumptions);

  // 百分比因子如果写成 0.5 这种小数，提示可能的口径歧义
  if (factor.unit === '%' && unit === '' && Math.abs(value) > 0 && Math.abs(value) < 1) {
    ambiguities.push({
      id: `amb_decimal_${factorMatch.key}`,
      kind: 'unsupported',
      question: `${factor.label} 的阈值是 ${value}，你是指 ${value}% 还是 ${(value * 100).toFixed(1)}%？当前按 ${value}% 处理。`,
      options: [],
    });
  }

  return makeCondition({
    factor: factorMatch.key,
    op,
    value,
    value2,
    source: 'local',
    confidence: opMatch ? 0.92 : 0.7,
    note: opMatch ? '' : '未写比较方向，使用因子默认方向',
  });
}

function applySpecialTerms(clause, conditions, options, assumptions, ambiguities, industries) {
  let touched = false;
  const lower = clause.toLowerCase();
  const has = (key) => conditions.some((c) => c.factor === key);

  if (/(不要|排除|剔除|去掉).*(st|\*st|退市)/i.test(clause) || /不碰st/i.test(clause)) {
    options.excludeST = true;
    assumptions.push('按“排除 ST/*ST/退市风险”处理');
    touched = true;
  }
  if (/(不要|排除|剔除|去掉).*(停牌|无成交)/.test(clause)) {
    options.excludeSuspended = true;
    assumptions.push('按“排除停牌/无成交”处理');
    touched = true;
  }
  if (/只要.*主板|仅.*主板|主板/.test(clause) && !/创业板|科创板/.test(clause)) {
    options.board = 'main';
    assumptions.push('板块范围限定为主板（沪市 60/00 开头）');
    touched = true;
  }
  if (/只要.*创业板|仅.*创业板|创业板/.test(clause) && !/主板|科创板/.test(clause)) {
    options.board = 'gem';
    assumptions.push('板块范围限定为创业板（30 开头）');
    touched = true;
  }
  if (/只要.*科创板|仅.*科创板|科创板/.test(clause) && !/主板|创业板/.test(clause)) {
    options.board = 'star';
    assumptions.push('板块范围限定为科创板（68 开头）');
    touched = true;
  }

  // 排除行业：排除房地产 / 不要银行
  const excludeIndustry = clause.match(/(?:排除|不要|剔除|去掉)(?:行业)?[：:]?(.+)/);
  if (excludeIndustry && !/st|停牌|退市/i.test(excludeIndustry[1])) {
    const target = excludeIndustry[1].trim();
    if (target.length >= 2 && target.length <= 8) {
      const found = matchIndustry(target, industries);
      if (found.hits.length > 0) {
        addCondition(conditions, { factor: 'industry', op: 'not_contains', value: found.hits[0] }, 'industry_exclude');
        assumptions.push(`排除行业按东方财富分类匹配到「${found.hits[0]}」`);
        touched = true;
      }
    }
  }

  if (/行业龙头|龙头/.test(clause) && !has('market_cap_industry_pct') && !has('market_cap')) {
    const groupId = 'leader';
    addCondition(conditions, { factor: 'market_cap_industry_pct', op: '>=', value: 80 }, groupId);
    assumptions.push('“龙头”默认按“同行业市值分位 ≥80%”处理；可在澄清卡中改为“总市值 ≥500 亿”');
    ambiguities.push({
      id: groupId,
      kind: 'choice',
      question: '“龙头”按什么定义？',
      current: 'industry_pct',
      options: [
        {
          label: '行业市值分位 ≥80%',
          value: 'industry_pct',
          description: '相对同行业公司规模，避免绝对市值偏差',
          conditions: [{ factor: 'market_cap_industry_pct', op: '>=', value: 80 }],
        },
        {
          label: '总市值 ≥500 亿',
          value: 'large_cap',
          description: '绝对规模口径，适合跨行业比较',
          conditions: [{ factor: 'market_cap', op: '>=', value: 500 }],
        },
      ],
    });
    touched = true;
  }

  if (/(大盘股|大盘|大市值)/.test(clause) && !/中小盘/.test(clause) && !has('market_cap')) {
    addCondition(conditions, { factor: 'market_cap', op: '>=', value: 500 }, 'size');
    assumptions.push('“大盘”按总市值 ≥500 亿元处理');
    touched = true;
  }
  if (/(中小盘|中盘|小盘)/.test(clause) && !has('market_cap')) {
    if (/小盘/.test(clause)) addCondition(conditions, { factor: 'market_cap', op: '<=', value: 100 }, 'size');
    else addCondition(conditions, { factor: 'market_cap', op: 'between', value: 50, value2: 500 }, 'size');
    assumptions.push(/小盘/.test(clause) ? '“小盘”按总市值 ≤100 亿元处理' : '“中小盘”按总市值 50–500 亿元处理');
    touched = true;
  }

  if (/低负债|负债低|负债率低/.test(clause) && !has('debt_ratio')) {
    addCondition(conditions, { factor: 'debt_ratio', op: '<=', value: 50 });
    assumptions.push('“低负债”按资产负债率 ≤50% 处理；银行/保险/证券不可与制造业直接比较');
    touched = true;
  }
  if (/高毛利|毛利率高/.test(clause) && !has('gross_margin')) {
    addCondition(conditions, { factor: 'gross_margin', op: '>=', value: 30 });
    assumptions.push('“高毛利”按销售毛利率 ≥30% 处理；金融行业通常不适用');
    touched = true;
  }
  if (/现金流好|现金流健康/.test(clause) && !has('ocf_ps')) {
    addCondition(conditions, { factor: 'ocf_ps', op: '>', value: 0 });
    assumptions.push('“现金流好”按每股经营现金流 >0 处理');
    touched = true;
  }
  if (/盈利|赚钱/.test(clause) && !/盈利改善|盈利能力改善/.test(clause) && !has('eps')) {
    addCondition(conditions, { factor: 'eps', op: '>', value: 0 });
    assumptions.push('“盈利”按每股收益 EPS >0 处理');
    touched = true;
  }
  if (/强势|动量|趋势向上/.test(clause) && !has('ret_20d') && !has('ret_60d') && !has('ma20_gt_ma60') && !conditions.some((c) => c.presetId === 'momentum')) {
    const groupId = 'momentum';
    addCondition(conditions, { factor: 'ret_20d', op: '>=', value: 5 }, groupId);
    addCondition(conditions, { factor: 'ma20_gt_ma60', op: 'is', value: true }, groupId);
    assumptions.push('“强势”按近20日涨幅 ≥5% 且 20日均线高于60日均线处理');
    ambiguities.push({
      id: groupId,
      kind: 'choice',
      question: '“近期强势”用哪个窗口？',
      current: '20d',
      options: [
        { label: '近20日涨幅 ≥5%', value: '20d', description: '偏短期', conditions: [{ factor: 'ret_20d', op: '>=', value: 5 }, { factor: 'ma20_gt_ma60', op: 'is', value: true }] },
        { label: '近60日涨幅 ≥10%', value: '60d', description: '偏中期', conditions: [{ factor: 'ret_60d', op: '>=', value: 10 }, { factor: 'ma20_gt_ma60', op: 'is', value: true }] },
      ],
    });
    touched = true;
  }
  if (/回调|超跌|跌下来/.test(clause)) {
    addCondition(conditions, { factor: 'ret_20d', op: '<=', value: -5 }, 'pullback');
    assumptions.push('“回调”按近20日涨幅 ≤-5% 处理；这是历史跌幅，不代表未来反弹');
    touched = true;
  }

  if (/高股息|股息率|分红高|高分红/.test(clause)) {
    ambiguities.push({
      id: 'unsupported_dividend',
      kind: 'unsupported',
      question: '当前快照没有股息率字段，无法可靠执行“高股息”。可改用“连续盈利 + 低负债”，或接入分红数据后再试。',
      options: [],
    });
    touched = true;
  }
  if (/港股|美股|北交所|新三板/.test(clause)) {
    ambiguities.push({
      id: 'unsupported_market',
      kind: 'unsupported',
      question: '当前股票池只覆盖沪深 A 股（不含北交所/港股/美股），该条件无法执行。',
      options: [],
    });
    touched = true;
  }
  if (/次新股|新股|上市不久/.test(lower)) {
    ambiguities.push({
      id: 'unsupported_new_listing',
      kind: 'unsupported',
      question: '当前快照没有上市日期字段，无法可靠识别“次新股”；可用“历史不足60日”的数据标记辅助判断，但不建议作为硬条件。',
      options: [],
    });
    touched = true;
  }

  return touched;
}

function applyPreset(list, preset, variantId, assumptions, ambiguities) {
  const variant = preset.variants[variantId] || preset.variants[preset.defaultVariant];
  for (const c of variant.conditions) {
    addCondition(list, { ...c, presetId: preset.id, confidence: 0.82, note: variant.note });
  }
  assumptions.push(`「${preset.label}」按「${variant.label}」口径拆为：${variant.conditions.map((c) => describeCondition(makeCondition(c))).join('、')}`);
  if (Object.keys(preset.variants).length > 1) {
    ambiguities.push({
      id: `preset_${preset.id}`,
      kind: 'preset_variant',
      presetId: preset.id,
      current: variantId,
      question: `「${preset.label}」用哪种口径？`,
      options: Object.entries(preset.variants).map(([vid, v]) => ({
        label: v.label,
        value: vid,
        description: v.note,
      })),
    });
  }
}

export function applyPresetVariant(conditions, presetId, variantId) {
  const preset = PRESETS[presetId];
  if (!preset) return conditions;
  const variant = preset.variants[variantId] || preset.variants[preset.defaultVariant];
  const others = conditions.filter((c) => c.presetId !== presetId);
  const next = variant.conditions.map((c) =>
    makeCondition({ ...c, source: 'preset', presetId, confidence: 0.82, note: variant.note })
  );
  return [...others, ...next];
}

export function applyChoice(conditions, ambiguityId, optionValue, ambiguity) {
  const option = ambiguity?.options?.find((o) => o.value === optionValue);
  if (!option) return conditions;
  const others = conditions.filter((c) => c.groupId !== ambiguityId);
  const next = (option.conditions || []).map((c) =>
    makeCondition({ ...c, source: 'clarify', confidence: 0.9, note: option.description })
  ).map((c) => ({ ...c, groupId: ambiguityId }));
  return [...others, ...next];
}

export function parseQuery(text, context = {}) {
  const query = String(text || '').trim();
  const stocks = context.stocks || [];
  const industries = [...new Set(stocks.map((s) => s.industry).filter((x) => x && x !== '未分类'))];
  const conditions = [];
  const assumptions = [];
  const ambiguities = [];
  const unparsed = [];
  const presets = [];
  const options = { excludeST: true, excludeSuspended: true, board: 'all' };
  const clauses = splitClauses(query);
  let optionsTouched = false;

  for (const clause of clauses) {
    let touched = false;

    // 1) 先匹配预设词（长词优先，避免“走势”抢先）
    let presetHit = null;
    for (const entry of PRESET_ALIAS_INDEX) {
      if (clause.includes(entry.alias)) {
        presetHit = entry;
        break;
      }
    }
    if (presetHit) {
      let variantId = presetHit.preset.defaultVariant;
      if (/严格/.test(clause)) variantId = presetHit.preset.variants.strict ? 'strict' : variantId;
      if (/宽松|放松/.test(clause)) variantId = presetHit.preset.variants.loose ? 'loose' : variantId;
      applyPreset(conditions, presetHit.preset, variantId, assumptions, ambiguities);
      presets.push({ id: presetHit.preset.id, label: presetHit.preset.label, variant: variantId, text: presetHit.alias });
      touched = true;
    }

    // 2) 行业匹配（可与其他条件共存）
    const industry = matchIndustry(clause, industries);
    if (industry.hits.length > 0) {
      addCondition(conditions, { factor: 'industry', op: 'in', value: industry.hits }, 'industry');
      assumptions.push(`行业按东方财富分类匹配到：${industry.hits.slice(0, 6).join('、')}${industry.hits.length > 6 ? ' 等' : ''}`);
      if (industry.alias && !industry.hits.includes(industry.alias)) {
        ambiguities.push({
          id: `industry_${industry.alias}`,
          kind: 'unsupported',
          question: `「${industry.alias}」不是一个精确行业名，已按包含关系匹配到 ${industry.hits.length} 个行业；如不对，请手动改成具体行业。`,
          options: [],
        });
      }
      touched = true;
    }

    // 3) 数值条件
    const numeric = parseNumericClause(clause, assumptions, ambiguities);
    if (numeric) {
      addCondition(conditions, numeric, 'numeric');
      touched = true;
    }

    // 4) 特殊词
    const optBefore = JSON.stringify(options);
    if (applySpecialTerms(clause, conditions, options, assumptions, ambiguities, industries)) touched = true;
    if (JSON.stringify(options) !== optBefore) optionsTouched = true;

    if (!touched) unparsed.push(clause);
  }

  if (conditions.length === 0 && unparsed.length === 0 && ambiguities.length === 0 && !optionsTouched) {
    unparsed.push(query || '（空输入）');
  }

  // 去重假设
  const uniqAssumptions = [...new Set(assumptions)];
  const uniqUnparsed = [...new Set(unparsed)];

  return {
    query,
    conditions,
    options,
    assumptions: uniqAssumptions,
    ambiguities,
    unparsed: uniqUnparsed,
    presets,
    source: 'local',
    confidence: conditions.length === 0 ? 0 : Math.min(0.95, 0.7 + conditions.length * 0.03),
  };
}

/**
 * 校验 LLM 返回，统一转换为与本地解析器相同的结构。
 * 任何未知因子、越界值、非法 op 都会被丢弃并记录，不直接执行。
 */
export function normalizeLLMResult(payload, context = {}) {
  const stocks = context.stocks || [];
  const conditions = [];
  const assumptions = [];
  const ambiguities = [];
  const unparsed = [];
  const options = { excludeST: true, excludeSuspended: true, board: 'all', ...(payload?.options || {}) };

  const allowedOps = new Set(['>=', '<=', '>', '<', '==', 'between', 'is', 'contains', 'not_contains', 'in']);
  for (const raw of Array.isArray(payload?.conditions) ? payload.conditions : []) {
    const factor = FACTORS[raw.factor];
    if (!factor) {
      unparsed.push(`未知因子：${raw.factor}`);
      continue;
    }
    if (!allowedOps.has(raw.op)) {
      unparsed.push(`非法运算符：${raw.op}`);
      continue;
    }
    const value = raw.value;
    if (factor.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
      unparsed.push(`阈值不是有限数字：${JSON.stringify(value)}`);
      continue;
    }
    if (factor.type === 'boolean' && typeof value !== 'boolean') {
      unparsed.push(`布尔因子值不合法：${JSON.stringify(value)}`);
      continue;
    }
    const cond = makeCondition({
      factor: raw.factor,
      op: raw.op,
      value,
      value2: raw.value2 ?? null,
      source: 'llm',
      confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.7,
      note: raw.note || '',
      mode: raw.mode === 'soft' ? 'soft' : 'hard',
      weight: typeof raw.weight === 'number' ? raw.weight : 1,
    });
    if (raw.op === 'between' && (cond.value2 === null || Number.isNaN(cond.value2))) {
      unparsed.push(`区间条件缺少第二个阈值：${raw.factor}`);
      continue;
    }
    const key = `${cond.factor}|${cond.op}|${JSON.stringify(cond.value)}|${cond.value2}`;
    if (!conditions.some((c) => `${c.factor}|${c.op}|${JSON.stringify(c.value)}|${c.value2}` === key)) {
      conditions.push(cond);
    }
  }

  for (const a of Array.isArray(payload?.assumptions) ? payload.assumptions : []) {
    if (typeof a === 'string' && a.trim()) assumptions.push(a.trim());
  }
  for (const a of Array.isArray(payload?.ambiguities) ? payload.ambiguities : []) {
    if (a && typeof a.question === 'string') {
      ambiguities.push({
        id: a.id || `llm_amb_${ambiguities.length}`,
        kind: a.kind || 'unsupported',
        question: a.question,
        options: Array.isArray(a.options) ? a.options : [],
      });
    }
  }
  for (const u of Array.isArray(payload?.unparsed) ? payload.unparsed : []) {
    if (typeof u === 'string' && u.trim()) unparsed.push(u.trim());
  }

  return {
    query: payload?.query || '',
    conditions,
    options,
    assumptions: [...new Set(assumptions)],
    ambiguities,
    unparsed: [...new Set(unparsed)],
    presets: [],
    source: 'llm',
    confidence: conditions.length ? 0.85 : 0,
  };
}

export const FACTOR_ALIAS_LIST = FACTOR_ALIASES;
