/**
 * IP 归属查询的服务端代理（Cloudflare Pages Functions）。
 *
 * 为什么需要它
 * ------------------------------------------------------------------
 * 浏览器直连第三方数据源有两个绕不过去的问题：
 *   1. **限流按访问者 IP 计**。实测 ipapi.co 对单个客户端很快返回 429，
 *      用户点几次就用不了了；
 *   2. **网络不可控**。运营商 DNS 偶尔把数据源解析到不可达地址，浏览器
 *      端只能干等超时。
 *
 * 放到服务端之后：
 *   - 限流池变成 Cloudflare 边缘节点的 IP（共享且量大），不再针对单个用户；
 *   - 查询结果进 Cache API（IP 归属几乎不变，缓存 24 小时是安全的），
 *      绝大多数请求根本不会打到第三方，速度快且几乎不会再触发限流；
 *   - 多源降级在服务端完成，浏览器只发一次请求。
 *
 * 查询自身 IP 时还有一条零依赖路径：Cloudflare 在 request.cf 里直接带了
 * 地理信息（国家 / 城市 / 经纬度 / 时区 / ASN），不需要任何外部请求。
 * 但它给的是 ISO 国家码（"US"）而不是国家名（"United States"），
 * 为了和第三方源的结果保持一致的展示形态，只在第三方全挂时才用它兜底。
 *
 * 路由：/api/ip           → 查询访问者自己的公网 IP
 *      /api/ip?ip=8.8.8.8 → 查询指定 IP
 *
 * 统一响应结构（与前端 js/ip-sources.js 的 IPInfo 完全一致）：
 * { ip, country, region, city, postal, lat, lon, timezone, asn, org, isp }
 */

/** 单个上游数据源的超时上限（毫秒） */
const UPSTREAM_TIMEOUT_MS = 4000;

/** 查询结果缓存时长（秒）。IP 归属稳定，缓存一天足够安全 */
const CACHE_TTL_SECONDS = 86400;

/** 浏览器可以自己缓存多久 */
const BROWSER_CACHE_SECONDS = 3600;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toText(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function formatAsn(raw) {
  const s = toText(raw);
  if (!s) return null;
  return /^AS/i.test(s) ? s.toUpperCase() : `AS${s}`;
}

/** 拆分 "AS4837 CHINA UNICOM Backbone" → { asn, org } */
function splitAsnAndOrg(raw) {
  const s = toText(raw);
  if (!s) return { asn: null, org: null };

  const match = s.match(/^(AS\d+)\s*(.*)$/i);
  if (match) {
    return { asn: match[1].toUpperCase(), org: toText(match[2]) || match[1].toUpperCase() };
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

function normalizeInfo(partial) {
  const info = { ...EMPTY_INFO };
  for (const key of Object.keys(EMPTY_INFO)) {
    const value = partial[key];
    if (value !== undefined && value !== null && value !== '') info[key] = value;
  }
  return info;
}

/**
 * 上游数据源清单，顺序即降级顺序。
 *
 * 排第一的是 ipwho.is：免费且不限流，实测最稳。
 * ipapi.co 虽然对浏览器限流狠，但服务端 IP 属于不同的限流池，保留作二档。
 * ipinfo.io 作三档。
 */
const UPSTREAMS = [
  {
    id: 'ipwho.is',
    build: ip => `https://ipwho.is/${encodeURIComponent(ip)}`,
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
        asn: formatAsn(conn.asn),
        org: toText(conn.org) || toText(conn.isp),
        isp: toText(conn.isp) || toText(conn.org),
      });
    },
  },
  {
    id: 'ipapi.co',
    build: ip => `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
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
        asn: formatAsn(toText(raw.asn) ?? asn),
        org,
        isp: org,
      });
    },
  },
  {
    id: 'ipinfo.io',
    build: ip => `https://ipinfo.io/${encodeURIComponent(ip)}/json`,
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
        asn: formatAsn(asn),
        org,
        isp: org,
      });
    },
  },
];

/**
 * 把 2 字母国家码补成完整国家名。
 *
 * 各家给的形态不一致：ipwho.is 给 "United States"，ipinfo.io 给 "US"，
 * 直接用会让界面上同一个字段随数据源变样。这里统一成完整国家名。
 *
 * 用 Intl.DisplayNames 而不是维护一张国家表 —— Workers 自带完整 ICU 数据，
 * 零维护成本，也不会漏国家。拿不到就原样返回，宁可显示码也不要出错。
 */
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

function expandCountryName(country) {
  const s = toText(country);
  if (!s || !/^[A-Za-z]{2}$/.test(s)) return s;
  try {
    return regionNames.of(s.toUpperCase()) ?? s;
  } catch {
    return s;
  }
}

