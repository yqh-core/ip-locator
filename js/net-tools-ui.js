/**
 * net-tools-ui.js —— CIDR/子网计算器 + DNS/rDNS 查询的 UI 层（第四轮）
 *
 * 与 app.js 完全解耦：独立 module，不触碰 IP 查询与测量客户端（冻结件）。
 * 渲染纪律：DNS 应答与用户输入都是不可信文本，一律 textContent/DOM API，不拼 innerHTML。
 */
import { cidrInfo, ptrName, dohQuery, DNS_TYPES, dnsStatusText, parseIPv4, parseIPv6 } from './net-tools.js';

const $ = (id) => document.getElementById(id);

/* ---------------- 通用：复制（clipboard + execCommand 降级，如实反馈） ---------------- */
async function copyText(text, btn, okLabel) {
  const original = btn.textContent;
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    } else {
      throw new Error('clipboard unavailable');
    }
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
  }
  btn.textContent = ok ? (okLabel || 'Copied ✓') : 'Copy failed';
  setTimeout(() => { btn.textContent = original; }, 1800);
}

function setStatus(node, msg, kind) {
  node.textContent = msg;
  node.className = 'net-status' + (kind ? ' is-' + kind : '');
}

/* ---------------- CIDR / 子网计算器 ---------------- */
const cidrInput = $('cidr-input');
const cidrResult = $('cidr-result');
const cidrStatus = $('cidr-status');

const CIDR_FIELDS = [
  ['network', 'Network address'],
  ['mask', 'Subnet mask'],
  ['wildcard', 'Wildcard mask'],
  ['broadcast', 'Broadcast address'],
  ['firstUsable', 'First usable address'],
  ['lastUsable', 'Last usable address'],
  ['totalAddresses', 'Total addresses'],
  ['usableHosts', 'Usable hosts'],
  ['classification', 'Address type'],
];

function renderCidr(r) {
  cidrResult.innerHTML = '';
  const head = document.createElement('p');
  head.className = 'net-head';
  const strong = document.createElement('strong');
  strong.textContent = `${r.network}/${r.prefix}`;
  head.appendChild(strong);
  head.appendChild(document.createTextNode(` · IPv${r.version}`));
  cidrResult.appendChild(head);

  const dl = document.createElement('dl');
  dl.className = 'net-grid';
  for (const [key, label] of CIDR_FIELDS) {
    const v = r[key];
    if (v === '' || v === undefined) continue;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  cidrResult.appendChild(dl);

  if (r.note) {
    const note = document.createElement('p');
    note.className = 'net-note';
    note.textContent = r.note;
    cidrResult.appendChild(note);
  }

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn-secondary';
  copyBtn.textContent = 'Copy JSON';
  copyBtn.addEventListener('click', () => copyText(JSON.stringify(r, null, 2), copyBtn));
  cidrResult.appendChild(copyBtn);
}

function runCidr() {
  const raw = cidrInput.value.trim();
  if (!raw) { setStatus(cidrStatus, 'Enter a CIDR range (e.g. 192.168.1.0/24) or a single IP address.', 'warn'); return; }
  try {
    const r = cidrInfo(raw);
    setStatus(cidrStatus, '', '');
    renderCidr(r);
  } catch (e) {
    cidrResult.innerHTML = '';
    setStatus(cidrStatus, e.message, 'error');
  }
}

if (cidrInput) {
  $('cidr-calc').addEventListener('click', runCidr);
  cidrInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runCidr(); } });
  document.querySelectorAll('[data-cidr]').forEach((btn) => {
    btn.addEventListener('click', () => { cidrInput.value = btn.dataset.cidr; runCidr(); });
  });
}

/* ---------------- DNS / rDNS 查询（Cloudflare DoH） ---------------- */
const dnsInput = $('dns-input');
const dnsType = $('dns-type');
const dnsResult = $('dns-result');
const dnsStatus = $('dns-status');
let dnsSeq = 0;

function isIp(s) { return parseIPv4(s) !== null || parseIPv6(s) !== null; }

function renderDns(json, queriedName, type) {
  dnsResult.innerHTML = '';
  const head = document.createElement('p');
  head.className = 'net-head';
  const strong = document.createElement('strong');
  strong.textContent = `${queriedName} · ${type}`;
  head.appendChild(strong);
  head.appendChild(document.createTextNode(' · ' + dnsStatusText(json.Status)));
  dnsResult.appendChild(head);

  const answers = json.Answer || [];
  if (answers.length) {
    const wrap = document.createElement('div');
    wrap.className = 'net-tablewrap';
    const table = document.createElement('table');
    table.className = 'net-table';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    ['Name', 'Type', 'TTL', 'Data'].forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    const TYPE_NAMES = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 257: 'CAA' };
    for (const a of answers) {
      const tr = document.createElement('tr');
      [a.name, TYPE_NAMES[a.type] || String(a.type), String(a.TTL), a.data].forEach((c) => {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    dnsResult.appendChild(wrap);
  } else {
    const p = document.createElement('p');
    p.className = 'net-note';
    p.textContent = json.Status === 3 ? 'The domain does not exist (NXDOMAIN). Check the spelling or try another record type.' : 'No records were returned.';
    dnsResult.appendChild(p);
  }

  const src = document.createElement('p');
  src.className = 'net-note';
  src.textContent = 'Data source: Cloudflare 1.1.1.1 DNS-over-HTTPS (queried directly from your browser, not through this site).';
  dnsResult.appendChild(src);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn-secondary';
  copyBtn.textContent = 'Copy JSON';
  copyBtn.addEventListener('click', () => copyText(JSON.stringify(json, null, 2), copyBtn));
  dnsResult.appendChild(copyBtn);
}

async function runDns() {
  const raw = dnsInput.value.trim().replace(/\.$/, '');
  if (!raw) { setStatus(dnsStatus, 'Enter a domain (e.g. example.com) or an IP address (automatic reverse DNS lookup).', 'warn'); return; }
  const seq = ++dnsSeq;
  let name = raw;
  let type = dnsType.value;
  if (isIp(raw)) {
    try {
      name = ptrName(raw);
      type = 'PTR';
      dnsType.value = 'PTR';
      setStatus(dnsStatus, `IP address detected; running reverse DNS lookup (${name})…`, 'info');
    } catch (e) {
      setStatus(dnsStatus, e.message, 'error');
      return;
    }
  } else {
    if (!/^[a-zA-Z0-9._-]+$/.test(raw)) {
      setStatus(dnsStatus, 'The domain contains invalid characters. Use only letters, numbers, dots, hyphens and underscores.', 'error');
      return;
    }
    setStatus(dnsStatus, 'Looking up…', 'info');
  }
  dnsResult.innerHTML = '';
  try {
    const json = await dohQuery(name, type);
    if (seq !== dnsSeq) return;
    setStatus(dnsStatus, '', '');
    renderDns(json, name, type);
  } catch (e) {
    if (seq !== dnsSeq) return;
    setStatus(dnsStatus, 'Lookup failed: ' + e.message, 'error');
  }
}

if (dnsInput) {
  $('dns-query').addEventListener('click', runDns);
  dnsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runDns(); } });
  document.querySelectorAll('[data-dns]').forEach((btn) => {
    btn.addEventListener('click', () => {
      dnsInput.value = btn.dataset.dns;
      if (btn.dataset.dnsType) dnsType.value = btn.dataset.dnsType;
      runDns();
    });
  });
}