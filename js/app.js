/**
 * UI 层：只管 DOM 与交互，数据获取和字段归一化交给 ip-sources.js。
 * 测量只保留既有 visit / tool_start / tool_success，不新增事件。
 */
import { fetchIPInfo, isPrivateIP, isValidIPv4, isValidIPv6, ipVersion, entityLabel } from './ip-sources.js';
import { cidrInfo, ptrName, dohQuery } from './net-tools.js';
import { resultToSummary } from './batch.js';

const tracker = new window.DDAnalytics.FunnelTracker(
  'ip',
  window.DDAnalytics.beaconTransport('https://metrics.digdevbox.com/collect'),
  { notCollected: ['download'] },
);
window.addEventListener('pagehide', () => { tracker.flush(); });

const el = {};

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

const PLACEHOLDER = '—';
let lastInfo = null;
let lastExtra = { rfcClass: '', zoneTime: '', ptr: '', sourceLabel: '' };

function flagEmoji(code) {
  const s = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) return '';
  return String.fromCodePoint(...[...s].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function t(key, fallback) {
  if (window.DD_I18N && typeof window.DD_I18N.t === 'function') {
    const v = window.DD_I18N.t(key);
    if (v && v !== key) return v;
  }
  return fallback;
}

function rfcClassOf(ip) {
  try { return cidrInfo(ip).classification; } catch { return ''; }
}

function zoneTime(timezone) {
  if (!timezone) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date());
  } catch {
    return '';
  }
}

async function copyText(text, btn) {
  const value = (text ?? '').trim();
  if (!value || value === PLACEHOLDER) return false;
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
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  if (!btn) return ok;
  const txt = btn.querySelector('.copy-txt');
  const msg = ok ? t('feedback.copied', '已复制') : t('feedback.copyFailed', '复制失败，请手动选择复制');
  btn.classList.toggle('copied', ok);
  btn.classList.toggle('copy-failed', !ok);
  if (txt) {
    const prev = txt.textContent;
    txt.textContent = msg;
    setTimeout(() => {
      txt.textContent = prev;
      btn.classList.remove('copied', 'copy-failed');
    }, 1600);
  }
  return ok;
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => {
  const ids = ['ipInput', 'loading', 'error', 'ipInfo', 'searchBtn', 'myIpBtn', 'ipv6DemoBtn', 'ipAddress', 'ipType', 'mapLink', 'sourceNote', 'copyIpBtn', 'mapEmbed', 'mapShowBtn', 'extraTools', 'jsonView', 'jsonCopyBtn', 'clientInfo', 'clientToggle', 'clientSummary', 'historyList', 'historyCount', 'historyEmpty', 'historyClear', 'localMap', 'zoneClock', 'addrKind', 'ptrBtn', 'ptrText', 'copySummaryBtn', 'exportJsonBtn', 'exportTxtBtn', 'countryMeta'];
  for (const id of ids) el[id] = document.getElementById(id);
  for (const f of FIELDS) el[f.id] = document.getElementById(f.id);

  el.searchBtn?.addEventListener('click', () => queryIP());
  el.myIpBtn?.addEventListener('click', () => queryMyIP());
  el.ipv6DemoBtn?.addEventListener('click', () => { el.ipInput.value = '2001:4860:4860::8888'; queryIP(); });
  el.copyIpBtn?.addEventListener('click', () => copyText(lastInfo?.ip || el.ipAddress.textContent, el.copyIpBtn));
  el.ipInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') queryIP();
  });
  el.copySummaryBtn?.addEventListener('click', () => {
    if (lastInfo) copyText(resultToSummary(lastInfo, lastExtra), el.copySummaryBtn);
  });
  el.exportJsonBtn?.addEventListener('click', () => {
    if (!lastInfo) return;
    downloadText(`ip-${safeName(lastInfo.ip)}.json`, JSON.stringify(lastInfo, null, 2), 'application/json');
  });
  el.exportTxtBtn?.addEventListener('click', () => {
    if (!lastInfo) return;
    downloadText(`ip-${safeName(lastInfo.ip)}.txt`, resultToSummary(lastInfo, lastExtra), 'text/plain;charset=utf-8');
  });
  el.jsonCopyBtn?.addEventListener('click', () => {
    if (lastInfo) copyText(JSON.stringify(lastInfo, null, 2), el.jsonCopyBtn);
  });
  el.ptrBtn?.addEventListener('click', () => lookupPtr());
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
  tracker.track('visit');
  queryMyIP();
});

