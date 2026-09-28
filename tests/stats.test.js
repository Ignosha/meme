// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/stats.js');

const close = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) < tol, `${a} !~ ${b}`);

test('chi-square p-values match reference tables', () => {
  close(S.chiSquareP(3.841, 1), 0.05);
  close(S.chiSquareP(11.070, 5), 0.05);
  close(S.chiSquareP(88.25, 68), 0.05, 2e-3);
  close(S.chiSquareP(37.652, 25), 0.05);
});

test('normal CDF', () => {
  close(S.normalCdf(0), 0.5, 1e-6);
  close(S.normalCdf(1.96), 0.975, 1e-4);
  close(S.twoSidedP(1.96), 0.05, 1e-3);
});

test('jackpot odds are 1 in 292,201,338', () => {
  assert.equal(S.jackpotOdds(), 292201338);
});

test('hypergeometric sums to 1 and has the right mean', () => {
  let total = 0, m = 0;
  for (let k = 0; k <= 5; k++) { const p = S.hypergeom(69, 5, 5, k); total += p; m += k * p; }
  close(total, 1, 1e-9);
  close(m, 25 / 69, 1e-9);
});

test('exact sum distribution: total 1, mean 175', () => {
  const d = S.sumDistribution(69, 5);
  close(d.reduce((a, b) => a + b, 0), 1, 1e-9);
  close(d.reduce((a, p, s) => a + p * s, 0), 175, 1e-6);
  assert.equal(d[14], 0);
  close(d[15], 1 / S.choose(69, 5), 1e-15);
});

test('parseRows validates and sorts real-format rows', () => {
  const rows = [
    { draw_date: '2016-01-13T00:00:00.000', winning_numbers: '04 08 19 27 34 10', multiplier: '2' },
    { draw_date: '2015-10-07T00:00:00.000', winning_numbers: '18 30 40 48 52 09' },
    { draw_date: '2016-01-16T00:00:00.000', winning_numbers: '04 08 19 27 70 10' }, // invalid white
    { draw_date: '2016-01-18T00:00:00.000', winning_numbers: '04 08 19 27 34 27' }, // invalid pb
  ];
  const d = S.parseRows(rows);
  assert.equal(d.length, 2);
  assert.equal(d[0].date, '2015-10-07');
  assert.deepEqual(d[1].white, [4, 8, 19, 27, 34]);
  assert.equal(d[1].pb, 10);
});

test('predict never looks at the future and returns valid tickets', () => {
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push({ date: `2020-01-${String(i + 1).padStart(2, '0')}`, white: [1 + i, 20 + i, 30 + i, 40 + i, 50 + i].sort((a, b) => a - b), pb: (i % 26) + 1 });
  for (const k of Object.keys(S.STRATEGIES)) {
    const p = S.predict(rows, k);
    assert.equal(p.white.length, 5);
    assert.equal(new Set(p.white).size, 5);
    assert.ok(p.pb >= 1 && p.pb <= 26);
  }
  assert.deepEqual(S.predict(rows, 'repeat').white, rows[11].white);
});

test('next draw date lands on Mon/Wed/Sat Eastern', () => {
  // Monday 2026-09-28, 10:00 ET -> today
  assert.deepEqual(S.nextDrawDate(new Date('2026-09-28T14:00:00Z')), { iso: '2026-09-28', weekday: 'Mon', isToday: true });
  // Monday 23:30 ET -> Wednesday
  assert.equal(S.nextDrawDate(new Date('2026-09-29T03:30:00Z')).iso, '2026-09-30');
  // Thursday -> Saturday
  assert.equal(S.nextDrawDate(new Date('2026-10-01T15:00:00Z')).iso, '2026-10-03');
});

test('ticket generators produce valid tickets', () => {
  const crypto = require('node:crypto');
  const r = (k) => crypto.randomInt(k);
  for (let i = 0; i < 500; i++) {
    for (const t of [S.randomTicket(r), S.lessPopularTicket(r)]) {
      assert.equal(new Set(t.white).size, 5);
      assert.ok(t.white.every((x) => x >= 1 && x <= 69));
      assert.ok(t.pb >= 1 && t.pb <= 26);
    }
  }
});
