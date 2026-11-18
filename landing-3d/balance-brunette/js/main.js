// Pure modules are imported statically; everything that needs three.js is imported inside boot() so that a blocked
// CDN / missing import-map support / no WebGL ends in the static fallback (see __fail3d in index.html), never a stuck veil.
import { CHAPTERS, sampleStory } from './story.js';
import { COPY } from './copy.js';
import { CURLS, THICKNESSES } from './lash-curve.js';

const PRODUCT_URL = 'https://effect-expert.com/products/balance-mix-brunette';
const LENGTHS = [6, 6, 7, 7, 8, 8, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11, 12, 12, 13];
const N = CHAPTERS.length;
const narrowMq = window.matchMedia('(max-width: 768px)');
const lowPower = (navigator.hardwareConcurrency || 8) <= 4;

const $ = (id) => document.getElementById(id);
const veilBar = $('veil-bar');
const veilProgress = (f) => { veilBar.style.transform = `scaleX(${f})`; };
veilProgress(0.1);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (t) => t * t * (3 - 2 * t);

// ---------- DOM: sections, panels, language ----------
let lang = 'uk';
try { lang = localStorage.getItem('lang') === 'en' ? 'en' : 'uk'; } catch (e) { /* storage unavailable */ }

const story = $('story');
const overlay = $('overlay');
const panels = CHAPTERS.map((c, i) => {
  const sec = document.createElement('section');
  sec.className = 'chapter';
  sec.dataset.id = c.id;
  story.appendChild(sec);
  const p = document.createElement('article');
  p.className = 'panel';
  p.innerHTML =
    '<p class="kicker"></p>' +
    `<${i === 0 ? 'h1' : 'h2'} class="title"></${i === 0 ? 'h1' : 'h2'}>` +
    '<p class="body"></p>' +
    (i === N - 1
      ? '<div class="cfg">' +
        '<div class="cfg-row"><span class="cfg-label" data-l="bend"></span><div class="seg" role="radiogroup" id="seg-curl"></div></div>' +
        '<div class="cfg-row"><span class="cfg-label" data-l="thickness"></span><div class="seg" role="radiogroup" id="seg-thick"></div></div>' +
        '<p class="cfg-note"><span id="cfg-length"></span><span id="cfg-color"></span></p>' +
        '</div><div class="buy"><span class="price"></span><a target="_blank" rel="noopener"></a></div>'
      : '');
  if (i === N - 1) p.classList.add('side');
  // Hidden panels are neither focusable nor read by screen readers; setPanels flips this together with `.live`.
  p.tabIndex = -1;
  p.inert = true;
  p.setAttribute('aria-hidden', 'true');
  overlay.appendChild(p);
  return p;
});

// ---------- configurator (last chapter) ----------
const cfg = { curl: 'L', thickness: '0.07' };
const segCurl = $('seg-curl');
const segThick = $('seg-thick');
const mkSeg = (host, items, attr) => items.map((v) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.dataset[attr] = v;
  b.textContent = v;
  host.appendChild(b);
  return b;
});
const curlBtns = mkSeg(segCurl, Object.keys(CURLS), 'curl');
const thickBtns = mkSeg(segThick, THICKNESSES, 'thick');
function syncSeg() {
  curlBtns.forEach((b) => {
    const on = b.dataset.curl === cfg.curl;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1; // roving tabindex: one tab stop per radiogroup
  });
  thickBtns.forEach((b) => {
    const on = b.dataset.thick === cfg.thickness;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
}
syncSeg();
// Radiogroup keyboard model: arrows (and Home/End) move focus AND selection, wrapping at the ends.
function segKeys(host, btns) {
  host.addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % btns.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i + btns.length - 1) % btns.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = btns.length - 1;
    if (n < 0) return;
    e.preventDefault();
    btns[n].focus();
    btns[n].click();
  });
}
segKeys(segCurl, curlBtns);
segKeys(segThick, thickBtns);

