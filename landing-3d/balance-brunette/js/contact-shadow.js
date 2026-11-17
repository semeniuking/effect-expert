import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

// Soft contact shadow (three.js webgl_shadow_contact technique): the product's depth is rendered from
// below into a small target, blurred H+V, and shown on a plane just under the ground. It is only
// re-rendered on demand (lid angle / yaw change), never every frame.
export function createContactShadow(renderer, scene, subject, {
  size = 512, width = 30, depth = 28, cx = -3.8, cz = 0, height = 3, opacity = 0.34, darkness = 0.75, blur = 2.2,
} = {}) {
  const group = new THREE.Group();
  group.position.set(cx, -0.01, cz);
  scene.add(group);

  const mkTarget = () => {
    const t = new THREE.WebGLRenderTarget(size, size);
    t.texture.generateMipmaps = false;
    return t;
  };
  const rt = mkTarget();
  const rtBlur = mkTarget();

  const planeGeo = new THREE.PlaneGeometry(width, depth).rotateX(Math.PI / 2);
  const plane = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({
    map: rt.texture, opacity, transparent: true, depthWrite: false, toneMapped: false,
  }));
  plane.renderOrder = -1;
  plane.scale.y = -1;
  group.add(plane);

  const blurPlane = new THREE.Mesh(planeGeo);
  blurPlane.visible = false;
  group.add(blurPlane);

  const cam = new THREE.OrthographicCamera(-width / 2, width / 2, depth / 2, -depth / 2, 0, height);
  cam.rotation.x = Math.PI / 2; // look up
  group.add(cam);

  const depthMat = new THREE.MeshDepthMaterial();
  depthMat.userData.darkness = { value: darkness };
  depthMat.onBeforeCompile = (shader) => {
    shader.uniforms.darkness = depthMat.userData.darkness;
    shader.fragmentShader = shader.fragmentShader
      .replace('uniform float opacity;', 'uniform float opacity;\nuniform float darkness;')
      .replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
        'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );');
  };
  depthMat.side = THREE.DoubleSide;
  depthMat.depthTest = false;
  depthMat.depthWrite = false;

  const hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
  hBlur.depthTest = false;
  const vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
  vBlur.depthTest = false;

  function blurPass(amount) {
    blurPlane.visible = true;
    blurPlane.material = hBlur;
    hBlur.uniforms.tDiffuse.value = rt.texture;
    hBlur.uniforms.h.value = amount / 256;
    renderer.setRenderTarget(rtBlur);
    renderer.render(blurPlane, cam);
    blurPlane.material = vBlur;
    vBlur.uniforms.tDiffuse.value = rtBlur.texture;
    vBlur.uniforms.v.value = amount / 256;
    renderer.setRenderTarget(rt);
    renderer.render(blurPlane, cam);
    blurPlane.visible = false;
  }

  function update() {
    const prevBg = scene.background;
    const prevOverride = scene.overrideMaterial;
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearAlpha();
    const prevColor = new THREE.Color();
    renderer.getClearColor(prevColor);
    plane.visible = false;
    scene.background = null;
    scene.overrideMaterial = depthMat;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    scene.overrideMaterial = prevOverride;
    blurPass(blur);
    blurPass(blur * 0.45);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevClear);
    scene.background = prevBg;
    plane.visible = true;
  }

  function dispose() {
    rt.dispose(); rtBlur.dispose(); planeGeo.dispose(); depthMat.dispose(); hBlur.dispose(); vBlur.dispose();
    scene.remove(group);
  }

  return { update, dispose, plane };
}
