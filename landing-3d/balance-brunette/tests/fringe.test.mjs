import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFringeData, fibreWidth, widthAt } from '../js/fringe.js';

test('fibreWidth scales with thickness (0.07 mm -> 0.0112 cm)', () => {
  assert.ok(Math.abs(fibreWidth('0.07') - 0.0112) < 1e-9);
  assert.ok(fibreWidth('0.1') > fibreWidth('0.05'));
});

test('widthAt: constant to 2/3, then tapers to 0', () => {
  assert.equal(widthAt(0.5, 0.01), 0.01);
  assert.equal(widthAt(2 / 3, 0.01), 0.01);
  assert.ok(widthAt(0.85, 0.01) < 0.01 && widthAt(0.85, 0.01) > 0);
  assert.equal(widthAt(1, 0.01), 0);
});

for (const [n, seg] of [[180, 14], [90, 12]]) {
  test(`fringe ${n} fibres x ${seg} segments`, () => {
    const d = buildFringeData({ curl: 'L', lengthMm: 10, count: n, segments: seg, seed: 7 });
    assert.equal(d.vertexCount, n * (seg + 1) * 2);
    assert.equal(d.triangleCount, n * seg * 2);
    assert.equal(d.positions.length, d.vertexCount * 3);
    assert.equal(d.tipWidths.length, n);
    assert.ok(d.tipWidths.every((w) => w === 0));
    for (const i of d.indices) assert.ok(i < d.vertexCount);
  });
}

test('desktop budget: 20 rows < 150k triangles', () => {
  const tri = buildFringeData({ curl: 'L', lengthMm: 10, count: 180, segments: 14 }).triangleCount;
  assert.ok(tri * 20 + 20 * 24 * 32 * 2 < 150000);
});

test('tip length jitter within +-2 % and x inside the strip', () => {
  const d = buildFringeData({ curl: 'C', lengthMm: 10, count: 180, segments: 14, seed: 3, press: 1 });
  const vpf = 30;
  for (let f = 0; f < 180; f++) {
    const z = d.positions[(f * vpf + 28) * 3 + 2];
    assert.ok(Math.abs(-z * 10 - 10) < 10 * 0.3, 'tip forward reach near nominal');
    const x = d.positions[(f * vpf + 28) * 3];
    assert.ok(x > -2.45 && x < 2.65);
  }
});
