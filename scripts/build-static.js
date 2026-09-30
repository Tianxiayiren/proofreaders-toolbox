#!/usr/bin/env node
'use strict';
/**
 * 生成字表数据文件 public/data/api-data.js
 *
 *   node scripts/build-static.js
 *
 * 页面直接读取该文件在浏览器内查询，无需任何服务端。
 * 发布到静态托管请改用 `node scripts/build-site.js`（生成数据 + 复制到 docs/）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { loadTable } = require('../lib/query');

const root = path.join(__dirname, '..');
const table = loadTable();

// 精简为数组：[编号, 字, 级别, 码位, 繁体数组|0, 异体数组|0]
const entries = table.all().map((e) => [
  e.index,
  e.char,
  e.level,
  e.codePoint,
  (e.traditional && e.traditional.chars) || 0,
  (e.variant && e.variant.chars) || 0,
]);

const payload = JSON.stringify({ meta: table.meta, entries });
const out = path.join(root, 'public', 'data', 'api-data.js');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, 'window.__HANZI_DATA__=' + payload + ';\n', 'utf8');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log('已生成 ' + path.relative(root, out));
console.log('  条目：' + entries.length + '（含繁体 ' + entries.filter((e) => e[4]).length +
            ' / 含异体 ' + entries.filter((e) => e[5]).length + '）');
console.log('  大小：' + kb(fs.statSync(out).size));
