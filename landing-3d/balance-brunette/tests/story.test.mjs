import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, sampleStory } from '../js/story.js';
import { COPY } from '../js/copy.js';

const IDS = ['hero', 'case', 'tray', 'color', 'taper', 'tips', 'tape', 'labels', 'configure'];

test('chapter ids in order', () => assert.deepEqual(CHAPTERS.map((c) => c.id), IDS));

test('p=0 and p=1 hit first/last chapter', () => {
  assert.deepEqual(sampleStory(CHAPTERS, 0).cam, CHAPTERS[0].cam);
  assert.deepEqual(sampleStory(CHAPTERS, 1).cam, CHAPTERS.at(-1).cam);
});

test('p clamps', () => {
  assert.deepEqual(sampleStory(CHAPTERS, -1), sampleStory(CHAPTERS, 0));
  assert.deepEqual(sampleStory(CHAPTERS, 2), sampleStory(CHAPTERS, 1));
});

test('1000 samples are finite and lid in [0,1]', () => {
  for (let i = 0; i < 1000; i++) {
    const s = sampleStory(CHAPTERS, i / 999);
    for (const v of [...s.cam.pos, ...s.cam.target, s.cam.fov, s.lid, s.yaw, s.local]) {
      assert.ok(Number.isFinite(v));
    }
    assert.ok(s.lid >= 0 && s.lid <= 1);
  }
});

test('hold zone equals the chapter exactly', () => {
  const N = CHAPTERS.length;
  CHAPTERS.forEach((c, i) => {
    const p = (i + 0.2) / N;
    const s = sampleStory(CHAPTERS, p);
    assert.equal(s.index, i);
    assert.deepEqual(s.cam, c.cam);
    assert.equal(s.lid, c.lid);
    assert.equal(s.yaw, c.yaw);
    assert.equal(s.highlight, c.highlight);
    assert.equal(s.callout, c.callout);
  });
});

test('highlight/callout switch at blend midpoint', () => {
  const N = CHAPTERS.length;
  const i = 2; // tray -> color
  const before = sampleStory(CHAPTERS, (i + 0.4 + 0.6 * 0.45) / N);
  const after = sampleStory(CHAPTERS, (i + 0.4 + 0.6 * 0.55) / N);
  assert.equal(before.highlight, CHAPTERS[i].highlight);
  assert.equal(after.highlight, CHAPTERS[i + 1].highlight);
  assert.equal(after.callout, CHAPTERS[i + 1].callout);
});

test('mobile picks camMobile when present', () => {
  const alt = CHAPTERS.map((c, i) => (i === 0 ? { ...c, camMobile: { pos: [1, 2, 3], target: [0, 0, 0], fov: 40 } } : c));
  assert.deepEqual(sampleStory(alt, 0, { mobile: true }).cam.pos, [1, 2, 3]);
  assert.deepEqual(sampleStory(alt, 0).cam, alt[0].cam);
  CHAPTERS.forEach((c, i) => {
    const m = sampleStory(CHAPTERS, (i + 0.2) / CHAPTERS.length, { mobile: true });
    assert.deepEqual(m.cam, c.camMobile || c.cam);
  });
});

test('curl-profile chapters are bare (no acrylic shell) and bareMix follows the blend', () => {
  const N = CHAPTERS.length;
  for (const id of ['color', 'taper', 'tips']) {
    const i = CHAPTERS.findIndex((c) => c.id === id);
    const s = sampleStory(CHAPTERS, (i + 0.2) / N);
    assert.equal(s.bare, true, id);
    assert.equal(s.bareMix, 1, id);
  }
  for (const id of ['hero', 'tray', 'tape']) {
    const i = CHAPTERS.findIndex((c) => c.id === id);
    const s = sampleStory(CHAPTERS, (i + 0.2) / N);
    assert.equal(s.bare, false, id);
    assert.equal(s.bareMix, 0, id);
  }
  const i = CHAPTERS.findIndex((c) => c.id === 'tray'); // tray -> color: mid-move
  const mid = sampleStory(CHAPTERS, (i + 0.4 + 0.6 * 0.5) / N);
  assert.ok(mid.bareMix > 0.3 && mid.bareMix < 0.7);
});

test('copy complete in both languages', () => {
  for (const lang of ['uk', 'en']) {
    assert.ok(COPY[lang].ui);
    for (const id of IDS) {
      const c = COPY[lang].chapters[id];
      for (const k of ['kicker', 'title', 'body', 'callout']) assert.equal(typeof c[k], 'string', `${lang}.${id}.${k}`);
      assert.ok(c.title && c.body && c.kicker);
    }
  }
});
