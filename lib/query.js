'use strict';

/**
 * 查询核心：《通用规范汉字表》数据加载与检索。
 * 只依赖 Node 内置模块，供构建脚本（生成静态数据）与测试使用；
 * 浏览器端运行的是 index.html 内同一套算法的实现。
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DATA = path.join(__dirname, '..', 'data', 'dataset.json');

/** 按码位切分（扩展 B 区字符为代理对） */
function toCodePoints(text) {
  return Array.from(text);
}

function codePointOf(char) {
  return toCodePoints(char)
    .map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ');
}

class CharacterTable {
  constructor(dataset) {
    if (!dataset || !Array.isArray(dataset.entries)) {
      throw new Error('数据集格式不正确：缺少 entries 数组');
    }
    this.meta = dataset.meta;
    this.entries = dataset.entries;
    this.byChar = new Map(); // 规范字 -> entry
    this.byIndex = new Map(); // 编号 -> entry
    this.reverseTraditional = new Map(); // 繁体字 -> [规范字]
    this.reverseVariant = new Map(); // 异体字 -> [规范字]

    for (const entry of this.entries) {
      if (this.byChar.has(entry.char)) {
        throw new Error(`数据集含重复汉字：${entry.char}`);
      }
      this.byChar.set(entry.char, entry);
      this.byIndex.set(entry.index, entry);
      this.#indexReverse(this.reverseTraditional, entry, entry.traditional);
      this.#indexReverse(this.reverseVariant, entry, entry.variant);
    }
  }

  #indexReverse(map, entry, forms) {
    if (!forms) return;
    for (const ch of forms.chars) {
      if (ch === entry.char) continue; // 不收录自映射
      if (!map.has(ch)) map.set(ch, []);
      const list = map.get(ch);
      if (!list.includes(entry.char)) list.push(entry.char);
    }
  }

  get size() {
    return this.entries.length;
  }

  levelInfo(level) {
    return this.meta.levels[String(level)] || null;
  }

  levelOf(index) {
    if (index <= 3500) return 1;
    if (index <= 6500) return 2;
    return 3;
  }

  /** 把一条字表记录整理成对外返回的结构 */
  #present(entry, matchedAs) {
    return {
      char: entry.char,
      index: entry.index,
      level: entry.level,
      levelName: this.levelInfo(entry.level)?.name || `${entry.level} 级字表`,
      codePoint: entry.codePoint,
      traditional: entry.traditional ? entry.traditional.chars : [],
      variant: entry.variant ? entry.variant.chars : [],
      matchedAs,
    };
  }

  /**
   * 查询一个字符。
   * @param {string} input 单个字符
   * @returns {{ok: boolean, error?: string, query?: string, results?: object[], viaTraditional?: string[], viaVariant?: string[]}}
   */
  query(input) {
    if (typeof input !== 'string') {
      return { ok: false, error: '请输入一个汉字' };
    }
    const text = input.trim();
    if (!text) {
      return { ok: false, error: '请输入一个汉字' };
    }
    const chars = toCodePoints(text);
    if (chars.length > 1) {
      return { ok: false, error: `一次只能查询一个字，当前输入了 ${chars.length} 个字符` };
    }
    const char = chars[0];

    const results = [];
    const direct = this.byChar.get(char);
    if (direct) {
      results.push(this.#present(direct, '规范字'));
    }

    // 反查：输入的可能是繁体字或异体字
    const viaTraditional = this.reverseTraditional.get(char) || [];
    const viaVariant = this.reverseVariant.get(char) || [];
    for (const ch of viaTraditional) {
      results.push(this.#present(this.byChar.get(ch), '繁体字'));
    }
    for (const ch of viaVariant) {
      results.push(this.#present(this.byChar.get(ch), '异体字'));
    }

    if (results.length === 0) {
      return {
        ok: false,
        error: `「${char}」不在《通用规范汉字表》8105 字之内`,
        query: char,
        queryCodePoint: codePointOf(char),
      };
    }

    return {
      ok: true,
      query: char,
      queryCodePoint: codePointOf(char),
      results,
    };
  }

  /**
   * 遍历全部条目（按编号顺序）。
   * 供 scripts/build-static.js 预生成静态响应使用。
   * @param {(entry: object) => void} [fn] 传入回调时逐条回调；不传则返回数组
   */
  all(fn) {
    if (typeof fn === 'function') {
      for (const entry of this.entries) fn(entry);
      return this;
    }
    return this.entries.slice();
  }

  /** 按编号取字，编号从 1 起 */
  byNumber(index) {
    const entry = this.byIndex.get(Number(index));
    return entry ? this.#present(entry, '规范字') : null;
  }

  /** 取某一级的字，可按 offset/limit 切片 */
  level(level, { offset = 0, limit = Infinity } = {}) {
    const n = Number(level);
    if (![1, 2, 3].includes(n)) return null;
    const list = this.entries.filter((e) => e.level === n);
    const start = Math.max(0, Number(offset) || 0);
    const end = limit === Infinity ? list.length : start + Math.max(0, Number(limit) || 0);
    return {
      level: n,
      info: this.levelInfo(n),
      total: list.length,
      offset: start,
      items: list.slice(start, end).map((e) => ({
        char: e.char,
        index: e.index,
        level: e.level,
        codePoint: e.codePoint,
      })),
    };
  }

  /** 统计信息 */
  stats() {
    const counts = { 1: 0, 2: 0, 3: 0 };
    let withTraditional = 0;
    let withVariant = 0;
    for (const entry of this.entries) {
      counts[entry.level] += 1;
      if (entry.traditional) withTraditional += 1;
      if (entry.variant) withVariant += 1;
    }
    return {
      title: this.meta.title,
      published: this.meta.published,
      issuer: this.meta.issuer,
      total: this.entries.length,
      levels: [1, 2, 3].map((n) => ({ ...this.levelInfo(n), level: n, actualCount: counts[n] })),
      withTraditional,
      withVariant,
      sources: this.meta.sources,
    };
  }
}

function loadDataset(file = DEFAULT_DATA) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function loadTable(file = DEFAULT_DATA) {
  return new CharacterTable(loadDataset(file));
}

module.exports = { CharacterTable, loadDataset, loadTable, codePointOf, toCodePoints, DEFAULT_DATA };
