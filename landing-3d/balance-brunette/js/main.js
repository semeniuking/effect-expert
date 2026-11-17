import * as THREE from 'three';
import { createStage } from './stage.js';
import { createLashTray } from './lashes.js';
import { createCase } from './case.js';
import { loadFonts } from './textures.js';
import { CHAPTERS, sampleStory } from './story.js';
import { COPY } from './copy.js';
import { createCallouts } from './callouts.js';
import { createPost } from './post.js';

const PRODUCT_URL = 'https://effect-expert.com/products/balance-mix-brunette';
const LENGTHS = [6, 6, 7, 7, 8, 8, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11, 12, 12, 13];
const N = CHAPTERS.length;
const narrowMq = window.matchMedia('(max-width: 768px)');
const lowPower = (navigator.hardwareConcurrency || 8) <= 4;

const $ = (id) => document.getElementById(id);
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
    (i === N - 1 ? '<div class="buy"><span class="price"></span><a target="_blank" rel="noopener"></a></div>' : '');
  if (i === N - 1) p.classList.add('side');
  overlay.appendChild(p);
  return p;
});

function applyLang() {
  const t = COPY[lang];
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
  $('lang').textContent = t.ui.lang;
  $('hint').textContent = t.ui.scroll;
  lastCallout = null;
}
let lastCallout = null;
$('lang').addEventListener('click', () => {
  lang = lang === 'uk' ? 'en' : 'uk';
  try { localStorage.setItem('lang', lang); } catch (e) { /* ignore */ }
  applyLang();
});

// ---------- 3D ----------
const mobileGfx = narrowMq.matches || lowPower;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const stage = createStage($('stage'), { mobile: mobileGfx });
const callouts = createCallouts($('callouts'));

await loadFonts();
const portrait = new Image();
portrait.src = 'assets/portrait.jpg';
await portrait.decode();
const loadImg = async (src) => {
  const im = new Image();
  im.src = src;
  try { await im.decode(); return im; } catch (e) { return null; }
};
const swatches = await Promise.all(['assets/swatch-top.jpg', 'assets/swatch-bot.jpg'].map(loadImg));

const caseApi = createCase({ renderer: stage.renderer, portrait, swatches, lengths: LENGTHS, curl: 'L', thickness: '0.07' });
const tray = createLashTray({
  curl: 'L', thickness: '0.07', lengths: LENGTHS, renderer: stage.renderer,
  perStrip: narrowMq.matches || lowPower ? 110 : 260,
});
tray.group.position.y = caseApi.insertSurfaceY;
caseApi.group.add(tray.group);
stage.scene.add(caseApi.group);
// ?empty: debug view of the bare acrylic case (no cards, no lashes) to judge glass clarity.
if (new URLSearchParams(location.search).has('empty')) {
  ['insert-card', 'lid-card'].forEach((n) => { const o = caseApi.group.getObjectByName(n); if (o) o.visible = false; });
  tray.group.visible = false;
}
const contact = stage.addContactShadow(caseApi.group, { opacity: new URLSearchParams(location.search).has('noshadow') ? 0 : 0.2, darkness: 0.8, blur: 3.5 });
let shadowKey = '';
// Photographic finish: bokeh + grain + vignette. Desktop only; mobile / reduced motion render directly.
const post = createPost(stage, { enabled: !mobileGfx && !reducedMotion });
if (post) stage.render = (dt) => post.render(dt);
let focus = 10;
let curPress = 0.3;
applyLang();

// Row brightness fade (setHighlight snaps, so fade the material colours here).
const rowMats = tray.rows.map((r) => r.materials[0]);
const allMats = tray.rows.flatMap((r) => r.materials); // ribbon + fibre fringe
const baseCol = rowMats[0].color.clone();
const rowF = tray.rows.map(() => 1);
// rowF: 1 = full colour; the active row keeps its normal brunette, every other row dims ~45 %.
function rowTarget(h, k) { return h == null || h === k ? 1 : 0.55; }
function applyRowF() { tray.rows.forEach((r, k) => r.materials.forEach((m) => m.color.copy(baseCol).multiplyScalar(rowF[k]))); }

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
const progressEl = $('progress');

