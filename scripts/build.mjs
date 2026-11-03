#!/usr/bin/env node
/**
 * 组装 Cloudflare Pages 的发布目录。
 *
 * 只做一件事：按白名单把仓库里的站点文件拷进 dist/。
 * 用白名单而不是「把仓库根整个发上去」，是为了避免 README / LICENSE / .gitignore
 * 这些仓库元文件被当成静态资源对外提供。
 *
 * 另外做两件 Cloudflare 侧看不到的事：
 *   1. 必需文件缺失时**硬失败**，而不是静默上线一个空壳站；
 *   2. 打印产物文件数与最大单文件，直接对照 Pages 的 20000 文件 / 25 MiB 上限。
 */
import { cp, mkdir, rm, readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');

/** 白名单：仓库根下这些条目会进入发布目录 */
const ENTRIES = [
  'index.html',
  'about.html',
  'privacy.html',
  'terms.html',
  'contact.html',
  'faq.html',
  'guides.html',
  'docs.html',
  '404.html',
  'robots.txt',
  'sitemap.xml',
  'ads.txt',
  '_headers',
  '9765d1ca8a6604d220ffa976e8ba38ce.txt',
  'css',
  'js',
  'images',
];

/** 缺一个就让构建失败的文件 —— 缺了说明仓库不完整，上线也是坏站 */
const REQUIRED = ['index.html'];

/**
 * 备份/临时文件不入产物（裁定⑤：修构建排除规则，**原备份保留在仓库里不动**）。
 *
 * 背景：css/style.css.bak-p2 是 2026-10-13 留下的旧样式表备份，未被 git 跟踪，
 * 但整目录拷贝时会被搬进 dist/。线上实测是 404（CF Pages 从 git 克隆构建，
 * 未跟踪文件不在克隆里），所以**不是生产泄漏**；真正的风险是改用 Direct Upload
 * 部署时会把这堆旧文件一起发出去，外加多占 Pages 的 20000 文件额度。
 *
 * 判据只认"备份/临时"这类形态，不认业务文件名，避免把正常文件吞掉。
 */
const EXCLUDE_PATTERNS = [
  /\.bak\b/i,            // style.css.bak-p2 / app.js.bak（\b 让 .bak 后面跟 -p2、.old 或直接结尾都命中）
  /~$/,                  // editor 备份 app.js~
  /\.swp$|\.swo$/i,      // vim 临时
  /\.DS_Store$/i,
  /^Thumbs\.db$/i,
];
const isExcluded = relPath => EXCLUDE_PATTERNS.some(re => re.test(relPath.replace(/\\/g, '/')));

/** Pages 的硬上限（Files: 20000, 单文件 25 MiB） */
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const missing = [];
const excludedSeen = [];
for (const name of ENTRIES) {
  const from = join(ROOT, name);
  if (!existsSync(from)) {
    missing.push(name);
    continue;
  }
  await cp(from, join(OUT, name), {
    recursive: true,
    dereference: true,
    filter: src => {
      // rel 相对仓库根，命中的是不入产物的备份/临时形态
      const rel = relative(ROOT, src).replace(/\\/g, '/');
      if (!isExcluded(rel)) return true;
      excludedSeen.push(rel);
      return false;
    },
  });
}

// 排除必须是**可见的**，不能静默：静默跳过会把"漏发一个文件"写成"构建一切正常"
if (excludedSeen.length > 0) {
  console.log(`EXCL 已排除 ${excludedSeen.length} 个备份/临时文件（源文件保留在仓库，未删除）:`);
  for (const rel of [...new Set(excludedSeen)].sort()) console.log(`  - ${rel}`);
}

// 判据自检：排除规则本身不能是摆设。仓库里此刻可能并没有 .bak 文件，
// 那样上面的日志就成了"0 命中 = 没扫"，所以用合成路径证明规则真的会命中。
const RULE_SELFTEST = [
  ['css/style.css.bak-p2', true],
  ['js/app.js.bak', true],
  ['js/app.js~', true],
  ['.DS_Store', true],
  ['css/style.css', false],
  ['index.html', false],
  ['js/ip-sources.js', false],
];
for (const [probe, expect] of RULE_SELFTEST) {
  if (isExcluded(probe) !== expect) {
    console.error(`ERROR 排除规则自检失败：${probe} 应${expect ? '被排除' : '保留'}，实际相反`);
    process.exit(1);
  }
}

const fatal = missing.filter(name => REQUIRED.includes(name));
if (fatal.length > 0) {
  console.error(`ERROR 缺少上线必需的文件: ${fatal.join(', ')}`);
  process.exit(1);
}
if (missing.length > 0) {
  console.warn(`WARN  跳过不存在的可选条目: ${missing.join(', ')}`);
}

const files = await walk(OUT);
if (files.length === 0) {
  console.error('ERROR 产物目录为空，构建命令没有产出任何文件');
  process.exit(1);
}

// 产物侧硬判据：不管从哪条路径进来的，备份/临时形态一律不许出现在 dist/
const leaked = files.filter(f => isExcluded(f.rel));
if (leaked.length > 0) {
  console.error(`ERROR 产物里仍有备份/临时文件（排除规则被绕过）: ${leaked.map(f => f.rel).join(', ')}`);
  process.exit(1);
}

const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
const biggest = files.reduce((max, f) => (f.size > max.size ? f : max), { size: 0, rel: '' });
const oversized = files.filter(f => f.size > MAX_FILE_BYTES);

console.log(`dist: ${files.length} 个文件, ${(totalBytes / 1024).toFixed(1)} KiB`);
console.log(`最大单文件: ${biggest.rel} (${(biggest.size / 1024 / 1024).toFixed(2)} MiB)`);

if (files.length > MAX_FILES) {
  console.error(`ERROR 文件数 ${files.length} 超过 Pages 上限 ${MAX_FILES}`);
  process.exit(1);
}
if (oversized.length > 0) {
  console.error(`ERROR 以下文件超过单文件 25 MiB 上限:`);
  for (const f of oversized) console.error(`  ${f.rel} (${(f.size / 1024 / 1024).toFixed(2)} MiB)`);
  process.exit(1);
}

/**
 * 守卫：产物里不允许出现站内 .html 链接。
 *
 * Cloudflare Pages 会把 *.html 统一 308 到干净 URL（HTML URL 规范化），
 * 链接写成 .html 形态时整站可爬链接都指向重定向，Search Console 会报
 * "Page with redirect"。本地预览服务器不复现这个行为，只看本地发现不了，
 * 所以在构建时直接拦下来。
 */
const offenders = [];
for (const file of files.filter(f => f.rel.endsWith('.html'))) {
  const html = await readFile(join(OUT, file.rel), 'utf8');
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(href) || href.startsWith('#')) continue;
    if (href.endsWith('.html')) offenders.push(`${file.rel} → ${href}`);
  }
}
if (offenders.length > 0) {
  console.error('ERROR 产物里存在站内 .html 链接，Cloudflare Pages 会把它们 308 掉:');
  for (const o of offenders) console.error(`  ${o}`);
  console.error('改用干净 URL（/about 而不是 /about.html），并在 _redirects 里加 200 重写。');
  process.exit(1);
}

console.log('OK 产物已就绪: dist/');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile()) {
      const { size } = await stat(full);
      out.push({ rel: relative(OUT, full).split('\\').join('/'), size });
    }
  }
  return out;
}
