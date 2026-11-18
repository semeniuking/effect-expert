import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFringeData, fibreWidth, widthAt, aoAt, FRINGE_V0 } from '../js/fringe.js';

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

for (const [n, seg] of [[900, 6], [360, 5], [180, 14]]) {
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

test('desktop budget: 20 ribbons + the active row strands < 150k triangles, >= 300 strands', () => {
  const d = buildFringeData({ curl: 'L', lengthMm: 13, count: 900, segments: 6 });
  assert.ok(d.fibreCount >= 300);
  assert.ok(d.triangleCount + 20 * 24 * 32 * 2 < 150000);
});

test('strands cover only the last ~12 % of the lash and end in a point', () => {
  assert.ok(FRINGE_V0 >= 0.85 && FRINGE_V0 <= 0.9);
  const d = buildFringeData({ curl: 'L', lengthMm: 13, count: 900, segments: 6, seed: 5 });
  for (let i = 0; i < d.vertexCount; i++) assert.ok(d.uvs[i * 2 + 1] >= FRINGE_V0 - 1e-6);
  assert.ok(d.tipWidths.every((w) => w === 0));
});

test('aoAt: dark at the tape, full brightness by the curl', () => {
  assert.ok(aoAt(0) < 0.4);
  assert.equal(aoAt(0.8), 1);
  for (let v = 0; v < 1; v += 0.05) assert.ok(aoAt(v + 0.05) >= aoAt(v));
});

test('tip length jitter within +-2 % and x inside the strip', () => {
  const seg = 6, vpf = (seg + 1) * 2;
  const d = buildFringeData({ curl: 'C', lengthMm: 10, count: 900, segments: seg, seed: 3, press: 1 });
  for (let f = 0; f < 900; f++) {
    const tip = f * vpf + seg * 2;
    const vEnd = d.uvs[tip * 2 + 1];
    assert.ok(vEnd <= 1 + 1e-6 && vEnd >= 0.98 - 1e-6, 'tip v within -2 % (v is clamped at 1)');
    const z = d.positions[tip * 3 + 2];
    assert.ok(Math.abs(-z * 10 - 7) < 7 * 0.3, 'tip forward reach near nominal');
    const x = d.positions[tip * 3];
    assert.ok(x > -2.45 && x < 2.65);
  }
});
