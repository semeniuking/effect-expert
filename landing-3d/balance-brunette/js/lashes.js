import * as THREE from 'three';
import { CURLS, THICKNESSES, TRAY_LENGTHS, lashCurve } from './lash-curve.js';
import { rng, ribbonWarp, buildFringeData, aoAt, fibreWidth } from './fringe.js';

// Hybrid lash row: one opaque silky ribbon for the body (alpha 1 to v .85, then a soft per-fibre fade to the
// tip) plus, on the ACTIVE row only, a dense bundle of real tapered strands for the last ~12 % (fringe.js).
const NX = 24;
const NY = 32;
const ROW_PITCH = 0.5; // cm
const STRIP_X0 = -2.4;
const STRIP_X1 = 2.6;
const TAPE_W = 0.25; // along Z
const TAPE_T = 0.06; // along Y
const ROW_LIFT = 0.008; // each row sits slightly above the previous so rows layer
const ENV_INTENSITY = 0.4; // fibres are matte silk: take a measured share of the studio env
const BASE_COLOR = '#38221b';
// three.js roughens the specular lobe ALONG the anisotropy direction (alphaT, KHR_materials_anisotropy). A hair's
// microfacet normals spread around its circumference, i.e. across the fibre, so the direction is u (rotation 0) and
// the highlight stretches into a satin band ACROSS the fibres. (pi/2 = along the fibre tangent smears it along them.)
const ANISO_ROT = 0;
let TRAY_PRESS = 0.3; // fibres lie pressed under the lid; 1 = natural curl (animated by Task 4 via setPress)
const THICK = {
  '0.05': { fibres: 512, normal: 0.11 },
  '0.07': { fibres: 400, normal: 0.15 },
  '0.1': { fibres: 288, normal: 0.2 },
};

export const rowBaseZ = (i) => -3.6 + i * ROW_PITCH;