function setPanels(s) {
  panels.forEach((p, i) => {
    let o = 0, dy = 12;
    if (i === s.index) { o = 1 - clamp01(s.blend * 2); dy = -12 * (1 - o); }
    else if (i === s.index + 1) { o = clamp01(s.blend * 2 - 1); dy = 12 * (1 - o); }
    p.style.opacity = o.toFixed(3);
    p.style.transform = `translateY(${dy.toFixed(1)}px)`;
    p.classList.toggle('live', o > 0.5);
  });
}

// Keep the product clear of the text: shift the image right (desktop) or up (mobile).
// In macro chapters the curtain column owns that area, so shift by exactly its size.
const curtainEl = $('curtain');
function applyViewOffset(cam, w, h, narrow, curtain) {
  if (narrow) {
    const cur = curtainEl.offsetHeight / 2;
    cam.setViewOffset(w, h, 0, h * 0.12 + (cur - h * 0.12) * curtain, w, h);
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

  stage.setView(s.cam);
  const cv = stage.renderer.domElement;
  applyViewOffset(stage.camera, cv.clientWidth, cv.clientHeight, narrow, s.curtain);
  curtainEl.style.opacity = s.curtain.toFixed(3);

  // Fibres lie pressed under the closed lid and spring to natural curl for the macro chapters.
  // Quantised so the geometry is rebuilt only a handful of times per transition, never per frame.
  const pq = Math.round(s.press * 10) / 10;
  if (pq !== curPress) { curPress = pq; tray.setPress(pq); }
  // Macro lighting rig: the studio env hits the vertical curl faces weakly, so lift the fibres' env share
  // as the strips spring up (tray view keeps the dark #170907-ish read).
  const envI = 0.4 + clamp01((s.press - 0.3) / 0.7) * 0.8; // capped ~1.2: more washes the fibres to orange
  for (const m of allMats) m.envMapIntensity = envI;
  caseApi.setLidOpen(smooth(s.lid));
  const heroW = s.index === 0 ? 1 - s.blend : 0;
  caseApi.group.rotation.y = s.yaw + Math.sin(time * 0.55) * (8 * Math.PI / 180) * heroW;
  // Contact shadow only depends on lid angle + yaw: re-render when they change (quantised), not per frame.
  const key = `${(smooth(s.lid) * 90).toFixed(0)}|${(caseApi.group.rotation.y * 200).toFixed(0)}`;
  if (key !== shadowKey) { shadowKey = key; caseApi.group.updateMatrixWorld(true); contact.update(); }

  // highlight fade (~350 ms)
  const fk = snap ? 1 : 1 - Math.exp(-dt / 0.12);
  for (let r = 0; r < rowF.length; r++) rowF[r] += (rowTarget(s.highlight, r) - rowF[r]) * fk;
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
  if (id !== curCallout || lastCallout !== lang) {
    curCallout = id;
    lastCallout = lang;
    callouts.set(id ? anchorVec : null, id ? COPY[lang].chapters[s.active].callout : '');
  }
  callouts.update(stage.camera, cv.clientWidth, cv.clientHeight);

  if (post) { // focus on the chapter's callout anchor, eased so the pull between chapters is smooth
    const want = id ? stage.camera.position.distanceTo(anchorVec) : focus;
    focus += (want - focus) * (snap ? 1 : 1 - Math.exp(-dt / 0.2));
    post.setDof(s.dof, focus);
  }

  setPanels(s);
  progressEl.style.transform = `scaleX(${pSmooth.toFixed(4)})`;
  $('hint').style.opacity = (1 - clamp01(pSmooth * N * 3)).toFixed(2);

  snap = false;
  if (++frames === 2) window.__ready = true;
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
