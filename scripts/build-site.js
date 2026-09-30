#!/usr/bin/env node
'use strict';
/**
 * 生成发布目录 docs/（GitHub Pages 用）
 *
 *   node scripts/build-site.js
 *
 * 做两件事：
 *   1. 调用 build-static.js 生成数据文件
 *   2. 把 public/ 整体复制到 docs/，并放入 .nojekyll
 *
 * GitHub Pages 设置为「main 分支 / docs 目录」即可，无需任何构建环境。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const docsDir = path.join(root, 'docs');

// 1) 生成数据
execFileSync(process.execPath, [path.join(__dirname, 'build-static.js')], { stdio: 'inherit' });

// 2) 复制 public → docs（先清空 docs，避免留下废弃文件）
fs.rmSync(docsDir, { recursive: true, force: true });
fs.cpSync(publicDir, docsDir, { recursive: true });

// 3) GitHub Pages：跳过 Jekyll 处理（文件名含下划线等也不会被忽略）
fs.writeFileSync(path.join(docsDir, '.nojekyll'), '');

// 4) 列出结果
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const full = path.join(dir, d.name);
  return d.isDirectory() ? walk(full) : [full];
});
const files = walk(docsDir);
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

console.log('\n已生成发布目录 docs/：');
for (const f of files) {
  const rel = path.relative(docsDir, f).split(path.sep).join('/');
  console.log('  ' + rel.padEnd(24) + kb(fs.statSync(f).size));
}
const total = files.reduce((s, f) => s + fs.statSync(f).size, 0);
console.log('  合计 ' + kb(total) + '（' + files.length + ' 个文件）');
