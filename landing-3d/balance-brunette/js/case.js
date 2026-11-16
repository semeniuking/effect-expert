import * as THREE from 'three';
import { makeInsertTexture, makeLidCardTexture, CARD_W, CARD_H, LAYOUT } from './textures.js';

const OUT_W = 7.6, OUT_H = 0.9, OUT_D = 16.4;
const WALL = 0.12;
const RADIUS = 0.25;
const BEVEL = 0.035;
const FLOOR_T = 0.12;
const CARD_T = 0.03;

function rrect(path, w, h, r) {
  const x = -w / 2, y = -h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  path.lineTo(x + w, y + h - r);
  path.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  path.lineTo(x + r, y + h);
  path.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  path.lineTo(x, y + r + 0);
  path.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return path;
}

function extrudeY(shape, y0, y1) {
  const depth = y1 - y0 - 2 * BEVEL;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 4,
    curveSegments: 14,
  });
  g.rotateX(-Math.PI / 2); // extrusion (z) -> +Y
  g.translate(0, y0 + BEVEL, 0);
  return g;
}

// One hollow half: floor + wall ring, open at +Y, centred on x/z origin, y 0..OUT_H.
function buildHalfGeometries() {
  const b = BEVEL;
  const outer = rrect(new THREE.Shape(), OUT_W - 2 * b, OUT_D - 2 * b, RADIUS - b);
  const hole = rrect(new THREE.Path(), OUT_W - 2 * WALL + 2 * b, OUT_D - 2 * WALL + 2 * b, RADIUS - WALL + b);
  const ring = new THREE.Shape(outer.getPoints(14));
  ring.holes.push(new THREE.Path(hole.getPoints(14)));
  const floorShape = new THREE.Shape(outer.getPoints(14));
  return { ring: extrudeY(ring, FLOOR_T * 0.5, OUT_H), floor: extrudeY(floorShape, 0, FLOOR_T) };
}

function makeAcrylic() {
  return new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: 0.04,
    transmission: 1,
    thickness: 0.3,
    ior: 1.49,
    clearcoat: 0.45,
    clearcoatRoughness: 0.02,
    attenuationColor: new THREE.Color('#e9f3f1'),
    attenuationDistance: 8,
    specularIntensity: 1,
    envMapIntensity: 0.6,
    side: THREE.DoubleSide,
  });
}

function edgeLines(geo, mat) {
  // Thin bright lines on the sharp creases: sells the polished moulded edge.
  const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 12), mat);
  l.renderOrder = 3;
  return l;
}

function printCard(texture, { paperBack = true } = {}) {
  const g = new THREE.Group();
  const paper = new THREE.Mesh(
    new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H),
    new THREE.MeshStandardMaterial({ color: '#f4f4f1', roughness: 0.7 })
  );
  paper.receiveShadow = true;
  const mat = new THREE.MeshStandardMaterial({
    map: texture, roughness: 0.6, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), mat);
  face.rotation.x = -Math.PI / 2;
  face.position.y = CARD_T / 2 + 0.0008;
  face.receiveShadow = true;
  if (paperBack) g.add(paper);
  g.add(face);
  g.userData.face = face;
  return g;
}

