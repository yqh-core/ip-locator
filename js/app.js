/**
 * UI 层：只管 DOM 与交互，所有数据获取和字段归一化都交给 ip-sources.js。
 *
 * 职责边界（高内聚低耦合）：
 *   - 本文件不认识任何一家 API 的字段名，也不拼 URL
 *   - 数据源增删、顺序调整都在 ip-sources.js 里完成，这里零改动
 */
import { fetchIPInfo, isPrivateIP, isValidIPv4, isValidIPv6, ipVersion, entityLabel } from './ip-sources.js';

// 测量闭环（隔离验证；analytics.iife.js 经经典 script 先加载暴露 window.DDAnalytics）。
// ip 无下载动作 → download 标 NOT_COLLECTED，不估算。测量失败不阻塞产品。
const tracker = new window.DDAnalytics.FunnelTracker(
  'ip',
  window.DDAnalytics.beaconTransport('https://metrics.digdevbox.com/collect'),
  { notCollected: ['download'] },
);
window.addEventListener('pagehide', () => { tracker.flush(); });

/** 页面元素缓存，DOMContentLoaded 时统一填充 */
const el = {};

/** 结果区每个字段对应的 DOM id，顺序即展示顺序 */
const FIELDS = [
  { id: 'country', label: '国家/地区' },
  { id: 'region', label: '省份/州' },
  { id: 'city', label: '城市' },
  { id: 'zip', label: '邮编', key: 'postal' },
  { id: 'asn', label: 'ASN' },
  { id: 'isp', label: '运营商' },
  { id: 'org', label: '组织' },
  { id: 'location', label: '经纬度' },
  { id: 'timezone', label: '时区' },
];

const PLACEHOLDER = '-';

/** 最近一次成功结果的归一化对象，供「原始 JSON」视图与复制使用。 */
let lastInfo = null;

/**
 * 2 字母 ISO 国家码 → 国旗 emoji（区域指示符）。非 2 字母码返回空串，
 * 宁可无旗也不出错。countryOriginal 保留的就是上游原话（多为码）。
 */
function flagEmoji(code) {
  const s = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) return '';
  return String.fromCodePoint(...[...s].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

/** 转义 HTML 特殊字符：客户端 userAgent 等自报值注入 innerHTML 前必须过这道。 */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** i18n 文案：优先 dd-i18n 内核，未注入时回退中文（与主题脚本同口径）。 */
function t(key, fallback) {
  if (window.DD_I18N && typeof window.DD_I18N.t === 'function') {
    const v = window.DD_I18N.t(key);
    if (v && v !== key) return v;
  }
  return fallback;
}

/**
 * 复制到剪贴板（ipinfo/whatismyip 招牌便利）。clipboard API 不可用时退回
 * select+execCommand；两条都失败就如实提示，不谎报"已复制"。
 * btn 用于就地反馈：有 .copy-txt 则短暂替换文案，1.6s 后还原。
 */
async function copyText(text, btn) {
  const value = (text ?? '').trim();
  if (!value || value === PLACEHOLDER) return;
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      ok = true;
    } else {
      throw new Error('clipboard unavailable');
    }
  } catch {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
  }
  if (!btn) return;
  const txt = btn.querySelector('.copy-txt');
  const msg = ok ? t('feedback.copied', '已复制') : t('feedback.copyFailed', '复制失败，请手动选择复制');
  btn.classList.add(ok ? 'copied' : 'copy-failed');
  if (txt) {
    const prev = txt.textContent;
    txt.textContent = msg;
    setTimeout(() => { txt.textContent = prev; btn.classList.remove('copied', 'copy-failed'); }, 1600);
  } else {
    btn.setAttribute('title', msg);
    setTimeout(() => { btn.classList.remove('copied', 'copy-failed'); }, 1600);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const ids = ['ipInput', 'loading', 'error', 'ipInfo', 'searchBtn', 'myIpBtn', 'ipv6DemoBtn', 'ipAddress', 'ipType', 'mapLink', 'sourceNote', 'copyIpBtn', 'mapEmbed', 'mapShowBtn', 'extraTools', 'jsonView', 'jsonCopyBtn', 'clientInfo', 'clientToggle', 'historyList', 'historyCount', 'historyEmpty', 'historyClear'];
  for (const id of ids) el[id] = document.getElementById(id);
  for (const f of FIELDS) el[f.id] = document.getElementById(f.id);

  el.searchBtn.addEventListener('click', () => queryIP());
  el.myIpBtn?.addEventListener('click', () => queryMyIP());
  el.ipv6DemoBtn?.addEventListener('click', () => { el.ipInput.value = '2001:4860:4860::8888'; queryIP(); });
  el.copyIpBtn?.addEventListener('click', () => {
    copyText(el.ipAddress.textContent, el.copyIpBtn);
  });
  el.ipInput.addEventListener('keypress', event => {
    if (event.key === 'Enter') queryIP();
  });

  // 第二轮：原始 JSON 复制 / 客户端信息展开 / 查询历史
  el.jsonCopyBtn?.addEventListener('click', () => {
    if (lastInfo) copyText(JSON.stringify(lastInfo, null, 2), el.jsonCopyBtn);
  });
  el.clientToggle?.addEventListener('click', () => {
    const open = el.clientInfo.hidden;
    el.clientInfo.hidden = !open;
    el.clientToggle.textContent = open ? '收起' : '展开';
    el.clientToggle.setAttribute('aria-expanded', String(open));
  });
  el.historyClear?.addEventListener('click', () => {
    writeHistory([]);
    renderHistory();
  });
  renderClientInfo();
  renderHistory();

  // 首次进入自动查询本机公网 IP
  tracker.track('visit');
  queryMyIP();
});

