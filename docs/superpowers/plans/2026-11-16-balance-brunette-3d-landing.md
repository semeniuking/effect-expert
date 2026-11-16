# BALANCE Brunette 3D Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone, photoreal real-time 3D landing page for the EFFECT EXPERT "BALANCE MIX Brunette" lash tray with an Apple-style pinned scroll story and a live configurator finale.

**Architecture:** Static `index.html` + ES modules, no build. Pure math modules (`lash-curve.js`, `story.js`, `copy.js`) are DOM/three-free and unit-tested with `node --test`. Three.js modules build the case, insert card and ~5,000 instanced fibres; GSAP ScrollTrigger scrubs a pure `sampleStory(p)` that drives camera, lid, highlight and callouts. Playwright smoke test renders every chapter to PNG.

**Tech Stack:** three@0.170.0 (importmap → `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js`, addons → `https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/`), GSAP 3.12.5 + ScrollTrigger (`https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js`, `.../ScrollTrigger.min.js`), Google Font **Jost** 300/400/500, Node 22 `node:test`, global `playwright`.

**Spec:** `docs/superpowers/specs/2026-11-16-balance-brunette-3d-landing-design.md` (read it; product facts live there). Reference photos: `landing-3d/balance-brunette/reference/`. Portrait for the lid card: `landing-3d/balance-brunette/assets/portrait.jpg`.

## Global Constraints

- Root: `landing-3d/balance-brunette/` (all paths below are relative to it). Never touch theme folders.
- Units: **1 three.js unit = 1 cm**. Y is up. Product lies flat; tray long axis = Z; "top of tray" (logo end) = −Z.
- Tray half outer size: 7.6 (X) × 0.9 (Y) × 16.4 (Z). Hinge line: x = −3.8, y = 0.9, along Z. Lid open = lid lies flat at x ∈ [−11.4, −3.8] (rotated 180° about the hinge); closed = lid on top of tray.
- Row layout: 20 rows, pitch 0.5 cm, row 0 (6 mm) nearest the logo; lash bases sit on a strip from x = −2.4 to x = +2.6; fibres point toward −Z and curl up (+Y).
- Lengths: `[6,6,7,7,8,8,9,9,9,10,10,10,10,11,11,11,11,12,12,13]` mm. Default bend `'L'`, thickness `'0.07'`.
- Brunette fibre base colour `#3a2420`, highlight tone `#6b4a3e`. Sticky tape `#f3e9b5`. Page background warm off-white `#f2f1ef`, ink `#111`.
- Fibres per strip: desktop 260, mobile (`matchMedia('(max-width: 768px)')` or `navigator.hardwareConcurrency <= 4`) 110. Pixel ratio cap 2 (mobile 1.5).
- Fibre rendered radius = real radius × `VISUAL_THICKNESS = 1.6` (readability).
- Product URL: `https://effect-expert.com/products/balance-mix-brunette`. Price `480 ₴`.
- `window.__ready = true` once the first frame with the full product has rendered; `window.__story = { goTo(chapterId) }` for tests.
- Zero console errors/warnings from our code. No new npm dependencies; no `package.json`.
- Implementers commit their own task (`git add` only their files) on the current branch.

## Review Focus

1. Resize / orientation change mid-scroll → canvas, camera aspect and callout positions stay correct (Task 1 resize test + Task 4 smoke at 390×844).
2. Fast scroll / jump to end (`goTo('configure')`) → no NaN camera, lid fully open, callout hidden or correct (Task 4 `sampleStory` bounds tests).
3. Switching bend/thickness repeatedly in the configurator → no geometry/texture leaks (old geometries `dispose()`d), insert tags reprint (Task 5 test: `renderer.info.memory.geometries` stable after 10 toggles).
4. `prefers-reduced-motion` → no idle turntable, scroll still works (Task 5).
5. CDN font slow/missing → canvas textures still draw with fallback sans after `document.fonts.load` timeout of 2 s (Task 3).

