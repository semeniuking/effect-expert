import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Final, display-referred touch: barely-there film grain and a soft vignette.
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.012 }, vignette: { value: 0.045 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, grain, vignette; varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.35, 0.95, length(d * vec2(1.0, 0.9)) * 1.45);
      c.rgb *= 1.0 - vignette * v;
      c.rgb += (hash(vUv * 1024.0 + fract(time) * 37.0) - 0.5) * grain;
      gl_FragColor = c;
    }`,
};

// Returns null when post-processing is off (mobile / reduced motion): the caller renders directly.
export function createPost(stage, { enabled = true } = {}) {
  if (!enabled) return null;
  const { renderer, scene, camera } = stage;
  // The composer renders linear to a float target and OutputPass tone-maps afterwards, which also maps the
  // background colour (Neutral compresses #f2f2f2 to #ededed). Pre-compensate so it lands on #f2f2f2 like the page.
  scene.background = new THREE.Color().setRGB(1.034, 1.034, 1.034, THREE.LinearSRGBColorSpace);
  const size = renderer.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new BokehPass(scene, camera, { focus: 10, aperture: 0, maxblur: 0 });
  bokeh.enabled = false;
  // The pass renders scene depth itself: the flat background colour must not leak in as fake depth.
  const bokehRender = bokeh.render.bind(bokeh);
  bokeh.render = (...a) => { const bg = scene.background; scene.background = null; bokehRender(...a); scene.background = bg; };
  composer.addPass(bokeh);
  composer.addPass(new OutputPass());
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);

  stage.onResize((w, h, pr) => { composer.setPixelRatio(pr); composer.setSize(w, h); });
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);

  let t = 0;
  return {
    composer,
    // dof: { aperture, maxblur } or null; focus in world units (distance camera -> subject).
    setDof(dof, focus) {
      const on = !!dof && dof.aperture > 1e-6;
      bokeh.enabled = on;
      if (on) {
        bokeh.uniforms.focus.value = focus;
        bokeh.uniforms.aperture.value = dof.aperture;
        bokeh.uniforms.maxblur.value = dof.maxblur;
      }
    },
    render(dt = 0.016) {
      t += dt;
      finish.uniforms.time.value = t;
      composer.render(dt);
    },
  };
}
