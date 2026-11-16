import * as THREE from 'three';
import { createStage } from './stage.js';

const mobile =
  window.matchMedia('(max-width: 768px)').matches || (navigator.hardwareConcurrency || 8) <= 4;

const stage = createStage(document.getElementById('stage'), { mobile });

// Placeholder tray half (replaced by case.js in a later task).
const box = new THREE.Mesh(
  new THREE.BoxGeometry(7.6, 0.9, 16.4),
  new THREE.MeshPhysicalMaterial({ color: 0x9fb8b3, roughness: 0.1, clearcoat: 1 })
);
box.position.y = 0.45;
box.castShadow = true;
box.receiveShadow = true;
stage.scene.add(box);

stage.setView({ pos: [12, 26, 28], target: [0, 0, 0], fov: 30 });

let frames = 0;
stage.onFrame(() => {
  if (++frames === 2) window.__ready = true; // first frame after box is in scene has rendered
});
stage.start();
