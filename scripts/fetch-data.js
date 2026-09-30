#!/usr/bin/env node
/**
 * 取数脚本：下载《通用规范汉字表》原始数据并生成 data/dataset.json
 *
 * 数据来源：
 *  1) 分级字表（字序即编号顺序，1–3500 一级 / 3501–6500 二级 / 6501–8105 三级）
 *     https://github.com/shengdoushi/common-standard-chinese-characters-table
 *  2) 附表一《规范字与繁体字、异体字对照表》
 *     https://github.com/lqfeng/ChineseCharacters
 *
 * 用法：node scripts/fetch-data.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'dataset.json');

const LEVEL_SOURCE = (n) =>
  `https://raw.githubusercontent.com/shengdoushi/common-standard-chinese-characters-table/master/level-${n}.txt`;

const ANNEX_SOURCE =
  'https://raw.githubusercontent.com/lqfeng/ChineseCharacters/master/' +
  encodeURIComponent(
    '通用规范汉字表(2013)全部(8105字)含拼音、繁体字、异体字.txt',
  );

const EXPECTED_LEVEL_SIZES = [3500, 3000, 1605];
const EXPECTED_TOTAL = 8105;

/** 按码位切分字符串（扩展 B 区字符是代理对，不能用 length/索引） */
function toCodePoints(text) {
  return Array.from(text.trim());
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下载失败 ${res.status} ${res.statusText}：${url}`);
  return res.text();
}

async function fetchLevels() {
  const levels = [];
  for (let n = 1; n <= 3; n += 1) {
    const raw = await fetchText(LEVEL_SOURCE(n));
    const chars = toCodePoints(raw.replace(/\s+/gu, ''));
    const expected = EXPECTED_LEVEL_SIZES[n - 1];
    if (chars.length !== expected) {
      throw new Error(
        `第 ${n} 级字表字数不符：期望 ${expected}，实得 ${chars.length}`,
      );
    }
    levels.push(chars);
    console.log(`  ✓ ${n} 级字表 ${chars.length} 字`);
  }
  return levels.flat();
}

/**
 * 解析对照栏：去掉外层括号，按竖线切分。
 *   "(廠)"       → ["廠"]
 *   "(干|乾|幹)" → ["干","乾","幹"]
 *   "[|乹亁|榦]" → ["乹亁","榦"]（空位丢弃）
 */
function parseList(field) {
  const text = (field || '').trim();
  if (!text) return [];
  const inner = /^[([]/.test(text) ? text.slice(1, -1) : text;
  return inner
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * 把对照表的三个字列整理成「规范字 → 繁体字 / 异体字」映射。
 *
 * 官方附录的列结构：第一栏规范字（本文件每行一个），第二栏繁体字（圆括号），
 * 第三栏异体字（方括号）。本数据集里：
 *  - 第二栏单字 → 该规范字对应的繁体字，可靠；
 *  - 第三栏单字 → 该规范字对应的异体字，可靠；
 *  - 两栏出现多字并带竖线时表示「真异体字组」，其内部顺序与位置并非严格配对
 *    （实测 里 → (里|裡) 与已有的 裏/裡 繁体标注冲突），故只做逐行收录，
 *    不推导组内配对，避免生成错误映射。
 */
function indexVariants(rows, chars) {
  const traditional = new Map(); // 规范字 -> [繁体字]
  const variant = new Map(); // 规范字 -> [异体字]

  const push = (map, key, char) => {
    if (!key || !char) return;
    if (!map.has(key)) map.set(key, []);
    if (!map.get(key).includes(char)) map.get(key).push(char);
  };

  let tradRows = 0;
  let varRows = 0;

  rows.forEach((row, i) => {
    const [num, char, , tradField = '', varField = ''] = row.split('\t');
    const text = (char || '').trim();
    if (!text) throw new Error(`第 ${i + 1} 行缺少汉字：${JSON.stringify(row)}`);
    if (parseInt(num, 10) !== i + 1) {
      throw new Error(`第 ${i + 1} 行编号不符：${JSON.stringify(num)}`);
    }
    if (text !== chars[i]) {
      throw new Error(
        `第 ${i + 1} 行与分级字表不一致：对照表「${text}」 vs 字表「${chars[i]}」`,
      );
    }

    const group = parseList(tradField); // 第二栏
    const forms = parseList(varField); // 第三栏
    if (group.length === 1) {
      push(traditional, text, group[0]);
      tradRows += 1;
    }
    if (forms.length === 1) {
      push(variant, text, forms[0]);
      varRows += 1;
    }
  });

  const multiTrad = rows.filter((row) => parseList(row.split('\t')[3]).length > 1).length;
  const multiVar = rows.filter((row) => parseList(row.split('\t')[4]).length > 1).length;
  console.log(
    `  ✓ 对照表：单字繁体对应 ${tradRows} 行、单字异体对应 ${varRows} 行；` +
      `多字真异体字组 ${multiTrad}/${multiVar} 行（不做组内配对推导）`,
  );

  return { traditional, variant, multiTrad, multiVar };
}

async function fetchVariants(chars) {
  const raw = await fetchText(ANNEX_SOURCE);
  const rows = raw.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (rows.length !== EXPECTED_TOTAL) {
    throw new Error(`对照表行数不符：期望 ${EXPECTED_TOTAL}，实得 ${rows.length}`);
  }

  const { traditional, variant } = indexVariants(rows, chars);
  const recognized = rows.filter((row) => {
    const [, , , tradField = '', varField = ''] = row.split('\t');
    return tradField.trim() !== '' || varField.trim() !== '';
  }).length;

  console.log(
    `  ✓ 对照表：${recognized} 字标注了繁体/异体，` +
      `其中繁体对应 ${traditional.size} 字、异体对应 ${variant.size} 字`,
  );
  return { traditional, variant };
}

function buildDataset(chars, { traditional, variant }) {
  const codePointOf = (ch) =>
    Array.from(ch)
      .map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
      .join(' ');

  const describe = (list) => {
    if (!list || !list.length) return undefined;
    return {
      chars: list,
      codePoints: list.map(codePointOf),
    };
  };

  const entries = chars.map((char, i) => {
    const entry = {
      index: i + 1,
      char,
      level: i + 1 <= 3500 ? 1 : i + 1 <= 6500 ? 2 : 3,
      codePoint: codePointOf(char),
    };
    const trad = describe(traditional.get(char));
    if (trad) entry.traditional = trad;
    const vari = describe(variant.get(char));
    if (vari) entry.variant = vari;
    return entry;
  });

  return {
    meta: {
      title: '通用规范汉字表',
      published: '2013-06-05',
      issuer: '教育部、国家语言文字工作委员会',
      total: entries.length,
      levels: {
        1: { name: '一级字表', description: '常用字集', count: 3500, from: 1, to: 3500 },
        2: { name: '二级字表', description: '使用度仅次于一级字', count: 3000, from: 3501, to: 6500 },
        3: { name: '三级字表', description: '姓氏人名、地名、科技术语及文言文用字', count: 1605, from: 6501, to: 8105 },
      },
      sources: {
        levels: 'https://github.com/shengdoushi/common-standard-chinese-characters-table',
        variants: 'https://github.com/lqfeng/ChineseCharacters',
      },
      generatedAt: new Date().toISOString(),
    },
    entries,
  };
}

function validate(dataset) {
  const { entries, meta } = dataset;
  if (entries.length !== EXPECTED_TOTAL) {
    throw new Error(`总字数不符：期望 ${EXPECTED_TOTAL}，实得 ${entries.length}`);
  }
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.char)) throw new Error(`重复汉字：${entry.char}`);
    seen.add(entry.char);
    if (!entry.codePoint) throw new Error(`缺少码位：${entry.char}`);
  }
  for (const n of [1, 2, 3]) {
    const info = meta.levels[n];
    const actual = entries.filter((e) => e.level === n).length;
    if (actual !== info.count) {
      throw new Error(`${info.name}字数不符：期望 ${info.count}，实得 ${actual}`);
    }
    const boundary = entries[info.from - 1];
    const last = entries[info.to - 1];
    if (boundary.level !== n || last.level !== n) {
      throw new Error(`${info.name}编号区间校验失败`);
    }
  }
  const withTrad = entries.filter((e) => e.traditional).length;
  const withVar = entries.filter((e) => e.variant).length;
  // 实测：2241 字带繁体字、80 字带异体字（另有一批字的繁体自身也在表内，故低于行数 2830）
  if (withTrad < 2000) {
    throw new Error(`繁体字覆盖异常：仅 ${withTrad} 字`);
  }
  if (withVar < 70) {
    throw new Error(`异体字覆盖异常：仅 ${withVar} 字`);
  }
  return { withTrad, withVar };
}

async function main() {
  console.log('开始获取《通用规范汉字表》数据…');
  const chars = await fetchLevels();
  const variants = await fetchVariants(chars);
  const dataset = buildDataset(chars, variants);
  const stats = validate(dataset);
  dataset.meta.variantCoverage = {
    withTraditional: stats.withTrad,
    withVariant: stats.withVar,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(dataset), 'utf8');

  const size = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log('\n校验通过：');
  console.log(`  总字数      ${dataset.meta.total}`);
  console.log(`  一级 / 二级 / 三级  ${metaCounts(dataset).join(' / ')}`);
  console.log(`  带繁体字    ${stats.withTrad} 字`);
  console.log(`  带异体字    ${stats.withVar} 字`);
  console.log(`\n已写入 ${path.relative(ROOT, OUT)}（${size} KB）`);
}

function metaCounts(dataset) {
  return [1, 2, 3].map((n) => dataset.meta.levels[n].count);
}

main().catch((err) => {
  console.error('\n生成数据失败：', err.message);
  process.exitCode = 1;
});
