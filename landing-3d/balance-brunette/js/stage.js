import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const BG = '#f2f1ef';

export function createStage(canvas, { mobile = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxPR = mobile ? 1.5 : 2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
  camera.position.set(0, 60, 40);
  camera.lookAt(0, 0, 0);

  // Key light: upper-left-front, casts the soft shadow.
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-30, 50, 30);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 10; sc.far = 140;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  // Soft rim from behind.
  const rim = new THREE.DirectionalLight(0xfff4ea, 0.9);
  rim.position.set(25, 20, -45);
  scene.add(rim);

  // Shadow catcher at y = 0.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.ShadowMaterial({ opacity: 0.18 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

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

  function resize() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPR));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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
      renderer.render(scene, camera);
    });
  }

  return { renderer, scene, camera, setView, onFrame, resize, start };
}