function showLoading() {
  el.loading.style.display = 'block';
  const lp = el.loading.querySelector('p');
  if (lp) lp.textContent = '正在查询IP信息...';
  el.error.style.display = 'none';
  el.ipInfo.style.display = 'none';
  if (el.extraTools) el.extraTools.hidden = true;
}

function hideLoading() {
  el.loading.style.display = 'none';
}

function showError(message) {
  el.error.textContent = `❌ ${message}`;
  el.error.style.display = 'block';
  el.ipInfo.style.display = 'none';
  if (el.extraTools) el.extraTools.hidden = true;
}

/** 输入校验：格式不对直接挡下，不发无谓的请求 */
function readInput() {
  const ip = el.ipInput.value.trim();
  if (!ip) {
    showError('请输入IP地址');
    return null;
  }
  if (!isValidIPv4(ip) && !isValidIPv6(ip)) {
    showError('请输入有效的 IPv4 或 IPv6 地址（如 8.8.8.8 或 2001:4860:4860::8888）');
    return null;
  }
  return ip;
}

async function queryIP() {
  const ip = readInput();
  if (ip) await runQuery(ip);
}

/** 查询本机：输入框留空，由数据源自行回源 */
async function queryMyIP() {
  await runQuery('');
}

/**
 * 查询序号。降级链路最长可能跑十几秒，这期间用户完全可以再发起一次查询；
 * 用序号丢弃过期响应，避免慢的那个把新结果覆盖掉（回填输入框同理）。
 */
let requestSeq = 0;

async function runQuery(ip) {
  const seq = ++requestSeq;
  tracker.track('tool_start');
  showLoading();
  try {
    const attempted = [];
    const { info, source, entity } = await fetchIPInfo(ip, {
      onAttempt: (src, ok) => {
        // 降级列表记的是"哪一条请求路径"失败了：代理那一跳失败要说路径，
        // 不是把失败归到某家第三方数据库头上（label 是数据源语义，pathLabel 是路径语义）
        attempted.push({ label: src.pathLabel || src.label, ok });
        if (!ok) {
          const lp = el.loading.querySelector('p');
          if (lp) lp.textContent = `正在尝试其他数据源…（已尝试 ${attempted.length} 个）`;
        }
      },
    });

    if (seq !== requestSeq) return; // 已有更新的查询，本次结果作废

    // 查本机时把结果回填输入框，方便用户接着查别的
    if (!ip) el.ipInput.value = info.ip;

    render(info);
    tracker.track('tool_success');
    renderSourceNote(source, entity, info, attempted);
  } catch (error) {
    if (seq !== requestSeq && error?.name === 'AbortError') return;
    console.error('查询IP信息失败:', error);
    showError(error.message || '查询失败，请稍后重试');
  } finally {
    if (seq === requestSeq) hideLoading();
  }
}

