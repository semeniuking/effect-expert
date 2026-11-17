import * as THREE from 'three';
import { createContactShadow } from './contact-shadow.js';

const BG = '#f2f2f2';

export function createStage(canvas, { mobile = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  const maxPR = mobile ? 1.5 : 2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = createStudioEnv();
  scene.environment = pmrem.fromScene(envScene, 0.03).texture;
  envScene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
  camera.position.set(0, 60, 40);
  camera.lookAt(0, 0, 0);

  // One weak, non-shadowing fill so the card keeps a little form; the softboxes do the real work.
  const fill = new THREE.DirectionalLight(0xffffff, 0.25);
  fill.position.set(-20, 50, 30);
  scene.add(fill);

  let contact = null;
  function addContactShadow(subject, opts = {}) {
    if (contact) contact.dispose();
    contact = createContactShadow(renderer, scene, subject, { size: mobile ? 256 : 512, ...opts });
    return contact;
  }

  const callbacks = [];
  const tmpTarget = new THREE.Vector3();

  function setView({ pos, target, fov }) {
    camera.position.set(pos[0], pos[1], pos[2]);
    tmpTarget.set(target[0], target[1], target[2]);
    camera.lookAt(tmpTarget);
    if (fov != null && camera.fov !== fov) camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  function onFrame(cb) { callbacks.push(cb); }
  const resizeCbs = [];
  const api = { renderer, scene, camera, setView, onFrame, resize, start, addContactShadow };
  api.render = () => renderer.render(scene, camera);
  api.onResize = (cb) => { resizeCbs.push(cb); };

  function resize() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPR));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const cb of resizeCbs) cb(w, h, renderer.getPixelRatio());
  }

  let started = false;
  let last = 0;
  function start() {
    if (started) return;
    started = true;
    resize();
    new ResizeObserver(resize).observe(canvas);
    last = performance.now();
    renderer.setAnimationLoop((now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      for (const cb of callbacks) cb(dt);
      api.render(dt);
    });
  }

  return api;
}

// Photo-studio environment: light-grey room lit by emissive softboxes. Gives long clean straight
// highlights along the acrylic edges and a near-shadowless high-key fill.
function createStudioEnv() {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(80, 60, 80),
    new THREE.MeshBasicMaterial({ color: '#7c7c7c', side: THREE.BackSide })
  );
  room.position.y = 22;
  env.add(room);
  const box = (w, h, intensity, pos, look) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity), side: THREE.DoubleSide })
    );
    m.position.set(...pos);
    m.lookAt(...look);
    env.add(m);
  };
  box(40, 40, 11, [0, 50, 0], [0, 0, 0]);          // top softbox, overhead
  box(7, 44, 14, [-37, 22, 0], [0, 0, 0]);          // long strip-box left
  box(7, 44, 14, [37, 22, 0], [0, 0, 0]);           // long strip-box right
  box(40, 18, 2.5, [0, 18, 37], [0, 0, 0]);        // weaker front fill
  // Black flags beside the strip-boxes: give the clear edges their dark, crisp definition.
  const flag = (w, h, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: '#0c0c0c', side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, pos[1], 0);
    env.add(m);
  };
  flag(10, 50, [-35.5, 22, -16]); flag(10, 50, [-35.5, 22, 16]);
  flag(10, 50, [35.5, 22, -16]); flag(10, 50, [35.5, 22, 16]);
  return env;
}
