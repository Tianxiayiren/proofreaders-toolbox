'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { CharacterTable, codePointOf, toCodePoints, DEFAULT_DATA } = require('../lib/query');

/** 构造一个可控的小数据集，用于验证查询逻辑本身 */
function fixture() {
  return new CharacterTable({
    meta: {
      title: '通用规范汉字表（测试数据）',
      published: '2013-06-05',
      issuer: '测试',
      total: 4,
      levels: {
        1: { name: '一级字表', description: '常用字集', count: 2, from: 1, to: 2 },
        2: { name: '二级字表', description: '次常用', count: 1, from: 3, to: 3 },
        3: { name: '三级字表', description: '专门领域', count: 1, from: 4, to: 4 },
      },
      sources: {},
    },
    entries: [
      { index: 1, char: '一', level: 1, codePoint: 'U+4E00' },
      {
        index: 2,
        char: '厂',
        level: 1,
        codePoint: 'U+5382',
        traditional: { chars: ['廠'], codePoints: ['U+5EE0'] },
      },
      {
        index: 3,
        char: '乃',
        level: 2,
        codePoint: 'U+4E43',
        variant: { chars: ['廼', '迺'], codePoints: ['U+5EFC', 'U+8FFA'] },
      },
      {
        index: 4,
        char: '𠮷',
        level: 3,
        codePoint: 'U+20BB7',
        variant: { chars: ['吉'], codePoints: ['U+5409'] },
      },
    ],
  });
}

test('按码位切分：扩展 B 区字符算作一个字', () => {
  assert.strictEqual(toCodePoints('𠮷').length, 1);
  assert.strictEqual(toCodePoints('一乙').length, 2);
  assert.strictEqual(codePointOf('𠮷'), 'U+20BB7');
  assert.strictEqual(codePointOf('一'), 'U+4E00');
});

test('查询规范字：返回编号、级别与级别名', () => {
  const table = fixture();
  const res = table.query('厂');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.query, '厂');
  assert.strictEqual(res.results.length, 1);
  const [hit] = res.results;
  assert.strictEqual(hit.index, 2);
  assert.strictEqual(hit.level, 1);
  assert.strictEqual(hit.levelName, '一级字表');
  assert.strictEqual(hit.codePoint, 'U+5382');
  assert.deepStrictEqual(hit.traditional, ['廠']);
  assert.deepStrictEqual(hit.variant, []);
  assert.strictEqual(hit.matchedAs, '规范字');
});

test('查询三级字（扩展 B 区）也能命中', () => {
  const res = fixture().query('𠮷');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.results[0].index, 4);
  assert.strictEqual(res.results[0].level, 3);
  assert.strictEqual(res.results[0].levelName, '三级字表');
});

test('繁体字反查：输入廠 → 规范字厂', () => {
  const res = fixture().query('廠');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.results.length, 1);
  assert.strictEqual(res.results[0].char, '厂');
  assert.strictEqual(res.results[0].index, 2);
  assert.strictEqual(res.results[0].matchedAs, '繁体字');
});

test('异体字反查：输入廼 → 规范字乃', () => {
  const res = fixture().query('廼');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.results[0].char, '乃');
  assert.strictEqual(res.results[0].index, 3);
  assert.strictEqual(res.results[0].level, 2);
  assert.strictEqual(res.results[0].matchedAs, '异体字');
});

test('输入「吉」时同时给出规范字与异体字反查结果', () => {
  const res = fixture().query('吉');
  assert.strictEqual(res.ok, true);
  const chars = res.results.map((r) => r.char);
  assert.ok(chars.includes('吉') === false, '「吉」不在测试字表内');
  assert.deepStrictEqual(chars, ['𠮷']);
  assert.strictEqual(res.results[0].matchedAs, '异体字');
});

test('未收录的字给出明确提示，并回带码位', () => {
  const res = fixture().query('A');
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /不在《通用规范汉字表》/);
  assert.strictEqual(res.query, 'A');
  assert.strictEqual(res.queryCodePoint, 'U+0041');
  assert.strictEqual(res.results, undefined);
});

test('输入校验：空串、纯空白、多字、非字符串都被拒绝', () => {
  const table = fixture();
  for (const bad of ['', '   ', '\t\n']) {
    const res = table.query(bad);
    assert.strictEqual(res.ok, false, `应拒绝：${JSON.stringify(bad)}`);
    assert.match(res.error, /请输入一个汉字/);
  }
  const multi = table.query('汉字');
  assert.strictEqual(multi.ok, false);
  assert.match(multi.error, /一次只能查询一个字/);
  assert.strictEqual(table.query(null).ok, false);
  assert.strictEqual(table.query(undefined).ok, false);
  assert.strictEqual(table.query(123).ok, false);
});

