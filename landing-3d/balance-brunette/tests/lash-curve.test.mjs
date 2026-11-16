import test from 'node:test';
import assert from 'node:assert/strict';
import { CURLS, THICKNESSES, TRAY_LENGTHS, lashCurve, fiberRadius } from '../js/lash-curve.js';

const arcLen = (p) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);

test('curl keys and constants', () => {
  assert.deepEqual(Object.keys(CURLS).sort(), ['B', 'C', 'CC', 'D', 'L', 'LB', 'LC', 'L SOFT', 'M'].sort());
  assert.deepEqual(THICKNESSES, ['0.05', '0.07', '0.1']);
  assert.equal(TRAY_LENGTHS.length, 20);
});

for (const key of Object.keys(CURLS)) {
  for (const L of [6, 10, 13]) {
    test(`curve ${key} @ ${L}mm`, () => {
      const p = lashCurve(key, L);
      assert.deepEqual(p[0], [0, 0]);
      assert.ok(Math.abs(arcLen(p) - L) / L < 0.01, `arc length ${arcLen(p)}`);
      for (let i = 0; i < p.length; i++) {
        assert.ok(p[i][1] >= -1e-6);
        if (i) assert.ok(p[i][1] >= p[i - 1][1] - 1e-9);
      }
    });
  }
}

test('D curls higher than B; L straight start', () => {
  const end = (k) => lashCurve(k, 10).at(-1)[1];
  assert.ok(end('D') > end('B'));
  const p = lashCurve('L', 10);
  for (const [f, u] of p) if (f <= 0.4 * 10) assert.equal(u, 0);
});

test('fiberRadius taper', () => {
  assert.equal(fiberRadius(0.5, 0.035), 0.035);
  assert.ok(Math.abs(fiberRadius(1, 0.035) - 0.0021) < 1e-9);
  let prev = fiberRadius(2 / 3, 0.035);
  for (let u = 0.7; u <= 1.0001; u += 0.05) {
    const r = fiberRadius(Math.min(u, 1), 0.035);
    assert.ok(r < prev);
    prev = r;
  }
});
