import * as THREE from 'three';
import { CURLS, THICKNESSES, TRAY_LENGTHS, lashCurve, fiberRadius } from './lash-curve.js';

export const VISUAL_THICKNESS = 1.6;
// Across-strip widening of the (already 1.6x) fibre cross-section so 260 fibres read as the
// dense, solid sheet seen in real trays instead of a see-through comb.
const WIDTH_BOOST = 4;
const RADIAL = 5;
const SEGMENTS = 24;
const ROW_PITCH = 0.5; // cm
const STRIP_X0 = -2.4;
const STRIP_X1 = 2.6;
const TAPE_W = 0.25; // along Z
const TAPE_T = 0.06; // along Y
const ROW_LIFT = 0.008; // each row sits slightly above the previous so fibres layer like a real tray
const BASE_COLOR = '#3a2420';

export const rowBaseZ = (i) => -3.6 + i * ROW_PITCH;

// Small deterministic PRNG so the tray looks identical on every load.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tube along the fibre curve. Local frame: origin at base, forward = -Z, up = +Y (cm).
export function buildFiberGeometry(curlKey, lengthMm, thickness) {
  const pts = lashCurve(curlKey, lengthMm, SEGMENTS);
  const baseR = parseFloat(thickness) / 2;
  const n = pts.length;
  const pos = [], nor = [], idx = [];
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
    let tf = b[0] - a[0], tu = b[1] - a[1];
    const tl = Math.hypot(tf, tu) || 1;
    tf /= tl; tu /= tl;
    const nf = -tu, nu = tf; // in-plane normal (points "up" for a flat fibre)
    const r = (fiberRadius(k / (n - 1), baseR) * VISUAL_THICKNESS) / 10;
    for (let j = 0; j < RADIAL; j++) {
      const phi = (j / RADIAL) * Math.PI * 2;
      const c = Math.cos(phi), s = Math.sin(phi);
      const dz = -nf * c, dy = nu * c, dx = s;
      pos.push(dx * r * WIDTH_BOOST, pts[k][1] / 10 + dy * r, -pts[k][0] / 10 + dz * r);
      { const nl = Math.hypot(dx / WIDTH_BOOST, dy, dz) || 1; nor.push(dx / WIDTH_BOOST / nl, dy / nl, dz / nl); }
    }
  }
  for (let k = 0; k < n - 1; k++) {
    for (let j = 0; j < RADIAL; j++) {
      const j2 = (j + 1) % RADIAL;
      const a = k * RADIAL + j, b = k * RADIAL + j2, c = (k + 1) * RADIAL + j, d = (k + 1) * RADIAL + j2;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Base cap (faces backwards, +Z).
  const capC = pos.length / 3;
  pos.push(0, pts[0][1] / 10, 0);
  nor.push(0, 0, 1);
  const capStart = pos.length / 3;
  for (let j = 0; j < RADIAL; j++) {
    pos.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
    nor.push(0, 0, 1);
  }
  for (let j = 0; j < RADIAL; j++) idx.push(capC, capStart + j, capStart + ((j + 1) % RADIAL));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function createLashTray({ curl = 'L', thickness = '0.07', perStrip = 260, lengths = TRAY_LENGTHS } = {}) {
  if (!CURLS[curl]) throw new Error('Unknown curl ' + curl);
  const group = new THREE.Group();
  group.name = 'lash-tray';

  const material = new THREE.MeshPhysicalMaterial({
    color: BASE_COLOR,
    roughness: 0.38,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
    sheen: 0.6,
    sheenColor: new THREE.Color('#6b4a3e'),
    envMapIntensity: 0.5,
  });
  const tapeMat = new THREE.MeshStandardMaterial({ color: '#f3e9b5', roughness: 0.55 });
  const tapeGeo = new THREE.BoxGeometry(STRIP_X1 - STRIP_X0, TAPE_T, TAPE_W);

  let curCurl = curl, curThickness = thickness;
  let highlight = null;
  const stripCx = (STRIP_X0 + STRIP_X1) / 2;
  const pitch = (STRIP_X1 - STRIP_X0) / perStrip;

  const rows = [];
  const shade = []; // per-row Float32Array of base lightness multipliers
  const tapes = [];

  lengths.forEach((lengthMm, i) => {
    const rand = rng(1000 + i * 7919);
    const lift = i * ROW_LIFT;
    const y0 = TAPE_T + lift + 0.006;
    const baseZ = rowBaseZ(i);

    const tape = new THREE.Mesh(tapeGeo, tapeMat);
    tape.position.set(stripCx, TAPE_T / 2 + lift, baseZ);
    tape.receiveShadow = true;
    tape.castShadow = true;
    tape.name = `tape-${i}`;
    group.add(tape);
    tapes.push(tape);

    const mesh = new THREE.InstancedMesh(buildFiberGeometry(curCurl, lengthMm, curThickness), material, perStrip);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = `row-${i}`;
    // Dark fibres wash out grey under the full room environment; give the material its own
    // (dimmer) reflection strength by binding the scene environment to it on first render.
    mesh.onBeforeRender = (_r, scene) => {
      if (!material.envMap && scene.environment) {
        material.envMap = scene.environment;
        material.needsUpdate = true;
      }
    };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const sh = new Float32Array(perStrip);
    for (let k = 0; k < perStrip; k++) {
      const x = STRIP_X0 + (k + 0.5) * pitch + (rand() - 0.5) * 0.6 * pitch;
      q.setFromAxisAngle(up, ((rand() - 0.5) * 3 * Math.PI) / 180);
      s.set(1, 1, 0.99 + rand() * 0.02);
      p.set(x, y0, baseZ);
      m.compose(p, q, s);
      mesh.setMatrixAt(k, m);
      sh[k] = 1 + (rand() - 0.5) * 0.12;
      mesh.setColorAt(k, new THREE.Color(sh[k], sh[k], sh[k]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    shade.push(sh);
    rows.push({ index: i, lengthMm, mesh, baseZ });
  });

  function applyHighlight() {
    const c = new THREE.Color();
    rows.forEach((row, i) => {
      const f = highlight == null || highlight === i ? 1 : 0.25;
      const sh = shade[i];
      for (let k = 0; k < perStrip; k++) {
        c.setRGB(sh[k] * f, sh[k] * f, sh[k] * f);
        row.mesh.setColorAt(k, c);
      }
      row.mesh.instanceColor.needsUpdate = true;
    });
  }

  function rebuild() {
    for (const row of rows) {
      const old = row.mesh.geometry;
      row.mesh.geometry = buildFiberGeometry(curCurl, row.lengthMm, curThickness);
      old.dispose();
    }
  }

  function setCurl(key) {
    if (!CURLS[key]) throw new Error('Unknown curl ' + key);
    curCurl = key;
    rebuild();
  }
  function setThickness(t) {
    if (!THICKNESSES.includes(t)) throw new Error('Unknown thickness ' + t);
    curThickness = t;
    rebuild();
  }
  function setHighlight(i) {
    highlight = i == null ? null : i;
    applyHighlight();
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
      const lift = row.index * ROW_LIFT;
      const y0 = TAPE_T + lift + 0.006;
      const pts = lashCurve(curCurl, row.lengthMm, SEGMENTS);
      const at = { base: 0, taper: Math.round((2 / 3) * SEGMENTS), tip: SEGMENTS }[parts[2]];
      if (at === undefined) throw new Error('Unknown anchor ' + name);
      v.set(stripCx, y0 + pts[at][1] / 10, row.baseZ - pts[at][0] / 10);
    } else throw new Error('Unknown anchor ' + name);
    group.updateMatrixWorld(true);
    return group.localToWorld(v);
  }

  return { group, rows, setCurl, setThickness, setHighlight, getAnchor };
}
