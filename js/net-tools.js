/**
 * net-tools.js —— CIDR/子网计算 + DNS/rDNS 查询的纯逻辑层（第四轮，对标 ipinfo 工具簇）
 *
 * 职责边界（与 app.js / ip-sources.js 同口径）：
 *   - 本文件不碰 DOM、不认识 IP 归属地 API；CIDR 计算是纯数学，可单测。
 *   - DNS 走 Cloudflare 1.1.1.1 的 DoH JSON 接口（公共 DNS 解析服务，浏览器直连，
 *     不经本站服务器；与 ip-api 那类「免费端点限非商业」的归属地数据库性质不同）。
 *   - 地址分类（私有/环回/链路本地/公网）是地址本身的数学属性（RFC 定义），
 *     不是对使用者网络接入类型的推断 —— 与 C1 裁定（禁网络类型输出）不冲突，
 *     既有 ipType「公网/内网」展示同口径。
 */

/* ---------------- IPv4 ---------------- */

export function parseIPv4(str) {
  const s = String(str).trim();
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255 || (p.length > 1 && p[0] === '0')) return null; // 拒前导零（歧义八进制写法）
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function formatIPv4(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/* ---------------- IPv6 ---------------- */

/** 解析 IPv6 为 BigInt。支持 :: 压缩与 IPv4-mapped 尾段；拒 zone index。 */
export function parseIPv6(str) {
  let s = String(str).trim();
  if (s.includes('%')) return null; // zone index 不属于地址本身
  if (s === '::') return 0n;
  // IPv4-mapped 尾段（::ffff:1.2.3.4）
  const v4tail = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4tail) {
    const v4 = parseIPv4(v4tail[2]);
    if (v4 === null) return null;
    s = v4tail[1] + ((v4 >>> 16) & 0xffff).toString(16) + ':' + (v4 & 0xffff).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const expand = (part) => (part === '' ? [] : part.split(':'));
  const head = expand(halves[0]);
  const tail = halves.length === 2 ? expand(halves[1]) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && head.length + tail.length >= 8) return null;
  const groups = halves.length === 2
    ? [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail]
    : head;
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

/** RFC 5952 压缩格式：小写、最长零段压缩（并列取最左）、单零不压。 */
export function formatIPv6(n) {
  const groups = [];
  for (let i = 7; i >= 0; i--) {
    groups.push(Number((n >> BigInt(i * 16)) & 0xffffn).toString(16));
  }
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === '0') {
      if (curStart < 0) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestStart = curStart; bestLen = curLen; }
    } else {
      curStart = -1; curLen = 0;
    }
  }
  if (bestLen < 2) return groups.join(':');
  const head = groups.slice(0, bestStart).join(':');
  const tail = groups.slice(bestStart + bestLen).join(':');
  return head + '::' + tail;
}

/* ---------------- CIDR 计算 ---------------- */

const V4_SPECIALS = [
  { start: 0x0A000000, end: 0x0AFFFFFF, label: 'Private (RFC 1918)' },
  { start: 0xAC100000, end: 0xAC1FFFFF, label: 'Private (RFC 1918)' },
  { start: 0xC0A80000, end: 0xC0A8FFFF, label: 'Private (RFC 1918)' },
  { start: 0x7F000000, end: 0x7FFFFFFF, label: 'Loopback' },
  { start: 0xA9FE0000, end: 0xA9FEFFFF, label: 'Link-local' },
  { start: 0x64400000, end: 0x647FFFFF, label: 'Carrier-grade NAT (RFC 6598)' },
  { start: 0xE0000000, end: 0xEFFFFFFF, label: 'Multicast' },
  { start: 0xF0000000, end: 0xFFFFFFFF, label: 'Reserved' },
  { start: 0x00000000, end: 0x00FFFFFF, label: 'This network' },
];

function v4Classify(n) {
  for (const r of V4_SPECIALS) {
    if (n >= r.start && n <= r.end) return r.label;
  }
  return 'Public';
}

function v6Classify(n) {
  if (n === 1n) return 'Loopback';
  if (n === 0n) return 'Unspecified';
  if ((n >> 118n) === 0x3fan) return 'Link-local'; // fe80::/10 → 高 10 位 1111111010
  if ((n >> 121n) === 0x7en) return 'Unique local (fc00::/7)'; // fc00::/7 → 高 7 位 1111110
  if ((n >> 112n) === 0x2001n && ((n >> 96n) & 0xffffn) === 0x0db8n) return 'Documentation range (2001:db8::/32)';
  if ((n >> 120n) === 0xffn) return 'Multicast';
  if ((n >> 112n) === 0x2001n && ((n >> 96n) & 0xffffn) === 0n) return 'Teredo';
  return 'Public (global unicast)';
}

/**
 * 输入 CIDR（a.b.c.d/nn 或 x:x::x/nn）或裸 IP（按 /32、/128）。
 * 返回结构化结果；非法输入抛 Error（消息可直接展示）。
 */