function applyLang() {
  const t = COPY[lang];
  segCurl.setAttribute('aria-label', t.ui.bend);
  segThick.setAttribute('aria-label', t.ui.thickness);
  panels[N - 1].querySelectorAll('.cfg-label').forEach((el) => { el.textContent = t.ui[el.dataset.l]; });
  $('cfg-length').textContent = `${t.ui.length}: ${t.ui.lengthNote}`;
  $('cfg-color').textContent = `${t.ui.color}: ${t.ui.colorValue}`;
  document.documentElement.lang = lang;
  panels.forEach((p, i) => {
    const c = t.chapters[CHAPTERS[i].id];
    p.querySelector('.kicker').textContent = c.kicker;
    p.querySelector('.title').textContent = c.title;
    p.querySelector('.body').textContent = c.body;
  });
  const buy = panels[N - 1].querySelector('.buy');
  buy.querySelector('.price').textContent = t.ui.price;
  const a = buy.querySelector('a');
  a.textContent = t.ui.buy;
  a.href = PRODUCT_URL;
  const fb = $('fallback');
  if (fb) {
    fb.lang = lang;
    fb.querySelector('.fb-kicker').textContent = t.chapters.hero.kicker;
    fb.querySelector('.fb-title').textContent = t.chapters.hero.title;
    fb.querySelector('.fb-body').textContent = t.chapters.hero.body;
    fb.querySelector('.price').textContent = t.ui.price;
    const fa = fb.querySelector('a');
    fa.textContent = t.ui.buy;
    fa.href = PRODUCT_URL;
  }
  $('lang').textContent = t.ui.lang;
  $('hint').textContent = t.ui.scroll;
  lastCallout = null;
}
let lastCallout = null;
let invalidateStage = null;
$('lang').addEventListener('click', () => {
  lang = lang === 'uk' ? 'en' : 'uk';
  try { localStorage.setItem('lang', lang); } catch (e) { /* ignore */ }
  applyLang();
  if (typeof invalidateStage === 'function') invalidateStage(); // the mobile sheet height changes with the copy
});
// Copy first: it must exist even if the 3D never boots.
applyLang();

