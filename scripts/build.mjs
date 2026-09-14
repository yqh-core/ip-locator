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
import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');

/** 白名单：仓库根下这些条目会进入发布目录 */
const ENTRIES = ['index.html', 'about.html', 'privacy.html', '404.html', 'robots.txt', 'css', 'js'];

/** 缺一个就让构建失败的文件 —— 缺了说明仓库不完整，上线也是坏站 */
const REQUIRED = ['index.html'];

/** Pages 的硬上限（Files: 20000, 单文件 25 MiB） */
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const missing = [];
for (const name of ENTRIES) {
  const from = join(ROOT, name);
  if (!existsSync(from)) {
    missing.push(name);
    continue;
  }
  await cp(from, join(OUT, name), { recursive: true, dereference: true });
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
