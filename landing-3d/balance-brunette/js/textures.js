import * as THREE from 'three';

// Printed-card textures. Both cards are 7.0 x 15.8 cm drawn on a 2048 x 4096 canvas.
// Card-space coordinates used below are centimetres from the card centre: x right, z down the
// canvas (canvas top = -Z = logo end). Texture top maps to -Z on a plane rotated -90deg about X.
export const CARD_W = 7.0;
export const CARD_H = 15.8;
const CW = 2048;
const CH = 4096;
const SX = CW / CARD_W; // px per cm, horizontal
const SY = CH / CARD_H; // px per cm, vertical
const K = SX / SY; // vertical squash that makes glyphs undistorted despite the anisotropic mapping

const INK = '#111111';
const PAPER = '#fbfbfa';
const FONT = 'Jost, "Helvetica Neue", Arial, sans-serif';

const ROW_PITCH = 0.5;
const rowBaseZ = (i) => -3.6 + i * ROW_PITCH; // keep in sync with lashes.js

const px = (x) => CW / 2 + x * SX;
const pz = (z) => CH / 2 + z * SY;

export function loadFonts() {
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return Promise.resolve();
  const loads = Promise.all([
    document.fonts.load('300 40px Jost', 'BALANCE0123456789'),
    document.fonts.load('400 40px Jost', 'EFFECT EXPERT 0123456789'),
    document.fonts.load('500 40px Jost', 'HANDS CREATE'),
  ]).catch(() => {});
  const timeout = new Promise((r) => setTimeout(r, 2000));
  return Promise.race([loads, timeout]).then(() => {});
}

function newCanvas() {
  const c = document.createElement('canvas');
  c.width = CW;
  c.height = CH;
  const g = c.getContext('2d');
  g.fillStyle = PAPER;
  g.fillRect(0, 0, CW, CH);
  return [c, g];
}