export function cidrInfo(input) {
  const s = String(input).trim();
  const slash = s.lastIndexOf('/');
  const addrPart = slash < 0 ? s : s.slice(0, slash);
  const prefixPart = slash < 0 ? '' : s.slice(slash + 1);

  const v4 = parseIPv4(addrPart);
  if (v4 !== null) {
    const prefix = slash < 0 ? 32 : Number(prefixPart);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32 || (slash >= 0 && !/^\d{1,2}$/.test(prefixPart))) {
      throw new Error('The IPv4 prefix must be an integer from 0 to 32.');
    }
    const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
    const network = (v4 & mask) >>> 0;
    const size = 2 ** (32 - prefix);
    const broadcast = (network + size - 1) >>> 0;
    // RFC 3021：/31 点对点两端皆可用；/32 单地址
    const usable = prefix >= 31 ? size : size - 2;
    return {
      version: 4,
      input: s,
      network: formatIPv4(network),
      broadcast: formatIPv4(broadcast),
      firstUsable: formatIPv4(prefix >= 31 ? network : (network + 1) >>> 0),
      lastUsable: formatIPv4(prefix >= 31 ? broadcast : (broadcast - 1) >>> 0),
      mask: formatIPv4(mask),
      wildcard: formatIPv4((~mask) >>> 0),
      prefix,
      totalAddresses: String(size),
      usableHosts: String(usable),
      classification: v4Classify(network),
      note: prefix === 31 ? '/31 is a point-to-point link (RFC 3021); both addresses are usable.' : prefix === 32 ? '/32 represents a single host address.' : '',
    };
  }

  const v6 = parseIPv6(addrPart);
  if (v6 !== null) {
    const prefix = slash < 0 ? 128 : Number(prefixPart);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128 || (slash >= 0 && !/^\d{1,3}$/.test(prefixPart))) {
      throw new Error('The IPv6 prefix must be an integer from 0 to 128.');
    }
    const hostBits = 128n - BigInt(prefix);
    const size = 1n << hostBits;
    const mask = prefix === 0 ? 0n : (((1n << 128n) - 1n) << hostBits) & ((1n << 128n) - 1n);
    const network = v6 & mask;
    const last = network | (size - 1n);
    return {
      version: 6,
      input: s,
      network: formatIPv6(network),
      broadcast: '',
      subnetRouterAnycast: formatIPv6(network),
      lastAddress: formatIPv6(last),
      mask: formatIPv6(mask),
      wildcard: '',
      prefix,
      totalAddresses: size.toString(),
      classification: v6Classify(network),
      subnet64Count: (prefix <= 64 ? (1n << BigInt(64 - prefix)) : 0n).toString(),
      note: 'IPv6 has no broadcast address. The subnet prefix with an all-zero interface identifier is the Subnet-Router Anycast address (RFC 4291), not a normal host address. Reserved subnet anycast identifiers may also apply.',
    };
  }

  throw new Error('Enter a valid IPv4 or IPv6 address or CIDR range (e.g. 192.168.1.0/24 or 2001:db8::/32).');
}

/* ---------------- rDNS 名称构造 ---------------- */

export function ptrName(ip) {
  const v4 = parseIPv4(ip);
  if (v4 !== null) {
    return formatIPv4(v4).split('.').reverse().join('.') + '.in-addr.arpa';
  }
  const v6 = parseIPv6(ip);
  if (v6 !== null) {
    const hex = v6.toString(16).padStart(32, '0');
    return hex.split('').reverse().join('.') + '.ip6.arpa';
  }
  throw new Error('This is not a valid IP address.');
}

/* ---------------- DNS over HTTPS（Cloudflare 1.1.1.1） ---------------- */

export const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';
export const DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA', 'PTR'];

/**
 * DoH JSON 查询。返回 Cloudflare 原始 JSON（Status/Answer/Authority…）。
 * 超时 10s；网络/CORS 失败与 DNS 状态码分开如实报告。
 */
export async function dohQuery(name, type = 'A', timeoutMs = 10000) {
  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const resp = await fetch(url, {
      headers: { accept: 'application/dns-json' },
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!resp.ok) throw new Error(`The DNS-over-HTTPS service returned HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`Lookup timed out after ${timeoutMs / 1000}s`);
    if (e instanceof TypeError) throw new Error('Network request failed: could not reach Cloudflare DNS-over-HTTPS. Check your connection or cross-origin restrictions.');
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** DNS 状态码 → 可读文案（RFC 1035 + 常见扩展）。 */
export function dnsStatusText(code) {
  const map = {
    0: 'NOERROR (response received)', 1: 'FORMERR (malformed query)', 2: 'SERVFAIL (server failure)',
    3: 'NXDOMAIN (domain does not exist)', 4: 'NOTIMP (not implemented)', 5: 'REFUSED (query refused)',
  };
  return map[code] ?? `RCODE ${code}`;
}