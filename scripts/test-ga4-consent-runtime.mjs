import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../analytics-consent.js', import.meta.url), 'utf8');
const ID = 'G-6H3Z1K9R7P';

function boot(initialConsent = null, noindex = false) {
  const storage = new Map();
  if (initialConsent) storage.set('ip-locator.ga4-consent.v1', initialConsent);
  const scripts = [];
  const cookieWrites = [];
  let documentRef;

  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.listeners = {};
      this.style = {};
      this.attributes = {};
      this.isConnected = false;
      this.textContent = '';
      this.id = '';
      this.type = '';
      this.src = '';
    }
    appendChild(child) { this.children.push(child); if (this.isConnected) markConnected(child); return child; }
    replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    addEventListener(key, fn) { (this.listeners[key] ||= []).push(fn); }
    remove() { this.isConnected = false; removeFrom(documentRef.body, this); }
    click() { (this.listeners.click || []).forEach(fn => fn()); }
  }
  function markConnected(element) { element.isConnected = true; (element.children || []).forEach(markConnected); }
  function removeFrom(parent, target) {
    parent.children = (parent.children || []).filter(item => item !== target);
    (parent.children || []).forEach(item => removeFrom(item, target));
  }
  function find(element, predicate) {
    if (predicate(element)) return element;
    for (const child of element.children || []) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  }
  const body = new Element('body');
  body.appendChild = function (child) { this.children.push(child); markConnected(child); return child; };
  const head = new Element('head');
  head.appendChild = function (child) { if (child.tagName === 'SCRIPT') scripts.push(child); child.isConnected = true; return child; };
  const noindexMeta = noindex ? { getAttribute: () => 'noindex, nofollow' } : null;
  documentRef = {
    readyState: 'complete',
    body,
    head,
    referrer: 'https://referrer.example/path?private=1',
    title: 'IP Locator test page',
    createElement: tag => new Element(tag),
    getElementById: id => find(body, element => element.id === id),
    querySelector: selector => selector === 'meta[name="robots"]' ? noindexMeta : null,
    get cookie() { return '_ga=existing; _ga_ABC=existing'; },
    set cookie(value) { cookieWrites.push(value); },
  };
  const history = { pushState() {}, replaceState() {} };
  const window = {
    dataLayer: [],
    addEventListener() {},
    setTimeout(fn) { fn(); },
    URL,
  };
  const context = {
    window,
    document: documentRef,
    history,
    location: {
      origin: 'https://ip.digdevbox.com',
      pathname: '/ip-geolocation/',
      search: '?ip=203.0.113.1',
      hostname: 'ip.digdevbox.com',
    },
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, value),
    },
    URL,
    Date,
    console,
  };
  vm.runInNewContext(source, context, { filename: 'analytics-consent.js' });
  const all = () => {
    const result = [];
    function walk(element) { result.push(element); (element.children || []).forEach(walk); }
    walk(body);
    return result;
  };
  const button = label => all().find(element => element.tagName === 'BUTTON' && element.textContent === label);
  return { storage, scripts, cookieWrites, window, document: documentRef, all, button };
}

{
  const test = boot();
  assert.equal(test.scripts.length, 0, 'no GA script before consent');
  assert.ok(test.button('Accept Google Analytics'));
  assert.ok(test.button('Reject Google Analytics'));
  test.button('Accept Google Analytics').click();
  assert.equal(test.storage.get('ip-locator.ga4-consent.v1'), 'accepted');
  assert.equal(test.scripts.length, 1);
  assert.equal(test.scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=' + ID);
  test.scripts[0].onload();
  const calls = test.window.dataLayer.map(args => Array.from(args));
  assert.ok(calls.some(args => args[0] === 'config' && args[1] === ID));
  const pageView = calls.find(args => args[0] === 'event' && args[1] === 'page_view');
  assert.ok(pageView);
  assert.equal(pageView[2].page_location, 'https://ip.digdevbox.com/ip-geolocation/');
  assert.ok(!pageView[2].page_location.includes('203.0.113.1'));
  assert.ok(!pageView[2].page_referrer.includes('?'));
}
{
  const test = boot();
  test.button('Reject Google Analytics').click();
  assert.equal(test.storage.get('ip-locator.ga4-consent.v1'), 'rejected');
  assert.equal(test.scripts.length, 0, 'reject never loads GA');
}
{
  const test = boot(null, true);
  test.button('Accept Google Analytics').click();
  test.scripts[0].onload();
  const calls = test.window.dataLayer.map(args => Array.from(args));
  assert.equal(calls.filter(args => args[0] === 'event' && args[1] === 'page_view').length, 0, 'noindex page view is suppressed');
}
{
  const test = boot();
  test.button('Accept Google Analytics').click();
  test.scripts[0].onload();
  test.button('Privacy choices').click();
  test.button('Reject Google Analytics').click();
  const calls = test.window.dataLayer.map(args => Array.from(args));
  assert.ok(calls.some(args => args[0] === 'consent' && args[1] === 'update' && args[2].analytics_storage === 'denied'));
  assert.ok(test.cookieWrites.some(value => value.includes('_ga=') && value.includes('Max-Age=0')));
}
console.log('[GA4 runtime] PASS: no pre-consent load; accept sends safe path-only page_view; reject blocks; noindex suppresses; withdrawal clears cookies');
