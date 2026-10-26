#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建「意图选股器」的可复现 A 股快照。

数据源（均为公开接口，页面可回溯）：
1) 行情：东方财富 push2 clist，按代码升序分页，覆盖沪深 A 股（不含北交所）。
2) 财务：东方财富 F10 主要财务指标 RPT_F10_FINANCE_MAINFINADATA，
   取最新两个报告期（默认 2026-09-30 / 2026-06-30），按股票取更新的一期。
3) 历史行情：东方财富 push2his 日 K（前复权），计算 20/60 日收益、年化波动、
   最大回撤、MA20/MA60。

输出：data/snapshot.json（紧凑 JSON，含 meta / stocks）。
所有字段保留原始值或明确的空值，不用 0 代替缺失；质量标记写入 quality_flags。

用法：
  python scripts/fetch_snapshot.py --limit 30 --skip-kline   # 快速联调
  python scripts/fetch_snapshot.py                            # 全量
"""
from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys
import time
import urllib.parse
import urllib.request
from bisect import bisect_right
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
HEADERS = {"User-Agent": UA, "Referer": "https://quote.eastmoney.com/", "Accept-Encoding": "identity"}
QUOTE_FIELDS = (
    "f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f20,f21,f23,f24,f25,f26,f37,f100,f115,f124"
)
QUOTE_FS = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23"
MIN_FRESH_REPORT_DATE = "2026-06-30"
GROWTH_OUTLIER_PCT = 300.0
INDUSTRY_MIN_N = 8


def now_cn() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def http_json(url: str, retries: int = 4, timeout: int = 30):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8", "replace"))
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"request failed after {retries} attempts: {url[:160]} :: {last}")


def fetch_quotes(limit: int | None = None):
    """按代码升序分页拉取全部沪深 A 股行情，返回 (total, {code: row})。"""
    base = "https://push2.eastmoney.com/api/qt/clist/get"
    first_params = {
        "pn": "1",
        "pz": "100",
        "po": "0",
        "np": "1",
        "fltt": "2",
        "invt": "2",
        "fid": "f12",
        "fs": QUOTE_FS,
        "fields": QUOTE_FIELDS,
    }
    first = http_json(base + "?" + urllib.parse.urlencode(first_params))
    data = first.get("data") or {}
    total = int(data.get("total") or 0)
    if total <= 0:
        raise RuntimeError("行情接口未返回 total")
    pages = math.ceil(total / 100)
    rows: dict[str, dict] = {}
    for pn in range(1, pages + 1):
        params = dict(first_params, pn=str(pn))
        d = http_json(base + "?" + urllib.parse.urlencode(params))
        chunk = ((d.get("data") or {}).get("diff") or [])
        if not chunk:
            break
        for row in chunk:
            code = str(row.get("f12") or "").zfill(6)
            if code:
                rows[code] = row
        if limit and len(rows) >= limit:
            break
        if pn % 10 == 0 or pn == pages:
            print(f"[quotes] page {pn}/{pages}  collected={len(rows)}", flush=True)
    # 剔除无价格/已退市代码（行情接口会保留部分历史代码，价格为 "-"）。
    # 停牌但有收盘价的股票保留，用 SUSPENDED_OR_NO_PRICE/NO_VOLUME 标记，由筛选层默认排除。
    filtered: dict[str, dict] = {}
    dropped_no_price = 0
    for code, row in rows.items():
        price = num(row.get("f2"))
        name = str(row.get("f14") or "")
        if price is None or price <= 0 or "退" in name:
            dropped_no_price += 1
            continue
        filtered[code] = row
    if limit:
        filtered = dict(list(sorted(filtered.items()))[:limit])
    print(f"[quotes] filtered_no_price={dropped_no_price} active={len(filtered)}", flush=True)
    return total, filtered


def fetch_financials(report_date: str):
    """拉取指定报告期的全量主要财务指标，返回行列表。"""
    base = "https://datacenter-web.eastmoney.com/api/data/v1/get"
    columns = (
        "SECURITY_CODE,SECURITY_NAME_ABBR,REPORT_DATE,REPORT_TYPE,REPORT_DATE_NAME,ORG_TYPE,"
        "SECURITY_TYPE_CODE,NOTICE_DATE,TOTALOPERATEREVE,PARENTNETPROFIT,TOTALOPERATEREVETZ,"
        "PARENTNETPROFITTZ,ROEJQ,XSMLL,XSMLL_TB,ZCFZL,MGJYXJJE,EPSJB,BPS,ROIC"
    )
    rows: list[dict] = []
    page = 1
    pages = 1
    while page <= pages:
        params = {
            "reportName": "RPT_F10_FINANCE_MAINFINADATA",
            "columns": columns,
            "filter": f"(REPORT_DATE='{report_date}')",
            "pageNumber": str(page),
            "pageSize": "500",
            "sortColumns": "SECURITY_CODE",
            "sortTypes": "1",
            "source": "WEB",
            "client": "WEB",
        }
        d = http_json(base + "?" + urllib.parse.urlencode(params))
        result = d.get("result") or {}
        data = result.get("data") or []
        pages = int(result.get("pages") or 1)
        rows.extend(data)
        if page == 1 or page == pages or page % 10 == 0:
            print(f"[finance {report_date}] page {page}/{pages} rows={len(rows)}", flush=True)
        if not data:
            break
        page += 1
    return rows


def fetch_index_trade_date() -> str:
    url = (
        "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.000001"
        "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
        "&klt=101&fqt=1&beg=20260101&end=20500101"
    )
    d = http_json(url)
    klines = (d.get("data") or {}).get("klines") or []
    if not klines:
        return date.today().isoformat()
    return klines[-1].split(",")[0]


def fetch_kline(code: str, beg: str = "20250101"):
    market = "1" if code.startswith("6") else "0"
    url = (
        f"https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={market}.{code}"
        "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
        f"&klt=101&fqt=1&beg={beg}&end=20500101"
    )
    d = http_json(url, retries=3)
    return code, (d.get("data") or {}).get("klines") or []


def kline_metrics(klines: list[str]) -> dict:
    """从日 K 字符串计算趋势/波动指标；数据不足返回空值并标记。"""
    rows = []
    for line in klines:
        parts = line.split(",")
        if len(parts) < 7:
            continue
        try:
            rows.append(
                {
                    "date": parts[0],
                    "close": float(parts[2]),
                    "volume": float(parts[5]),
                    "amount": float(parts[6]),
                }
            )
        except ValueError:
            continue
    rows = [r for r in rows if r["close"] > 0]
    if not rows:
        return {
            "kline_last_date": None,
            "kline_rows": 0,
            "ret_20d": None,
            "ret_60d": None,
            "vol_60d": None,
            "max_dd_60d": None,
            "ma20": None,
            "ma60": None,
            "above_ma60": None,
            "ma20_gt_ma60": None,
            "kline_flags": ["MISSING_KLINE"],
        }
    closes = [r["close"] for r in rows]
    dates = [r["date"] for r in rows]
    flags: list[str] = []
    if len(closes) < 61:
        flags.append("NEW_LISTING_OR_SHORT_HISTORY")

    ret_20d = (closes[-1] / closes[-21] - 1.0) * 100.0 if len(closes) >= 21 else None
    ret_60d = (closes[-1] / closes[-61] - 1.0) * 100.0 if len(closes) >= 61 else None

    window = closes[-61:] if len(closes) >= 61 else closes
    rets = [math.log(window[i] / window[i - 1]) for i in range(1, len(window)) if window[i - 1] > 0]
    vol_60d = (statistics.pstdev(rets) * math.sqrt(252) * 100.0) if len(rets) >= 20 else None

    peak = window[0]
    worst = 0.0
    for c in window:
        peak = max(peak, c)
        worst = min(worst, c / peak - 1.0)
    max_dd_60d = worst * 100.0 if window else None

    ma20 = statistics.fmean(closes[-20:]) if len(closes) >= 20 else None
    ma60 = statistics.fmean(closes[-60:]) if len(closes) >= 60 else None
    above_ma60 = (closes[-1] > ma60) if ma60 is not None else None
    ma20_gt_ma60 = (ma20 > ma60) if (ma20 is not None and ma60 is not None) else None

    return {
        "kline_last_date": dates[-1],
        "kline_rows": len(rows),
        "ret_20d": round(ret_20d, 2) if ret_20d is not None else None,
        "ret_60d": round(ret_60d, 2) if ret_60d is not None else None,
        "vol_60d": round(vol_60d, 2) if vol_60d is not None else None,
        "max_dd_60d": round(max_dd_60d, 2) if max_dd_60d is not None else None,
        "ma20": round(ma20, 2) if ma20 is not None else None,
        "ma60": round(ma60, 2) if ma60 is not None else None,
        "above_ma60": above_ma60,
        "ma20_gt_ma60": ma20_gt_ma60,
        "kline_flags": flags,
    }


def num(value):
    if value is None or value == "" or value == "-":
        return None
    try:
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def build_stock(quote: dict, fin: dict | None, km: dict, trade_date: str) -> dict:
    code = str(quote.get("f12") or "").zfill(6)
    name = str(quote.get("f14") or "").strip()
    industry = str(quote.get("f100") or "").strip()
    if not industry or industry == "-":
        industry = "未分类"

    flags: list[str] = list(km.get("kline_flags") or [])
    price = num(quote.get("f2"))
    pct_chg = num(quote.get("f3"))
    volume = num(quote.get("f5"))
    amount = num(quote.get("f6"))
    turnover = num(quote.get("f8"))
    volume_ratio = num(quote.get("f10"))
    total_cap = num(quote.get("f20"))
    float_cap = num(quote.get("f21"))
    pb = num(quote.get("f23"))
    ret_60d_quote = num(quote.get("f24"))
    ret_ytd = num(quote.get("f25"))

    pe_candidates = [num(quote.get("f115")), num(quote.get("f9"))]
    pe_ttm = next((v for v in pe_candidates if v is not None and v > 0), None)
    if pe_ttm is None:
        if any(v is not None and v <= 0 for v in pe_candidates):
            flags.append("NEGATIVE_PE")
        else:
            flags.append("MISSING_PE")
    pe_source = None
    if pe_ttm is not None:
        pe_source = "f115" if (pe_candidates[0] is not None and pe_candidates[0] > 0) else "f9"

    if pb is not None and pb <= 0:
        flags.append("NEGATIVE_PB")
        pb = None
    elif pb is None:
        flags.append("MISSING_PB")

    if price is None or price <= 0:
        flags.append("SUSPENDED_OR_NO_PRICE")
    if volume is None or volume <= 0:
        flags.append("NO_VOLUME")

    st = ("ST" in name.upper()) or ("退" in name)
    if st:
        flags.append("ST")

    fin = fin or {}
    roe = num(fin.get("ROEJQ"))
    rev_growth = num(fin.get("TOTALOPERATEREVETZ"))
    profit_growth = num(fin.get("PARENTNETPROFITTZ"))
    gross_margin = num(fin.get("XSMLL"))
    gross_margin_chg = num(fin.get("XSMLL_TB"))
    debt_ratio = num(fin.get("ZCFZL"))
    ocf_ps = num(fin.get("MGJYXJJE"))
    eps = num(fin.get("EPSJB"))
    bps = num(fin.get("BPS"))
    roic = num(fin.get("ROIC"))
    report_date = (fin.get("REPORT_DATE") or "")[:10] or None
    report_name = fin.get("REPORT_DATE_NAME") or None
    notice_date = (fin.get("NOTICE_DATE") or "")[:10] or None
    org_type = fin.get("ORG_TYPE") or None

    if not report_date:
        flags.append("MISSING_FIN")
    elif report_date < MIN_FRESH_REPORT_DATE:
        flags.append("STALE_FIN")
    if report_date and report_date > trade_date:
        flags.append("FUTURE_REPORT")

    if bps is not None and bps < 0:
        flags.append("NEGATIVE_EQUITY")
    if rev_growth is not None and abs(rev_growth) > GROWTH_OUTLIER_PCT:
        flags.append("GROWTH_OUTLIER")
    if profit_growth is not None and abs(profit_growth) > GROWTH_OUTLIER_PCT:
        flags.append("GROWTH_OUTLIER")

    if km.get("kline_last_date") and km["kline_last_date"] != trade_date:
        flags.append("KLINE_STALE")
    if km.get("kline_last_date") and km["kline_last_date"] < trade_date:
        # 超过 7 个自然日没有新 K 线，视为可能停牌/长期无成交
        try:
            d1 = date.fromisoformat(km["kline_last_date"])
            d2 = date.fromisoformat(trade_date)
            if (d2 - d1).days > 7:
                flags.append("LONG_SUSPENSION")
        except ValueError:
            pass

    # 去重，保持顺序
    seen = set()
    flags = [f for f in flags if not (f in seen or seen.add(f))]

    def r2(v):
        return round(v, 2) if v is not None else None

    return {
        "code": code,
        "name": name,
        "market": "SH" if code.startswith("6") else "SZ",
        "industry": industry,
        "price": r2(price),
        "pct_chg": r2(pct_chg),
        "turnover": r2(turnover),
        "volume_ratio": r2(volume_ratio),
        "amount": r2(amount),
        "market_cap": round(total_cap / 1e8, 2) if total_cap and total_cap > 0 else None,
        "float_cap": round(float_cap / 1e8, 2) if float_cap and float_cap > 0 else None,
        "pe_ttm": r2(pe_ttm),
        "pe_source": pe_source,
        "pb": r2(pb),
        "ret_60d_quote": r2(ret_60d_quote),
        "ret_ytd": r2(ret_ytd),
        "roe": r2(roe),
        "rev_growth": r2(rev_growth),
        "profit_growth": r2(profit_growth),
        "gross_margin": r2(gross_margin),
        "gross_margin_chg": r2(gross_margin_chg),
        "debt_ratio": r2(debt_ratio),
        "ocf_ps": r2(ocf_ps),
        "eps": r2(eps),
        "bps": r2(bps),
        "roic": r2(roic),
        "report_date": report_date,
        "report_name": report_name,
        "notice_date": notice_date,
        "org_type": org_type,
        "kline_last_date": km.get("kline_last_date"),
        "kline_rows": km.get("kline_rows"),
        "ret_20d": km.get("ret_20d"),
        "ret_60d": km.get("ret_60d"),
        "vol_60d": km.get("vol_60d"),
        "max_dd_60d": km.get("max_dd_60d"),
        "ma20": km.get("ma20"),
        "ma60": km.get("ma60"),
        "above_ma60": km.get("above_ma60"),
        "ma20_gt_ma60": km.get("ma20_gt_ma60"),
        "quality_flags": flags,
        # 以下字段在 attach_industry_percentiles 填充
        "industry_n": None,
        "pe_industry_pct": None,
        "pb_industry_pct": None,
        "market_cap_industry_pct": None,
        "pe_industry_n": None,
        "pb_industry_n": None,
    }


def attach_industry_percentiles(stocks: list[dict]):
    by_industry: dict[str, list[dict]] = defaultdict(list)
    for s in stocks:
        by_industry[s["industry"]].append(s)

    for industry, group in by_industry.items():
        n = len(group)
        for s in group:
            s["industry_n"] = n
            if industry == "未分类" or n < INDUSTRY_MIN_N:
                if "INDUSTRY_SMALL" not in s["quality_flags"]:
                    s["quality_flags"].append("INDUSTRY_SMALL")

    for factor, pct_key, n_key, lower_is_better in (
        ("pe_ttm", "pe_industry_pct", "pe_industry_n", True),
        ("pb", "pb_industry_pct", "pb_industry_n", True),
        ("market_cap", "market_cap_industry_pct", None, False),
    ):
        groups: dict[str, list[tuple[dict, float]]] = defaultdict(list)
        for s in stocks:
            v = s.get(factor)
            if v is not None and v > 0:
                groups[s["industry"]].append((s, float(v)))
        for industry, items in groups.items():
            if industry == "未分类" or len(items) < INDUSTRY_MIN_N:
                continue
            vals = sorted(v for _, v in items)
            n = len(vals)
            for s, v in items:
                pct = bisect_right(vals, v) / n * 100.0
                s[pct_key] = round(pct, 1)
                if n_key:
                    s[n_key] = n


def compute_quality(stocks: list[dict], quote_total: int, kline_ok: int, report_counts: dict) -> dict:
    total = len(stocks)
    flag_counts = Counter(f for s in stocks for f in s["quality_flags"])
    report_dist = Counter(s["report_date"] or "缺失" for s in stocks)

    def missing_rate(key: str) -> float:
        n = sum(1 for s in stocks if s.get(key) is None)
        return round(n / total * 100, 2) if total else 0.0

    factors = [
        "price", "pe_ttm", "pb", "market_cap", "turnover", "roe", "rev_growth",
        "profit_growth", "gross_margin", "debt_ratio", "vol_60d", "max_dd_60d",
        "ret_60d", "ret_20d", "pe_industry_pct",
    ]
    missing = {k: missing_rate(k) for k in factors}
    return {
        "universe_count": total,
        "quote_total": quote_total,
        "quote_coverage_pct": round(total / quote_total * 100, 2) if quote_total else 0,
        "kline_ok": kline_ok,
        "kline_coverage_pct": round(kline_ok / total * 100, 2) if total else 0,
        "report_date_distribution": dict(report_dist.most_common()),
        "report_rows": report_counts,
        "flag_counts": dict(flag_counts.most_common()),
        "missing_rate_pct": missing,
        "industry_count": len({s["industry"] for s in stocks}),
        "unclassified_industry": sum(1 for s in stocks if s["industry"] == "未分类"),
        "st_count": sum(1 for s in stocks if "ST" in s["quality_flags"]),
        "suspended_count": sum(1 for s in stocks if "SUSPENDED_OR_NO_PRICE" in s["quality_flags"]),
        "negative_pe_count": sum(1 for s in stocks if "NEGATIVE_PE" in s["quality_flags"]),
        "missing_fin_count": sum(1 for s in stocks if "MISSING_FIN" in s["quality_flags"]),
        "stale_fin_count": sum(1 for s in stocks if "STALE_FIN" in s["quality_flags"]),
        "growth_outlier_count": sum(1 for s in stocks if "GROWTH_OUTLIER" in s["quality_flags"]),
    }


def build_meta(trade_date: str, quote_total: int, stocks: list[dict], kline_ok: int,
               report_counts: dict, started_at: float) -> dict:
    quality = compute_quality(stocks, quote_total, kline_ok, report_counts)
    return {
        "schema_version": "1.0.0",
        "product": "意图选股器 · Intent Screener",
        "generated_at": now_cn(),
        "trade_date": trade_date,
        "build_seconds": round(time.time() - started_at, 1),
        "universe": "沪深 A 股（不含北交所）",
        "stock_count": len(stocks),
        "data_sources": [
            {
                "name": "东方财富行情快照",
                "type": "quote",
                "url": "https://quote.eastmoney.com/",
                "endpoint": "push2.eastmoney.com/api/qt/clist/get",
                "as_of": trade_date,
                "fields": {
                    "price": "f2 最新价",
                    "pct_chg": "f3 涨跌幅",
                    "turnover": "f8 换手率",
                    "volume_ratio": "f10 量比",
                    "market_cap": "f20 总市值（元，转换为亿元）",
                    "float_cap": "f21 流通市值（元，转换为亿元）",
                    "pe_ttm": "f115 PE(TTM)，缺失时回退 f9 动态PE",
                    "pb": "f23 市净率",
                    "ret_60d_quote": "f24 60日涨跌幅",
                    "ret_ytd": "f25 年初至今涨跌幅",
                    "industry": "f100 行业",
                },
            },
            {
                "name": "东方财富 F10 主要财务指标",
                "type": "financial",
                "url": "https://emweb.securities.eastmoney.com/",
                "endpoint": "datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA",
                "as_of": sorted(report_counts.keys()),
                "fields": {
                    "roe": "ROEJQ 报告期加权 ROE（未年化）",
                    "rev_growth": "TOTALOPERATEREVETZ 营业总收入同比",
                    "profit_growth": "PARENTNETPROFITTZ 归母净利润同比",
                    "gross_margin": "XSMLL 销售毛利率",
                    "gross_margin_chg": "XSMLL_TB 毛利率同比（相对变化，%",
                    "debt_ratio": "ZCFZL 资产负债率",
                    "ocf_ps": "MGJYXJJE 每股经营现金流",
                    "eps": "EPSJB 基本每股收益",
                    "bps": "BPS 每股净资产",
                    "report_date": "REPORT_DATE 报告期",
                    "notice_date": "NOTICE_DATE 披露日",
                },
            },
            {
                "name": "东方财富日 K（前复权）",
                "type": "kline",
                "url": "https://quote.eastmoney.com/",
                "endpoint": "push2his.eastmoney.com/api/qt/stock/kline/get",
                "as_of": trade_date,
                "fields": {
                    "ret_20d": "近 20 个交易日收盘涨跌幅",
                    "ret_60d": "近 60 个交易日收盘涨跌幅",
                    "vol_60d": "近 60 个交易日对数收益年化波动率",
                    "max_dd_60d": "近 60 个交易日最大回撤",
                    "ma20": "20 日收盘均线",
                    "ma60": "60 日收盘均线",
                },
            },
        ],
        "definitions": [
            {"key": "pe_ttm", "label": "PE(TTM)", "unit": "倍", "note": "亏损股为负值，筛选时不得把负 PE 当作便宜；本产品将负 PE 标记为 NEGATIVE_PE 并按缺失处理。"},
            {"key": "pe_industry_pct", "label": "PE 行业分位", "unit": "%", "note": "同行业内 PE 由低到高的分位；越低越便宜。行业有效样本 < 8 时为空。"},
            {"key": "pb_industry_pct", "label": "PB 行业分位", "unit": "%", "note": "同行业内 PB 由低到高的分位；越低越便宜。"},
            {"key": "roe", "label": "报告期加权 ROE", "unit": "%", "note": "取自最新报告期，未年化；中报/三季报不可与年报 ROE 直接横比。"},
            {"key": "rev_growth", "label": "营收同比", "unit": "%", "note": "最新报告期营业总收入同比；基数异常时标记 GROWTH_OUTLIER。"},
            {"key": "profit_growth", "label": "归母净利同比", "unit": "%", "note": "最新报告期归母净利润同比；基数异常时标记 GROWTH_OUTLIER。"},
            {"key": "vol_60d", "label": "近60日年化波动率", "unit": "%", "note": "对数收益标准差 × √252；历史不足 20 个交易日为空。"},
            {"key": "max_dd_60d", "label": "近60日最大回撤", "unit": "%", "note": "区间内峰值到谷值的最大跌幅，负值越大回撤越深。"},
            {"key": "report_date", "label": "财务报告期", "unit": "日期", "note": "早于 2026-06-30 标记 STALE_FIN；UI 逐股展示报告期与披露日。"},
        ],
        "limitations": [
            "行情为构建时点的快照，盘中构建时价格/估值会随行情变化；提交版本在页面顶部标注快照时间。",
            "财务数据来自公开 F10 接口，按股票取最新报告期；未做审计级复核，不构成投资建议。",
            "ROE 为报告期加权 ROE，未年化；中报、三季报、年报之间不可直接横比。",
            "行业分类采用东方财富行业字段，行业分位仅在有效样本 >= 8 时计算。",
            "PE 为负的亏损股不能视为低估值；本产品按缺失处理并展示原因。",
            "未接入实时行情推送、公告原文、研报与回测；监控任务仅在当前快照内模拟。",
            "不输出涨跌预测、收益承诺或买卖建议。",
        ],
        "quality": quality,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data", "snapshot.json"))
    parser.add_argument("--limit", type=int, default=None, help="仅构建前 N 只，联调用")
    parser.add_argument("--workers", type=int, default=10)
    parser.add_argument("--skip-kline", action="store_true")
    parser.add_argument("--kline-beg", default="20250101")
    args = parser.parse_args()

    started = time.time()
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)

    trade_date = fetch_index_trade_date()
    print(f"[meta] trade_date={trade_date}", flush=True)

    quote_total, quotes = fetch_quotes(limit=args.limit)
    print(f"[quotes] total={quote_total} collected={len(quotes)}", flush=True)

    report_dates = ["2026-09-30", "2026-06-30"]
    fin_by_code: dict[str, dict] = {}
    report_counts: dict[str, int] = {}
    for rd in report_dates:
        rows = fetch_financials(rd)
        report_counts[rd] = len(rows)
        for row in rows:
            code = str(row.get("SECURITY_CODE") or "").zfill(6)
            if not code:
                continue
            prev = fin_by_code.get(code)
            if prev is None or str(row.get("REPORT_DATE") or "") > str(prev.get("REPORT_DATE") or ""):
                fin_by_code[code] = row
        print(f"[finance {rd}] rows={len(rows)} merged_codes={len(fin_by_code)}", flush=True)

    kline_map: dict[str, dict] = {}
    if args.skip_kline:
        for code in quotes:
            kline_map[code] = kline_metrics([])
    else:
        codes = list(quotes.keys())
        print(f"[kline] fetching {len(codes)} codes with {args.workers} workers ...", flush=True)
        done = 0
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(fetch_kline, c, args.kline_beg): c for c in codes}
            for fut in as_completed(futures):
                code = futures[fut]
                try:
                    _, klines = fut.result()
                    kline_map[code] = kline_metrics(klines)
                except Exception as exc:  # noqa: BLE001
                    print(f"[kline] {code} failed: {exc}", file=sys.stderr, flush=True)
                    kline_map[code] = kline_metrics([])
                done += 1
                if done % 250 == 0 or done == len(codes):
                    print(f"[kline] {done}/{len(codes)}", flush=True)

    stocks = []
    for code, quote in quotes.items():
        km = kline_map.get(code) or kline_metrics([])
        stocks.append(build_stock(quote, fin_by_code.get(code), km, trade_date))

    attach_industry_percentiles(stocks)
    kline_ok = sum(1 for s in stocks if s.get("kline_last_date"))
    meta = build_meta(trade_date, quote_total, stocks, kline_ok, report_counts, started)

    payload = {"meta": meta, "stocks": stocks}
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, args.out)
    size_mb = os.path.getsize(args.out) / 1024 / 1024
    print(f"[done] {len(stocks)} stocks -> {args.out} ({size_mb:.2f} MB) in {meta['build_seconds']}s", flush=True)
    print(json.dumps(meta["quality"], ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
