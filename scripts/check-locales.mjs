/**
 * 静态站（dd-i18n 机制型）locale 配平门禁 —— G2 的 B 型执行器。
 *
 * 背景：ip / fangdai / streamplay 三站共用同一份 `js/dd-i18n.js`（字节相同），
 * 词条是 `locales/<code>.json`（扁平 key，如 "nav.devtools"）。此前三站**没有任何
 * 配平检查**：缺一个 key 只会在切到该语言时把 key 名原样渲染出来，界面上不报错。
 *
 * 判据（与主站 G2 同语义）：
 *   1. 每个 locale 文件必须能解析、顶层为对象；
 *   2. 以 default（en）为基准，其它 locale 不得缺 key、值不得为空串；
 *   3. 不得有多余 key（防维护漂移：删了基准 key 却留下残条目）；
 *   4. 占位符集合必须一致（{name} / %s 之类，数量与名称都不许漂）。
 *
 * 用法：`node scripts/check-locales.mjs`，退出码 0 = PASS / 1 = FAIL。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales');
const DEFAULT_LOCALE = 'en';

/** 把嵌套对象摊平成点号 key（本仓当前是扁平 JSON，兼容两者）。 */
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const PLACEHOLDER = /\{[a-zA-Z0-9_]+\}|%[sd]/g;
const placeholdersOf = (s) => (typeof s === 'string' ? [...s.matchAll(PLACEHOLDER)].map(m => m[0]).sort().join(',') : '');

const files = readdirSync(LOCALES_DIR).filter(f => f.endsWith('.json')).sort();
if (!files.length) { console.error('[locales] FAIL locales/ 下没有任何 .json'); process.exit(1); }

const tables = {};
const failures = [];
for (const f of files) {
  const code = f.replace(/\.json$/, '');
  try {
    const data = JSON.parse(readFileSync(join(LOCALES_DIR, f), 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('顶层不是对象');
    tables[code] = flatten(data);
  } catch (e) {
    failures.push(`locales/${f} 解析失败：${String(e.message || e).split('\n')[0]}`);
  }
}

const codes = Object.keys(tables).sort();
if (!tables[DEFAULT_LOCALE]) {
  failures.push(`缺少基准语言 locales/${DEFAULT_LOCALE}.json`);
} else {
  const base = tables[DEFAULT_LOCALE];
  for (const code of codes) {
    if (code === DEFAULT_LOCALE) continue;
    const t = tables[code];
    const missing = Object.keys(base).filter(k => !(typeof t[k] === 'string' && t[k].trim() !== ''));
    const extra = Object.keys(t).filter(k => !(k in base));
    const phMismatch = Object.keys(base).filter(k => k in t && placeholdersOf(base[k]) !== placeholdersOf(t[k]));
    if (missing.length) failures.push(`${code} 缺 ${missing.length} 个 key：${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`);
    if (extra.length) failures.push(`${code} 有 ${extra.length} 个多余 key：${extra.slice(0, 8).join(', ')}${extra.length > 8 ? ' …' : ''}`);
    if (phMismatch.length) failures.push(`${code} 占位符不一致 ${phMismatch.length} 个：${phMismatch.slice(0, 8).join(', ')}`);
  }
}

for (const code of codes) console.log(`[locales] ${code}: ${Object.keys(tables[code]).length} keys`);
if (failures.length) {
  console.error(`[locales] FAIL ${failures.length} 项：`);
  for (const f of failures) console.error(`[locales]   - ${f}`);
  process.exit(1);
}
console.log('[locales] PASS 各语言 key 集合/空值/多余键/占位符一致');
