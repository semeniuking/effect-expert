import * as THREE from 'three';
import { createStage } from './stage.js';
import { createLashTray } from './lashes.js';
import { createCase } from './case.js';
import { loadFonts, makeInsertTexture, makeLidCardTexture } from './textures.js';

const mobile =
  window.matchMedia('(max-width: 768px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
const LENGTHS = [6, 6, 7, 7, 8, 8, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11, 12, 12, 13];

const stage = createStage(document.getElementById('stage'), { mobile });
window.__stage = stage;
const q = new URLSearchParams(location.search);
const v = q.get('view') || 'default';

const views = {
  top: { pos: [0, 30, 6], target: [0, 0, 0.6], fov: 30 },
  macro: { pos: [6, 4, 7], target: [0, 0.3, -2], fov: 28 },
  default: { pos: [12, 26, 28], target: [0, 0, 0], fov: 30 },
  'case-closed': { pos: [0, 34, 8], target: [0, 0, 0], fov: 30 },
  'case-closed-low': { pos: [10, 14, 20], target: [0, 0.5, 0], fov: 30 },
  'case-half': { pos: [-8, 24, 26], target: [-2, 1, 0], fov: 32 },
  'case-open': { pos: [0, 44, 8], target: [-3.8, 0, 0], fov: 30 },
  'case-open-low': { pos: [-4, 12, 20], target: [-3.8, 0.5, 0], fov: 32 },
  'case-hinge': { pos: [-9, 6, -3], target: [-3.8, 0.9, -5.6], fov: 30 },
};

await loadFonts();
const portrait = new Image();
portrait.src = 'assets/portrait.jpg';
await portrait.decode();

if (v === 'cards') {
  const aniso = stage.renderer.capabilities.getMaxAnisotropy();
  const mk = (tex, x) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 15.8),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.01, 0);
    stage.scene.add(m);
  };
  mk(makeInsertTexture({ lengths: LENGTHS, curl: 'L', thickness: '0.07', anisotropy: aniso }), -4);
  mk(makeLidCardTexture(portrait, { anisotropy: aniso }), 4);
  stage.setView({ pos: [0, 40, 0.01], target: [0, 0, 0], fov: 34 });
} else {
  const c = createCase({ renderer: stage.renderer, portrait, lengths: LENGTHS, curl: 'L', thickness: '0.07' });
  stage.scene.add(c.group);
  window.__case = c;
  const open = v.startsWith('case-open') ? 1 : v === 'case-half' ? 0.5 : v === 'case-hinge' ? 1 : 0;
  c.setLidOpen(open);
  const tray = q.get('notray') ? { group: new THREE.Group() } : createLashTray({ perStrip: mobile ? 110 : 260 });
  tray.group.position.y = c.insertSurfaceY;
  stage.scene.add(tray.group);
  window.__tray = tray;
  stage.setView(views[v] || views.default);
}

let frames = 0;
stage.onFrame(() => {
  if (++frames === 2) window.__ready = true;
});
stage.start();
