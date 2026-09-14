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
 *   lat, lon, timezone, asn, org, isp
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

/** 用归一化结果补齐缺失字段，保证调用方拿到的对象结构恒定 */
function normalizeInfo(partial) {
  const info = { ...EMPTY_INFO };
  for (const key of Object.keys(EMPTY_INFO)) {
    const value = partial[key];
    if (value !== undefined && value !== null && value !== '') {
      info[key] = value;
    }
  }
  return info;
}

/** 判断是否为内网 / 回环 / 链路本地地址 */
export function isPrivateIP(ip) {
  const parts = String(ip || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;

  if (parts[0] === 10) return true;                                  // 10.0.0.0/8
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
  if (parts[0] === 192 && parts[1] === 168) return true;             // 192.168.0.0/16
  if (parts[0] === 127) return true;                                 // 127.0.0.0/8 回环
  if (parts[0] === 169 && parts[1] === 254) return true;             // 169.254.0.0/16 链路本地
  return false;
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
 * 单个数据源的超时上限（毫秒）。
 *
 * 为什么必须设：实测在部分网络下数据源会解析到不可达的 IPv6 地址，
 * 请求不报错也不返回，一直挂到浏览器默认超时（几十秒），界面就一直转圈。
 * 设成 6 秒后，挂住的源会被快速跳过，最多 3×6=18 秒必有结论。
 */
export const SOURCE_TIMEOUT_MS = 6000;

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
    id: 'ipapi.co',
    label: 'ipapi.co',
    /** ip 为空时查询本机公网 IP */
    build: ip => (ip ? `https://ipapi.co/${encodeURIComponent(ip)}/json/` : 'https://ipapi.co/json/'),
    normalize(raw) {
      if (!raw || raw.error) return null;
      const { asn, org } = splitAsnAndOrg(raw.org ?? raw.asn);
      return normalizeInfo({
        ip: toText(raw.ip),
        country: toText(raw.country_name) || toText(raw.country),
        region: toText(raw.region),
        city: toText(raw.city),
        postal: toText(raw.postal),
        lat: toNumber(raw.latitude),
        lon: toNumber(raw.longitude),
        timezone: toText(raw.timezone),
        asn: toText(raw.asn) || asn,
        org,
        isp: org,
      });
    },
  },
  {
    id: 'ipwho.is',
    label: 'ipwho.is',
    build: ip => (ip ? `https://ipwho.is/${encodeURIComponent(ip)}` : 'https://ipwho.is/'),
    normalize(raw) {
      if (!raw || raw.success === false) return null;
      const conn = raw.connection || {};
      const tz = typeof raw.timezone === 'string' ? raw.timezone : raw.timezone?.id;
      return normalizeInfo({
        ip: toText(raw.ip),
        country: toText(raw.country),
        region: toText(raw.region),
        city: toText(raw.city),
        postal: toText(raw.postal),
        lat: toNumber(raw.latitude),
        lon: toNumber(raw.longitude),
        timezone: toText(tz),
        asn: toText(conn.asn) ? String(conn.asn).toUpperCase() : null,
        org: toText(conn.org) || toText(conn.isp),
        isp: toText(conn.isp) || toText(conn.org),
      });
    },
  },
  {
    id: 'ipinfo.io',
    label: 'ipinfo.io',
    build: ip => (ip ? `https://ipinfo.io/${encodeURIComponent(ip)}/json` : 'https://ipinfo.io/json'),
    normalize(raw) {
      if (!raw || raw.bogon) return null;
      const [lat, lon] = String(raw.loc || '').split(',');
      const { asn, org } = splitAsnAndOrg(raw.org);
      return normalizeInfo({
        ip: toText(raw.ip),
        country: toText(raw.country),
        region: toText(raw.region),
        city: toText(raw.city),
        postal: toText(raw.postal),
        lat: toNumber(lat),
        lon: toNumber(lon),
        timezone: toText(raw.timezone),
        asn,
        org,
        isp: org,
      });
    },
  },
];

/**
 * 依次尝试各数据源，返回第一个成功的结果。
 *
 * @param {string} ip  目标 IP，空串表示查本机
 * @param {{ signal?: AbortSignal, onAttempt?: (source, ok, detail) => void }} options
 * @returns {Promise<{ info: object, source: object }>}
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
      return { info, source };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      const detail = error?.message || String(error);
      reasons.push(`${source.label}: ${detail}`);
      onAttempt?.(source, false, detail);
    }
  }

  throw new Error(`全部数据源均不可用（${reasons.join('；')}）`);
}
