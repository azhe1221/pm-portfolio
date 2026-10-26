/**
 * 零依赖静态服务器 + 可选 LLM 解析代理。
 *
 * 默认：只提供静态文件，前端使用本地规则解析器。
 * 配置 LLM_API_KEY 后：/api/parse 会把自然语言发给 OpenAI-compatible Chat Completions，
 * 前端再做一次白名单/类型/范围校验；LLM 失败时自动回退本地解析器。
 *
 * 环境变量：
 *   PORT=8080
 *   LLM_BASE_URL=https://api.openai.com/v1
 *   LLM_API_KEY=...
 *   LLM_MODEL=gpt-4o-mini
 *   LLM_MOCK=1   # 本地演示/测试，不调用外部 API
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon',
};

let cachedMeta = null;
function snapshotMeta() {
  if (cachedMeta) return cachedMeta;
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'data', 'snapshot.json'), 'utf8');
    cachedMeta = JSON.parse(raw).meta;
  } catch { cachedMeta = null; }
  return cachedMeta;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const FACTOR_KEYS = [
  'pe_ttm', 'pb', 'pe_industry_pct', 'pb_industry_pct', 'market_cap', 'market_cap_industry_pct',
  'turnover', 'volume_ratio', 'pct_chg', 'ret_20d', 'ret_60d', 'vol_60d', 'max_dd_60d',
  'above_ma60', 'ma20_gt_ma60', 'roe', 'rev_growth', 'profit_growth', 'gross_margin',
  'gross_margin_chg', 'debt_ratio', 'ocf_ps', 'eps', 'bps', 'roic', 'industry',
];

const SYSTEM_PROMPT = `你是 A 股选股意图解析器。把用户的中文意图解析为 JSON，不要输出解释文字。
可用因子（只能用这些 key）：${FACTOR_KEYS.join(', ')}。
规则：
1. 模糊词必须展开为可检查的代理条件，并把口径写进 assumptions。
2. PE 为负的亏损股不能被当作低估值；估值条件用 pe_ttm 和 pe_industry_pct 表达。
3. 缺失数据不能用 0 代替；解析阶段不补值。
4. 识别不了的词放进 unparsed；有歧义的放进 ambiguities（question + options）。
5. 不输出买卖建议、目标价、收益承诺。
输出 JSON 结构：
{
  "conditions": [{"factor":"roe","op":">=","value":10,"mode":"hard","confidence":0.8,"note":"口径"}],
  "options": {"excludeST": true, "excludeSuspended": true, "board": "all"},
  "assumptions": ["..."],
  "ambiguities": [{"id":"...","kind":"unsupported","question":"...","options":[]}],
  "unparsed": ["..."]
}
op 只允许 >= <= > < == between is contains not_contains in。`;

async function callLLM(query) {
  if (process.env.LLM_MOCK === '1') {
    return {
      conditions: [
        { factor: 'rev_growth', op: '>=', value: 10, mode: 'hard', confidence: 0.82, note: '经营改善：营收同比≥10%' },
        { factor: 'profit_growth', op: '>=', value: 10, mode: 'hard', confidence: 0.82, note: '经营改善：归母净利同比≥10%' },
        { factor: 'roe', op: '>=', value: 10, mode: 'hard', confidence: 0.82, note: '经营改善：报告期ROE≥10%' },
        { factor: 'pe_ttm', op: '<=', value: 30, mode: 'hard', confidence: 0.8, note: '估值合理：PE≤30' },
        { factor: 'pe_industry_pct', op: '<=', value: 50, mode: 'hard', confidence: 0.8, note: '估值合理：行业PE分位≤50%' },
      ],
      options: { excludeST: true, excludeSuspended: true, board: 'all' },
      assumptions: ['LLM_MOCK 模式：仅用于本地联调，不对应真实模型输出'],
      ambiguities: [],
      unparsed: [],
    };
  }
  const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: query },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    parsed._model = model;
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

export function createAppServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/api/health') {
      const meta = snapshotMeta();
      return json(res, 200, {
        ok: true,
        snapshot: meta ? { trade_date: meta.trade_date, stock_count: meta.stock_count, generated_at: meta.generated_at } : null,
        llm: { configured: Boolean(process.env.LLM_API_KEY || process.env.LLM_MOCK === '1'), model: process.env.LLM_MODEL || (process.env.LLM_MOCK === '1' ? 'mock' : null) },
      });
    }

    if (pathname === '/api/parse') {
      if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      const configured = Boolean(process.env.LLM_API_KEY || process.env.LLM_MOCK === '1');
      if (!configured) {
        return json(res, 501, { error: 'LLM_NOT_CONFIGURED', message: '未配置 LLM_API_KEY；前端会自动使用本地规则解析器。' });
      }
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}');
        const query = String(body.query || '').trim();
        if (!query || query.length > 500) return json(res, 400, { error: 'INVALID_QUERY' });
        const result = await callLLM(query);
        return json(res, 200, { source: 'llm', query, ...result });
      } catch (err) {
        return json(res, 502, { error: 'LLM_FAILED', message: String(err.message || err) });
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });

    let rel = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.resolve(ROOT, `.${rel}`);
    if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) return json(res, 403, { error: 'FORBIDDEN' });
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) return json(res, 404, { error: 'NOT_FOUND' });
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': (ext === '.html' || ext === '.js' || ext === '.css' || ext === '.json') ? 'no-cache' : 'public, max-age=3600',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath).pipe(res);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || '0.0.0.0';
  createAppServer().listen(port, host, () => {
    console.log(`意图选股器: http://127.0.0.1:${port}`);
    console.log(`LLM: ${process.env.LLM_API_KEY ? 'configured' : process.env.LLM_MOCK === '1' ? 'mock' : 'local parser only'}`);
  });
}