// Generates normal / roughness / alpha maps once (tileable in u). v = 1 is the canvas top (tip).
export function createFibreTextures(size = 1024, renderer = null) {
  const COLS = size >= 1024 ? 512 : 256; // fibre columns per tile: >= 2 px per fibre
  const rand = rng(424242);
  // Column boundaries with random width jitter, normalised to the tile.
  const w = Array.from({ length: COLS }, () => 0.8 + rand() * 0.4);
  const sum = w.reduce((a, b) => a + b, 0);
  const edges = [0];
  for (const x of w) edges.push(edges[edges.length - 1] + (x / sum) * size);
  // Per-fibre lightness +-1.5 % (more reads as wood grain) and a hair of warm/cool drift.
  const light = Array.from({ length: COLS }, () => 1 + (rand() - 0.5) * 0.03);
  const warm = Array.from({ length: COLS }, () => (rand() - 0.5) * 0.006);
  const rough = Array.from({ length: COLS }, () => 0.94 + rand() * 0.06);
  const cDepth = Array.from({ length: COLS }, () => 0.85 + rand() * 0.3);

  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  };
  const cn = mk(), cr = mk(), cc = mk(), ct = mk();
  const dt = ct.getContext('2d').createImageData(size, size);
  const dn = cn.getContext('2d').createImageData(size, size);
  const dr = cr.getContext('2d').createImageData(size, size);
  const dc = cc.getContext('2d').createImageData(size, size);

  let col = 0;
  for (let x = 0; x < size; x++) {
    while (x + 0.5 > edges[col + 1] && col < COLS - 1) col++;
    const t = ((x + 0.5 - edges[col]) / (edges[col + 1] - edges[col])) * 2 - 1; // -1..1
    const tt = Math.max(-0.97, Math.min(0.97, t));
    const nx = (tt / Math.sqrt(1 - tt * tt)) * 0.55 * cDepth[col];
    const nl = Math.hypot(nx, 1);
    const r = Math.round((nx / nl * 0.5 + 0.5) * 255);
    const b = Math.round((1 / nl * 0.5 + 0.5) * 255);
    for (let y = 0; y < size; y++) {
      const v = 1 - (y + 0.5) / size;
      const i = (y * size + x) * 4;
      dn.data[i] = r; dn.data[i + 1] = 128; dn.data[i + 2] = b; dn.data[i + 3] = 255;
      const rv = Math.round(255 * (rough[col] - 0.05 * Math.abs(t)));
      dr.data[i] = dr.data[i + 1] = dr.data[i + 2] = rv; dr.data[i + 3] = 255;
      // Tray/tape views (round 3 look, kept): opaque to v .55, smooth fade to 0 at .8 under the 180-strand fringe.
      const kt = Math.min(1, Math.max(0, (v - 0.55) / 0.25));
      const at = Math.round(255 * (1 - kt * kt * (3 - 2 * kt)));
      dt.data[i] = dt.data[i + 1] = dt.data[i + 2] = at; dt.data[i + 3] = 255;
      // colour map: mean ~0.94 so the material colour stays the reference; contrast <= +-1.5 %.
      const m = 0.94 * light[col] * (1 - 0.006 * t * t);
      dc.data[i] = Math.min(255, Math.round(255 * m * (1 + warm[col])));
      dc.data[i + 1] = Math.min(255, Math.round(255 * m));
      dc.data[i + 2] = Math.min(255, Math.round(255 * m * (1 - warm[col])));
      dc.data[i + 3] = 255;
    }
  }
  cn.getContext('2d').putImageData(dn, 0, 0);
  cr.getContext('2d').putImageData(dr, 0, 0);
  ct.getContext('2d').putImageData(dt, 0, 0);
  cc.getContext('2d').putImageData(dc, 0, 0);

  // Macro alpha (wide and short: 2x the columns, ~fibre-sized, so the tip edge reads as hair, not comb teeth).
  // Body is fully opaque (one continuous sheet); each fibre column narrows to a point over the last 4 % of the
  // lash and ends at its own length (within 1.5 %: the tips are even by spec). Cut at alphaTest .5: crisp,
  // antialiased hair ends, no dithered grey steps. On the active row real strands (fringe.js) cover the last 12 %.
  const AW = size * 2, AH = size / 2, ACOLS = AW / 2;
  const arand = rng(777);
  const aw = Array.from({ length: ACOLS }, () => 0.8 + arand() * 0.4);
  const asum = aw.reduce((a, b) => a + b, 0);
  const aedges = [0];
  for (const x of aw) aedges.push(aedges[aedges.length - 1] + (x / asum) * AW);
  const end = Array.from({ length: ACOLS }, () => 0.985 + arand() * 0.015);
  const ca = document.createElement('canvas');
  ca.width = AW; ca.height = AH;
  const da = ca.getContext('2d').createImageData(AW, AH);
  for (let x = 0, col = 0; x < AW; x++) {
    while (x + 0.5 > aedges[col + 1] && col < ACOLS - 1) col++;
    const t = ((x + 0.5 - aedges[col]) / (aedges[col + 1] - aedges[col])) * 2 - 1;
    for (let y = 0; y < AH; y++) {
      const v = 1 - (y + 0.5) / AH;
      const k = Math.min(1, Math.max(0, (v - (end[col] - 0.04)) / 0.04));
      // body texels are exactly 1 (a sub-1 column edge shows as see-through lines where a column is ~2 px wide)
      const a = Math.round(255 * Math.min(1, Math.max(0, (1 - k - Math.abs(t)) * 4 + 1)));
      const i = (y * AW + x) * 4;
      da.data[i] = da.data[i + 1] = da.data[i + 2] = a; da.data[i + 3] = 255;
    }
  }
  ca.getContext('2d').putImageData(da, 0, 0);

  const aniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
  const tex = (c, srgb = false) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = aniso;
    return t;
  };
  return { cols: COLS, alphaCols: ACOLS, normalMap: tex(cn), roughnessMap: tex(cr), alphaMap: tex(ca), alphaMapTray: tex(ct), colorMap: tex(cc, true) };
}