function finishTexture(canvas, anisotropy, old) {
  const t = old || new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy || 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// Draw text with undistorted glyphs. cap = cap height in cm; the string is tracked so its width
// is exactly `width` cm when given (otherwise natural + `track` cm). align: 'center'|'left'|'right'.
function text(g, str, x, z, { cap = 0.3, weight = 400, width = 0, track = 0, align = 'center', color = INK } = {}) {
  const size = (cap / 0.7) * SX; // Jost cap-height is about 0.7 em
  g.save();
  g.setTransform(1, 0, 0, K, px(x), pz(z));
  g.font = `${weight} ${size}px ${FONT}`;
  g.fillStyle = color;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  const chars = [...str];
  const widths = chars.map((c) => g.measureText(c).width);
  const natural = widths.reduce((a, b) => a + b, 0);
  const n = Math.max(1, chars.length - 1);
  const gap = width ? (width * SX - natural) / n : track * SX;
  const total = natural + gap * (chars.length - 1);
  let cx = align === 'center' ? -total / 2 : align === 'right' ? -total : 0;
  const base = (cap * SX) / 2; // vertically centre the caps on z
  const out = [];
  chars.forEach((c, i) => {
    g.fillText(c, cx, base);
    out.push(cx);
    cx += widths[i] + gap;
  });
  g.restore();
  return { positions: out, widths, size, base };
}

function line(g, x0, z0, x1, z1, wCm, color = INK) {
  g.save();
  g.fillStyle = color;
  const lx = Math.min(x0, x1), rx = Math.max(x0, x1), tz = Math.min(z0, z1), bz = Math.max(z0, z1);
  const horizontal = bz - tz < 1e-6;
  if (horizontal) g.fillRect(px(lx), pz(z0) - (wCm * SY) / 2, (rx - lx) * SX, wCm * SY);
  else g.fillRect(px(x0) - (wCm * SX) / 2, pz(tz), wCm * SX, (bz - tz) * SY);
  g.restore();
}

// Boxed EFFECT / EXPERT logo, centred at (cx, cz), box width w, aspect ~2.6:1.
function drawLogo(g, cx, cz, w) {
  const h = w / 2.6;
  const lw = Math.max(0.02, w * 0.0065);
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - h / 2, z1 = cz + h / 2;
  line(g, x0, z0, x1, z0, lw); // top
  line(g, x0, z0, x0, z1, lw); // left
  line(g, x1, z0, x1, z1, lw); // right
  const gapHalf = w * 0.25; // EXPERT sits in a gap of the bottom line
  line(g, x0, z1, cx - gapHalf, z1, lw);
  line(g, cx + gapHalf, z1, x1, z1, lw);
  text(g, 'EFFECT', cx, cz - h * 0.12, { cap: w * 0.115, weight: 400, width: w * 0.76 });
  text(g, 'EXPERT', cx, z1, { cap: w * 0.062, weight: 400, width: w * 0.33 });
}

function drawWordmark(g, left, z, widthCm, cap) {
  // "BALĀNCE": macron over the 2nd A drawn by hand so we never depend on the font's latin-ext subset.
  const word = 'BALANCE';
  const r = text(g, word, left, z, { cap, weight: 300, width: widthCm, align: 'left' });
  const i = 3;
  const x = left + (r.positions[i] + r.widths[i] / 2) / SX; // centre of the 2nd A, in cm
  const barW = (r.widths[i] / SX) * 0.62;
  line(g, x - barW / 2, z - cap / 2 - cap * 0.42, x + barW / 2, z - cap / 2 - cap * 0.42, Math.max(0.014, cap * 0.07));
}

export function drawInsert(canvas, { lengths, curl = 'L', thickness = '0.07' }) {
  const g = canvas.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, CW, CH);

  drawLogo(g, -1.5, -6.2, 2.1);
  drawWordmark(g, -0.1, -6.2, 2.76, 0.33);

  const max = Math.max(...lengths);
  lengths.forEach((len, i) => {
    const z = rowBaseZ(i);
    // faint row separators on the tag column
    line(g, -3.45, z + ROW_PITCH / 2 - 0.02, -2.6, z + ROW_PITCH / 2 - 0.02, 0.008, '#d9d9d6');
    text(g, curl, -3.3, z - 0.1, { cap: 0.12, weight: 400, align: 'left' });
    text(g, thickness, -3.3, z + 0.09, { cap: 0.12, weight: 400, align: 'left' });
    text(g, String(len), 3.15, z, { cap: 0.2, weight: 400, align: 'center' });
  });

  // Tape band + printed spec twice at the bottom.
  const tz = rowBaseZ(lengths.length - 1) + 0.72;
  g.save();
  g.fillStyle = '#f0f0ed';
  g.fillRect(px(-2.4), pz(tz) - 0.15 * SY, 5.0 * SX, 0.3 * SY);
  g.restore();
  const spec = `${curl} ${thickness} ${max}MM`;
  text(g, spec, -1.1, tz, { cap: 0.11, weight: 400, track: 0.012 });
  text(g, spec, 1.5, tz, { cap: 0.11, weight: 400, track: 0.012 });
  return canvas;
}

export function makeInsertTexture({ lengths, curl = 'L', thickness = '0.07', anisotropy = 8 } = {}) {
  const [canvas] = newCanvas();
  const opts = { lengths, curl, thickness };
  drawInsert(canvas, opts);
  const t = finishTexture(canvas, anisotropy);
  t.name = 'insert-card';
  t.userData.redraw = (patch = {}) => {
    Object.assign(opts, patch);
    drawInsert(canvas, opts);
    t.needsUpdate = true;
  };
  return t;
}