test('输入首尾空白会被忽略', () => {
  const res = fixture().query('  厂  ');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.results[0].index, 2);
});

test('按编号取字，越界返回 null', () => {
  const table = fixture();
  assert.strictEqual(table.byNumber(1).char, '一');
  assert.strictEqual(table.byNumber(4).char, '𠮷');
  assert.strictEqual(table.byNumber(0), null);
  assert.strictEqual(table.byNumber(5), null);
});

test('按级别取字：级别校验、offset/limit 切片', () => {
  const table = fixture();
  assert.strictEqual(table.level(1).total, 2);
  assert.deepStrictEqual(table.level(1).items.map((i) => i.char), ['一', '厂']);
  assert.deepStrictEqual(table.level(1, { offset: 1 }).items.map((i) => i.char), ['厂']);
  assert.deepStrictEqual(table.level(1, { offset: 0, limit: 1 }).items.map((i) => i.char), ['一']);
  assert.strictEqual(table.level(1).info.name, '一级字表');
  assert.strictEqual(table.level(4), null);
  assert.strictEqual(table.level(0), null);
  assert.strictEqual(table.level('x'), null);
});

test('统计信息按级别汇总', () => {
  const stats = fixture().stats();
  assert.strictEqual(stats.total, 4);
  assert.deepStrictEqual(stats.levels.map((l) => l.actualCount), [2, 1, 1]);
  assert.strictEqual(stats.withTraditional, 1);
  assert.strictEqual(stats.withVariant, 2);
});

test('重复汉字与缺失 entries 会被拒绝', () => {
  const meta = { levels: { 1: { name: '一级字表' } } };
  assert.throws(
    () => new CharacterTable({ meta, entries: [{ char: '一', index: 1, level: 1 }, { char: '一', index: 2, level: 1 }] }),
    /重复汉字/,
  );
  assert.throws(() => new CharacterTable({ meta }), /缺少 entries/);
  assert.throws(() => new CharacterTable(null), /数据集格式不正确/);
});

// ---------- 真实数据集的结构校验（数据文件缺失时自动跳过） ----------
const hasData = fs.existsSync(DEFAULT_DATA);

test('真实数据集：8105 字，分级为 3500 / 3000 / 1605', { skip: !hasData && '请先运行 npm run fetch-data' }, () => {
  const { loadTable } = require('../lib/query');
  const table = loadTable();
  assert.strictEqual(table.size, 8105);
  const stats = table.stats();
  assert.deepStrictEqual(stats.levels.map((l) => l.actualCount), [3500, 3000, 1605]);
});

test('真实数据集：编号连续且与所在级别一致', { skip: !hasData && '请先运行 npm run fetch-data' }, () => {
  const { loadTable } = require('../lib/query');
  const table = loadTable();
  table.entries.forEach((entry, i) => {
    assert.strictEqual(entry.index, i + 1, `第 ${i + 1} 条编号不连续`);
    assert.strictEqual(entry.level, table.levelOf(entry.index), `${entry.char} 的级别与编号不符`);
  });
  assert.strictEqual(table.byNumber(1).char, '一');
  assert.strictEqual(table.byNumber(3500).level, 1);
  assert.strictEqual(table.byNumber(3501).level, 2);
  assert.strictEqual(table.byNumber(6500).level, 2);
  assert.strictEqual(table.byNumber(6501).level, 3);
  assert.strictEqual(table.byNumber(8105).level, 3);
});

test('真实数据集：抽查官方对照结果', { skip: !hasData && '请先运行 npm run fetch-data' }, () => {
  const { loadTable } = require('../lib/query');
  const table = loadTable();
  const cases = [
    ['厂', 6, 1, ['廠']],
    ['与', 34, 1, ['與']],
    ['树', 1439, 1, ['樹']],
  ];
  for (const [char, index, level, traditional] of cases) {
    const res = table.query(char);
    assert.strictEqual(res.ok, true, `${char} 应能查到`);
    assert.strictEqual(res.results[0].index, index, `${char} 编号应为 ${index}`);
    assert.strictEqual(res.results[0].level, level, `${char} 级别应为 ${level}`);
    assert.deepStrictEqual(res.results[0].traditional, traditional, `${char} 繁体应为 ${traditional}`);
  }
  // 异体字抽查：同一栏内连写的多个异体字按原样保留为一组（源数据即「廼迺」）
  assert.deepStrictEqual(table.query('乃').results[0].variant, ['廼迺']);
  assert.deepStrictEqual(table.query('里').results[0].variant, ['裡']);
  // 繁体/异体反查
  assert.strictEqual(table.query('廠').results[0].char, '厂');
  assert.strictEqual(table.query('裡').results[0].char, '里');
});
