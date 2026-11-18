// Pure fringe maths (no three.js, runs in Node and the browser).
// Each tray row gets a bundle of real, individually tapered fibre strips for the tip region.
import { lashCurve } from './lash-curve.js';

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Low-frequency irregularity shared by the body ribbon and the fibres (so they stay on one surface).
export function ribbonWarp(seed) {
  const rand = rng(seed);
  const p1 = rand() * 6.28, p2 = rand() * 6.28, p3 = rand() * 6.28;
  return {
    heightK: (u, v) => 1 + (0.012 * Math.sin(u * 9.4 + p1) + 0.006 * Math.sin(u * 23 + p2)) * v * v,
    lengthK: (u, v) => 1 + 0.01 * Math.sin(u * 15 + p3) * v,
  };
}

// Round 4: the body is one opaque silky sheet (ribbon, alpha 1 to v .85); real strands only in the last ~12 %.
export const FRINGE_V0 = 0.88; // fibres start here (v = fraction of lash length)
export const TAPER_START = 2 / 3; // default: taper begins at 2/3 of the fibre's own length
export const widthAt = (t, w0, start = TAPER_START) => {
  if (t <= start) return w0;
  const k = Math.min(1, (t - start) / (1 - start));
  return w0 * (1 - k * k * (3 - 2 * k));
};
// Ambient occlusion along the fibre: dark at the tape (the fibres are packed and shadow each other there),
// full brightness from about the middle of the lash. Shared by the ribbon and the fringe vertex colours.
export const aoAt = (v) => {
  const k = Math.min(1, Math.max(0, v / 0.75));
  return 0.32 + 0.68 * k * k * (3 - 2 * k);
};
export const fibreWidth = (thickness) => (parseFloat(thickness) / 10) * 1.6; // cm: diameter x 1.6

// Curve sample at v (fraction of length), linearly interpolated; v > 1 extrapolates along the last tangent.
function sampleAt(pts, v) {
  const n = pts.length - 1;
  const f = Math.max(0, v) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const a = pts[i], b = pts[i + 1];
  const t = f - i; // may exceed 1 past the end: linear extension
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Builds the tip fringe of one row.
 * Returns typed arrays plus the tip widths. Per fibre: (segments + 1) * 2 vertices, segments * 2 triangles.
 */
export function buildFringeData({
  curl, lengthMm, count, segments = 6, press = 1, thickness = '0.07', seed = 0,
  x0 = -2.4, x1 = 2.6, warpSeed = seed, v0 = FRINGE_V0, taperStart = 0.45, width = 0,
}) {
  const pts = lashCurve(curl, lengthMm, 200);
  const warp = ribbonWarp(warpSeed);
  const rand = rng(seed ^ 0x9e3779b9);
  const W = x1 - x0;
  // Diameter x 1.2, but at least 1.5 x the pitch so neighbouring strands overlap into a sheet until the taper.
  const w0 = width || Math.max(fibreWidth(thickness) * 0.75, (1.5 * W) / count);
  const vpf = (segments + 1) * 2;
  const pos = new Float32Array(count * vpf * 3);
  const uv = new Float32Array(count * vpf * 2);
  const idx = new Uint32Array(count * segments * 6);
  const tipWidths = new Float32Array(count);
  let vi = 0, ii = 0;
  for (let f = 0; f < count; f++) {
    const xc = x0 + ((f + 0.5 + (rand() - 0.5) * 0.6) / count) * W; // +-0.3 spacing jitter
    // +-2 % tip length, bell-shaped (mean of three uniforms): most tips are even, a few stray hairs stand out
    const vEnd = 1 + ((rand() + rand() + rand()) / 3 - 0.5) * 0.04;
    const sway = (rand() - 0.5) * 0.02; // <= 0.01 cm
    const u = (xc - x0) / W;
    const base = vi;
    for (let k = 0; k <= segments; k++) {
      const t = k / segments;
      const v = v0 + (vEnd - v0) * t;
      const [fw, up] = sampleAt(pts, v);
      const vw = Math.min(1, v);
      const y = (up / 10) * warp.heightK(u, vw) * press + 0.002;
      const z = (-fw / 10) * warp.lengthK(u, vw);
      const hw = widthAt(t, w0, taperStart) / 2;
      const cx = xc + sway * t * t;
      for (const side of [-1, 1]) {
        pos[vi * 3] = cx + side * hw;
        pos[vi * 3 + 1] = y;
        pos[vi * 3 + 2] = z;
        uv[vi * 2] = (cx + side * hw - x0) / W; // same u as the ribbon: the fibre gets the ribbon's normal/aniso frame
        uv[vi * 2 + 1] = Math.min(1, v);
        vi++;
      }
      if (k === segments) tipWidths[f] = widthAt(t, w0, taperStart);
    }
    for (let k = 0; k < segments; k++) {
      const a = base + k * 2, b = a + 1, c = a + 2, d = a + 3;
      idx[ii++] = a; idx[ii++] = b; idx[ii++] = c;
      idx[ii++] = b; idx[ii++] = d; idx[ii++] = c;
    }
  }
  return { positions: pos, uvs: uv, indices: idx, vertexCount: vi, triangleCount: ii / 3, tipWidths, fibreCount: count };
}