---

### Task 1: Scaffold, stage and smoke harness

**Files:**
- Create: `index.html`, `styles.css`, `js/stage.js`, `js/main.js`, `tests/smoke.mjs`, `tests/serve.sh`, `.gitignore` (ignores `tests/out/`)

**Interfaces:**
- Produces: `createStage(canvas: HTMLCanvasElement, { mobile: boolean }) → { renderer, scene, camera, setView({ pos: [x,y,z], target: [x,y,z], fov: number }), onFrame(cb: (dt:number)=>void), resize(), start() }`
- Produces: `tests/smoke.mjs` CLI: `node tests/smoke.mjs [--w 1440 --h 900] [--chapters a,b,c]` → serves the folder on a free port, opens it in Chromium (`--use-angle=swiftshader --enable-unsafe-swiftshader`), waits for `window.__ready` (60 s), fails on any console `error`, writes `tests/out/<w>x<h>-<chapter|boot>.png`, and asserts the canvas screenshot's pixel std-dev > 6 (not blank).

- [ ] **Step 1:** Write `tests/smoke.mjs` (plain Node, `import { chromium } from 'playwright'` via `createRequire`; static server with `node:http`, correct MIME for `.js/.mjs/.css/.jpg/.png`). When `window.__story` is absent it only shoots `boot`.
- [ ] **Step 2:** Run `node tests/smoke.mjs` → expect FAIL (no index.html / `__ready` timeout).
- [ ] **Step 3:** `index.html`: importmap (three + `three/addons/`), Jost font link, GSAP scripts, `<canvas id="stage">` inside `<div class="stage">` (position: fixed, inset 0), `<main id="story">` placeholder, `<script type="module" src="js/main.js">`. `stage.js`: WebGLRenderer (antialias, `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, exposure 1.0, `shadowMap` PCFSoft), PMREM of `RoomEnvironment` as `scene.environment`, background `#f2f1ef`, key DirectionalLight (shadow 2048, from upper-left-front), soft rim light from behind, `ShadowMaterial` ground plane (opacity 0.18) at y = 0, PerspectiveCamera fov 30. Resize via ResizeObserver. `main.js` for now: stage + a 7.6×0.9×16.4 placeholder box, render, set `window.__ready`.
- [ ] **Step 4:** Run `node tests/smoke.mjs` and `node tests/smoke.mjs --w 390 --h 844` → PASS, look at `tests/out/*boot.png` (box visible, shadow, no letterboxing).

### Task 2: Lash fibres (pure curve math + instanced tray)

**Files:**
- Create: `js/lash-curve.js` (no imports), `js/lashes.js`, `tests/lash-curve.test.mjs`

**Interfaces:**
- Produces (`lash-curve.js`): `CURLS` (keys exactly `B, C, CC, D, L, LB, LC, 'L SOFT', M`, each `{ straightFrac, radiusMm, sweepDeg }`), `THICKNESSES = ['0.05','0.07','0.1']`, `TRAY_LENGTHS` (spec array), `lashCurve(curlKey, lengthMm, segments = 24) → Array<[forwardMm, upMm]>` (starts `[0,0]`, initial tangent `(1,0)`; straight run of `straightFrac·L`, then an arc of `radiusMm` bending up until `sweepDeg` or length is used, remainder continues straight along the tangent), `fiberRadius(u, baseRadiusMm) → mm` (constant for u ≤ 2/3, smoothstep taper to `0.06·base` at u = 1).
- Starting curl table (tune visually against `reference/macro-colors.png`, keep tests green): B `{0,9,45}`, C `{0,7,60}`, CC `{0,6,72}`, D `{0,5.2,85}`, L `{0.45,2,75}`, LB `{0.4,3,62}`, LC `{0.35,3.5,72}`, 'L SOFT' `{0.45,3.5,58}`, M `{0.3,2.5,80}`.
- Produces (`lashes.js`): `createLashTray({ curl='L', thickness='0.07', perStrip, lengths=TRAY_LENGTHS }) → { group, rows: Array<{ index, lengthMm, mesh: InstancedMesh, baseZ }>, setCurl(key), setThickness(t), setHighlight(rowIndex|null), getAnchor(name) → THREE.Vector3 (world) }`. Anchor names: `row:<i>:tip`, `row:<i>:base`, `row:<i>:taper` (point at u = 2/3), `tape:<i>`. `group` origin = insert-card surface (Task 4 places it at `caseApi.insertSurfaceY`).

- [ ] **Step 1: Write failing tests** `tests/lash-curve.test.mjs`:
  - every CURLS key × lengths 6/10/13: polyline arc length within 1 % of `lengthMm`; first point `[0,0]`; all `up ≥ −1e-6`; `up` monotonic non-decreasing.
  - `D` end height (10 mm) > `B` end height; `L` has `up === 0` for its first `0.4·L`.
  - `fiberRadius(0.5, 0.035) === 0.035`; `fiberRadius(1, 0.035) ≈ 0.0021`; strictly decreasing on (2/3, 1].
- [ ] **Step 2:** `node --test tests/` → FAIL.
- [ ] **Step 3:** Implement `lash-curve.js`.
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5:** Implement `lashes.js`: one `BufferGeometry` per row (tube swept along `lashCurve`, 5 radial × 24 segments, radius from `fiberRadius` × `VISUAL_THICKNESS`, ends capped at the base, converted mm→cm, forward = −Z, up = +Y); one `InstancedMesh` per row with per-instance jitter (x spacing ±0.3 of pitch, yaw ±1.5°, length scale 0.99–1.01, instanceColor lightness ±6 %). Material: `MeshPhysicalMaterial` colour `#3a2420`, roughness 0.38, clearcoat 0.6, clearcoatRoughness 0.25, sheen 0.6, sheenColor `#6b4a3e`, castShadow. Each row also gets: light-yellow tape (0.9 cm × 0.06 cm × 5.0 cm thin box, `#f3e9b5`, roughness 0.55) under the bases. `setHighlight(i)` lerps non-selected rows' instanceColor to 25 % brightness (and back on `null`). `setCurl/setThickness` rebuild row geometries and `dispose()` the old ones.
- [ ] **Step 6:** Temporarily mount the tray in `main.js` (top-down + macro views), run `node tests/smoke.mjs`, compare `tests/out/` against `reference/open-tray.jpg` and `reference/macro-colors.png`; adjust spacing/colour until it reads as dense dark-brunette rows with visible curl. Report the screenshots you looked at.

### Task 3: Acrylic case, insert card and printed textures

**Files:**
- Create: `js/textures.js`, `js/case.js`

**Interfaces:**
- Produces (`textures.js`): `loadFonts() → Promise<void>` (loads Jost 300/400/500, resolves after 2 s max), `makeInsertTexture({ lengths, curl, thickness }) → CanvasTexture` (2048 × 4096 canvas mapped to the 7.0 × 15.8 cm card; boxed "EFFECT"/"EXPERT" logo top-left, "BALĀNCE" wordmark top-right letter-spaced; per row left tag `${curl}\n${thickness}` and right length number, rows aligned to the Global Constraints layout; bottom white tape text `${curl} ${thickness} ${max}MM` twice), `makeLidCardTexture(portrait: HTMLImageElement) → CanvasTexture` (layout of `reference/closed-front.jpg`: two dark brunette swatch bars with a subtle fibre sheen, boxed logo, portrait, "HANDS CREATE - WORLD ADMIRE"). Anisotropy = `renderer.capabilities.getMaxAnisotropy()` (pass renderer in or set later).
- Produces (`case.js`): `createCase({ renderer, portrait, lengths, curl, thickness }) → { group, lid: Object3D, setLidOpen(t: 0..1), setPrint({ curl, thickness }), insertSurfaceY: number, getAnchor(name) → Vector3 (world) }`. Anchors: `hinge`, `clasp`, `logo`, `wordmark`, `lid-card`.

- [ ] **Step 1:** Implement `textures.js`; verify by temporarily mounting each texture on a plane in `main.js` and running `node tests/smoke.mjs` — text crisp, matches references.
- [ ] **Step 2:** Implement `case.js`: each half is a hollow rounded box (outer 7.6 × 0.9 × 16.4, wall 0.12, corner radius 0.25) built from `RoundedBoxGeometry` shells or extruded rounded-rect frames + floor; material `MeshPhysicalMaterial` { transmission 1, thickness 0.3, ior 1.49, roughness 0.04, clearcoat 1, attenuationColor `#e9f3f1`, attenuationDistance 8, specularIntensity 1 }. Bevelled edges must catch highlights (that is what sells acrylic). Two hinge knuckles (cylinders) at z = ±5.6 on the hinge line, one clasp tab mid-length on each free edge. Insert card (insert texture, roughness 0.6) lies on the tray floor; lid card (lid texture) inside the lid, print facing out when closed. `setLidOpen(0)` = closed, `1` = 180° open, eased by caller. `setPrint` redraws the insert texture and disposes the old one.
- [ ] **Step 3:** Mount case in `main.js` with lid at 0, 0.5, 1; run smoke; compare with `reference/closed-front.jpg` and `reference/open-tray.jpg`. Report the screenshots you looked at.

### Task 4: Scroll story, copy and callouts

**Files:**
- Create: `js/story.js` (pure data + math, no imports), `js/copy.js` (pure), `js/callouts.js`, `tests/story.test.mjs`
- Modify: `index.html`, `styles.css`, `js/main.js`, `tests/smoke.mjs` (shoot every chapter via `__story.goTo`)

**Interfaces:**
- Consumes: Task 1 `createStage`, Task 2 `createLashTray`, Task 3 `createCase`.
- Produces (`story.js`): `CHAPTERS: Array<{ id, cam: { pos, target, fov }, lid: number, yaw: number, highlight: number|null, callout: string|null }>` with ids in order `hero, case, tray, color, taper, tips, tape, labels, configure`; `sampleStory(chapters, p) → { cam, lid, yaw, highlight, callout, index, local }` — each chapter owns `1/N` of progress, holds for the first 40 % of its slice, then smoothstep-blends to the next over the remaining 60 %; `highlight`/`callout` switch at the blend midpoint; `p` clamped to [0,1].
- Produces (`copy.js`): `COPY = { uk: { ui, chapters: { [id]: { kicker, title, body } } }, en: {...} }`. Ukrainian copy from the product description (spec); EN is a faithful translation.
- Produces (`callouts.js`): `createCallouts(root: HTMLElement) → { set(anchorWorld: Vector3|null, label: string), update(camera, width, height) }` — dot + thin vertical 1px line + letter-spaced uppercase label (style of `reference/macro-colors.png`), fades on change, hidden when the anchor is behind the camera.

Chapter content (camera values are starting points to tune by screenshot):

| id | view | lid | highlight | callout |
|---|---|---|---|---|
| hero | 3/4 front-above of closed case, case fills ~55 % of height, idle yaw sway ±8° | 0 | null | null |
| case | rises above while lid opens | 0→1 | null | `hinge` |
| tray | top-down, whole open product | 1 | null | `wordmark` |
| color | macro, 35° from table, rows 8–12 | 1 | 10 | `row:10:tip` "BRUNETTE" |
| taper | extreme macro side view of row 19 tips | 1 | 19 | `row:19:taper` |
| tips | grazing angle along tips of row 12 | 1 | 12 | `row:12:tip` |
| tape | macro at bases of rows 4–6 | 1 | 5 | `tape:5` |
| labels | macro at left tags + right numbers rows 0–3 | 1 | null | `logo` |
| configure | 3/4 view of open tray, product shifted left to leave room for the panel | 1 | null | null |

- [ ] **Step 1: Write failing tests** `tests/story.test.mjs`: `sampleStory(CHAPTERS, 0).cam` equals `CHAPTERS[0].cam`; `p = 1` equals last chapter; `p = -1` and `p = 2` clamp; for 1,000 evenly spaced `p` no NaN and `lid ∈ [0,1]`; inside a hold zone values equal the chapter's exactly; ids are the 9 above in order; every id has `kicker/title/body` in both `COPY.uk` and `COPY.en`.
- [ ] **Step 2:** `node --test tests/` → FAIL; implement `story.js`, `copy.js`; → PASS.
- [ ] **Step 3:** Page: `#story` gets one `<section class="chapter" data-id>` per chapter (100vh each, last one 140vh); overlay text block fixed bottom-left (desktop) / bottom (mobile), large Jost 300 title (clamp 32–72 px), small uppercase kicker, 16–18 px body; text cross-fades by `index/local`. GSAP ScrollTrigger on `#story` (`start: 'top top'`, `end: 'bottom bottom'`, `scrub: 0.6`) feeds `p` to `sampleStory`; per frame apply cam (`setView`), `caseApi.setLidOpen(easeInOut(lid))`, product group yaw, `lashes.setHighlight`, callouts. Header: small boxed EFFECT EXPERT logo left, UA/EN toggle right. Scroll progress hairline at top. Mount `window.__story.goTo(id)` (instant: `window.scrollTo` to the hold zone + sync render).
- [ ] **Step 4:** Smoke at 1440×900 and 390×844 for all chapters → PASS; inspect every PNG: each chapter frames its feature, callout lands on it, text readable and not covering the subject. Tune `CHAPTERS` values; tests stay green.

### Task 5: Configurator finale, polish and performance

**Files:**
- Modify: `index.html`, `styles.css`, `js/main.js`, `js/copy.js`, `tests/smoke.mjs`

**Interfaces:**
- Consumes: `lashes.setCurl/setThickness`, `caseApi.setPrint`, `COPY`.

- [ ] **Step 1:** Configure chapter panel (right side desktop, bottom sheet mobile): segmented buttons Bend (9 options), Thickness (3), static Length note "6–13 mm", price `480 ₴`, CTA "Купити" / "Buy" → product URL (`target="_blank" rel="noopener"`). Buttons call `setCurl/setThickness/setPrint`; fibres morph via a 300 ms blend (rebuild at end is fine if simpler) — no frame hitch > 100 ms on desktop.
- [ ] **Step 2:** Add smoke check: on `configure`, click every bend then each thickness, assert `renderer.info.memory.geometries` (exposed as `window.__debug.geometries()`) after equals before ±2, and no console errors; screenshot `configure-D-0.1.png`.
- [ ] **Step 3:** Polish: loading veil with thin progress line until `__ready`; idle hero sway disabled under `prefers-reduced-motion`; `devicePixelRatio` cap; mobile fibre count; pause rendering when tab hidden; render only on change after the hero (dirty flag) to save battery; `<meta>` title/description/OG image (`assets/og.jpg` = a hero screenshot).
- [ ] **Step 4:** Full smoke (both sizes, all chapters) + `node --test tests/` → PASS; report timings and screenshots reviewed.

### Task 6 (controller): Whole-branch review, publish

- [ ] Dispatch a fresh reviewer over the whole folder against spec + plan; fix findings.
- [ ] Controller visually inspects every chapter PNG; commit; push `feature/eloquent-dijkstra-2lwziv`.
- [ ] Publish as a private Artifact (`index.html` + `files` for `js/*`, `styles.css`, `assets/*`) and give the user the link.