/** 粗略校验：只放行 IPv4 / IPv6 的合法字符，避免把奇怪的东西拼进上游 URL */
function isPlausibleIP(ip) {
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip);
}

/**
 * 并发问所有上游，谁先给出可用结果就用谁。
 *
 * 一开始写的是串行降级，但线上观察发现排第一的 ipwho.is 在边缘节点
 * 常年超时（本机直连却是好的，怀疑是它对 Cloudflare 出口 IP 有限制），
 * 于是每次查询都要先白等 4 秒才轮到 ipinfo.io。
 *
 * 改成并发后总耗时取决于最快的那个源，慢的源不阻塞。
 * 因为有 24 小时缓存兜着，真正打到上游的请求很少，多发的那几路可以接受。
 */
async function lookupUpstreams(ip) {
  let settled = false;

  return new Promise((resolve) => {
    const attempts = UPSTREAMS.map(async (upstream) => {
      try {
        const response = await fetch(upstream.build(ip), {
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          headers: { Accept: 'application/json', 'User-Agent': 'locip/1.0' },
          // 上游结果我们自己按 IP 缓存，这里不让 Cloudflare 再插一层
          cf: { cacheTtl: 0 },
        });
        if (!response.ok) return;

        const info = upstream.normalize(await response.json());
        if (info && info.ip && !settled) {
          settled = true;
          resolve({ info, source: upstream.id });
        }
      } catch {
        // 超时或网络错误：这一路作废，等其他路
      }
    });

    // 全部落空才判失败
    Promise.allSettled(attempts).then(() => { if (!settled) resolve(null); });
  });
}

/**
 * 零依赖兜底：直接读 Cloudflare 注入的地理信息。
 * 只在查自身 IP 且上游全挂时使用 —— cf 只给 ISO 国家码，形态和上游不一致。
 */
function infoFromRequestCf(ip, cf) {
  if (!cf) return null;
  return normalizeInfo({
    ip,
    country: expandCountryName(cf.country),
    region: toText(cf.region) || toText(cf.regionCode),
    city: toText(cf.city),
    postal: toText(cf.postalCode),
    lat: toNumber(cf.latitude),
    lon: toNumber(cf.longitude),
    timezone: toText(cf.timezone),
    asn: formatAsn(cf.asn),
    org: toText(cf.asOrganization),
    isp: toText(cf.asOrganization),
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${BROWSER_CACHE_SECONDS}`,
      ...CORS_HEADERS,
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 查询目标：显式传 ip 就查它，否则查访问者自己
  const requested = (url.searchParams.get('ip') || '').trim();
  const isSelfQuery = requested === '';
  const targetIP = isSelfQuery
    ? (request.headers.get('CF-Connecting-IP') || '').trim()
    : requested;

  if (!targetIP) {
    return jsonResponse({ error: 'missing_ip', message: '无法确定要查询的 IP' }, 400);
  }
  if (!isPlausibleIP(targetIP)) {
    return jsonResponse({ error: 'invalid_ip', message: 'IP 格式不正确' }, 400);
  }

  // key 带版本号：归一化规则变了（比如国家名统一）时换个版本就能让旧缓存整体失效
  const cacheKey = new URL(`https://ip-api-cache.locip/v2/${targetIP}`).toString();
  const cache = caches.default;

  // 命中缓存直接返回，第三方一次都不用打
  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const body = await cached.json();
      return jsonResponse({ ...body, cached: true });
    }
  } catch {
    // 缓存读失败不影响主流程
  }

  const upstreamResult = await lookupUpstreams(targetIP);
  let payload;
  let status = 200;

  if (upstreamResult) {
    payload = {
      ...upstreamResult.info,
      country: expandCountryName(upstreamResult.info.country),
      source: upstreamResult.source,
      cached: false,
    };
  } else {
    // 上游全挂：查自身 IP 时还能用 Cloudflare 自带的地理信息兜底
    const fallback = isSelfQuery ? infoFromRequestCf(targetIP, request.cf) : null;
    if (fallback && fallback.ip) {
      payload = { ...fallback, source: 'cloudflare-edge', cached: false };
    } else {
      return jsonResponse(
        { error: 'upstream_unavailable', message: '上游数据源暂时不可用，请稍后重试' },
        502,
      );
    }
  }

  // 写缓存。自身 IP 查询只缓存较短时间（访问者可能换网络），
  // 指定 IP 查询缓存满 24 小时。
  try {
    const ttl = isSelfQuery ? 300 : CACHE_TTL_SECONDS;
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(payload), {
        headers: { 'Cache-Control': `public, max-age=${ttl}` },
      }),
    );
  } catch {
    // 写缓存失败不影响本次响应
  }

  return jsonResponse(payload, status);
}
