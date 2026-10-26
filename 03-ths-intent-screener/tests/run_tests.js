/**
 * 命令行测试：真实快照 + 前端同款解析/筛选引擎。
 * 运行：npm test
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSelfTests } from '../assets/js/selftest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const snapshotPath = path.join(__dirname, '..', 'data', 'snapshot.json');
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const results = runSelfTests({ stocks: snapshot.stocks, meta: snapshot.meta });
const pass = results.filter((r) => r.pass).length;

console.log(`\n意图选股器 · 测试报告`);
console.log(`快照：${snapshot.meta.trade_date} · ${snapshot.meta.stock_count} 只 · ${snapshot.meta.generated_at}`);
console.log(`结果：${pass}/${results.length} 通过\n`);
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  if (r.detail) console.log(`      ${r.detail}`);
}
console.log('');
if (pass !== results.length) process.exit(1);
