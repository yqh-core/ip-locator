import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/home-hero.css', import.meta.url), 'utf8');

test('homepage lookup remains inside the hero task flow', () => {
  const heroStart = html.indexOf('<header class="hero-panel">');
  const heroEnd = html.indexOf('</header>', heroStart);
  const lookupStart = html.indexOf('<div class="search-section lookup-panel"', heroStart);
  assert.ok(heroStart >= 0, 'homepage hero exists');
  assert.ok(heroEnd > heroStart, 'homepage hero closes');
  assert.ok(lookupStart > heroStart && lookupStart < heroEnd, 'primary IP lookup form must be inside the hero');
  for (const id of ['ipInput', 'searchBtn', 'myIpBtn', 'ipv6DemoBtn']) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id + ' remains unique');
  }
});

test('desktop keeps the network-console split layout', () => {
  assert.match(css, /grid-template-areas:\s*"copy brief"\s*"lookup brief"/);
  assert.match(css, /\.hero-copy\s*\{[^}]*grid-area:\s*copy/s);
  assert.match(css, /\.hero-brief\s*\{[^}]*grid-area:\s*brief/s);
  assert.match(css, /\.lookup-panel\s*\{[^}]*grid-area:\s*lookup/s);
});

test('mobile prioritizes the lookup and preserves a one-row input plus Query action', () => {
  assert.match(css, /@media\s*\(max-width:\s*768px\)[\s\S]*?grid-template-areas:\s*"copy"\s*"lookup"/);
  assert.match(css, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.hero-brief\s*\{\s*display:\s*none;/);
  assert.match(css, /@media\s*\(max-width:\s*480px\)[\s\S]*?\.lookup-panel \.search-box\s*\{[^}]*flex-direction:\s*row/s);
  assert.match(css, /\.lookup-panel #ipInput\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.lookup-panel #searchBtn\s*\{[^}]*width:\s*auto/s);
});

test('homepage SEO title, description and canonical remain unchanged', () => {
  assert.match(html, /<title>IP Geolocation Lookup — IP Address, ASN &amp; DNS \| DigDevBox<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ip\.digdevbox\.com\/">/);
  assert.match(html, /Look up public IPv4 and IPv6 addresses by location, ISP and ASN/);
});