/** 给字段值挂一个复制按钮（幂等：重渲染不重复添加）。 */
function addFieldCopy(node) {
  const item = node.closest('.info-item');
  if (!item || item.querySelector('.field-copy')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'field-copy';
  btn.setAttribute('aria-label', t('aria.copyField', '复制该字段'));
  btn.setAttribute('title', t('aria.copyField', '复制该字段'));
  btn.innerHTML = '<span class="copy-ico" aria-hidden="true">📋</span>';
  btn.addEventListener('click', () => copyText(node.textContent, btn));
  item.appendChild(btn);
}

/** 把归一化后的 IPInfo 渲染进结果区 */
function render(info) {
  el.ipAddress.textContent = info.ip ?? PLACEHOLDER;
  const ver = ipVersion(info.ip);
  el.ipType.textContent = `${isPrivateIP(info.ip) ? '内网' : '公网'}${ver ? ' IPv' + ver : ' IP'}`;

  for (const field of FIELDS) {
    const node = el[field.id];
    if (!node) continue;
    let raw = info[field.key ?? field.id];
    // 国家是"可能经本站转换"的字段：展示值与原值不同时，把上游原值一并显示出来，
    // 这样用户能看到 United States 是本站把 US 补全的，而不是上游就这么写的。
    if (field.id === 'country' && raw && info.countryOriginal && info.countryOriginal !== raw) {
      raw = `${raw}（上游原值 ${info.countryOriginal}）`;
    }
    if (field.id === 'country' && raw) {
      const flag = flagEmoji(info.countryOriginal);
      if (flag) raw = `${flag} ${raw}`;
    }
    node.textContent = raw === null || raw === undefined || raw === '' ? PLACEHOLDER : raw;
    addFieldCopy(node);
  }

  // 经纬度是由 lat / lon 合成的，单独处理
  const hasCoord = Number.isFinite(info.lat) && Number.isFinite(info.lon);
  el.location.textContent = hasCoord ? `${info.lat}, ${info.lon}` : PLACEHOLDER;
  addFieldCopy(el.location);

  renderMap(hasCoord ? info : null);

  el.error.style.display = 'none';
  el.ipInfo.style.display = 'block';

  // 第二轮：原始 JSON 视图 + 查询历史（均本地，不外发）
  lastInfo = info;
  renderJsonView(info);
  recordHistory(info.ip);
}

/** 把归一化结果以格式化 JSON 展示（开发者友好，对标 ipinfo 的 raw 输出）。 */
function renderJsonView(info) {
  if (!el.jsonView) return;
  el.jsonView.textContent = JSON.stringify(info, null, 2);
  if (el.extraTools) el.extraTools.hidden = false;
}

/** 客户端信息：纯本机读取 navigator/screen/Intl/connection，不发出任何请求。 */
function renderClientInfo() {
  if (!el.clientInfo) return;
  const nav = navigator;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  let tz = '—';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '—'; } catch { /* ignore */ }
  const rows = [
    ['用户代理', nav.userAgent || '—'],
    ['平台', nav.platform || '—'],
    ['语言', nav.language || '—'],
    ['屏幕分辨率', `${screen.width}×${screen.height}`],
    ['颜色深度', `${screen.colorDepth} bit`],
    ['在线状态', nav.onLine ? '在线' : '离线'],
    ['网络类型', conn ? `${conn.effectiveType || '—'}${conn.downlink ? ` · 约 ${conn.downlink} Mbps` : ''}` : '浏览器不支持检测'],
    ['时区', tz],
    ['Cookie 启用', nav.cookieEnabled ? '是' : '否'],
    ['Do Not Track', nav.doNotTrack === '1' ? '开启' : '关闭 / 未设置'],
  ];
  el.clientInfo.innerHTML = rows.map(([k, v]) => (
    `<div class="client-row"><span class="client-key">${escapeHtml(k)}</span><span class="client-val">${escapeHtml(v)}</span></div>`
  )).join('');
}

/* ---- 查询历史：仅存本机 localStorage，去重、上限 10、点击重查、单条删除、清空 ---- */
const HISTORY_KEY = 'ipquery:history';
const HISTORY_MAX = 10;

function readHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : [];
  } catch { return []; }
}

function writeHistory(arr) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); } catch { /* 隐私模式可能禁写 */ }
}

function recordHistory(ip) {
  if (!ip) return;
  const arr = readHistory().filter(x => x !== ip);
  arr.unshift(ip);
  writeHistory(arr.slice(0, HISTORY_MAX));
  renderHistory();
}

function renderHistory() {
  if (!el.historyList) return;
  const arr = readHistory();
  el.historyList.innerHTML = '';
  if (el.historyCount) el.historyCount.textContent = String(arr.length);
  if (el.historyEmpty) el.historyEmpty.style.display = arr.length ? 'none' : 'block';
  for (const ip of arr) {
    const li = document.createElement('li');
    li.className = 'history-item';
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'history-link';
    link.title = ip;
    link.textContent = ip;
    link.addEventListener('click', () => { el.ipInput.value = ip; queryIP(); });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'history-del';
    del.setAttribute('aria-label', '删除这条记录');
    del.textContent = '✕';
    del.addEventListener('click', () => {
      writeHistory(readHistory().filter(x => x !== ip));
      renderHistory();
    });
    li.appendChild(link);
    li.appendChild(del);
    el.historyList.appendChild(li);
  }
}

function renderMap(info) {
  // 新查询先收起上一张嵌入地图（坐标变了，旧图作废）
  el.mapEmbed.hidden = true;
  el.mapEmbed.innerHTML = '';
  if (!info) {
    el.mapShowBtn.hidden = true;
    el.mapLink.innerHTML = '<p>暂无地理位置信息</p>';
    return;
  }
  const { lat, lon } = info;
  el.mapShowBtn.hidden = false;
  el.mapShowBtn.onclick = () => {
    // 点击才加载第三方瓦片（隐私：不自动向 OSM 发请求）；坐标是 IP 估算位置。
    const d = 0.02;
    const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
    el.mapEmbed.innerHTML = `<iframe title="${t('map.embedTitle', '大致地理位置地图')}" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat},${lon}"></iframe>`;
    el.mapEmbed.hidden = false;
    el.mapShowBtn.hidden = true;
  };
  el.mapLink.innerHTML = `
    <p>📌 在地图上查看：</p>
    <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=12/${lat}/${lon}" target="_blank" rel="noopener">OpenStreetMap</a>
    &nbsp;|&nbsp;
    <a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" rel="noopener">Google Maps</a>
  `;
}

/**
 * 说明本次结果**实际出自哪家数据库**。
 *
 * D1 修复前的错误做法：显示 `source.label`。当答案来自本站服务端代理时，
 * label 恒为「第三方 IP 数据服务」——用户永远看不到真正应答的那一家，
 * 而服务端明明已经在响应里回了 source 字段。
 *
 * 现在的规则（三条都不许推断）：
 *   · entity 有值 → 显示它。代理路径下它来自服务端回报；
 *     直连降级路径下它就是那条直连源本身，绝不会继续挂代理的名。
 *   · entity 为 null（服务端没回 source）→ 显示「来源未上报」，不猜。
 *   · cached 明确 true/false 才显示缓存态；null 表示该路径不上报，保持沉默。
 */
function renderSourceNote(source, entity, info, attempted) {
  if (!el.sourceNote) return;

  const failed = attempted.filter(a => !a.ok);
  const degrade = failed.length
    ? `（${failed.map(a => a.label).join('、')} 不可用，已自动降级）`
    : '';

  const via = entity ? entityLabel(entity) : null;
  const sourceText = via || '来源未上报';

  // 经代理时补一句路径说明，避免用户把 ipinfo.io 误当成本站自己的数据
  const pathNote = entity && source.id === 'locip-server' && entity !== 'locip-server'
    ? '（经本站服务端代理转发）'
    : '';

  let cacheNote = '';
  if (info && info.cached === true) cacheNote = ' · 命中本站缓存';
  else if (info && info.cached === false) cacheNote = ' · 本次已回源';

  el.sourceNote.textContent = `数据来源：${sourceText}${pathNote}${cacheNote}${degrade}`;
}
