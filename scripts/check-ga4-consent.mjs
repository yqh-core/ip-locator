import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = 'G-6H3Z1K9R7P';
const htmlFiles = [
  'index.html',
  'ip-geolocation/index.html',
  'about.html',
  'contact.html',
  'docs.html',
  'faq.html',
  'guides.html',
  'privacy.html',
  'terms.html',
];
const failures = [];
for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  if (!html.includes('/analytics-consent.js')) failures.push(file + ': missing consent script');
}
const buildScript = fs.readFileSync(path.join(root, 'scripts/build.mjs'), 'utf8');
if (!buildScript.includes("'analytics-consent.js'")) failures.push('scripts/build.mjs: consent loader missing from deployment allowlist');
const script = fs.readFileSync(path.join(root, 'analytics-consent.js'), 'utf8');
const checks = [
  ['correct IP Locator Measurement ID', new RegExp(id)],
  ['explicit consent storage', /localStorage\.setItem\(CONSENT_KEY, value\)/],
  ['analytics denied by default', /analytics_storage:\s*'denied'/],
  ['query string excluded', /location\.origin \+ location\.pathname/],
  ['noindex page view blocked', /isNoindexPage\(\)/],
  ['duplicate route views blocked', /path === lastPage/],
  ['automatic page_view disabled', /send_page_view:\s*false/],
  ['Google Analytics-specific consent labels', /Accept Google Analytics[\s\S]*Reject Google Analytics/],
  ['no IP lookup values in GA4 copy', /never send the IP address you look up, lookup results, or URL query parameters/],
];
for (const [label, pattern] of checks) if (!pattern.test(script)) failures.push('analytics-consent.js: ' + label);
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (!index.includes('js/analytics.iife.js')) failures.push('index.html: existing first-party funnel tracker was removed');
const privacy = fs.readFileSync(path.join(root, 'privacy.html'), 'utf8');
for (const term of ['Google Analytics 4', 'metrics.digdevbox.com', 'tool_start', 'URL 查询参数']) {
  if (!privacy.includes(term)) failures.push('privacy.html: missing disclosure ' + term);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('[GA4 consent] PASS: all nine public HTML pages, correct ID, opt-in gate, safe path, noindex and privacy disclosure');
