/**
 * UI 层：只管 DOM 与交互，所有数据获取和字段归一化都交给 ip-sources.js。
 *
 * 职责边界（高内聚低耦合）：
 *   - 本文件不认识任何一家 API 的字段名，也不拼 URL
 *   - 数据源增删、顺序调整都在 ip-sources.js 里完成，这里零改动
 */
import { fetchIPInfo, isPrivateIP, isValidIPv4, entityLabel } from './ip-sources.js';

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

document.addEventListener('DOMContentLoaded', () => {
  const ids = ['ipInput', 'loading', 'error', 'ipInfo', 'searchBtn', 'myIpBtn', 'ipAddress', 'ipType', 'mapLink', 'sourceNote'];
  for (const id of ids) el[id] = document.getElementById(id);
  for (const f of FIELDS) el[f.id] = document.getElementById(f.id);

  el.searchBtn.addEventListener('click', () => queryIP());
  el.myIpBtn?.addEventListener('click', () => queryMyIP());
  el.ipInput.addEventListener('keypress', event => {
    if (event.key === 'Enter') queryIP();
  });

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
}

function hideLoading() {
  el.loading.style.display = 'none';
}

function showError(message) {
  el.error.textContent = `❌ ${message}`;
  el.error.style.display = 'block';
  el.ipInfo.style.display = 'none';
}

/** 输入校验：格式不对直接挡下，不发无谓的请求 */
function readInput() {
  const ip = el.ipInput.value.trim();
  if (!ip) {
    showError('请输入IP地址');
    return null;
  }
  if (!isValidIPv4(ip)) {
    showError('请输入有效的 IPv4 地址（如：8.8.8.8）');
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

/** 把归一化后的 IPInfo 渲染进结果区 */
function render(info) {
  el.ipAddress.textContent = info.ip ?? PLACEHOLDER;
  el.ipType.textContent = isPrivateIP(info.ip) ? '内网IP' : '公网IP';

  for (const field of FIELDS) {
    const node = el[field.id];
    if (!node) continue;
    let raw = info[field.key ?? field.id];
    // 国家是"可能经本站转换"的字段：展示值与原值不同时，把上游原值一并显示出来，
    // 这样用户能看到 United States 是本站把 US 补全的，而不是上游就这么写的。
    if (field.id === 'country' && raw && info.countryOriginal && info.countryOriginal !== raw) {
      raw = `${raw}（上游原值 ${info.countryOriginal}）`;
    }
    node.textContent = raw === null || raw === undefined || raw === '' ? PLACEHOLDER : raw;
  }

  // 经纬度是由 lat / lon 合成的，单独处理
  const hasCoord = Number.isFinite(info.lat) && Number.isFinite(info.lon);
  el.location.textContent = hasCoord ? `${info.lat}, ${info.lon}` : PLACEHOLDER;

  renderMap(hasCoord ? info : null);

  el.error.style.display = 'none';
  el.ipInfo.style.display = 'block';
}

function renderMap(info) {
  if (!info) {
    el.mapLink.innerHTML = '<p>暂无地理位置信息</p>';
    return;
  }
  const { lat, lon } = info;
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
