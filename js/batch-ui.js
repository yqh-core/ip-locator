/**
 * 批量查询界面。一次只查一个地址，走和单条查询相同的数据链路。
 * 不新增测量事件。用户粘贴的地址只留在浏览器里。
 */
import { fetchIPInfo, isPrivateIP } from './ip-sources.js';
import { cidrInfo } from './net-tools.js';
import { parseIpList, resultsToCsv, BATCH_MAX } from './batch.js';

const $ = (id) => document.getElementById(id);

function rfcClass(ip) {
  try { return cidrInfo(ip).classification; } catch { return ''; }
}

function setStatus(node, message) {
  if (node) node.textContent = message || '';
}

function download(filename, text, mime) {
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

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text || '—';
  return td;
}

function renderTable(host, rows) {
  host.replaceChildren();
  if (!rows.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'batch-table-wrap';
  const table = document.createElement('table');
  table.className = 'batch-table';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const label of ['IP', '位置', 'ASN', '组织', '来源', '备注']) {
    const th = document.createElement('th');
    th.textContent = label;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    const place = [row.country, row.region, row.city].filter(Boolean).join(' · ');
    tr.append(
      cell(row.ip),
      cell(place),
      cell(row.asn),
      cell(row.org || row.isp),
      cell(row.source),
      cell(row.note),
    );
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  host.appendChild(wrap);
}

function initBatch() {
  const input = $('batch-input');
  const runBtn = $('batch-run');
  const status = $('batch-status');
  const result = $('batch-result');
  const copyBtn = $('batch-copy');
  const csvBtn = $('batch-csv');
  if (!input || !runBtn || !result) return;

  let rows = [];
  let running = false;
  let abort = null;

  function syncExports() {
    const on = rows.length > 0 && !running;
    if (copyBtn) copyBtn.disabled = !on;
    if (csvBtn) csvBtn.disabled = !on;
  }

  async function run() {
    if (running) {
      abort?.abort();
      return;
    }
    const parsed = parseIpList(input.value, BATCH_MAX);
    if (!parsed.valid.length) {
      setStatus(status, parsed.invalid.length ? '这些内容不是 IP 地址。每行一个，或用逗号分开。' : '先贴几个 IP 再查。');
      return;
    }
    const notes = [];
    if (parsed.invalid.length) notes.push(`跳过 ${parsed.invalid.length} 个无法识别的片段`);
    if (parsed.truncated) notes.push(`只查前 ${parsed.max} 个，多出来的请再贴一次`);

    running = true;
    abort = new AbortController();
    runBtn.textContent = '停止';
    rows = [];
    renderTable(result, rows);
    syncExports();

    for (let i = 0; i < parsed.valid.length; i++) {
      if (abort.signal.aborted) break;
      const ip = parsed.valid[i];
      setStatus(status, `正在查 ${i + 1} / ${parsed.valid.length}${notes.length ? `。${notes.join('；')}` : ''}`);
      const row = { ip, rfc_class: rfcClass(ip), note: '' };
      if (isPrivateIP(ip)) {
        row.note = '私有或本机地址，没有公网归属';
        row.source = '本机判断';
      } else {
        try {
          const { info, entity } = await fetchIPInfo(ip, { signal: abort.signal });
          Object.assign(row, {
            country: info.country,
            region: info.region,
            city: info.city,
            postal: info.postal,
            asn: info.asn,
            org: info.org,
            isp: info.isp,
            timezone: info.timezone,
            lat: info.lat,
            lon: info.lon,
            source: entity || info.source || '',
          });
        } catch (error) {
          if (error?.name === 'AbortError') break;
          row.note = error?.message || '查询失败';
        }
      }
      rows.push(row);
      renderTable(result, rows);
    }

    running = false;
    runBtn.textContent = '开始批量查';
    const stopped = abort.signal.aborted;
    setStatus(status, `${stopped ? '已停止。' : ''}完成 ${rows.length} 条${notes.length ? `。${notes.join('；')}` : ''}`);
    syncExports();
  }

  runBtn.addEventListener('click', () => { run(); });
  copyBtn?.addEventListener('click', async () => {
    const text = resultsToCsv(rows);
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = '已复制';
    } catch {
      copyBtn.textContent = '复制失败';
    }
    setTimeout(() => { copyBtn.textContent = '复制 CSV'; }, 1600);
  });
  csvBtn?.addEventListener('click', () => {
    download(`ip-batch-${rows.length}.csv`, resultsToCsv(rows), 'text/csv;charset=utf-8');
  });
  syncExports();
}

if (document.readyState !== 'loading') initBatch();
else document.addEventListener('DOMContentLoaded', initBatch);
