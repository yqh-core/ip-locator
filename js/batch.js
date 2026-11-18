/**
 * 批量查询的纯逻辑：拆地址、去重、限额、CSV。
 * 不发请求、不碰 DOM。真正的查询在 batch-ui.js，一次一个地址走现有查询链路。
 */
import { isValidIP } from './ip-sources.js';

/** 单次批量上限。再大就会把上游免费额度打满，页面上会说明原因。 */
export const BATCH_MAX = 20;

/**
 * @param {string} text 用户粘贴的文本，允许空格、换行、逗号、分号
 * @param {number} [max]
 * @returns {{ valid: string[], invalid: string[], truncated: boolean, max: number }}
 */
export function parseIpList(text, max = BATCH_MAX) {
  const cap = Number.isInteger(max) && max > 0 ? max : BATCH_MAX;
  const tokens = String(text ?? '').split(/[\s,;，；]+/).map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  const valid = [];
  const invalid = [];
  let truncated = false;
  for (const token of tokens) {
    if (!isValidIP(token)) {
      invalid.push(token);
      continue;
    }
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (valid.length >= cap) {
      truncated = true;
      continue;
    }
    valid.push(token);
  }
  return { valid, invalid, truncated, max: cap };
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CSV_HEADERS = ['ip', 'country', 'region', 'city', 'postal', 'asn', 'org', 'isp', 'timezone', 'lat', 'lon', 'rfc_class', 'source', 'note'];

/** 把批量行写成 CSV。rfc_class 是地址数学分类，不是代理/VPN 结论。 */
export function resultsToCsv(rows) {
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows || []) {
    lines.push(CSV_HEADERS.map(key => csvCell(row[key])).join(','));
  }
  return lines.join('\r\n');
}

/** 单条结果的可读摘要，给复制和导出用。 */
export function resultToSummary(info, extra = {}) {
  const row = info || {};
  const lines = [];
  const push = (label, value) => {
    if (value === null || value === undefined || value === '') return;
    lines.push(`${label}：${value}`);
  };
  push('IP', row.ip);
  push('国家/地区', row.country);
  push('省份/州', row.region);
  push('城市', row.city);
  push('邮编', row.postal);
  push('ASN', row.asn);
  push('运营商（登记）', row.isp);
  push('组织（登记）', row.org);
  if (Number.isFinite(row.lat) && Number.isFinite(row.lon)) push('经纬度', `${row.lat}, ${row.lon}`);
  push('时区', row.timezone);
  push('当地时间', extra.zoneTime);
  push('地址类别', extra.rfcClass);
  push('反向域名', extra.ptr);
  push('数据来源', extra.sourceLabel || row.source);
  lines.push('说明：这是 IP 地理信息估算，通常只能精确到城市级，不代表设备或用户的实际物理位置，仅供参考。');
  return lines.join('\n');
}
