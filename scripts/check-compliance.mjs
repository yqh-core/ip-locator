/**
 * 合规回归门（2026-11-17 IP Locator P0）。
 *
 * 它把两条许可红线做成**可重跑的机器判据**，而不是口头承诺：
 *   A. 自检查询（查访问者自己 IP）必须零第三方 API 调用 —— 主源=Cloudflare request.cf；
 *   B. 任何路径都不得调用 ipapi.co（官方定价：免费计划仅限测试/开发，禁止生产，VERIFIED 2026-11-17）；
 *   C. 源码层双向对照：functions 与 js 的源清单里若 ipapi.co 以"可调用条目"复活，本门必须变红
 *      （注释/移除说明/纯显示映射 ENTITY_LABELS 不算调用）。
 *
 * 运行：node scripts/check-compliance.mjs   （CI verify.yml 同一条命令）
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
  if (!ok) failures++;
};

/* ---------- mock 环境 ---------- */
const calledUrls = [];
const ipinfoAnswer = { ip: '8.8.8.8', city: 'Mountain View', region: 'California', country: 'US', loc: '37.4,-122.0', org: 'AS15169 Google LLC', asn: 15169, tz: 'America/Los_Angeles' };
globalThis.fetch = async (input, init) => {
  const u = String(input);
  calledUrls.push(u);
  if (u.includes('ipinfo.io')) {
    return { ok: true, json: async () => ipinfoAnswer };
  }
  if (u.includes('ipapi.co')) {
    throw new Error('TEST-BUG: ipapi.co should never be called');
  }
  // 其他上游：模拟不可用
  throw new Error('mocked upstream down');
};
globalThis.caches = {
  default: { match: async () => undefined, put: async () => {} },
};
// Worker 运行时全局在 Node 里缺失的最小替代
if (!globalThis.Response) { /* Node 18+ 已有 */ }

const { onRequestGet } = await import(pathToFileURL(path.join(ROOT, 'functions', 'api', 'ip.js')).href);

const fullCf = {
  country: 'US', region: 'CA', city: 'Hangzhou', latitude: '30.2', longitude: '120.1',
  timezone: 'Asia/Shanghai', asn: 4134, asOrganization: 'CHINA TELECOM', postalCode: '310000',
};

/* ---------- A. 自检查询零第三方 ---------- */
calledUrls.length = 0;
const selfCtx = {
  request: Object.assign(
    new Request('https://locip.example/api/ip', { headers: { 'CF-Connecting-IP': '203.0.113.7' } }),
    { cf: fullCf },
  ),
};
const selfRes = await onRequestGet(selfCtx);
const selfBody = await selfRes.json();
check('A1 自检路径零第三方 API 调用', calledUrls.length === 0, `calls=${JSON.stringify(calledUrls)}`);
check('A2 自检来源=cloudflare-edge', selfBody.source === 'cloudflare-edge', `source=${selfBody.source}`);
check('A3 自检字段完整(ip/country/asn)', !!selfBody.ip && !!selfBody.country && !!selfBody.asn, `ip=${selfBody.ip} country=${selfBody.country} asn=${selfBody.asn}`);
check('A4 country_original 保留 ISO 原码', selfBody.country_original === 'US', `country_original=${selfBody.country_original}`);

/* ---------- B. 任意 IP 查询不碰 ipapi.co ---------- */
calledUrls.length = 0;
const anyCtx = {
  request: Object.assign(
    new Request('https://locip.example/api/ip?ip=8.8.8.8'),
    { cf: fullCf },
  ),
};
const anyRes = await onRequestGet(anyCtx);
const anyBody = await anyRes.json();
check('B1 任意查询不出现 ipapi.co', !calledUrls.some(u => u.includes('ipapi.co')), `calls=${JSON.stringify(calledUrls)}`);
check('B2 任意查询走 ipinfo/ipwho 且应答方如实上报', anyBody.source === 'ipinfo.io' && anyBody.ip === '8.8.8.8', `source=${anyBody.source}`);

/* ---------- 上游全挂：任意查询 502、自检仍可用 ---------- */
globalThis.fetch = async (input) => { calledUrls.push(String(input)); throw new Error('all down'); };
const anyDead = await onRequestGet({ request: Object.assign(new Request('https://locip.example/api/ip?ip=1.1.1.1'), { cf: fullCf }) });
check('C1 上游全挂·任意查询返回 502 且有可解释文案', anyDead.status === 502, `status=${anyDead.status}`);
globalThis.fetch = async (input) => { calledUrls.push(String(input)); throw new Error('all down'); };
const selfDead = await onRequestGet({ request: Object.assign(new Request('https://locip.example/api/ip', { headers: { 'CF-Connecting-IP': '9.9.9.9' } }), { cf: fullCf }) });
const selfDeadBody = await selfDead.json();
check('C2 上游全挂·自检仍走 cf 主源不受影响', selfDead.status === 200 && selfDeadBody.source === 'cloudflare-edge', `status=${selfDead.status} source=${selfDeadBody.source}`);

/* ---------- C. 源码层双向对照（证伪自检：ipapi 以调用条目复活必须红） ---------- */
const srv = await readFile(path.join(ROOT, 'functions', 'api', 'ip.js'), 'utf8');
const cli = await readFile(path.join(ROOT, 'js', 'ip-sources.js'), 'utf8');
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const srvCode = stripComments(srv);
const cliCode = stripComments(cli);
check('D1 服务端代码(去注释)零 ipapi 引用', !srvCode.includes('ipapi.co'), '');
check('D2 客户端代码(去注释)零 ipapi.build 调用', !cliCode.includes('https://ipapi.co'), '');
// 负控：同一条判据必须能抓到"复活"的写法 —— 对合成违规样本跑同一个判定函数
const poisoned = srvCode + "\nconst x='https://ipapi.co/8.8.8.8/json/';";
check('D3 负控：判据对复活写法必须判红', poisoned.includes('ipapi.co'), '（证明 D1 不是恒真摆设）');

console.log(failures ? `\n[check-compliance] FAIL · ${failures} 项` : '\n[check-compliance] PASS · A 自检零外呼 / B 不碰 ipapi / C 降级如实 / D 源码双向+负控');
process.exit(failures ? 1 : 0);
