/**
 * check-copy-policy.mjs —— IP V1 商业口径的机器门禁
 *
 * 裁定要求三件事必须被"守住而不是一次改好"：
 *   ① 三页文案必须含规定的限定语（估算 / 通常只能精确到城市级 / 不代表实际物理位置 / 仅供参考）
 *   ② 不得出现"据 ASN 或地理集中推断住宅·移动·机房"式断言
 *   ③ network_type 全链路不输出，内部固定 unknown
 *
 * 因此这不是一个"看一眼就通过"的脚本：
 *   · 每条判据都配 **双向对照** —— 已知违规文本必须判红，合规文本（含否定式与上限式免责）不得误红。
 *     这条纪律来自本项目反复出现的教训：判据过宽会制造假问题，判据不判红的"通过"是假绿。
 *   · ③ 是真的把生产模块 import 进来跑一次归一化，看产出键集合，而不是 grep 一下就算。
 *   · 任一对照不成立 → 直接 ABORT，不出"全部通过"的结论。
 *
 * 用法：node scripts/check-copy-policy.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..')
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8')

let fail = 0
const ok = (name, cond, detail) => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`)
  if (!cond) fail++
}

/* ---------------- 判据 A：各页必须含的限定语 ---------------- */
const REQUIRED = {
  'index.html': ['IP 地理信息估算', '通常只能精确到城市级', '不代表设备或用户的实际物理位置', '仅供参考', '资源登记归属'],
  'terms.html': ['概率推断', '通常只能精确到城市级', '不代表设备或用户的实际物理位置', '仅供参考', '不判断、也不输出'],
  'guides.html': ['概率推断', '通常只能精确到城市级', '不代表设备或用户的实际物理位置', '仅供参考', '不等同于实际服务运营商'],
  // 裁定④（本轮新增授权页）：FAQ 里必须把"登记归属组织"和"实际接入运营商"分开说
  'faq.html': ['注册数据库里的归属组织', '不等同于该地址当前由哪家运营商提供接入服务', '不能用来判断使用者属于住宅、移动还是机房网络'],
  // 裁定②：docs 的精度边界段必须落在"注册归属 ≠ 实际位置"上；
  // 本轮再把 ASN 比较式的作用域钉进去（"更适合识别网络归属线索"，而不是笼统的"更可靠"）
  'docs.html': ['注册归属', '不等于设备的实际位置', '更适合用来识别流量所属的网络归属线索',
                '不能据此判断用户当前使用的接入运营商'],
  // 本轮：about 把"属于哪家运营商"限定为注册归属组织 / 网络信息
  'about.html': ['在注册归属数据里对应哪家组织或网络', '不一定代表用户当前实际使用的网络运营商', '也不代表设备的物理位置'],
  // 本轮：privacy 的数据处理描述必须与**实测缓存行为**一致（键含被查询 IP、有 TTL、无单条清除入口）
  'privacy.html': ['键中包含该 IP 原文', '到期自动失效', '没有单条手动清除入口'],
}
console.log('\n[A] 授权页面限定语（裁定"必须遵守的产品口径"逐条落地）')
// 必须在**去标签后的正文**上比，而不是在原始 HTML 上比：
// 「更适合用来识别流量所属的<strong>网络归属线索</strong>」这种写法，
// 用 raw includes 会判成"限定语缺失"（本轮实测踩过一次），而它明明渲染给了用户。
// 去标签 + 去空白同时也更严：只写在 <!-- --> 或 <script> 里的句子不再算数。
function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, '')
}
for (const [file, phrases] of Object.entries(REQUIRED)) {
  const body = visibleText(read(file))
  const missing = phrases.filter(p => !body.includes(p.replace(/\s+/g, '')))
  ok(`${file} 含全部 ${phrases.length} 项限定语`, missing.length === 0, missing.length ? '缺：' + missing.join(' / ') : '')
}