function safeName(ip) {
  return String(ip || 'result').replace(/[^0-9a-zA-Z.:_-]/g, '');
}

function showLoading(ip) {
  el.ipInfo?.classList.add('is-loading');
  if (el.loading) el.loading.hidden = false;
  const lp = el.loading?.querySelector('p');
  if (lp) lp.textContent = ip ? `正在查 ${ip}` : '正在读取你的出口地址';
  if (el.error) el.error.hidden = true;
}

function hideLoading() {
  el.ipInfo?.classList.remove('is-loading');
  if (el.loading) el.loading.hidden = true;
}

function showError(message) {
  if (!el.error) return;
  el.error.textContent = message;
  el.error.hidden = false;
  if (el.ipAddress && el.ipAddress.textContent.includes('正在读取')) {
    el.ipAddress.textContent = '还没读到地址';
    if (el.ipType) el.ipType.textContent = '可以重试，或换一个地址';
  }
}

function readInput() {
  const ip = el.ipInput.value.trim();
  if (!ip) {
    showError('先输入一个 IP。公网地址才能查到登记位置，例如 8.8.8.8。');
    return null;
  }
  if (!isValidIPv4(ip) && !isValidIPv6(ip)) {
    showError('这个格式不像 IPv4 或 IPv6。IPv4 类似 8.8.8.8，IPv6 类似 2001:4860:4860::8888。');
    return null;
  }
  return ip;
}

async function queryIP() {
  const ip = readInput();
  if (ip) await runQuery(ip);
}

async function queryMyIP() {
  if (el.ipInput) el.ipInput.value = '';
  await runQuery('');
}

let requestSeq = 0;

async function runQuery(ip) {
  const seq = ++requestSeq;
  tracker.track('tool_start');
  showLoading(ip);
  try {
    const attempted = [];
    const { info, source, entity } = await fetchIPInfo(ip, {
      onAttempt: (src, ok) => {
        attempted.push({ label: src.pathLabel || src.label, ok });
        if (!ok) {
          const lp = el.loading?.querySelector('p');
          if (lp) lp.textContent = '这条线路没有应答，正在换下一条';
        }
      },
    });
    if (seq !== requestSeq) return;
    if (!ip && el.ipInput) el.ipInput.value = info.ip;
    render(info);
    tracker.track('tool_success');
    renderSourceNote(source, entity, info, attempted);
  } catch (error) {
    if (seq !== requestSeq && error?.name === 'AbortError') return;
    console.error('查询 IP 失败:', error);
    showError(error.message || '查询没有完成，过一会儿再试。');
  } finally {
    if (seq === requestSeq) hideLoading();
  }
}