function drawSwatch(g, x, z0, z1, flip) {
  const w = 1.24;
  const X = px(x - w / 2), Z = pz(z0), Wp = w * SX, Hp = (z1 - z0) * SY;
  g.save();
  g.beginPath();
  g.rect(X, Z, Wp, Hp);
  g.clip();
  const base = g.createLinearGradient(X, 0, X + Wp, 0);
  base.addColorStop(0, '#120807');
  base.addColorStop(0.5, '#1d0f0c');
  base.addColorStop(1, '#0d0605');
  g.fillStyle = base;
  g.fillRect(X, Z, Wp, Hp);
  // soft curved sheen like fibres catching light
  const cy = flip ? Z + Hp * 0.2 : Z + Hp * 0.78;
  for (let k = 0; k < 3; k++) {
    const rg = g.createRadialGradient(X + Wp * 0.85, cy + k * 40, 10, X + Wp * 0.85, cy + k * 40, Wp * (0.9 - k * 0.15));
    rg.addColorStop(0, `rgba(135,60,52,${0.5 - k * 0.12})`);
    rg.addColorStop(1, 'rgba(70,28,24,0)');
    g.fillStyle = rg;
    g.fillRect(X, Z, Wp, Hp);
  }
  // fine fibre streaks
  let s = 4242;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.lineWidth = 1.2;
  for (let i = 0; i < 260; i++) {
    const fx = X + rnd() * Wp;
    const a = 0.03 + rnd() * 0.07;
    g.strokeStyle = rnd() > 0.4 ? `rgba(150,85,70,${a})` : `rgba(0,0,0,${a * 2})`;
    g.beginPath();
    g.moveTo(fx, Z);
    g.bezierCurveTo(fx + (rnd() - 0.5) * 30, Z + Hp * 0.35, fx + (rnd() - 0.5) * 40, Z + Hp * 0.7, fx + (rnd() - 0.5) * 20, Z + Hp);
    g.stroke();
  }
  g.restore();
}

export function drawLid(canvas, portrait) {
  const g = canvas.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, CW, CH);

  const cx = 0.07;
  drawSwatch(g, cx, -CARD_H / 2, -CARD_H / 2 + CARD_H * 0.2, true);
  drawSwatch(g, cx, CARD_H / 2 - CARD_H * 0.143, CARD_H / 2, false);

  drawLogo(g, cx, -CARD_H / 2 + CARD_H * 0.309, 4.06);

  // portrait, cover-cropped to 4.06 x 3.25 cm
  const pw = 4.06, ph = 3.25, pzc = -CARD_H / 2 + CARD_H * 0.571;
  const dx = px(cx - pw / 2), dy = pz(pzc - ph / 2), dw = pw * SX, dh = ph * SY;
  if (portrait && (portrait.naturalWidth || portrait.width)) {
    const iw = portrait.naturalWidth || portrait.width, ih = portrait.naturalHeight || portrait.height;
    const phys = pw / ph;
    let sw = iw, sh = iw / phys;
    if (sh > ih) { sh = ih; sw = ih * phys; }
    const sxo = (iw - sw) / 2, syo = (ih - sh) * 0.35;
    g.drawImage(portrait, sxo, syo, sw, sh, dx, dy, dw, dh);
  } else {
    g.fillStyle = '#bbb';
    g.fillRect(dx, dy, dw, dh);
  }

  text(g, 'HANDS CREATE - WORLD ADMIRE', cx, -CARD_H / 2 + CARD_H * 0.765, { cap: 0.17, weight: 400, width: 4.06 });
  return canvas;
}

export function makeLidCardTexture(portrait, { anisotropy = 8 } = {}) {
  const [canvas] = newCanvas();
  drawLid(canvas, portrait);
  const t = finishTexture(canvas, anisotropy);
  t.name = 'lid-card';
  t.userData.redraw = () => { drawLid(canvas, portrait); t.needsUpdate = true; };
  return t;
}

// Layout points other modules (anchors) may need, in card space (cm from card centre).
export const LAYOUT = {
  insertLogo: { x: -1.5, z: -6.2 },
  insertWordmark: { x: 1.28, z: -6.2 },
  lidCenter: { x: 0, z: 0 },
};