// Ribbon along the fibre curve. Local frame: origin at base centre-left, forward = -Z, up = +Y (cm).
export function buildRibbonGeometry(curlKey, lengthMm, seed = 0, press = TRAY_PRESS) {
  const pts = lashCurve(curlKey, lengthMm, NY);
  const warp = ribbonWarp(seed);
  const pos = new Float32Array((NX + 1) * (NY + 1) * 3);
  const uv = new Float32Array((NX + 1) * (NY + 1) * 2);
  const col = new Float32Array((NX + 1) * (NY + 1) * 3);
  const W = STRIP_X1 - STRIP_X0;
  for (let j = 0; j <= NY; j++) {
    const v = j / NY;
    for (let i = 0; i <= NX; i++) {
      const u = i / NX;
      const n = j * (NX + 1) + i;
      pos[n * 3] = STRIP_X0 + u * W;
      pos[n * 3 + 1] = (pts[j][1] / 10) * warp.heightK(u, v) * press;
      pos[n * 3 + 2] = (-pts[j][0] / 10) * warp.lengthK(u, v);
      uv[n * 2] = u;
      uv[n * 2 + 1] = v;
      col[n * 3] = col[n * 3 + 1] = col[n * 3 + 2] = aoAt(v);
    }
  }
  const idx = [];
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
      idx.push(a, b, c, b, d, c); // normal faces +Y for a flat ribbon
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function createLashTray({ curl = 'L', thickness = '0.07', perStrip = 260, lengths = TRAY_LENGTHS, renderer = null } = {}) {
  if (!CURLS[curl]) throw new Error('Unknown curl ' + curl);
  if (!THICK[thickness]) throw new Error('Unknown thickness ' + thickness);
  const group = new THREE.Group();
  group.name = 'lash-tray';

  // perStrip is only a quality hint now: low counts (mobile) get a 512 px texture.
  const textures = createFibreTextures(perStrip <= 150 ? 512 : 1024, renderer);
  const tapeMat = new THREE.MeshStandardMaterial({ color: '#f3e9b5', roughness: 0.7 });
  // Tapes of rows 0..18 sit under the next row's fibres: shade them (cheap occlusion) so the sparse tip taper
  // of the row above never shows cream gaps. Only the last row's tape is exposed and keeps the real colour.
  const tapeMatShaded = new THREE.MeshStandardMaterial({ color: '#3b2a22', roughness: 0.8 });
  const tapeGeo = new THREE.BoxGeometry(STRIP_X1 - STRIP_X0, TAPE_T, TAPE_W);
  const baseCol = new THREE.Color(BASE_COLOR);

  let press = TRAY_PRESS;
  let curCurl = curl, curThickness = thickness, highlight = null;
  const stripCx = (STRIP_X0 + STRIP_X1) / 2;
  const rows = [], tapes = [], mats = [], fringeMats = [];
  // NOTE (round 5): the 'macro' look is kept but UNUSED. Extreme macros read as CG, so no chapter sets `bare` any more
  // and every chapter uses 'tray'. Do not delete: it is the fallback if a close-up is ever wanted again.
  // Two looks, switched on chapter change (never per frame):
  // - 'tray' (tray / tape / overview, round 3 look): ribbon fades out v .55-.8 under a 180-strand fringe on every row.
  // - 'macro' (curl-profile chapters): ribbon is one opaque sheet with even, tapered per-fibre ends (alpha), and only
  //   the ACTIVE row gets real strands: 900, dense like a real strip, in the last 12 % of the length.
  const low = perStrip <= 150;
  const MODES = {
    tray: { count: low ? 90 : 180, segments: low ? 12 : 14, v0: 0.45, taperStart: 2 / 3, wide: 0.9 },
    macro: { count: low ? 360 : 900, segments: low ? 5 : 6, v0: 0.88, taperStart: 0.45, wide: 0 },
  };
  let mode = 'tray';
  let fringeRow = null;
  const emptyGeo = () => new THREE.BufferGeometry();
  const fringeOf = (row) => {
    const m = MODES[mode];
    const W = STRIP_X1 - STRIP_X0;
    return buildFringeData({
      curl: curCurl, lengthMm: row.lengthMm, count: m.count, segments: m.segments, press,
      thickness: curThickness, seed: 500 + row.index * 17, warpSeed: 100 + row.index * 31,
      x0: STRIP_X0, x1: STRIP_X1, v0: m.v0, taperStart: m.taperStart,
      // tray: fibre body >= 90 % of the pitch so tape/card never flash through the body fade (round 3)
      width: m.wide ? Math.max(fibreWidth(curThickness), (m.wide * W) / m.count) : 0,
    });
  };
  const fringeGeo = (row) => {
    const d = fringeOf(row);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2));
    const c = new Float32Array(d.vertexCount * 3);
    for (let i = 0; i < d.vertexCount; i++) c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = aoAt(d.uvs[i * 2 + 1]);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setIndex(new THREE.BufferAttribute(d.indices, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  };

  function applyThickness() {
    const th = THICK[curThickness];
    for (const t of Object.values(textures)) if (t.repeat) t.repeat.set(th.fibres / textures.cols, 1);
    textures.alphaMap.repeat.set((th.fibres * 2.25) / textures.alphaCols, 1); // ~900 hair ends across the strip
    for (const m of mats) m.normalScale.set(th.normal, th.normal);
  }

  lengths.forEach((lengthMm, i) => {
    const lift = i * ROW_LIFT;
    const baseZ = rowBaseZ(i);
    const y0 = TAPE_T + lift + 0.004;

    const tape = new THREE.Mesh(tapeGeo, i === lengths.length - 1 ? tapeMat : tapeMatShaded);
    tape.position.set(stripCx, TAPE_T / 2 + lift, baseZ);
    tape.name = `tape-${i}`;
    group.add(tape);
    tapes.push(tape);

    // Matte silk, not vinyl: no clearcoat, a soft anisotropic band across the fibres, warm sheen.
    const mat = new THREE.MeshPhysicalMaterial({
      color: BASE_COLOR,
      map: textures.colorMap,
      roughness: 0.55,
      specularIntensity: 0.42,
      sheen: 0.4,
      sheenRoughness: 0.4,
      sheenColor: new THREE.Color('#6a564e'),
      anisotropy: 0.8,
      anisotropyRotation: ANISO_ROT,
      normalMap: textures.normalMap,
      roughnessMap: textures.roughnessMap,
      alphaMap: textures.alphaMapTray,
      envMapIntensity: ENV_INTENSITY,
      vertexColors: true, // AO toward the tape
      side: THREE.DoubleSide,
      alphaTest: 0, // macro mode: .5 (crisp, antialiased per-fibre ends; a soft ramp dithers into grey steps)
      alphaToCoverage: true,
      transparent: false,
    });
    mats.push(mat);
    // Fibre fringe: same silk, but no alpha map (the geometry itself is the fibre shape).
    const fmat = mat.clone();
    fmat.alphaMap = null;
    // fibre u spans its own width (fringe.js), so the normal map rounds each hair and the anisotropic band
    // continues from the ribbon onto the strands.
    fmat.alphaTest = 0;
    fmat.alphaToCoverage = false;
    fmat.polygonOffset = true;
    fmat.polygonOffsetFactor = -1;
    fmat.polygonOffsetUnits = -1;
    fringeMats.push(fmat);

    const mesh = new THREE.Mesh(buildRibbonGeometry(curCurl, lengthMm, 100 + i * 31, press), mat);
    mesh.position.set(0, y0, baseZ);
    mesh.name = `row-${i}`;
    // material.envMapIntensity is ignored for scene.environment, so bind it on first render.
    mesh.onBeforeRender = (_r, scene) => {
      const env = scene.userData.lashEnv || scene.environment;
      if (!mat.envMap && env) {
        mat.envMap = env;
        mat.needsUpdate = true;
      }
    };
    group.add(mesh);
    const row = { index: i, lengthMm, mesh, baseZ, fringe: null, materials: [mat, fmat] };
    const fringe = new THREE.Mesh(emptyGeo(), fmat);
    fringe.visible = false;
    fringe.position.copy(mesh.position);
    fringe.name = `fringe-${i}`;
    fringe.onBeforeRender = (_r, scene) => {
      const env = scene.userData.lashEnv || scene.environment;
      if (!fmat.envMap && env) {
        fmat.envMap = env;
        fmat.needsUpdate = true;
      }
    };
    group.add(fringe);
    row.fringe = fringe;
    rows.push(row);
  });
  applyThickness();

  function rebuild() {
    for (const row of rows) {
      const old = row.mesh.geometry;
      row.mesh.geometry = buildRibbonGeometry(curCurl, row.lengthMm, 100 + row.index * 31, press);
      old.dispose();
    }
    refreshFringes(true);
  }
  const wantsFringe = (row) => mode === 'tray' || row.index === fringeRow;
  // (Re)build the strands of the rows that should have them; `all` = rebuild even rows that already have them.
  function refreshFringes(all = false) {
    for (const row of rows) {
      const want = wantsFringe(row);
      if (!want && !row.fringe.visible) continue;
      if (want && row.fringe.visible && !all) continue;
      const old = row.fringe.geometry;
      row.fringe.geometry = want ? fringeGeo(row) : emptyGeo();
      row.fringe.visible = want;
      old.dispose();
    }
  }
  // Macro mode: real strands on the active row only (call on highlight change, never per frame).
  function setFringeRow(i) {
    const next = i == null || !rows[i] ? null : i;
    if (next === fringeRow) return;
    fringeRow = next;
    if (mode === 'macro') refreshFringes();
  }
  function setMode(next) {
    if (!MODES[next] || next === mode) return;
    mode = next;
    for (const m of mats) {
      m.alphaMap = mode === 'macro' ? textures.alphaMap : textures.alphaMapTray;
      m.alphaTest = mode === 'macro' ? 0.5 : 0;
      m.needsUpdate = true;
    }
    refreshFringes(true);
  }
  function setPress(f) {
    press = f;
    rebuild();
  }
  function setCurl(key) {
    if (!CURLS[key]) throw new Error('Unknown curl ' + key);
    curCurl = key;
    rebuild();
  }
  function setThickness(t) {
    if (!THICKNESSES.includes(t)) throw new Error('Unknown thickness ' + t);
    curThickness = t;
    applyThickness();
    rebuild(); // fibre width scales with thickness
  }
  function setHighlight(i) {
    highlight = i == null ? null : i;
    rows.forEach((row, k) => {
      const f = highlight == null || highlight === k ? 1 : 0.3;
      mats[k].color.copy(baseCol).multiplyScalar(f);
      fringeMats[k].color.copy(baseCol).multiplyScalar(f);
    });
  }

  function getAnchor(name) {
    const parts = name.split(':');
    const v = new THREE.Vector3();
    if (parts[0] === 'tape') {
      const t = tapes[+parts[1]];
      if (!t) throw new Error('Unknown anchor ' + name);
      v.copy(t.position);
    } else if (parts[0] === 'row') {
      const row = rows[+parts[1]];
      if (!row) throw new Error('Unknown anchor ' + name);
      const y0 = TAPE_T + row.index * ROW_LIFT + 0.004;
      const pts = lashCurve(curCurl, row.lengthMm, NY);
      const at = { base: 0, taper: Math.round((2 / 3) * NY), tip: NY }[parts[2]];
      if (at === undefined) throw new Error('Unknown anchor ' + name);
      // optional 4th part: 'x0' / 'x1' = the strip's end, or a number = local x (curl-profile views)
      const p3 = parts[3];
      const ax = p3 === 'x0' ? STRIP_X0 + 0.02 : p3 === 'x1' ? STRIP_X1 - 0.02
        : p3 != null && Number.isFinite(+p3) ? +p3 : stripCx;
      v.set(ax, y0 + (pts[at][1] / 10) * press, row.baseZ - pts[at][0] / 10);
    } else throw new Error('Unknown anchor ' + name);
    group.updateMatrixWorld(true);
    return group.localToWorld(v);
  }

  function dispose() {
    for (const t of Object.values(textures)) if (t.dispose) t.dispose();
    for (const m of mats) m.dispose();
    for (const m of fringeMats) m.dispose();
    for (const r of rows) { r.mesh.geometry.dispose(); r.fringe.geometry.dispose(); }
    tapeGeo.dispose();
    tapeMat.dispose();
    tapeMatShaded.dispose();
  }

  refreshFringes();
  return { group, rows, setPress, setCurl, setThickness, setHighlight, setFringeRow, setMode, getAnchor, dispose };
}