function addFieldCopy(node) {
  const item = node?.closest('.info-item');
  if (!item || item.querySelector('.field-copy')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'field-copy';
  btn.setAttribute('aria-label', t('aria.copyField', '复制该字段'));
  btn.textContent = '复制';
  btn.addEventListener('click', () => copyText(node.textContent, btn));
  item.appendChild(btn);
}

function render(info) {
  el.ipAddress.textContent = info.ip ?? PLACEHOLDER;
  const ver = ipVersion(info.ip);
  const kind = isPrivateIP(info.ip) ? '内网' : '公网';
  el.ipType.textContent = ver ? `${kind} IPv${ver}` : kind;
  const rfc = rfcClassOf(info.ip);
  if (el.addrKind) el.addrKind.textContent = rfc || PLACEHOLDER;

  for (const field of FIELDS) {
    const node = el[field.id];
    if (!node) continue;
    let raw = info[field.key ?? field.id];
    if (field.id === 'country' && el.countryMeta) {
      const code = info.countryOriginal;
      el.countryMeta.textContent = code && code !== raw ? `登记码 ${code}` : '';
    }
    if (field.id === 'country' && raw) {
      const flag = flagEmoji(info.countryOriginal);
      if (flag) raw = `${flag} ${raw}`;
    }
    node.textContent = raw === null || raw === undefined || raw === '' ? PLACEHOLDER : raw;
    addFieldCopy(node);
  }

  const hasCoord = Number.isFinite(info.lat) && Number.isFinite(info.lon);
  el.location.textContent = hasCoord ? `${info.lat}, ${info.lon}` : PLACEHOLDER;
  addFieldCopy(el.location);

  const clock = zoneTime(info.timezone);
  if (el.zoneClock) el.zoneClock.textContent = clock ? `当地现在 ${clock}` : '';

  lastExtra = {
    rfcClass: rfc,
    zoneTime: clock,
    ptr: '',
    sourceLabel: '',
  };
  if (el.ptrText) el.ptrText.textContent = '还没查反向域名。需要的话再点一次，会向 Cloudflare DNS 查 PTR。';
  if (el.ptrBtn) el.ptrBtn.disabled = !info.ip;

  renderMap(hasCoord ? info : null);
  if (el.error) el.error.hidden = true;
  lastInfo = info;
  renderJsonView(info);
  recordHistory(info.ip);
  for (const btn of [el.copySummaryBtn, el.exportJsonBtn, el.exportTxtBtn]) {
    if (btn) btn.disabled = false;
  }
}

function renderJsonView(info) {
  if (!el.jsonView) return;
  el.jsonView.textContent = JSON.stringify(info, null, 2);
  if (el.extraTools) el.extraTools.hidden = false;
}

async function lookupPtr() {
  if (!lastInfo?.ip || !el.ptrText) return;
  el.ptrText.textContent = '正在查反向域名…';
  if (el.ptrBtn) el.ptrBtn.disabled = true;
  try {
    const name = ptrName(lastInfo.ip);
    const json = await dohQuery(name, 'PTR');
    const answers = Array.isArray(json?.Answer) ? json.Answer.map(a => a.data).filter(Boolean) : [];
    const text = answers.length ? answers.join('，') : '没有 PTR 记录';
    el.ptrText.textContent = text;
    lastExtra = { ...lastExtra, ptr: text };
  } catch (error) {
    el.ptrText.textContent = error?.message || '反向查询没有完成';
  } finally {
    if (el.ptrBtn) el.ptrBtn.disabled = false;
  }
}

function renderClientInfo() {
  if (!el.clientInfo) return;
  const nav = navigator;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  let tz = '—';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '—'; } catch { /* ignore */ }
  if (el.clientSummary) {
    el.clientSummary.textContent = `这台设备报告的语言是 ${nav.language || '未知'}，时区是 ${tz}，屏幕 ${screen.width}×${screen.height}。这些只在本机读取，不上传。`;
  }
  const rows = [
    ['用户代理', nav.userAgent || '—'],
    ['平台', nav.platform || '—'],
    ['语言', nav.language || '—'],
    ['屏幕', `${screen.width}×${screen.height}`],
    ['颜色深度', `${screen.colorDepth} bit`],
    ['在线', nav.onLine ? '在线' : '离线'],
    ['浏览器报告的连接', conn ? `${conn.effectiveType || '—'}${conn.downlink ? `，约 ${conn.downlink} Mbps` : ''}` : '这个浏览器不提供'],
    ['时区', tz],
    ['Cookie', nav.cookieEnabled ? '允许' : '关闭'],
  ];
  el.clientInfo.innerHTML = rows.map(([k, v]) => (
    `<div class="client-row"><span class="client-key">${escapeHtml(k)}</span><span class="client-val">${escapeHtml(v)}</span></div>`
  )).join('');
}

const HISTORY_KEY = 'ipquery:history';
const HISTORY_MAX = 12;

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
  el.historyList.replaceChildren();
  if (el.historyCount) el.historyCount.textContent = String(arr.length);
  if (el.historyEmpty) el.historyEmpty.hidden = arr.length > 0;
  for (const ip of arr) {
    const li = document.createElement('li');
    li.className = 'history-item';
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'history-link';
    link.textContent = ip;
    link.addEventListener('click', () => { el.ipInput.value = ip; queryIP(); });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'history-del';
    del.setAttribute('aria-label', `删除 ${ip}`);
    del.textContent = '×';
    del.addEventListener('click', () => {
      writeHistory(readHistory().filter(x => x !== ip));
      renderHistory();
    });
    li.append(link, del);
    el.historyList.appendChild(li);
  }
}