/* ---------------- 判据 B：禁止"接入类型/实际运营商"式断言 ---------------- */
// 命中式：把地址说成某类使用者，或把 ASN/组织直接当实际运营商。
// 每条规则单独声明豁免式 —— 上一版对所有规则统一开放"归属纠偏"豁免，
// 结果把 "更可能是机房而非真实用户分布" 这种**本身就是被禁止的分类断言**放过了
// （对照表里那条旧文案因此不再判红 = 门禁出现漏洞）。
// 结论：接入类型分类断言（1/2/5）永不吃 CORRECTIVE 豁免；只有"运营商身份"类（3/4）可以吃。
const FORBIDDEN = [
  { re: /(?:判定|判断|识别|确定|认定|视为)\S{0,14}(?:机房|住宅|数据中心|移动网络|residential|data ?center)/i, ex: ['NEGATION', 'LIMITER'] },
  { re: /(?:更可能|基本可判定|可以判定|说明\S{0,8}是)\S{0,16}(?:机房|住宅|数据中心|服务器发起)/i, ex: ['NEGATION', 'LIMITER'] },
  // 只禁"等同式"断言（就是 / 即为 / 正是 …实际运营商）。
  // 上一版把"属于"也算违规，结果把 about.html 里"属于哪家运营商""属于这家运营商"
  // 这种**登记归属说法**判红了 —— 那正是本轮口径要求采用的措辞，属于判据过宽制造假问题。
  { re: /(?:就是|即为|便是|正是|即是)[^。；]{0,8}(?:实际(?:的)?)?(?:服务)?运营商/, ex: ['NEGATION', 'LIMITER', 'CORRECTIVE'] },
  { re: /ASN\S{0,14}(?:就是|即为|即)\S{0,8}(?:运营商|服务商)/i, ex: ['NEGATION', 'LIMITER', 'CORRECTIVE'] },
  { re: /\bnetwork_type\s*[:=]\s*["']?(?:residential|mobile|hosting|data_?center)/i, ex: [] },
  // 裁定③补的盲区：datacenter / data center 这类**英文**接入类型词必须和中文"机房"同等对待。
  // 上一轮只写了中文"数据中心"，"classify this IP as data center traffic" 这种句子能溜过去；
  // 而 v2 审计的 D4 更是只覆盖"住宅/企业专线"，压根不看机房 —— 两套判据都有这个洞。
  { re: /(?:classif\w*|categoriz\w*|label\w*|treat\w*|mark\w*)[^.]{0,24}(?:data ?center|hosting|residential|mobile network)/i, ex: ['NEGATION', 'LIMITER'] },
  { re: /(?:this|these)\s+IP(?:s)?\s+are\s+(?:data ?center|hosting|residential)/i, ex: ['NEGATION'] },
  // 裁定②：绝对化精度表述。上一轮 docs.html 被判红两处（"精度最高""准确率最高"），
  // 出现在讲 GPS/Wi-Fi 方法和精度边界分级的段落里 —— 是"方法之间比较"也不是本站宣传，
  // 但口径不允许任何绝对化精度措辞，所以按裁定改文案而不是改判据。
  { re: /(?:精度|准确率|准确度|定位精度|可靠度)\S{0,6}(?:最高|第一|100%|绝对)|(?:最精确|业界领先|行业领先|全球领先|无一例外)/, ex: ['NEGATION', 'LIMITER'] },
]
// 观察项（不判红）：把 ASN 直接当作"运营商身份"来用的措辞。
// 三页之外的 faq/docs/about 有这类句子，本轮**未授权修改**，只登记移交下一轮裁定。
const ADVISORY = [
  /(?:判断|识别|确定)[^。；]{0,16}运营商/,
]
const EXEMPT = {
  // 否定句与上限句不得判成断言，否则等于逼产品删掉合规免责
  // 英文否定式并入 NEGATION：上一版只有中文豁免词，结果
  // "We do not classify IPs as data center or residential traffic…" 这条**合规否定句**被判红
  // —— 判据过宽会逼产品把英文免责也删掉。`\s*` 是必需的：分句后 "do not " 末尾带空格，
  // 纯 `\S{0,18}$` 匹配不上。
  NEGATION: /(?:不|未|没|无法|不能|不要|并非|不代表|不等同于|不判断|不得|没有可靠依据)\S{0,18}$|\b(?:not|never|cannot|can't|don't|doesn't|without|no need to)\b\s*\S{0,18}$/i,
  LIMITER: /(?:只能|仅能|通常只能|最多|至多|不超过|上限)\S{0,10}$/,
  // 归属纠偏句（"IP 属于运营商设备，而不是你本人"）符合口径，仅对运营商身份类规则豁免
  CORRECTIVE: /(?:而不是|而非|并非|不代表|不等于)/,
}

/** 先剥标签再分句：HTML 里没有句号的大段会让"子句"变成整页文本，
 *  于是任何一处关键词都会把整块判红（about.html 就是这么误报的）。 */
function toClauses(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
  return text.split(/(?<=[。；;!?])/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

function clauseViolations(input) {
  const out = []
  const clauses = input.includes('<')
    ? toClauses(input)
    : input.split(/(?<=[。；;!?])/).map(s => s.trim()).filter(Boolean)
  for (const clause of clauses) {
    for (const { re, ex } of FORBIDDEN) {
      const m = clause.match(re)
      if (!m) continue
      const before = clause.slice(0, m.index)
      let exempted = false
      for (const key of ex) {
        if (EXEMPT[key].test(before) || (key === 'CORRECTIVE' && EXEMPT.CORRECTIVE.test(clause.slice(m.index)))) {
          exempted = true
          break
        }
      }
      if (exempted) continue
      out.push(clause.slice(0, 110))
      break
    }
  }
  return out
}

console.log('\n[B] 禁止"据登记信息推断接入类型 / 把 ASN 当实际运营商 / 绝对化精度"')
// 判红范围 = 已获授权的页面。第 12 轮三页 → 第 13 轮加 docs/faq → 本轮再加 about/privacy，
// 现在全站 7 个业务页都在判红范围内；若将来出现未授权页命中，仍走 WARN 登记而不是偷偷改文案。
const ENFORCED = ['index.html', 'terms.html', 'guides.html', 'docs.html', 'faq.html', 'about.html', 'privacy.html']
const ADVISORY_PAGES = []
for (const file of ENFORCED) {
  const v = clauseViolations(read(file))
  ok(`${file} 无接入类型式断言（授权范围内，判红）`, v.length === 0, v.length ? v[0] : '')
}
for (const file of ADVISORY_PAGES) {
  const body = read(file)
  const v = clauseViolations(body)
  const adv = toClauses(body).filter(c => ADVISORY.some(re => re.test(c)))
  console.log(`  WARN ${file}（超出本轮授权，不判红）：硬禁令命中 ${v.length} 条 / ASN=运营商式措辞 ${adv.length} 条`)
  for (const s of [...v, ...adv].slice(0, 3)) console.log(`       └ ${s.slice(0, 96)}`)
  if (v.length) console.log('       （注：硬禁令若命中，说明该页文本与本轮口径冲突，需下一轮裁定后再改）')
}
if (ADVISORY_PAGES.length === 0) {
  console.log('  —— 已无"未授权只登记"的页面：全站 7 个业务页都在判红范围内（本行是为了让"0 页"不被读成"没扫"）')
}

/* ---------------- 判据 B 的双向对照 ---------------- */
console.log('\n[B-对照] 判据必须能判红，也不会乱红')
const MUST_RED = [
  ['旧 guides 文案（本轮已删）', '若集中在少数几个城市且 ASN 一致，更可能是机房而非真实用户分布。'],
  ['旧 guides 文案（本轮已删）', '如果它们的 ASN 都属于同一家云厂商，基本可判定为服务器发起的自动化流量。'],
  ['直接断言运营商', 'ASN 就是这个地址的实际运营商，可以直接据此封禁。'],
  ['等同式措辞（无 ASN 前缀）', '批量查询结果即为实际服务运营商，可据此判断流量来源。'],
  ['输出网络类型', 'network_type = residential 字段用于标识住宅网络用户。'],
  // 本轮裁定②删掉的 docs 原话：绝对化精度表述，冻结成必须判红样本
  ['旧 docs 文案（本轮已删）', '国家级：准确率最高，通常可信。'],
  ['旧 docs 文案（本轮已删）', '借助设备端 GPS/Wi-Fi 数据反推活动区域，精度最高，但依赖大量样本。'],
  // 裁定③补的 datacenter 盲区：英文措辞必须和中文"机房"一样判红
  ['datacenter 式分类（英文）', 'Classify these IPs as data center traffic and block them.'],
  ['residential 式断言（英文）', 'These IPs are residential addresses, so they are real users.'],
  ['机房式断言（英文 are）', 'These IPs are data center ranges, so they are bots.'],
]
let redPass = 0
for (const [name, s] of MUST_RED) {
  const hit = clauseViolations(s).length > 0
  if (hit) redPass++
  console.log(`  ${hit ? 'OK  ' : 'FAIL'} 应判红：${name}`)
  if (!hit) fail++
}
const MUST_GREEN = [
  '本工具不判断、也不输出使用者属于住宅网络、移动网络还是数据中心。',
  '不要据此把地址判定为机房地址或真实用户分布——这类推断我们没有可靠依据。',
  'IP 地理定位本质上只能精确到城市级，不代表设备或用户的实际物理位置。',
  'ASN 与「运营商 / 组织」来自第三方库的归属记录，不等同于该地址的实际服务运营商。',
  // 归属纠偏句：faq 里的原文，说的是"IP 属于运营商设备而不是你本人"，符合口径，不得误红
  'IP 地址归属于运营商的网络设备，而不是你本人。',
  // 登记归属措辞（about.html 原文）：说"属于哪家/这家运营商"是允许的口径，
  // 把它们钉进绿色对照，防止下次有人把判据重新放宽到"属于"。
  '拿到一个 IP，想知道它大概在哪儿、属于哪家运营商。',
  '把它当「大概在这个城市、属于这家运营商」来用是可靠的，指望定位到门牌号则会失望。',
  // 本轮裁定②④新写的合规文本：不得被绝对化禁令或接入类型禁令误红
  '这类方法通常能给出比 IP 归属库更细的范围，但依赖大量样本，且涉及隐私争议——本站不使用这类数据。',
  '国家级：在各精度层级里相对更可靠，但它反映的是注册归属，不等于设备的实际位置。',
  '街道级及以下：任何 IP 库都无法可靠提供，声称能做的一律不可信。',
  '通过 ASN 你看到的是这个 IP 段在注册数据库里的归属组织，它不等同于该地址当前由哪家运营商提供接入服务，也不能用来判断使用者属于住宅、移动还是机房网络。',
  // 英文合规否定句：放宽后的 datacenter 判据不得把它判红（否则等于逼产品删掉英文免责）
  'We do not classify IPs as data center or residential traffic, and we never expose such a field.',
  // 本轮三页新文案：不得被任何禁令误红（红了就是判据过宽）
  '在排查异常流量时，它通常比城市字段更适合用来识别流量所属的网络归属线索；但这不代表设备的实际位置，也不能据此判断用户当前使用的接入运营商。',
  '拿到一个 IP，想知道它大概在哪儿、在注册归属数据里对应哪家组织或网络。',
  '这不一定代表用户当前实际使用的网络运营商，也不代表设备的物理位置。',
  '本站按被查询的 IP 生成缓存键（键中包含该 IP 原文），到期自动失效，本站没有单条手动清除入口。',
]
// 诚实登记一处**不对称**：本轮从 docs 删掉的「ASN 比城市字段更可靠」没有被写成 MUST_RED，
// 因为现有禁令没有"比较式可靠性"这一条，而临时加一条会误红 faq 的「省级更可靠」、
// docs 的「较可靠，可作为业务参考」这类合规文本。
// 该句的防回归靠 A 段：新句子的作用域限定语（"更适合用来识别…网络归属线索"）是必需项，
// 谁把旧句改回来，必需短语就消失 → 门禁变红。这是另一种判据，不是没有判据。
let greenPass = 0
for (const s of MUST_GREEN) {
  const hit = clauseViolations(s)
  if (hit.length === 0) greenPass++
  console.log(`  ${hit.length === 0 ? 'OK  ' : 'FAIL'} 不应误红：${s.slice(0, 34)}…${hit.length ? ' → ' + hit[0] : ''}`)
  if (hit.length) fail++
}
if (redPass !== MUST_RED.length) { console.log('  FAIL 有违规文本没被判红 —— 门禁是摆设'); fail++ }
if (greenPass !== MUST_GREEN.length) { console.log('  FAIL 有合规文本被误判 —— 判据过宽'); fail++ }

/* ---------------- 判据 C：network_type 全链路不输出（真跑生产模块） ---------------- */
const ALLOWED_KEYS = ['ip', 'country', 'region', 'city', 'postal', 'lat', 'lon', 'timezone',
  'asn', 'org', 'isp', 'source', 'cached', 'countryOriginal']

console.log('\n[C] network_type 全链路不输出')
const mod = await import(pathToFileURL(path.join(REPO, 'js', 'ip-sources.js')).href)
const src = mod.IP_SOURCES.find(s => s.id === 'locip-server')
const produced = src.normalize({
  ip: '8.8.8.8', country: 'United States', country_original: 'US', region: 'California', city: 'Mountain View',
  postal: '94043', lat: 38.0, lon: -122.1, timezone: 'America/Los_Angeles', asn: 'AS15169',
  org: 'Google LLC', isp: 'Google LLC', source: 'ipinfo.io', cached: false,
  // 上游就算塞了这些字段，也不得透传到产品对象
  network_type: 'data_center', usage_type: 'hosting', conn_type: 'DLT', ip_type: 'residential',
})
const extra = Object.keys(produced).filter(k => !ALLOWED_KEYS.includes(k))
ok('归一化产出键集合 ⊆ 允许集合（无 network_type/usage_type/conn_type）',
  extra.length === 0, extra.length ? '多出：' + extra.join(',') : `${Object.keys(produced).length} 键`)
ok('上游注入的 network_type 未被透传', !('network_type' in produced))

const apiSrc = read('functions/api/ip.js')
ok('服务端 payload 不构造 network_type', !/network_type|usage_type|conn_type/.test(apiSrc))

// 这里只查"UI 上有没有一个用来展示接入类型的字段/标签"，不查正文用词：
// 正文出现"住宅 / 机房"是本轮新写的合规免责句，用关键词一刀切会自相矛盾。
const UI_FIELD = /id\s*=\s*["'][^"']*(?:network|usage|access)[-_]?type["']/i
const UI_LABEL = />\s*(?:网络类型|接入类型|Network\s*type)\s*</i
for (const f of ['index.html', 'guides.html', 'faq.html', 'docs.html', 'about.html', 'privacy.html']) {
  const body = read(f)
  const hits = [UI_FIELD.test(body), UI_LABEL.test(body)].filter(Boolean).length
  ok(`${f} 无"接入类型"展示字段/标签`, hits === 0)
}
// 客户端字段表是唯一决定结果卡渲染什么的清单，直接读源码断言
const appSrc = read('js/app.js')
const fieldIds = [...appSrc.matchAll(/\{\s*id:\s*'([^']+)'/g)].map(m => m[1])
ok('结果卡字段表不含接入类型项', !fieldIds.some(id => /network|usage|access|type/i.test(id)),
  `字段：${fieldIds.join(',')}`)

/* ---------------- 汇总 ---------------- */
console.log(`\n[check-copy-policy] ${fail ? 'FAIL ' + fail + ' 项' : 'PASS'} · A 限定语 / B 断言禁令（含双向对照） / C 字段全链路`)
process.exit(fail ? 1 : 0)
