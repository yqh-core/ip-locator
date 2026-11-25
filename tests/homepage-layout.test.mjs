import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/home-hero.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const enLocale = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8'));
const zhLocale = JSON.parse(readFileSync(new URL('../locales/zh.json', import.meta.url), 'utf8'));

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

test('lookup loading feedback fills the reserved area and errors release it', () => {
  assert.match(html, /id="loading"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /data-i18n="loading\.title"/);
  assert.match(html, /data-i18n="loading\.description"/);
  assert.match(html, /class="lookup-skeleton" aria-hidden="true"/);
  assert.equal((html.match(/class="lookup-skeleton-field"/g) || []).length, 9, 'skeleton mirrors the nine result fields');
  assert.match(css, /#result-zone\.is-error\s*\{\s*min-height:\s*0;/);
  assert.match(css, /#result-zone\.is-loading \.loading\s*\{[^}]*min-height:\s*650px/s);
  assert.match(css, /@media\s*\(max-width:\s*768px\)[\s\S]*?#result-zone\.is-loading \.loading\s*\{[^}]*min-height:\s*1290px/s);
  assert.match(app, /el\.resultZone = document\.getElementById\('result-zone'\)/);
  assert.match(app, /classList\.add\('is-loading'\)/);
  assert.match(app, /classList\.add\('is-error'\)/);
  assert.match(app, /classList\.remove\('is-loading', 'is-error'\)/);
  for (const [name, locale] of [['English', enLocale], ['Chinese', zhLocale]]) {
    for (const key of ['loading.title', 'loading.description', 'loading.retrying']) {
      assert.equal(typeof locale[key], 'string', `${name} locale must define ${key}`);
      assert.ok(locale[key].trim().length > 0, `${name} ${key} must not be empty`);
    }
  }
});

test('homepage SEO title, description and canonical remain unchanged', () => {
  assert.match(html, /<title>IP Address Lookup &amp; Geolocation — IPv4, IPv6, ASN &amp; DNS \| DigDevBox<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ip\.digdevbox\.com\/">/);
  assert.match(html, /<h1 data-i18n="h1\.title">🌍 IP Address Lookup &amp; Geolocation<\/h1>/);
  assert.match(html, /Find your public IP address or look up any IPv4\/IPv6 address/);
});
