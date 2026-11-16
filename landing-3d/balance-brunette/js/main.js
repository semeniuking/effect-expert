import * as THREE from 'three';
import { createStage } from './stage.js';
import { createLashTray } from './lashes.js';

const mobile =
  window.matchMedia('(max-width: 768px)').matches || (navigator.hardwareConcurrency || 8) <= 4;

const stage = createStage(document.getElementById('stage'), { mobile });

// Temporary: bare lash tray on a white card (replaced by case.js / story in later tasks).
const card = new THREE.Mesh(
  new THREE.BoxGeometry(7.2, 0.1, 16),
  new THREE.MeshStandardMaterial({ color: '#fbfbfa', roughness: 0.8 })
);
card.position.y = -0.05;
card.receiveShadow = true;
stage.scene.add(card);

const tray = createLashTray({ perStrip: mobile ? 110 : 260 });
stage.scene.add(tray.group);
window.__tray = tray;

const views = {
  top: { pos: [0, 30, 6], target: [0, 0, 0.6], fov: 30 },
  macro: { pos: [6, 4, 7], target: [0, 0.3, -2], fov: 28 },
  default: { pos: [12, 26, 28], target: [0, 0, 0], fov: 30 },
};
const v = new URLSearchParams(location.search).get('view') || 'default';
stage.setView(views[v] || views.default);

let frames = 0;
stage.onFrame(() => {
  if (++frames === 2) window.__ready = true;
});
stage.start();