function renderLocalMap(info) {
  const host = el.localMap;
  if (!host) return;
  host.replaceChildren();
  if (!info) {
    const p = document.createElement('p');
    p.className = 'map-empty';
    p.textContent = '这条结果没有坐标，这里留空。没有坐标就不画点。';
    host.appendChild(p);
    return;
  }
  const { lat, lon } = info;
  const x = ((Number(lon) + 180) / 360) * 360;
  const y = ((90 - Number(lat)) / 180) * 180;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 360 180');
  svg.setAttribute('class', 'local-map');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `登记坐标示意，纬度 ${lat}，经度 ${lon}`);
  const ns = svg.namespaceURI;
  for (let i = 0; i <= 360; i += 30) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', String(i));
    line.setAttribute('x2', String(i));
    line.setAttribute('y1', '0');
    line.setAttribute('y2', '180');
    line.setAttribute('class', 'grat');
    svg.appendChild(line);
  }
  for (let i = 0; i <= 180; i += 30) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('x2', '360');
    line.setAttribute('y1', String(i));
    line.setAttribute('y2', String(i));
    line.setAttribute('class', 'grat');
    svg.appendChild(line);
  }
  const pin = document.createElementNS(ns, 'circle');
  pin.setAttribute('cx', String(Math.min(356, Math.max(4, x))));
  pin.setAttribute('cy', String(Math.min(176, Math.max(4, y))));
  pin.setAttribute('r', '5');
  pin.setAttribute('class', 'pin');
  svg.appendChild(pin);
  const cap = document.createElement('p');
  cap.className = 'map-caption';
  cap.textContent = '点在经纬网上的位置，对应登记坐标。这不是卫星定位，也不是你人站着的地方。';
  host.append(svg, cap);
}

function renderMap(info) {
  if (el.mapEmbed) {
    el.mapEmbed.hidden = true;
    el.mapEmbed.replaceChildren();
  }
  renderLocalMap(info);
  if (!info) {
    if (el.mapShowBtn) el.mapShowBtn.hidden = true;
    if (el.mapLink) el.mapLink.replaceChildren();
    return;
  }
  const { lat, lon } = info;
  if (el.mapShowBtn) {
    el.mapShowBtn.hidden = false;
    el.mapShowBtn.onclick = () => {
      const d = 0.08;
      const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
      const frame = document.createElement('iframe');
      frame.title = t('map.embedTitle', '大致地理位置地图');
      frame.loading = 'lazy';
      frame.referrerPolicy = 'no-referrer';
      frame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
      el.mapEmbed.replaceChildren(frame);
      el.mapEmbed.hidden = false;
      el.mapShowBtn.hidden = true;
    };
  }
  if (!el.mapLink) return;
  el.mapLink.replaceChildren();
  const osm = document.createElement('a');
  osm.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=10/${lat}/${lon}`;
  osm.target = '_blank';
  osm.rel = 'noopener noreferrer';
  osm.textContent = '在 OpenStreetMap 打开';
  const gmaps = document.createElement('a');
  gmaps.href = `https://www.google.com/maps?q=${lat},${lon}`;
  gmaps.target = '_blank';
  gmaps.rel = 'noopener noreferrer';
  gmaps.textContent = '在 Google 地图打开';
  el.mapLink.append(osm, gmaps);
}

function renderSourceNote(source, entity, info, attempted) {
  if (!el.sourceNote) return;
  const failed = attempted.filter(a => !a.ok);
  const via = entity ? entityLabel(entity) : null;
  const sourceText = via || '来源没有上报';
  lastExtra = { ...lastExtra, sourceLabel: sourceText };
  const pathNote = entity && source.id === 'locip-server' && entity !== 'locip-server'
    ? '，经本站边缘转发'
    : '';
  let cacheNote = '';
  if (info && info.cached === true) cacheNote = '，用了不超过 1 小时的技术缓存';
  else if (info && info.cached === false) cacheNote = '，这次是新查的';
  const degrade = failed.length ? `。${failed.map(a => a.label).join('、')}这次没有应答` : '';
  el.sourceNote.textContent = `数据来源：${sourceText}${pathNote}${cacheNote}${degrade}`;

  const ATTRIBUTION_HREFS = { 'ipinfo.io': 'https://ipinfo.io', 'ipwho.is': 'https://ipwho.is' };
  const href = entity && ATTRIBUTION_HREFS[entity];
  if (href) {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = '数据许可与署名';
    el.sourceNote.append(' ', a);
  }
}
