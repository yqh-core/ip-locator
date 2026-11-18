/**
 * IP 数据源适配层（纯数据，不碰 DOM）。
 *
 * 每个数据源只负责两件事：
 *   1. build(ip)  —— 拼出请求 URL（ip 为空表示查询本机公网 IP）
 *   2. normalize(raw) —— 把各家字段各异的响应归一化成统一的 IPInfo 结构，
 *      拿不到就置 null，绝不让调用方去猜字段名
 *
 * 新增数据源 = 往 IP_SOURCES 里加一项，UI 层不用改。
 *
 * 统一产出结构 IPInfo:
 * {
 *   ip, country, region, city, postal,
 *   lat, lon, timezone, asn, org, isp,
 *   // 溯源（D1 修复新增，不得丢弃）
 *   source,          // 实际应答方 id：服务端回报 or 直连源自身
 *   cached,          // 是否命中服务端边缘缓存；null = 该路径不上报
 *   countryOriginal  // 上游原话的国家值（country 可能是本站补全后的展示值）
 * }
 */

/** 把任意值转成有限数字，失败返回 null */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 去掉首尾空格；空串归一成 null */
function toText(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * ASN 统一成 "AS4837" 形态。
 * ipwho.is 给的是纯数字 4837，ipinfo.io 给的是 "AS4837"，不统一的话界面上
 * 同一个字段会随数据源变样。
 */
export function formatAsn(raw) {
  const s = toText(raw);
  if (!s) return null;
  return /^AS/i.test(s) ? s.toUpperCase() : `AS${s}`;
}

/**
 * 拆分 "AS4837 CHINA UNICOM Backbone" 这类字段。
 * 返回 { asn, org }，两者都可能为 null。
 */
export function splitAsnAndOrg(raw) {
  const s = toText(raw);
  if (!s) return { asn: null, org: null };

  const match = s.match(/^(AS\d+)\s*(.*)$/i);
  if (match) {
    return {
      asn: match[1].toUpperCase(),
      org: toText(match[2]) || match[1].toUpperCase(),
    };
  }
  return { asn: null, org: s };
}

const EMPTY_INFO = {
  ip: null,
  country: null,
  region: null,
  city: null,
  postal: null,
  lat: null,
  lon: null,
  timezone: null,
  asn: null,
  org: null,
  isp: null,
};

/**
 * 溯源字段（D1 修复，2026-11-03）。
 *
 * 为什么单独列一组而不是塞进 EMPTY_INFO：EMPTY_INFO 是"归属地数据"，
 * 这组是"这条数据从哪来、是不是缓存"。上一版把两者混在一个白名单循环里，
 * 服务端诚实返回的 source / cached 到客户端就被静默丢弃，于是界面上
 * "本次实际生效的数据源"这句话永远为假。分开列，丢弃就只能显式发生。
 *
 * · source          实际应答方的标识。必须来自真实响应，不得由客户端按
 *                   优先级推断（代理路径取服务端返回的值；直连路径取
 *                   该源自己的 id —— 因为它本身就是应答者）。
 * · cached          是否命中服务端边缘缓存。null = 该路径不上报，界面不臆造。
 * · countryOriginal 上游原话的国家值；country 是展示值（可能经本站补全）。
 */
const PROVENANCE_KEYS = ['source', 'cached', 'countryOriginal'];

/** 用归一化结果补齐缺失字段，保证调用方拿到的对象结构恒定 */
function normalizeInfo(partial, provenance = {}) {
  const info = { ...EMPTY_INFO };
  for (const key of Object.keys(EMPTY_INFO)) {
    const value = partial[key];
    if (value !== undefined && value !== null && value !== '') {
      info[key] = value;
    }
  }
  // 溯源字段独立补齐：值为 null 表示"确实不知道"，与"没这个字段"不同，
  // 所以这里不能用上面那个"空值跳过"的循环。
  for (const key of PROVENANCE_KEYS) {
    info[key] = provenance[key] ?? null;
  }
  return info;
}

/**
 * 把 2 字母国家码补成完整国家名，同时保留上游原话。
 *
 * 与 functions/api/ip.js 的 expandCountryName 同一口径，这样"代理应答"和
 * "浏览器直连应答"两条路径显示的国家形态一致（上一版直连会显示 "US"，
 * 代理显示 "United States"，同一字段随路径变样）。
 * 拿不到就原样返回，宁可显示码也不要出错；原值一律留在 countryOriginal。
 */
let regionNames = null;
function expandCountry(country) {
  const s = toText(country);
  if (!s) return { country: null, countryOriginal: s };
  if (!/^[A-Za-z]{2}$/.test(s)) return { country: s, countryOriginal: s };
  try {
    if (!regionNames) regionNames = new Intl.DisplayNames(['zh-Hans'], { type: 'region' });
    return { country: regionNames.of(s.toUpperCase()) || s, countryOriginal: s };
  } catch {
    return { country: s, countryOriginal: s };
  }
}

/**
 * 上游/服务端应答方 id → 界面显示名。
 * 覆盖服务端可能回报的 id（含 cloudflare-edge 零依赖兜底）。
 */
const ENTITY_LABELS = {
  'ipwho.is': 'ipwho.is',
  'ipapi.co': 'ipapi.co',
  'ipinfo.io': 'ipinfo.io',
  'cloudflare-edge': 'Cloudflare 边缘节点自带信息',
  'locip-server': '本站服务端代理',
}

export function entityLabel(id) {
  return ENTITY_LABELS[id] || id || null;
}

/** 判断 IPv4 是否为内网 / 回环 / 链路本地地址 */
function isPrivateIPv4(ip) {
  const parts = String(ip || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;

  if (parts[0] === 10) return true;                                  // 10.0.0.0/8
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
  if (parts[0] === 192 && parts[1] === 168) return true;             // 192.168.0.0/16
  if (parts[0] === 127) return true;                                 // 127.0.0.0/8 回环
  if (parts[0] === 169 && parts[1] === 254) return true;             // 169.254.0.0/16 链路本地
  return false;
}

/**
 * 判断是否为内网 / 回环 / 链路本地地址（IPv4 与 IPv6）。
 * IPv6：::1 回环、:: 未指定、fe80::/10 链路本地、fc00::/7 唯一本地；
 * ::ffff:a.b.c.d 这类 IPv4-mapped 地址按其 IPv4 部分判定。
 */
export function isPrivateIP(ip) {
  const s = String(ip || '').trim();
  if (s.includes(':')) {
    const low = s.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (/^fe[89ab]/.test(low)) return true;   // fe80::/10
    if (/^f[cd]/.test(low)) return true;      // fc00::/7
    const mapped = low.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isPrivateIPv4(mapped[1]);
    return false;
  }
  return isPrivateIPv4(s);
}

/** 校验点分十进制 IPv4 格式（只做格式校验，不判断可达性） */
export function isValidIPv4(ip) {
  const s = String(ip || '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return false;
  return s.split('.').every(p => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

/**
 * 校验 IPv6 格式（含 :: 压缩与 IPv4-mapped 尾段，不判断可达性）。
 * 规则：至多一个 ::；纯十六进制段每段 1–4 位；无 :: 时恰好 8 段，
 * 有 :: 时两侧段数之和 ≤ 7（:: 至少代表一段）；尾段可为点分 IPv4。
 * 带 zone index（%eth0）的地址对公网归属查询无意义，按非法处理。
 */
export function isValidIPv6(ip) {
  let s = String(ip || '').trim();
  if (!s.includes(':') || s.length > 45) return false;

  // 尾段是点分 IPv4（如 ::ffff:192.168.0.1）：校验后替换成两个十六进制段
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!isValidIPv4(tail)) return false;
    s = s.slice(0, lastColon + 1) + '0:0';
  }

  const dcCount = (s.match(/::/g) || []).length;
  if (dcCount > 1) return false;

  let groups;
  if (dcCount === 1) {
    const [left, right] = s.split('::');
    const lg = left ? left.split(':') : [];
    const rg = right ? right.split(':') : [];
    if (lg.length + rg.length > 7) return false;
    groups = [...lg, ...rg];
  } else {
    groups = s.split(':');
    if (groups.length !== 8) return false;
  }
  return groups.every(g => /^[0-9a-fA-F]{1,4}$/.test(g));
}

/** IPv4 或 IPv6 任一合法即可 */
export function isValidIP(ip) {
  return isValidIPv4(ip) || isValidIPv6(ip);
}

/** 返回 IP 版本（4 / 6），非法返回 null */
export function ipVersion(ip) {
  if (isValidIPv4(ip)) return 4;
  if (isValidIPv6(ip)) return 6;
  return null;
}

/**
 * 单个数据源的超时上限（毫秒）。
 *
 * 为什么必须设：实测在部分网络下数据源会解析到不可达的 IPv6 地址，
 * 请求不报错也不返回，一直挂到浏览器默认超时（几十秒），界面就一直转圈。
 * 设成 6 秒后，挂住的源会被快速跳过，最多 3×6=18 秒必有结论。
 */
export const SOURCE_TIMEOUT_MS = 4000;

/**
 * 把调用方信号和超时信号合并成一个。
 * 浏览器不支持 AbortSignal.any 时退化为「只用超时」，保证超时兜底始终生效。
 */
function withTimeout(signal, timeout) {
  const timeoutSignal = AbortSignal.timeout(timeout);
  if (!signal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeoutSignal]);
  return timeoutSignal;
}

/**
 * 数据源清单。顺序即降级顺序：前一个失败（网络错误 / 非 2xx / 归一化后无 IP）
 * 自动换下一个，全部失败才向用户报错。
 */
export const IP_SOURCES = [
  {
    /**
     * 本站服务端代理（functions/api/ip.js）。
     *
     * 排在第一位是有意的：它把自查路径完全走 Cloudflare 边缘数据（不打第三方），指定 IP 查询带短周期边缘缓存，命中时比直连更快。
     * 万一 Pages Functions 没生效（本地打开、或路由未部署），这里会拿到 404 / HTML，
     * json() 抛错，下面的降级逻辑会自动换直连源，不会让用户卡住。
     */
    id: 'locip-server',
    // P1-5：label 表达「数据来源」而非「请求路径」。该源是本站服务端代理
    // （functions/api/ip.js），背后转发第三方 IP 数据库——数据实际来自第三方，
    // 旧 label「本站服务端」会让用户误以为数据由本站提供，与页脚
    // 「查询结果来自第三方 IP 数据服务」矛盾。请求路径在结果卡静态说明中单独说明。
    label: '第三方 IP 数据服务',
    /**
     * 降级提示里用的是"这一条请求路径"失败了，不是"这一家数据库"失败了。
     * P1-5 把 label 改成表达数据来源之后，在降级列表里反而说不清：
     * 用户会以为"第三方数据库不可用"，实际是本站代理这一跳没通。
     * 所以给降级文案单配一个路径名。
     */
    pathLabel: '本站服务端代理',
    /**
     * 'reported' = 应答方是谁，只有服务端自己知道，必须读它回报的 source。
     * 直连源用默认的 'self'（它本身就是应答者，说自己是它是事实，不是推断）。
     * 这一条是 D1 的核心判据：代理路径下**绝不**把 'locip-server' 当数据来源，
     * 也不在服务端没回 source 时拿优先级去猜。
     */
    entityFrom: 'reported',
    build: ip => (ip ? `/api/ip?ip=${encodeURIComponent(ip)}` : '/api/ip'),
    normalize(raw) {
      // 服务端返回的已经是统一的 IPInfo 结构 + 溯源字段
      if (!raw || raw.error || !raw.ip) return null;
      // ⚠ 这一路真正的应答方是 raw.source（服务端并发竞态里胜出的那一家），
      // 不是本条目的 id 'locip-server'。'locip-server' 只是请求路径。
      // 界面必须显示 raw.source —— 这是 D1 的核心，不得用客户端预设优先级推断。
      const shown = expandCountry(raw.country);
      const info = normalizeInfo({ ...raw, country: shown.country }, {
        source: toText(raw.source),
        cached: typeof raw.cached === 'boolean' ? raw.cached : null,
        countryOriginal: toText(raw.country_original) || shown.countryOriginal,
      });
      return info;
    },
  },
  // 直连兜底只保留 ipinfo.io（2026-11-18）：
  // ipapi.co 免费计划不可用于生产，2026-11-17 已移除。
  // ipwho.is 商用条款未能核到一手说明，复盘包要求未确认许可的端点不得用于本站，故不再请求。
  // ENTITY_LABELS 仍保留旧 id，避免历史缓存里的 source 显示成空白。
  {
    id: 'ipinfo.io',
    label: 'ipinfo.io',
    build: ip => (ip ? `https://ipinfo.io/${encodeURIComponent(ip)}/json` : 'https://ipinfo.io/json'),
    normalize(raw) {
      if (!raw || raw.bogon) return null;
      const [lat, lon] = String(raw.loc || '').split(',');
      const { asn, org } = splitAsnAndOrg(raw.org);
      const shown = expandCountry(toText(raw.country));
      return normalizeInfo({
        ip: toText(raw.ip),
        country: shown.country,
        region: toText(raw.region),
        city: toText(raw.city),
        postal: toText(raw.postal),
        lat: toNumber(lat),
        lon: toNumber(lon),
        timezone: toText(raw.timezone),
        asn: formatAsn(asn),
        org,
        isp: org,
      }, {
        source: 'ipinfo.io',
        cached: null,
        countryOriginal: shown.countryOriginal,
      });
    },
  },
];

/**
 * 依次尝试各数据源，返回第一个成功的结果。
 *
 * @param {string} ip  目标 IP，空串表示查本机
 * @param {{ signal?: AbortSignal, onAttempt?: (source, ok, detail) => void }} options
 * @returns {Promise<{ info: object, source: object, entity: string|null }>}
 *   · source  本次**由哪一条请求链路**拿到答案（可能是本站代理，也可能是某家直连）
 *   · entity  答案**实际出自哪家数据库**：代理路径取服务端回报的 raw.source，
 *             直连路径就是该源自己。界面只显示这个，不显示猜测出来的优先级。
 * @throws 全部数据源都失败时抛 Error，message 里带上每个源的原因
 */
export async function fetchIPInfo(ip, options = {}) {
  const { signal, onAttempt, timeout = SOURCE_TIMEOUT_MS } = options;
  const reasons = [];

  for (const source of IP_SOURCES) {
    try {
      const response = await fetch(source.build(ip), {
        signal: withTimeout(signal, timeout),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const info = source.normalize(await response.json());
      // 归一化后连 IP 都拿不到，视为这个源没给出可用答案
      if (!info || !info.ip) throw new Error('响应缺少 IP 字段');

      onAttempt?.(source, true, '');
      // entity 的取值规则由每个源自己声明，避免"用客户端优先级猜应答方"：
      //   entityFrom: 'reported' → 只认响应里回报的 source；没有就是 null（不猜）
      //   其余（直连源）默认 'self' → 它本身就是应答者，报自己的 id 是事实
      const entity = source.entityFrom === 'reported'
        ? (info.source ?? null)
        : (info.source ?? source.id)
      return { info, source, entity };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      const detail = error?.message || String(error);
      // 汇总错误同样按"请求路径"记账，理由同 pathLabel 注释
      reasons.push(`${source.pathLabel || source.label}: ${detail}`);
      onAttempt?.(source, false, detail);
    }
  }

  throw new Error(`全部数据源均不可用（${reasons.join('；')}）`);
}
