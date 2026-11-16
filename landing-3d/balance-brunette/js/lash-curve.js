// Pure lash-fibre curve math (no imports; runs in Node and the browser).
export const CURLS = {
  B: { straightFrac: 0, radiusMm: 9, sweepDeg: 45 },
  C: { straightFrac: 0, radiusMm: 7, sweepDeg: 60 },
  CC: { straightFrac: 0, radiusMm: 6, sweepDeg: 72 },
  D: { straightFrac: 0, radiusMm: 5.2, sweepDeg: 85 },
  L: { straightFrac: 0.45, radiusMm: 2, sweepDeg: 75 },
  LB: { straightFrac: 0.4, radiusMm: 3, sweepDeg: 62 },
  LC: { straightFrac: 0.35, radiusMm: 3.5, sweepDeg: 72 },
  'L SOFT': { straightFrac: 0.45, radiusMm: 3.5, sweepDeg: 58 },
  M: { straightFrac: 0.3, radiusMm: 2.5, sweepDeg: 80 },
};

export const THICKNESSES = ['0.05', '0.07', '0.1'];
export const TRAY_LENGTHS = [6, 6, 7, 7, 8, 8, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11, 12, 12, 13];

// Point at arc-length s along the fibre: straight run, circular arc, straight remainder.
function pointAt(s, L, c) {
  const s0 = c.straightFrac * L;
  const sweep = (c.sweepDeg * Math.PI) / 180;
  const arcLen = c.radiusMm * sweep;
  if (s <= s0) return [s, 0];
  const R = c.radiusMm;
  const a = Math.min(s - s0, arcLen) / R;
  let f = s0 + R * Math.sin(a);
  let u = R * (1 - Math.cos(a));
  const rest = s - s0 - arcLen;
  if (rest > 0) {
    f += rest * Math.cos(sweep);
    u += rest * Math.sin(sweep);
  }
  return [f, u];
}

export function lashCurve(curlKey, lengthMm, segments = 24) {
  const c = CURLS[curlKey];
  if (!c) throw new Error('Unknown curl ' + curlKey);
  const pts = [];
  for (let i = 0; i <= segments; i++) pts.push(pointAt((i / segments) * lengthMm, lengthMm, c));
  return pts;
}

export function fiberRadius(u, baseRadiusMm) {
  if (u <= 2 / 3) return baseRadiusMm;
  const t = Math.min(1, (u - 2 / 3) / (1 / 3));
  const s = t * t * (3 - 2 * t);
  return baseRadiusMm * (1 - s * (1 - 0.06));
}
