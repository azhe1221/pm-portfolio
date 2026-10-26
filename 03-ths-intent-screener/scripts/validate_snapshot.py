#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
校验 data/snapshot.json，并生成 docs/数据校验报告.md。
默认包含 3 个在线交叉核对（行情 vs 日K、F10 独立入口），可用 --offline 跳过。
"""
from __future__ import annotations

import argparse
import json
import math
import os
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone, timedelta

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
HEADERS = {"User-Agent": UA, "Referer": "https://quote.eastmoney.com/"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def http_json(url, timeout=20):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def is_finite_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--out", default=os.path.join(ROOT, "docs", "数据校验报告.md"))
    args = parser.parse_args()

    path = os.path.join(ROOT, "data", "snapshot.json")
    size_mb = os.path.getsize(path) / 1024 / 1024
    with open(path, encoding="utf-8") as f:
        snap = json.load(f)
    meta = snap.get("meta") or {}
    stocks = snap.get("stocks") or []
    checks = []

    def check(name, ok, detail):
        checks.append({"name": name, "ok": bool(ok), "detail": str(detail)})

    codes = [s.get("code") for s in stocks]
    check("股票数量与 meta 一致", meta.get("stock_count") == len(stocks), f"meta={meta.get('stock_count')} / 实际={len(stocks)}")
    check("股票代码唯一", len(codes) == len(set(codes)), f"{len(codes)} 条，去重后 {len(set(codes))} 条")
    check("快照交易日期存在", bool(meta.get("trade_date")), meta.get("trade_date"))
    check("数据源声明完整", bool(meta.get("data_sources")) and len(meta["data_sources"]) >= 3, f"{len(meta.get('data_sources') or [])} 个来源")
    check("字段口径声明完整", bool(meta.get("definitions")) and len(meta["definitions"]) >= 8, f"{len(meta.get('definitions') or [])} 个字段定义")

    required = ["code", "name", "industry", "price", "pe_ttm", "pb", "market_cap", "roe", "rev_growth", "profit_growth", "vol_60d", "max_dd_60d", "quality_flags"]
    missing_fields = [k for k in required if any(k not in s for s in stocks)]
    check("必填字段存在", not missing_fields, f"缺失字段：{missing_fields}" if missing_fields else "全部存在")

    # 数值合法性
    bad = []
    for s in stocks:
        for k in ("price", "market_cap", "turnover", "vol_60d", "max_dd_60d", "pe_ttm", "pb", "roe", "rev_growth", "profit_growth"):
            v = s.get(k)
            if v is None:
                continue
            if not is_finite_number(v):
                bad.append(f"{s.get('code')}.{k}={v!r}")
    check("数值字段均为有限数字", not bad, f"异常 {len(bad)} 个" if bad else "无 NaN/Infinity")

    ranges = {
        "price": (0, 100000), "market_cap": (0, 1e7), "turnover": (0, 1000),
        "pe_ttm": (0, 10000000), "pb": (0, 10000), "roe": (-1000, 1000),
        "rev_growth": (-10000000, 10000000), "profit_growth": (-10000000, 10000000),
        "vol_60d": (0, 1000), "max_dd_60d": (-100, 0),
        "pe_industry_pct": (0, 100), "pb_industry_pct": (0, 100),
        "market_cap_industry_pct": (0, 100),
    }
    out_of_range = []
    for s in stocks:
        for k, (lo, hi) in ranges.items():
            v = s.get(k)
            if v is None:
                continue
            if not (lo <= v <= hi):
                out_of_range.append(f"{s.get('code')}.{k}={v}")
    check("关键字段在可解释范围内", not out_of_range, f"越界 {len(out_of_range)} 个：{out_of_range[:5]}" if out_of_range else "全部在范围内")

    # 负 PE 必须为空 + 标记
    neg_pe_bad = [s["code"] for s in stocks if "NEGATIVE_PE" in (s.get("quality_flags") or []) and s.get("pe_ttm") is not None]
    check("负 PE 股票未被当成正估值", not neg_pe_bad, f"异常 {len(neg_pe_bad)} 只" if neg_pe_bad else "负 PE 均已置空并标记 NEGATIVE_PE")

    # 极端增速必须带标记，不能静默当正常
    growth_unflagged = [s["code"] for s in stocks if (s.get("profit_growth") is not None and abs(s["profit_growth"]) > 300) and "GROWTH_OUTLIER" not in (s.get("quality_flags") or [])]
    check("极端增速已标记 GROWTH_OUTLIER", not growth_unflagged, f"未标记 {len(growth_unflagged)} 只" if growth_unflagged else "全部标记")

    # 财务覆盖率 / K线覆盖率
    fin_missing = [s for s in stocks if not s.get("report_date")]
    kline_missing = [s for s in stocks if not s.get("kline_last_date")]
    check("财务覆盖率 >= 99%", len(fin_missing) / max(len(stocks), 1) < 0.01, f"缺失 {len(fin_missing)} 只（{len(fin_missing)/max(len(stocks),1)*100:.2f}%）")
    check("K线覆盖率 >= 99%", len(kline_missing) / max(len(stocks), 1) < 0.01, f"缺失 {len(kline_missing)} 只（{len(kline_missing)/max(len(stocks),1)*100:.2f}%）")
    check("行业分类覆盖率 >= 99%", sum(1 for s in stocks if s.get("industry") and s.get("industry") != "未分类") / max(len(stocks), 1) >= 0.99, f"未分类 {sum(1 for s in stocks if s.get('industry') == '未分类')} 只")

    # 财务报告期不晚于快照日
    future = [s["code"] for s in stocks if s.get("report_date") and s["report_date"] > str(meta.get("trade_date"))]
    check("财务报告期不晚于快照日", not future, f"异常 {len(future)} 只" if future else "全部 <= trade_date")

    # 关键股票
    by_code = {s["code"]: s for s in stocks}
    known = {"600519": "贵州茅台", "300750": "宁德时代", "600036": "招商银行"}
    for code, name in known.items():
        s = by_code.get(code)
        check(f"关键股票存在：{code} {name}", bool(s), "存在" if s else "缺失")
        if s:
            check(f"{code} 字段可解释", (s.get("price") or 0) > 0 and (s.get("market_cap") or 0) > 0 and s.get("industry") != "未分类", f"price={s.get('price')} cap={s.get('market_cap')} industry={s.get('industry')}")

    # 在线交叉核对
    online = []
    if not args.offline:
        try:
            # 1) 行情价格 vs 日K最后收盘（3 只）
            for code in ("600519", "300750", "600036"):
                s = by_code.get(code)
                market = "1" if code.startswith("6") else "0"
                url = (f"https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={market}.{code}"
                       "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
                       "&klt=101&fqt=1&beg=20260101&end=20500101")
                d = http_json(url)
                klines = (d.get("data") or {}).get("klines") or []
                close = float(klines[-1].split(",")[2]) if klines else None
                diff = abs(close - s["price"]) / close * 100 if close else None
                online.append((f"行情/日K 收盘一致：{code}", diff is not None and diff < 1.0, f"行情={s['price']} 日K={close} 差={diff:.3f}%" if diff is not None else "无K线"))
            # 2) F10 独立入口 vs 快照 ROE（600519，2026中报）
            url = "https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=SH600519"
            d = http_json(url)
            row = next((x for x in (d.get("data") or []) if str(x.get("REPORT_DATE", "")).startswith("2026-06-30")), None)
            snap_roe = by_code["600519"].get("roe")
            online.append(("F10 独立入口 ROE 一致：600519", bool(row) and abs(float(row.get("ROEJQ")) - snap_roe) < 0.05, f"独立={row.get('ROEJQ') if row else None} 快照={snap_roe}"))
        except Exception as exc:  # noqa: BLE001
            online.append(("在线交叉核对", False, f"网络/接口失败：{exc}"))
        for name, ok, detail in online:
            check(name, ok, detail)

    # 质量统计
    flag_counts = Counter(f for s in stocks for f in (s.get("quality_flags") or []))
    report_dist = Counter(s.get("report_date") or "缺失" for s in stocks)
    missing_pe = sum(1 for s in stocks if s.get("pe_ttm") is None)
    negative_pe = sum(1 for s in stocks if "NEGATIVE_PE" in (s.get("quality_flags") or []))
    st = sum(1 for s in stocks if "ST" in (s.get("quality_flags") or []))

    passed = sum(1 for c in checks if c["ok"])
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    now = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    lines = [
        "# 数据校验报告",
        "",
        f"- 生成时间：{now}",
        f"- 快照文件：`data/snapshot.json`（{size_mb:.2f} MB）",
        f"- 快照交易日期：{meta.get('trade_date')}",
        f"- 数据生成时间：{meta.get('generated_at')}",
        f"- 股票池：{len(stocks)} 只（行情原始 {meta.get('quality', {}).get('quote_total')} 只，剔除无价格/退市后）",
        f"- 校验结果：**{passed}/{len(checks)} 通过**",
        "",
        "## 校验项",
        "",
        "| 结果 | 校验项 | 说明 |",
        "| --- | --- | --- |",
    ]
    for c in checks:
        lines.append(f"| {'PASS' if c['ok'] else 'FAIL'} | {c['name']} | {c['detail']} |")
    lines += [
        "",
        "## 质量统计",
        "",
        f"- 财务报告期分布：`{json.dumps(dict(report_dist.most_common()), ensure_ascii=False)}`",
        f"- PE 为空：{missing_pe} 只（其中负 PE {negative_pe} 只，按缺失处理，不当作便宜）",
        f"- ST/*ST/退市风险：{st} 只（默认预过滤排除）",
        f"- 质量标记：`{json.dumps(dict(flag_counts.most_common()), ensure_ascii=False)}`",
        "",
        "## 口径备注",
        "",
        "- 行情、财务、日K均为公开接口在构建时点的快照；盘中构建时价格/估值会变化，页面顶部标注快照时间。",
        "- ROE 为最新报告期加权 ROE，未年化；中报/三季报/年报之间不可直接横比。",
        "- 负 PE 一律置空并标记；缺失值不会被当作 0 参与筛选。",
        "- 行业分位仅在行业有效样本 >= 8 时计算。",
        "- 本报告是工程校验，不是审计；不构成投资建议。",
        "",
    ]
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print(f"{passed}/{len(checks)} checks passed -> {args.out}")
    for c in checks:
        if not c["ok"]:
            print(f"FAIL {c['name']}: {c['detail']}")
    return 0 if passed == len(checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
