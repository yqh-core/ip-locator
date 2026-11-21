#!/usr/bin/env node
/**
 * Build-artifact SEO contract for IP Locator.
 *
 * The sitemap is an allowlist of canonical, indexable pages — not a list of
 * every HTML file in the deployment. Keep this list intentional and update it
 * only when a page has been reviewed for English source content and search value.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.argv[2] || 'dist';
const ORIGIN = 'https://ip.digdevbox.com';
const EXPECTED = new Map([
  ['/', 'index.html'],
  ['/ip-address-lookup/', 'ip-address-lookup/index.html'],
  ['/ip-geolocation/', 'ip-geolocation/index.html'],
  ['/docs', 'docs.html'],
  ['/guides', 'guides.html'],
  ['/faq', 'faq.html'],
]);

export function parseSitemap(xml) {
  if (!/<urlset\b[^>]*>/i.test(xml)) throw new Error('sitemap.xml is missing a urlset root');
  const urls = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(match => match[1].trim());
  if (urls.length === 0) throw new Error('sitemap.xml contains no loc entries');
  if (/<loc>[^<]*<\/loc>/i.test(xml)) throw new Error('sitemap.xml contains an empty loc entry');
  return urls;
}

export function validateSitemapUrls(urls) {
  const seen = new Set();
  const errors = [];
  for (const raw of urls) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      errors.push('Invalid sitemap URL: ' + raw);
      continue;
    }
    if (url.origin !== ORIGIN) errors.push('Non-canonical host in sitemap: ' + raw);
    if (url.search || url.hash) errors.push('Sitemap URL must not contain query/hash: ' + raw);
    if (seen.has(url.href)) errors.push('Duplicate sitemap URL: ' + raw);
    seen.add(url.href);
    if (!EXPECTED.has(url.pathname)) errors.push('Unexpected or non-approved sitemap path: ' + url.pathname);
  }
  for (const path of EXPECTED.keys()) {
    if (!seen.has(ORIGIN + path)) errors.push('Missing approved indexable page: ' + ORIGIN + path);
  }
  for (const url of seen) {
    const path = new URL(url).pathname;
    if (!EXPECTED.has(path)) continue;
    if (url !== ORIGIN + path) errors.push('Non-canonical sitemap URL: ' + url);
  }
  return errors;
}

function extractMeta(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const tag = tags.find(item =>
    item.includes('name="' + name + '"') || item.includes("name='" + name + "'"),
  );
  return tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1]?.trim() || '';
}

function extractCanonical(html) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  const tag = tags.find(item =>
    item.includes('rel="canonical"') || item.includes("rel='canonical'"),
  );
  return tag?.match(/\bhref=["']([^"']+)["']/i)?.[1]?.trim() || '';
}

async function main() {
  if (process.argv.includes('--self-test')) {
    const valid = [...EXPECTED.keys()].map(path => ORIGIN + path);
    if (validateSitemapUrls(valid).length) throw new Error('self-test rejected the approved sitemap');
    if (!validateSitemapUrls([...valid, 'https://example.com/spam']).some(x => x.includes('Non-canonical host'))) {
      throw new Error('self-test failed to reject an off-site URL');
    }
    if (!validateSitemapUrls([...valid, ORIGIN + '/about']).some(x => x.includes('Unexpected'))) {
      throw new Error('self-test failed to reject an unapproved page');
    }
    if (!validateSitemapUrls([...valid, valid[0]]).some(x => x.includes('Duplicate'))) {
      throw new Error('self-test failed to reject a duplicate URL');
    }
    if (!validateSitemapUrls(valid.slice(1)).some(x => x.includes('Missing approved'))) {
      throw new Error('self-test failed to detect a missing page');
    }
    console.log('PASS: sitemap indexability contract self-tests');
    return;
  }

  const sitemap = await readFile(join(ROOT, 'sitemap.xml'), 'utf8');
  const robots = await readFile(join(ROOT, 'robots.txt'), 'utf8');
  const urls = parseSitemap(sitemap);
  const errors = validateSitemapUrls(urls);

  if (!/sitemap:\s*https:\/\/ip\.digdevbox\.com\/sitemap\.xml/i.test(robots)) {
    errors.push('robots.txt must reference the canonical production sitemap');
  }
  if (/^\s*disallow:\s*\/\s*$/im.test(robots)) {
    errors.push('robots.txt must not block the entire site');
  }

  for (const [path, file] of EXPECTED) {
    const html = await readFile(join(ROOT, file), 'utf8');
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '';
    const description = extractMeta(html, 'description');
    const canonical = extractCanonical(html);
    if (!title) errors.push(path + ' is missing a title');
    if (!description) errors.push(path + ' is missing a meta description');
    if (canonical !== ORIGIN + path) errors.push(path + ' canonical mismatch: ' + canonical);
    if (/<meta\b(?=[^>]*\bname=["']robots["'])(?=[^>]*\bcontent=["'][^"']*noindex)/i.test(html)) {
      errors.push(path + ' is noindex but listed in the sitemap');
    }
    if (!/<h1\b/i.test(html)) errors.push(path + ' is missing an H1');
  }

  if (errors.length) {
    console.error('FAIL: IP Locator SEO artifact contract');
    for (const error of errors) console.error(' - ' + error);
    process.exitCode = 1;
    return;
  }
  console.log('PASS: ' + urls.length + ' approved canonical indexable URLs; robots, title, description, canonical, indexability and H1 verified');
}

main().catch(error => {
  console.error('SEO artifact contract crashed:', error);
  process.exitCode = 1;
});