async function boot() {
  // ---------- 3D ----------
  const [THREE, { createStage }, { createLashTray }, { createCase }, { loadFonts }, { createCallouts }, { createPost }] = await Promise.all([
    import('three'), import('./stage.js'), import('./lashes.js'), import('./case.js'), import('./textures.js'),
    import('./callouts.js'), import('./post.js'),
  ]);
  const mobileGfx = narrowMq.matches || lowPower;
  const rmMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = rmMq.matches;
  rmMq.addEventListener('change', () => { reducedMotion = rmMq.matches; stage.invalidate(); });
  const stage = createStage($('stage'), { mobile: mobileGfx });
  invalidateStage = () => stage.invalidate();
  veilProgress(0.2);
  const callouts = createCallouts($('callouts'));

  await loadFonts();
  veilProgress(0.35);
  const loadImg = async (src) => {
    const im = new Image();
    im.src = src;
    try { await im.decode(); return im; } catch (e) { return null; }
  };
  const portrait = await loadImg('assets/portrait.jpg'); // null -> the lid card falls back to a grey box
  veilProgress(0.5);
  const swatches = await Promise.all(['assets/swatch-top.jpg', 'assets/swatch-bot.jpg'].map(loadImg));
  veilProgress(0.65);

  const caseApi = createCase({ renderer: stage.renderer, portrait, swatches, lengths: LENGTHS, curl: 'L', thickness: '0.07' });
  const tray = createLashTray({
    curl: 'L', thickness: '0.07', lengths: LENGTHS, renderer: stage.renderer,
    perStrip: narrowMq.matches || lowPower ? 110 : 260,
  });
  veilProgress(0.85);
  tray.group.position.y = caseApi.insertSurfaceY;
  caseApi.group.add(tray.group);
  stage.scene.add(caseApi.group);
  const contact = stage.addContactShadow(caseApi.group, { opacity: 0.2, darkness: 0.8, blur: 3.5 });
  let shadowKey = '';
  // Photographic finish: bokeh + grain + vignette. Desktop only; mobile / reduced motion render directly.
  const post = createPost(stage, { enabled: !mobileGfx && !reducedMotion });
  if (post) stage.render = (dt) => post.render(dt);
  // Direct rendering (mobile / reduced motion) tone-maps the *transmitted* page background (Neutral: #f2f2f2 -> #ededed)
  // inside the acrylic material, so the clear lid read as grey. The post path pre-compensates the background by 1.034
  // instead; lift the lid body colour here (measured: 1.067 lands on the desktop lid level) so the open lid reads as clear acrylic over #f2f2f2 everywhere.
  if (!post) caseApi.acrylic.color.multiplyScalar(1.067);
  wrapRenderLater();
  let focus = 10;
  let curPress = 0.3;
  let curFringe;
  let curBare = false;
  // NOTE (round 5): the macro look below (bare / macroKey / macro env) is unused: no chapter sets `bare` any more.
  // Kept in place as a fallback; with bareMix 0 it is inert (key light intensity 0).
  // Macro key: a small soft source behind and above the far strip end (like the photo's backlight). Its distance
  // falloff darkens the strip body toward the camera and its direct anisotropic specular draws the satin band across
  // the fibres of the curl. Always in the scene (intensity 0 outside the curl-profile chapters: no shader recompiles).
  const macroKey = new THREE.PointLight(0xffffff, 0, 0, 2);
  macroKey.position.set(-6, 5, 9);
  stage.scene.add(macroKey);
  const MACRO_KEY = 60;
  function setLashEnv(env) {
    for (const m of tray.rows.flatMap((r) => r.materials)) { m.envMap = env; m.needsUpdate = true; }
  }
  // Curl-profile chapters look along the strips from beyond the case wall: hide the acrylic shell there (as if the
  // strips were taken out of the case), so the curl silhouettes stand against the white card and background.
  const acrylicMeshes = [];
  caseApi.group.traverse((o) => { if (o.isMesh && o.material === caseApi.acrylic) acrylicMeshes.push(o); });

  // Row brightness fade (setHighlight snaps, so fade the material colours here).
  const rowMats = tray.rows.map((r) => r.materials[0]);
  const allMats = tray.rows.flatMap((r) => r.materials); // ribbon + fibre fringe
  const baseCol = rowMats[0].color.clone();
  const rowF = tray.rows.map(() => 1);
  // rowF: 1 = full colour; the active row keeps its normal brunette, every other row dims ~45 %.
  function rowTarget(h, k) { return h == null || h === k ? 1 : 0.55; }
  // Macro chapters: the lit fibre body is a cool neutral brown (#453832-#544742 in the photos), not the warm
  // near-black of the tray view, so the base colour moves toward LIT as the strips spring up (press 0.3 -> 1).
  const litCol = new THREE.Color('#54443d');
  const mixCol = new THREE.Color();
  let macroM = 0;
  function applyRowF() {
    mixCol.copy(baseCol).lerp(litCol, macroM);
    tray.rows.forEach((r, k) => r.materials.forEach((m) => m.color.copy(mixCol).multiplyScalar(rowF[k])));
  }

  // Configure: geometry is rebuilt only on click (after the pressed state has painted), never per frame.
  // Old geometries are disposed inside setCurl/setThickness (the smoke leak check enforces it); the print canvas and
  // texture are reused (redraw + needsUpdate). The hitch is measured from the start of the rebuild to the END of the
  // next rendered frame (GPU upload included), not the JS rebuild alone.
  let pendingCfg = null;
  let lastRebuildMs = 0;
  let rebuildT0 = null;
  function queueConfig(patch) {
    const first = !pendingCfg;
    pendingCfg = { ...(pendingCfg || {}), ...patch };
    Object.assign(cfg, patch);
    syncSeg();
    if (!first) return;
    // rAF runs before the next paint, so defer one more tick: the pressed state paints first, then the rebuild.
    requestAnimationFrame(() => setTimeout(() => {
      const p = pendingCfg;
      pendingCfg = null;
      rebuildT0 = performance.now();
      try {
        if (p.curl) tray.setCurl(p.curl);
        if (p.thickness) tray.setThickness(p.thickness);
        caseApi.setPrint({ curl: cfg.curl, thickness: cfg.thickness });
      } finally {
        stage.invalidate(); // a frame is always drawn, even if a rebuild step threw
      }
    }, 0));
  }
  function wrapRenderLater() {  // hoisted: called once the post pipeline (if any) owns stage.render
    const inner = stage.render;
    stage.render = (dt) => {
      inner(dt);
      if (rebuildT0 != null) {
        stage.renderer.getContext().finish(); // include the GPU work (texture upload, mipmaps) of this frame
        lastRebuildMs = performance.now() - rebuildT0;
        rebuildT0 = null;
      }
    };
  }
  segCurl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && b.dataset.curl !== cfg.curl) queueConfig({ curl: b.dataset.curl });
  });
  segThick.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && b.dataset.thick !== cfg.thickness) queueConfig({ thickness: b.dataset.thick });
  });

  // ---------- scroll state ----------
  let pTarget = 0;
  let pSmooth = 0;
  function readScroll() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    pTarget = max > 0 ? clamp01(window.scrollY / max) : 0;
  }
  if (window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.create({
      trigger: story, start: 'top top', end: 'bottom bottom',
      onUpdate: (self) => { pTarget = self.progress; },
    });
  } else {
    window.addEventListener('scroll', readScroll, { passive: true });
  }
  readScroll();
  pSmooth = pTarget;

  const anchorVec = new THREE.Vector3();
  const anchorFn = (name) => (/^(row|tape):/.test(name) ? tray.getAnchor(name) : caseApi.getAnchor(name));
  let curCallout = null;
  let time = 0;
  let snap = true;
  let frames = 0;
  let lastP = -1;
  const progressEl = $('progress');

  function setPanels(s) {
    let shown = null;
    panels.forEach((p, i) => {
      let o = 0, dy = 12;
      if (i === s.index) { o = 1 - clamp01(s.blend * 2); dy = -12 * (1 - o); }
      else if (i === s.index + 1) { o = clamp01(s.blend * 2 - 1); dy = 12 * (1 - o); }
      p.style.opacity = o.toFixed(3);
      p.style.transform = `translateY(${dy.toFixed(1)}px)`;
      const live = o > 0.5;
      if (live !== p.classList.contains('live')) { // only when the state flips
        if (!live && p.contains(document.activeElement)) lostFocus = true; // check before inert drops focus
        p.classList.toggle('live', live);
        p.inert = !live;
        if (live) p.removeAttribute('aria-hidden'); else p.setAttribute('aria-hidden', 'true');
        if (live) shown = p;
      }
    });
    if (lostFocus) { // the focused control just faded out: move focus to the new panel (or the language button)
      lostFocus = false;
      const next = shown || panels.find((p) => p.classList.contains('live'));
      (next || $('lang')).focus({ preventScroll: true });
    }
    if (shown && announce.dataset.id !== CHAPTERS[panels.indexOf(shown)].id) {
      announce.dataset.id = CHAPTERS[panels.indexOf(shown)].id;
      announce.textContent = shown.querySelector('.title').textContent; // one polite announcement per chapter
    }
  }
  let lostFocus = false;
  const announce = $('announce');

  // Keep the product clear of the text: shift the image right (desktop) or up (mobile).
  // In macro chapters the curtain column owns that area, so shift by exactly its size.
  const curtainEl = $('curtain');
  function applyViewOffset(cam, w, h, narrow, curtain, sheet) {
    if (narrow) {
      const cur = curtainEl.offsetHeight / 2;
      const base = h * 0.12 + (cur - h * 0.12) * curtain;
      // configurator bottom sheet: lift the product by half the sheet height so it sits above it
      const sh = Math.min(h * 0.58, panels[N - 1].offsetHeight) / 2;
      cam.setViewOffset(w, h, 0, base + (sh - base) * sheet, w, h);
    } else {
      const cur = curtainEl.offsetWidth / 2;
      cam.setViewOffset(w, h, -(w * 0.13 + (cur - w * 0.13) * curtain), 0, w, h);
    }
  }

  stage.onFrame((dt) => {
    time += dt;
    const k = snap ? 1 : 1 - Math.exp(-dt / 0.16);
    pSmooth += (pTarget - pSmooth) * k;
    if (Math.abs(pTarget - pSmooth) < 1e-5) pSmooth = pTarget;
    const narrow = narrowMq.matches;
    const s = sampleStory(CHAPTERS, pSmooth, { mobile: narrow });
    // Render only on change (dirty flag): scrolling, easing still settling, hero sway, config clicks, resize.
    let dirty = snap || pSmooth !== lastP || frames < 90;
    lastP = pSmooth;

    stage.setView(s.cam);
    const cv = stage.renderer.domElement;
    const sheet = s.index === N - 1 ? 1 : s.index === N - 2 ? s.blend : 0;
    applyViewOffset(stage.camera, cv.clientWidth, cv.clientHeight, narrow, s.curtain, sheet);
    curtainEl.style.opacity = s.curtain.toFixed(3);

    // Fibres lie pressed under the closed lid and spring to natural curl for the macro chapters.
    // Quantised so the geometry is rebuilt only a handful of times per transition, never per frame.
    const pq = Math.round(s.press * 10) / 10;
    if (pq !== curPress) { curPress = pq; tray.setPress(pq); }
    // Real tip strands on the active row only; rebuilt on highlight change, never per frame.
    if (s.highlight !== curFringe) { curFringe = s.highlight; tray.setFringeRow(s.highlight); }
    macroKey.intensity = MACRO_KEY * s.bareMix; // fades with the camera move (the shell/env swap at the midpoint)
    const bare = !!s.bare;
    if (bare !== curBare) {
      curBare = bare;
      for (const m of acrylicMeshes) m.visible = !bare;
      tray.setMode(bare ? 'macro' : 'tray');
      setLashEnv(bare ? stage.scene.userData.macroEnv : stage.scene.userData.lashEnv);
      shadowKey = ''; // the shadow follows what is visible
    }
    // Macro lighting rig: the studio env hits the vertical curl faces weakly, so lift the fibres' env share
    // as the strips spring up (tray view keeps the dark #170907-ish read).
    const envI = 0.4 + clamp01((s.press - 0.3) / 0.7) * 0.8; // capped ~1.2: more washes the fibres to orange
    for (const m of allMats) m.envMapIntensity = envI;
    macroM = clamp01((s.press - 0.3) / 0.7);
    caseApi.setLidOpen(smooth(s.lid));
    const heroW = s.index === 0 ? 1 - s.blend : 0;
    // Idle sway is off under prefers-reduced-motion.
    const sway = reducedMotion ? 0 : Math.sin(time * 0.55) * (8 * Math.PI / 180) * heroW;
    caseApi.group.rotation.y = s.yaw + sway;
    if (heroW > 0 && !reducedMotion) dirty = true;
    // Contact shadow only depends on lid angle + yaw: re-render when they change (quantised), not per frame.
    const key = `${(smooth(s.lid) * 90).toFixed(0)}|${(caseApi.group.rotation.y * 200).toFixed(0)}`;
    if (key !== shadowKey) { shadowKey = key; caseApi.group.updateMatrixWorld(true); contact.update(); }

    // highlight fade (~350 ms)
    const fk = snap ? 1 : 1 - Math.exp(-dt / 0.12);
    for (let r = 0; r < rowF.length; r++) {
      const want = rowTarget(s.highlight, r);
      rowF[r] += (want - rowF[r]) * fk;
      if (Math.abs(want - rowF[r]) < 1e-3) rowF[r] = want;
      else dirty = true;
    }
    applyRowF();

    // callout
    caseApi.group.updateMatrixWorld(true);
    const id = s.callout;
    if (id) {
      anchorVec.copy(anchorFn(id));
      if (id.startsWith('tape:') && id !== 'tape:19') { // tape is hidden under fibres mid-strip: pin to its exposed end
        tray.group.worldToLocal(anchorVec).x += 2.5;
        tray.group.localToWorld(anchorVec);
      }
    }
    const calloutKey = id ? `${id}|${s.active}` : null; // two chapters may pin the same anchor with different labels
    if (calloutKey !== curCallout || lastCallout !== lang) {
      curCallout = calloutKey;
      lastCallout = lang;
      callouts.set(id ? anchorVec : null, id ? COPY[lang].chapters[s.active].callout : '');
    }
    callouts.update(stage.camera, cv.clientWidth, cv.clientHeight);

    if (post) { // focus on the chapter's callout anchor, eased so the pull between chapters is smooth
      const want = id ? stage.camera.position.distanceTo(anchorVec) : focus;
      const f0 = focus;
      focus += (want - focus) * (snap ? 1 : 1 - Math.exp(-dt / 0.2));
      if (Math.abs(want - focus) < 1e-3) focus = want;
      if (focus !== f0) dirty = true;
      post.setDof(s.dof, focus);
    }

    setPanels(s);
    progressEl.style.transform = `scaleX(${pSmooth.toFixed(4)})`;
    $('hint').style.opacity = (1 - clamp01(pSmooth * N * 3)).toFixed(2);

    snap = false;
    if (dirty) stage.invalidate();
    if (++frames === 2) {
      window.__ready = true;
      veilProgress(1);
      document.documentElement.classList.remove('no-3d'); // a slow boot that tripped the 10 s timeout recovers here
      const veil = $('veil');
      if (veil) {
        veil.classList.add('done');
        setTimeout(() => veil.remove(), 900);
      }
    }
  });

  // Always-on test hooks (tiny); the full debug surface only with ?debug.
  window.__debug = {
    geometries: () => stage.renderer.info.memory.geometries,
    textures: () => stage.renderer.info.memory.textures,
    lastRebuildMs: () => lastRebuildMs,
    pendingConfig: () => !!pendingCfg || rebuildT0 != null,
  };
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window.__debug, {
    THREE, tray, caseApi, stage, post, macroKey,
    macroEnv(opts) { stage.scene.userData.macroEnv = stage.buildMacroEnv(opts); if (curBare) setLashEnv(stage.scene.userData.macroEnv); },
  });

  window.__story = {
    chapters: CHAPTERS, // exposed for tuning/tests
    goTo(id) {
      const i = CHAPTERS.findIndex((c) => c.id === id);
      if (i < 0) throw new Error('Unknown chapter ' + id);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, ((i + 0.2) / N) * max);
      readScroll();
      if (window.ScrollTrigger) ScrollTrigger.update();
      pTarget = ((i + 0.2) / N);
      pSmooth = pTarget;
      snap = true;
    },
  };

  stage.start();
}

try {
  await boot();
} catch (e) {
  console.warn('3D unavailable, showing the static page:', e);
  if (window.__fail3d) window.__fail3d(e);
}
