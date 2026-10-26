import {
  FACTORS, evaluateCondition, screen, validateConditions, conditionImpact,
  buildExplanation, complianceCheck, makeCondition,
} from './engine.js';
import { parseQuery } from './parser.js';

const baseStock = (over = {}) => ({
  code: '000001', name: '测试股份', market: 'SZ', industry: '测试行业',
  price: 10, pct_chg: 1, turnover: 1, volume_ratio: 1, amount: 1e8,
  market_cap: 100, float_cap: 80, pe_ttm: 20, pe_source: 'f115', pb: 2,
  ret_60d_quote: 5, ret_ytd: 5, roe: 12, rev_growth: 10, profit_growth: 10,
  gross_margin: 30, gross_margin_chg: 1, debt_ratio: 40, ocf_ps: 1, eps: 1, bps: 10, roic: 10,
  report_date: '2026-06-30', report_name: '2026中报', notice_date: '2026-08-15', org_type: '通用',
  kline_last_date: '2026-10-26', kline_rows: 200, ret_20d: 5, ret_60d: 5,
  vol_60d: 20, max_dd_60d: -10, ma20: 10, ma60: 9, above_ma60: true, ma20_gt_ma60: true,
  quality_flags: [], industry_n: 20, pe_industry_pct: 40, pb_industry_pct: 40,
  market_cap_industry_pct: 50, pe_industry_n: 20, pb_industry_n: 20,
  ...over,
});

export function runSelfTests({ stocks = [], meta = null, conditions = [], options = {} } = {}) {
  const out = [];
  const check = (name, fn) => {
    try {
      const detail = fn();
      out.push({ name, pass: true, detail: typeof detail === 'string' ? detail : '' });
    } catch (err) {
      out.push({ name, pass: false, detail: err.message });
    }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  check('解析：三个模糊词能拆成 >=8 个可检查条件', () => {
    const p = parseQuery('经营改善、估值合理、走势相对稳定', { stocks });
    assert(p.conditions.length >= 8, `实际 ${p.conditions.length} 个条件`);
    assert(p.presets.length === 3, `实际 ${p.presets.length} 个预设`);
    return `${p.conditions.length} 条件 / ${p.assumptions.length} 条口径假设`;
  });

  check('解析：数值条件能正确映射因子与阈值', () => {
    const p = parseQuery('ROE大于15%，PE低于20，市值超过500亿', { stocks });
    const roe = p.conditions.find((c) => c.factor === 'roe');
    const pe = p.conditions.find((c) => c.factor === 'pe_ttm');
    const cap = p.conditions.find((c) => c.factor === 'market_cap');
    assert(roe && roe.value === 15, 'ROE 阈值不对');
    assert(pe && pe.value === 20, 'PE 阈值不对');
    assert(cap && cap.value === 500, '市值阈值不对');
    return `${roe.op}15 / ${pe.op}20 / ${cap.op}500亿`;
  });

  check('解析：只有排除项时不应误报“未识别”', () => {
    const p = parseQuery('不要ST，排除停牌，只要主板', { stocks });
    assert(p.conditions.length === 0, '不应产生条件');
    assert(p.unparsed.length === 0, `unparsed=${p.unparsed.join('|')}`);
    assert(p.options.board === 'main', 'board 未生效');
    return `board=${p.options.board}`;
  });

  check('缺失值：负 PE 不通过估值条件，且状态为 missing', () => {
    const s = baseStock({ pe_ttm: null, quality_flags: ['NEGATIVE_PE'] });
    const r = evaluateCondition(s, makeCondition({ factor: 'pe_ttm', op: '<=', value: 30 }));
    assert(r.status === 'missing', `实际 ${r.status}`);
    assert(r.reason.includes('负'), '原因未提示负 PE');
    return r.reason;
  });

  check('缺失值：财务缺失不通过 ROE 条件，不当作 0', () => {
    const s = baseStock({ roe: null, quality_flags: ['MISSING_FIN'] });
    const r = evaluateCondition(s, makeCondition({ factor: 'roe', op: '>=', value: 10 }));
    assert(r.status === 'missing', `实际 ${r.status}`);
    assert(r.reason.includes('财务'), '原因未提示财务缺失');
    return r.reason;
  });

  check('冲突检查：PE<=10 与 PE>=30 应报互斥', () => {
    const v = validateConditions([
      makeCondition({ factor: 'pe_ttm', op: '<=', value: 10 }),
      makeCondition({ factor: 'pe_ttm', op: '>=', value: 30 }),
    ]);
    assert(v.errors.some((e) => e.code === 'CONFLICT'), '未报冲突');
    return v.errors[0].message;
  });

  check('软条件：不通过时不应把股票排除', () => {
    const stocks2 = [baseStock({ code: '000001', roe: 5 }), baseStock({ code: '000002', roe: 20 })];
    const cs = [
      makeCondition({ factor: 'roe', op: '>=', value: 10, mode: 'soft' }),
      makeCondition({ factor: 'market_cap', op: '>=', value: 1, mode: 'hard' }),
    ];
    const r = screen(stocks2, cs, { excludeST: true, excludeSuspended: true });
    assert(r.matched.length === 2, `实际 ${r.matched.length}`);
    assert(r.matched[0].score >= r.matched[1].score, '软条件未参与排序');
    return `2 只均保留，软条件只影响分数`;
  });

  check('敏感性：收紧 PE 阈值后入选数量不应增加', () => {
    const p = parseQuery('PE低于30', { stocks });
    const before = screen(stocks, p.conditions, p.options);
    const impact = conditionImpact(stocks, p.conditions, 0, { value: 10 }, p.options);
    assert(impact.afterCount <= before.matched.length, `after=${impact.afterCount} before=${before.matched.length}`);
    return `${before.matched.length} → ${impact.afterCount}（${impact.delta}）`;
  });

  check('数据完整性：股票代码唯一，关键股票存在', () => {
    if (!stocks.length) return '无数据快照，跳过（浏览器端会再跑）';
    const codes = new Set(stocks.map((s) => s.code));
    assert(codes.size === stocks.length, '存在重复代码');
    assert(codes.has('600519'), '缺少 600519');
    assert(codes.has('300750'), '缺少 300750');
    return `${stocks.length} 只，代码唯一`;
  });

  check('合规：解释文案不含买卖建议词', () => {
    const s = baseStock();
    const c = makeCondition({ factor: 'roe', op: '>=', value: 10 });
    const ev = evaluateCondition(s, c);
    const exp = buildExplanation(s, { matched: true, score: 80, results: [{ condition: c, ...ev }] }, [c]);
    const text = `${exp.headline} ${exp.bullets.join(' ')}`;
    const ck = complianceCheck(text);
    assert(ck.pass, `命中禁用词：${ck.hits.join('、')}`);
    return '通过';
  });

  return out;
}
