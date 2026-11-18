// Pure data + math for the scroll story. No imports.
export const CHAPTERS = [
  { id: 'hero', cam: { pos: [13, 22, 26], target: [0, 0, 0], fov: 30 }, camMobile: { pos: [19, 32, 38], target: [0, 0, 0], fov: 30 },
    lid: 0, yaw: 0, highlight: null, callout: null },
  { id: 'case', cam: { pos: [-8.6, 26, 24], target: [-4.6, 0.5, 0], fov: 34 }, camMobile: { pos: [-9.6, 49, 45.6], target: [-2, 0.5, 0], fov: 32 },
    lid: 1, yaw: 0, highlight: null, callout: 'hinge' },
  { id: 'tray', cam: { pos: [-3.8, 46, 1], target: [-3.8, 0, 0], fov: 28 }, camMobile: { pos: [-3.8, 69, 1], target: [-3.8, 0, 0], fov: 30 },
    lid: 1, yaw: 0, highlight: null, callout: 'wordmark' },
  // Round 5 ruling: extreme macros read as CG, tray/tape distance reads as a photo. No camera gets closer to the
  // lashes than the tape chapter (~12.9 cm from its anchor); color / taper / tips use the tray look and differ by
  // angle (3/4 oblique from above; from the base side down the rows: short rows far, long rows near; low oblique across the curled ends).
  { id: 'color', cam: { pos: [6.5, 10.5, 10.5], target: [0.1, 0.3, 1.3], fov: 30 }, camMobile: { pos: [6.5, 10.5, 10.5], target: [0.1, 0.3, 1.3], fov: 40 },
    lid: 1, yaw: 0, highlight: 10, callout: 'row:10:tip:x0', curtain: true, press: 1, dof: { aperture: 0.0015, maxblur: 0.007 } },
  { id: 'taper', cam: { pos: [-4, 11, 12], target: [0.1, 0.3, -1.5], fov: 26 }, camMobile: { pos: [-4, 11, 12], target: [0.1, 0.3, -1.5], fov: 40 },
    lid: 1, yaw: 0, highlight: 0, callout: 'row:0:taper', curtain: true, press: 1, dof: { aperture: 0.0012, maxblur: 0.006 } },
  { id: 'tips', cam: { pos: [6, 5.5, -11.4], target: [0, 0.4, -0.5], fov: 26 }, camMobile: { pos: [6, 5.5, -11.4], target: [0, 0.4, -0.5], fov: 38 },
    lid: 1, yaw: 0, highlight: 8, callout: 'row:8:tip:x0', curtain: true, press: 1, dof: { aperture: 0.0012, maxblur: 0.006 } },
  { id: 'tape', cam: { pos: [-2.2, 10.5, 13.5], target: [-0.6, 0.1, 5.4], fov: 32 }, camMobile: { pos: [-2.2, 12.5, 15.5], target: [-0.4, 0.1, 5.4], fov: 48 },
    lid: 1, yaw: 0, highlight: 19, callout: 'tape:19', curtain: true, press: 1, dof: { aperture: 0.0012, maxblur: 0.006 } },
  { id: 'labels', cam: { pos: [0, 11.5, -1.5], target: [0, 0, -4.4], fov: 40 }, camMobile: { pos: [0, 15, -1.5], target: [0, 0, -4.4], fov: 62 },
    lid: 1, yaw: 0, highlight: null, callout: 'logo', curtain: true },
  { id: 'configure', cam: { pos: [-0.4, 24, 24.7], target: [5.8, 0, 2.7], fov: 32 }, camMobile: { pos: [-18, 52, 48], target: [-3.8, 0, 0], fov: 32 },
    lid: 1, yaw: 0, highlight: null, callout: null },
];

const HOLD = 0.4;
const smooth = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;
const mixArr = (a, b, t) => a.map((v, i) => mix(v, b[i], t));
const camOf = (c, mobile) => (mobile && c.camMobile ? c.camMobile : c.cam);

export function sampleStory(chapters, p, { mobile = false } = {}) {
  const N = chapters.length;
  const pc = Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0));
  let index = Math.min(N - 1, Math.floor(pc * N));
  let local = pc * N - index;
  if (pc === 1) { index = N - 1; local = 1; }
  const a = chapters[index];
  const b = chapters[Math.min(N - 1, index + 1)];
  const t = index === N - 1 ? 0 : Math.max(0, (local - HOLD) / (1 - HOLD));
  const s = smooth(t);
  const ca = camOf(a, mobile), cb = camOf(b, mobile);
  const cam = t === 0
    ? { pos: [...ca.pos], target: [...ca.target], fov: ca.fov }
    : { pos: mixArr(ca.pos, cb.pos, s), target: mixArr(ca.target, cb.target, s), fov: mix(ca.fov, cb.fov, s) };
  const src = t >= 0.5 ? b : a;
  return {
    cam,
    lid: t === 0 ? a.lid : mix(a.lid, b.lid, s),
    yaw: t === 0 ? a.yaw : mix(a.yaw, b.yaw, s),
    press: mix(a.press != null ? a.press : 0.3, b.press != null ? b.press : 0.3, s),
    dof: {
      aperture: mix(a.dof ? a.dof.aperture : 0, b.dof ? b.dof.aperture : 0, s),
      maxblur: mix(a.dof ? a.dof.maxblur : 0, b.dof ? b.dof.maxblur : 0, s),
    },
    highlight: src.highlight,
    bare: !!src.bare,
    bareMix: t === 0 ? (a.bare ? 1 : 0) : mix(a.bare ? 1 : 0, b.bare ? 1 : 0, s),
    callout: src.callout,
    active: src.id,
    curtain: t === 0 ? (a.curtain ? 1 : 0) : mix(a.curtain ? 1 : 0, b.curtain ? 1 : 0, s),
    index,
    local,
    blend: s,
  };
}
