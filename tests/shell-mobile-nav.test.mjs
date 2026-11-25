import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const cssPath = existsSync(new URL('../public/css/dd-shell.css', import.meta.url))
  ? new URL('../public/css/dd-shell.css', import.meta.url)
  : new URL('../css/dd-shell.css', import.meta.url);
const css = readFileSync(cssPath, 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('compact satellite navigation remains a single-line, horizontally scrollable flex item', () => {
  const baseRule = css.match(/\.dd-brandbar nav\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.match(baseRule, /overflow-x:\s*auto/);
  assert.match(baseRule, /flex-wrap:\s*nowrap/);

  const mobileAt = css.indexOf('@media (max-width: 640px)');
  assert.ok(mobileAt >= 0, 'mobile breakpoint exists');
  const mobile = css.slice(mobileAt);
  const navRule = mobile.match(/\.dd-brandbar\.slim nav\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.match(navRule, /min-width:\s*0/);
  assert.match(navRule, /flex:\s*1 1 0/);
  assert.match(navRule, /margin-left:\s*0/);
  assert.match(navRule, /scrollbar-width:\s*thin/);
  assert.match(navRule, /overscroll-behavior-x:\s*contain/);
});

test('mobile compact navigation exposes a visible native scroll track', () => {
  const mobile = css.slice(css.indexOf('@media (max-width: 640px)'));
  assert.match(mobile, /\.dd-brandbar\.slim nav::-webkit-scrollbar\s*\{[^}]*display:\s*block/);
  assert.match(mobile, /\.dd-brandbar\.slim nav::-webkit-scrollbar\s*\{[^}]*height:\s*3px/);
  assert.match(mobile, /\.dd-brandbar\.slim nav::-webkit-scrollbar-thumb\s*\{[^}]*background:/);
  assert.match(mobile, /\.dd-brandbar\.slim nav::-webkit-scrollbar-track\s*\{[^}]*background:/);
});

test('the cross-site navigation is clearly named for assistive technology', () => {
  const start = html.indexOf('<div class="dd-brandbar slim">');
  assert.ok(start >= 0, 'compact brandbar is present');
  const nav = html.indexOf('<nav aria-label="DigDevBox sites">', start);
  const end = html.indexOf('</nav>', nav);
  assert.ok(nav > start && end > nav, 'compact nav has a label and closes inside the brandbar');
});