export function createCase({ renderer, portrait, lengths, curl = 'L', thickness = '0.07' }) {
  const aniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
  const group = new THREE.Group();
  group.name = 'acrylic-case';

  const acrylic = makeAcrylic();
  const edgeMat = new THREE.LineBasicMaterial({ color: '#6f8286', transparent: true, opacity: 0.6 });
  const { ring, floor } = buildHalfGeometries();
  const halfMeshes = [];
  const half = (parent) => {
    const g = new THREE.Group();
    for (const geo of [ring, floor]) {
      const m = new THREE.Mesh(geo, acrylic);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m, edgeLines(geo, edgeMat));
      halfMeshes.push(m);
    }
    parent.add(g);
    return g;
  };

  // --- tray (right half) ---
  const tray = half(group);
  tray.name = 'tray';

  const insertTex = makeInsertTexture({ lengths, curl, thickness, anisotropy: aniso });
  const insert = printCard(insertTex);
  const insertSurfaceY = FLOOR_T + CARD_T + 0.002;
  insert.position.set(0, FLOOR_T + CARD_T / 2 + 0.002, 0);
  insert.name = 'insert-card';
  group.add(insert);

  // --- lid (pivots about the hinge line x=-3.8, y=0.9, along Z) ---
  const hingeX = -OUT_W / 2;
  const lid = new THREE.Group();
  lid.name = 'lid';
  lid.position.set(hingeX, OUT_H, 0);
  const lidBody = new THREE.Group();
  lidBody.position.set(OUT_W / 2, OUT_H, 0); // lid-local: x 0..7.6, y 0..0.9
  lidBody.rotation.z = Math.PI; // open side down
  half(lidBody);
  lid.add(lidBody);
  group.add(lid);

  const lidTex = makeLidCardTexture(portrait, { anisotropy: aniso });
  // Lid print behaves like a film on the clear lid: visible from outside, see-through from inside
  // (the real open case shows an empty clear lid).
  const lidCard = printCard(lidTex, { paperBack: false });
  lidCard.position.set(OUT_W / 2, OUT_H - WALL - CARD_T / 2 - 0.004, 0); // under the ceiling, print up
  lidCard.name = 'lid-card';
  lid.add(lidCard);

  // --- hinge knuckles on the shared long edge ---
  const knuckleGeo = new THREE.CylinderGeometry(0.27, 0.27, 1.3, 28);
  knuckleGeo.rotateX(Math.PI / 2); // axis along Z
  const plateGeo = new THREE.BoxGeometry(0.3, 0.5, 1.3);
  const mk = (geo, x, y, z, parent) => {
    const m = new THREE.Mesh(geo, acrylic);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  mk(knuckleGeo, 0, 0.02, 5.6, lid); // lid knuckle
  mk(plateGeo, 0.02, 0.0, 5.6, lid).position.y = -0.2;
  mk(knuckleGeo, hingeX, OUT_H + 0.02, -5.6, group); // tray knuckle
  mk(plateGeo, hingeX + 0.02, OUT_H - 0.45, -5.6, group);

  // --- clasp tabs on the free long edge ---
  const trayTab = mk(new THREE.BoxGeometry(0.1, 0.85, 1.7), OUT_W / 2 + 0.07, OUT_H * 0.55, 0, group);
  trayTab.rotation.z = -0.12;
  const lugGeo = new THREE.BoxGeometry(0.28, 0.12, 1.2);
  mk(lugGeo, OUT_W / 2 + 0.14, OUT_H + 0.08, 0, group);
  const lidLug = mk(new THREE.BoxGeometry(0.1, 0.55, 1.2), OUT_W + 0.07, 0.22, 0, lid);
  lidLug.rotation.z = 0.1;

  // --- anchors ---
  const anchors = {};
  const addAnchor = (name, parent, x, y, z) => {
    const o = new THREE.Object3D();
    o.name = 'anchor-' + name;
    o.position.set(x, y, z);
    parent.add(o);
    anchors[name] = o;
  };
  addAnchor('hinge', group, hingeX, OUT_H, 0);
  addAnchor('clasp', group, OUT_W / 2 + 0.15, OUT_H * 0.6, 0);
  addAnchor('logo', group, LAYOUT.insertLogo.x, insertSurfaceY, LAYOUT.insertLogo.z);
  addAnchor('wordmark', group, LAYOUT.insertWordmark.x, insertSurfaceY, LAYOUT.insertWordmark.z);
  addAnchor('lid-card', lid, OUT_W / 2, OUT_H - WALL + 0.01, 0);

  const redrawAll = () => { insertTex.userData.redraw(); lidTex.userData.redraw(); };
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    document.fonts.ready.then(redrawAll).catch(() => {});
  }

  let curInsertTex = insertTex;
  const state = { lengths, curl, thickness };

  function setLidOpen(t) {
    lid.rotation.z = Math.PI * Math.min(1, Math.max(0, t));
  }

  function setPrint({ curl: c = state.curl, thickness: th = state.thickness } = {}) {
    state.curl = c;
    state.thickness = th;
    const next = makeInsertTexture({ lengths: state.lengths, curl: c, thickness: th, anisotropy: aniso });
    insert.userData.face.material.map = next;
    insert.userData.face.material.needsUpdate = true;
    curInsertTex.dispose();
    curInsertTex = next;
  }

  const tmp = new THREE.Vector3();
  function getAnchor(name) {
    const a = anchors[name];
    if (!a) throw new Error('Unknown anchor ' + name);
    group.updateWorldMatrix(true, true);
    return a.getWorldPosition(tmp.set(0, 0, 0)).clone();
  }

  setLidOpen(0);
  return { group, lid, setLidOpen, setPrint, insertSurfaceY, getAnchor, halfMeshes, acrylic, edgeMat };
}
