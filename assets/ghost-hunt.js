// @ts-check
/**
 * Ghost Hunt by Effect Expert.
 *
 * Loaded by snippets/ghost-hunt.liquid (dynamic import) only when the game is enabled or debug mode is on.
 * The Worker (ghost-hunt-worker/) decides where the 5 white ghosts are today; this file finds those
 * spots on the page, injects the ghosts, and runs the tracker, code check and golden ghost claim.
 */
import { closeOnBackdrop } from '@theme/utils';

/**
 * Fields of the golden ghost claim form. Labels come from `strings[name]` (locales, ghost_hunt.*).
 * Keep the names in sync with GOLDEN_REQUIRED in ghost-hunt-worker/wrangler.toml.
 */
const GOLDEN_FIELDS = [
  { name: 'name', type: 'text', autocomplete: 'name', required: true },
  { name: 'phone', type: 'tel', autocomplete: 'tel', required: true },
  { name: 'email', type: 'email', autocomplete: 'email', required: true },
  { name: 'consent', type: 'checkbox', required: true },
];

const STATE_KEY = 'ghostHunt:v1';
const LAYOUT_KEY = 'ghostHunt:layout';
const OFFSET_KEY = 'ghostHunt:offset';
const DEBUG_KEY = 'ghostHuntDebugKey';
const PLAYER_KEY = 'ghostHunt:player';
const LAYOUT_TTL_MS = 60_000;
const HOME_MIN_IMAGE_SIZE = 150;

const configElement = document.getElementById('GhostHuntConfig');
const config = configElement ? JSON.parse(configElement.textContent || '{}') : null;
const debugKey = /** @type {any} */ (window).GhostHunt?.debugKey || null;

/* ---------------------------------- Storage --------------------------------- */

/**
 * @typedef {object} GhostHuntState
 * @property {Record<string, string>} found - ghost number -> digit
 * @property {string} [promo] - discount code once the right code was entered
 * @property {'won' | 'taken'} [golden]
 */

/** Debug progress is kept apart so testing never touches the team's real progress. */
const stateKey = () => (debugKey ? `${STATE_KEY}:debug` : STATE_KEY);

/** @returns {GhostHuntState} */
function loadState() {
  try {
    return { found: {}, ...JSON.parse(localStorage.getItem(stateKey()) || '{}') };
  } catch {
    return { found: {} };
  }
}

/** @param {GhostHuntState} state */
function saveState(state) {
  try {
    localStorage.setItem(stateKey(), JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private mode); the game still works for this page view.
  }
}

/** @param {string} key */
function sessionGet(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {any} value
 */
function sessionSet(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore: caching is only an optimisation.
  }
}

/* --------------------------------- Analytics -------------------------------- */

/** Random id for this browser, so the Worker's stats count people rather than clicks. */
const player = (() => {
  try {
    let id = localStorage.getItem(PLAYER_KEY);
    if (!id) {
      id = crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(PLAYER_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
})();

/**
 * Publishes a game event to Shopify customer events (for custom pixels, e.g. GA4), to `dataLayer` (GTM)
 * and to `gtag` when present. Debug play is only logged to the console so it never pollutes reports.
 * @param {string} name - e.g. ghost_hunt_catch
 * @param {Record<string, string | number | boolean>} [data]
 */
function track(name, data = {}) {
  if (debugKey) {
    console.debug('[Ghost Hunt] event', name, data);
    return;
  }
  const win = /** @type {any} */ (window);
  try {
    win.Shopify?.analytics?.publish?.(name, data);
  } catch {}
  try {
    (win.dataLayer = win.dataLayer || []).push({ event: name, ...data });
  } catch {}
  try {
    if (typeof win.gtag === 'function') win.gtag('event', name, data);
  } catch {}
}

const apiBase = () => String(config.api).replace(/\/+$/, '');

/**
 * Funnel step the Worker can't see on its own. Fire-and-forget, survives navigation.
 * Sent as text/plain so it needs no CORS preflight.
 * @param {string} type - tracker_open | promo_copy | promo_apply | golden_found
 */
function beacon(type) {
  if (debugKey) return;
  try {
    fetch(`${apiBase()}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ type, player }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

/* ------------------------------------ API ----------------------------------- */

/**
 * @param {string} path
 * @param {object} [body]
 * @returns {Promise<{status: number, data: any}>}
 */
async function api(path, body) {
  /** @type {Record<string, string>} */
  const headers = {};
  if (debugKey) headers['X-Debug-Key'] = debugKey;
  if (body) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${apiBase()}${path}`, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify({ ...body, player }) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

/** @param {{force?: boolean}} [options] */
async function fetchLayout({ force = false } = {}) {
  const offset = debugKey ? Number(sessionGet(OFFSET_KEY)) || 0 : 0;
  const cached = sessionGet(LAYOUT_KEY);
  if (!force && !debugKey && cached && Date.now() - cached.ts < LAYOUT_TTL_MS) return cached.data;

  const { data } = await api(`/layout${offset ? `?offset=${offset}` : ''}`);
  if (!debugKey) sessionSet(LAYOUT_KEY, { ts: Date.now(), data });
  return data;
}

/**
 * @param {string} template
 * @param {Record<string, string | number>} values
 */
function format(template, values) {
  return String(template).replace(/\[(\w+)\]/g, (match, key) => (key in values ? String(values[key]) : match));
}

/* ---------------------------------- Anchors --------------------------------- */

/**
 * Finds where a ghost should sit on the current page. Anchor indexes come from the Worker's layout.js
 * (product photo 0–3, collection card 0–7, home image 0–5) and wrap around when the page has fewer.
 *
 * - product: a slide of <media-gallery> (blocks/_product-media-gallery.liquid). One track serves both the
 *   desktop main image (driven by the thumbnails) and the mobile swipe gallery, so one ghost covers both.
 * - collection: a `.product-card__media` in the collection grid; the ghost overlays it as a sibling because
 *   the media link is `aria-hidden` and can't contain a button.
 * - home: large images in <main> outside product cards; the ghost overlays the image.
 *
 * @param {{type: string, handle?: string, anchor: number}} spot
 * @returns {{container?: HTMLElement, target?: HTMLElement}}
 */
function findAnchor(spot) {
  const page = config.page;
  const main = document.getElementById('MainContent');
  if (!main) return {};

  if (spot.type === 'product') {
    if (page.type !== 'product' || page.product !== spot.handle) return {};
    const slides = /** @type {HTMLElement[]} */ ([
      ...main.querySelectorAll('media-gallery .media-gallery__track > .media-gallery__slide'),
    ]);
    return slides.length ? { container: slides[spot.anchor % slides.length] } : {};
  }

  if (spot.type === 'collection') {
    if (page.type !== 'collection' || page.collection !== spot.handle) return {};
    const cards = /** @type {HTMLElement[]} */ ([...main.querySelectorAll('[data-facets-grid] .product-card__media')]);
    return cards.length ? { target: cards[spot.anchor % cards.length] } : {};
  }

  if (spot.type === 'home') {
    if (page.type !== 'index') return {};
    const images = homeImages(main);
    return images.length ? { target: images[spot.anchor % images.length] } : {};
  }

  return {};
}

/**
 * Large images on the home page, in document order. Deterministic for the same layout and breakpoint.
 * @param {HTMLElement} main
 * @returns {HTMLImageElement[]}
 */
function homeImages(main) {
  return [...main.querySelectorAll('img')].filter((image) => {
    if (image.closest('.product-card, header, footer, .ghost-hunt-ghost')) return false;
    const width = image.offsetWidth || Number(image.getAttribute('width')) || 0;
    const height = image.offsetHeight || Number(image.getAttribute('height')) || 0;
    return width >= HOME_MIN_IMAGE_SIZE && height >= HOME_MIN_IMAGE_SIZE;
  });
}

/* ----------------------------------- Ghost ---------------------------------- */

/**
 * @param {{n?: number, golden?: boolean, x: number, y: number, rot?: number}} spot
 * @param {boolean} debug
 * @returns {HTMLElement}
 */
function createGhost(spot, debug) {
  const ghost = document.createElement('div');
  ghost.className = `ghost-hunt-ghost${spot.golden ? ' ghost-hunt-ghost--golden' : ''}${debug ? ' is-debug' : ''}`;
  ghost.style.setProperty('--ghost-x', `${spot.x}%`);
  ghost.style.setProperty('--ghost-y', `${spot.y}%`);
  ghost.style.setProperty('--ghost-rot', `${spot.rot || 0}deg`);
  ghost.style.setProperty('--ghost-size', `${config.size}px`);
  ghost.style.setProperty('--ghost-opacity', String(spot.golden ? 1 : config.opacity));
  if (debug) ghost.dataset.label = spot.golden ? 'GOLD' : `#${spot.n}`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghost-hunt-ghost__button';
  button.setAttribute('aria-label', spot.golden ? config.strings.goldenLabel : config.strings.ghostLabel);
  // Stop the click here so it never reaches the gallery or the product card link underneath.
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    ghost.dispatchEvent(
      new CustomEvent('ghost-hunt:catch', { bubbles: true, detail: { n: spot.n, golden: !!spot.golden, ghost } }),
    );
  });

  const image = document.createElement('img');
  image.src = spot.golden ? config.images.gold : config.images.white;
  image.alt = '';
  image.width = 200;
  image.height = 185;
  image.draggable = false;
  image.loading = 'lazy';

  button.append(image);
  ghost.append(button);
  return ghost;
}

/**
 * Places a ghost over an element whose container we don't control, using pixel offsets relative to the
 * element's positioned ancestor. Re-positions on resize.
 * @param {HTMLElement} ghost
 * @param {HTMLElement} target
 * @param {{x: number, y: number}} spot
 * @returns {(() => void) | null} cleanup
 */
function overlay(ghost, target, spot) {
  const parent = /** @type {HTMLElement | null} */ (target.offsetParent);
  if (!parent || parent === document.body) return null;

  ghost.classList.add('ghost-hunt-ghost--overlay');
  const position = () => {
    // offsetLeft/Top are relative to offsetParent's padding box, same as absolute positioning.
    ghost.style.left = `${target.offsetLeft + (target.offsetWidth * spot.x) / 100}px`;
    ghost.style.top = `${target.offsetTop + (target.offsetHeight * spot.y) / 100}px`;
  };
  parent.append(ghost);
  position();
  const observer = new ResizeObserver(position);
  observer.observe(target);
  return () => observer.disconnect();
}

/* ------------------------------------ App ----------------------------------- */

/** Tracker button + native modal dialog with the progress and golden ghost panels. */
class GhostHuntApp extends HTMLElement {
  /** @type {Record<string, any>} */
  refs = {};

  /** @type {GhostHuntState} */
  state = loadState();

  /** @type {any} */
  layout = null;

  /** @type {Map<string, {ghosts: HTMLElement[], cleanup: (() => void) | null}>} */
  placed = new Map();

  debug = false;

  /** @type {HTMLElement | null} */
  opener = null;

  /** @type {number | undefined} */
  toastTimer;

  /** @type {MutationObserver | null} */
  observer = null;

  connectedCallback() {
    this.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[/** @type {HTMLElement} */ (el).dataset.ref || ''] = el;
    });
    const { dialog, tracker, close, codeForm, copy, applyLink, goldenForm } = this.refs;
    if (!dialog || !tracker) return;

    closeOnBackdrop(dialog);
    dialog.addEventListener('close', this.onClose);
    close.addEventListener('click', () => dialog.close());
    tracker.addEventListener('click', () => this.openProgress());
    codeForm.addEventListener('submit', this.verifyCode);
    copy.addEventListener('click', this.copyPromo);
    applyLink.addEventListener('click', this.applyPromo);
    goldenForm.addEventListener('submit', this.claimGolden);
    document.addEventListener('ghost-hunt:catch', this.onCatch);

    this.buildGoldenFields();
    this.render();
    this.start();
  }

  disconnectedCallback() {
    document.removeEventListener('ghost-hunt:catch', this.onCatch);
    this.observer?.disconnect();
  }

  async start() {
    try {
      this.layout = await fetchLayout();
    } catch (error) {
      console.warn('[Ghost Hunt] layout unavailable', error);
      return;
    }

    this.debug = !!this.layout?.debug;

    // A wrong ?ghosthunt key must not switch the game on for a visitor while it's disabled.
    if (!this.debug && !config.enabled) {
      if (debugKey) console.warn('[Ghost Hunt] debug key rejected by the Worker');
      return;
    }
    if (!this.layout?.active) return;

    this.render();
    this.placeAll();
    if (this.debug) this.renderDebugPanel();

    // Re-place ghosts whose anchors were replaced (facets.js swapping the product grid, load more, etc.).
    const main = document.getElementById('MainContent');
    if (main) {
      let frame = 0;
      this.observer = new MutationObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => this.placeAll());
      });
      this.observer.observe(main, { childList: true, subtree: true });
    }
  }

  /* ------------------------------ Placement ------------------------------ */

  spots() {
    if (!this.layout?.active) return [];

    const spots = (this.layout.ghosts || [])
      .filter((/** @type {any} */ spot) => !this.state.found[spot.n])
      .map((/** @type {any} */ spot) => ({ ...spot, key: `n${spot.n}` }));

    const golden = config.golden;
    const goldenOn = (golden.enabled || this.debug) && golden.product && this.layout.golden?.available;
    if (goldenOn && !this.state.golden) {
      spots.push({
        key: 'golden',
        golden: true,
        type: 'product',
        handle: golden.product,
        anchor: golden.anchor,
        x: golden.x,
        y: golden.y,
        rot: 0,
      });
    }
    return spots;
  }

  placeAll() {
    const spots = this.spots();
    const wanted = new Set(spots.map((/** @type {any} */ spot) => spot.key));

    for (const [key, entry] of this.placed) {
      if (!wanted.has(key) || entry.ghosts.some((ghost) => !ghost.isConnected)) this.remove(key);
    }

    for (const spot of spots) {
      if (this.placed.has(spot.key)) continue;
      const { container, target } = findAnchor(spot);
      const ghost = createGhost(spot, this.debug);
      let cleanup = null;
      if (container) {
        container.append(ghost);
      } else if (target) {
        cleanup = overlay(ghost, target, spot);
        if (!cleanup) continue;
      } else {
        continue;
      }
      this.placed.set(spot.key, { ghosts: [ghost], cleanup });
    }
  }

  /** @param {string} key */
  remove(key) {
    const entry = this.placed.get(key);
    if (!entry) return;
    entry.cleanup?.();
    for (const ghost of entry.ghosts) ghost.remove();
    this.placed.delete(key);
  }

  /** @param {string} key */
  vanish(key) {
    const entry = this.placed.get(key);
    if (!entry) return;
    entry.cleanup?.();
    this.placed.delete(key);
    for (const ghost of entry.ghosts) {
      ghost.classList.add('is-caught');
      setTimeout(() => ghost.remove(), 600);
    }
  }

  /* ------------------------------- Catching ------------------------------- */

  /** @param {Event} event */
  onCatch = async (event) => {
    const { n, golden } = /** @type {CustomEvent} */ (event).detail;

    if (golden) {
      beacon('golden_found');
      track('ghost_hunt_golden_found');
      this.openPanel('golden');
      return;
    }

    if (this.state.found[n]) return;

    try {
      const { status, data } = await api('/catch', { n });
      if (status !== 200 || !data.digit) {
        this.toast(status === 403 ? config.strings.inactive : config.strings.error);
        return;
      }
      this.state.found[n] = data.digit;
      saveState(this.state);

      const found = Object.keys(this.state.found).length;
      const total = this.layout?.total || 5;
      if (found === 1) track('ghost_hunt_start');
      track('ghost_hunt_catch', { ghost_number: n, found_count: found, total });
      if (found === total) track('ghost_hunt_complete', { total });

      this.vanish(`n${n}`);
      this.render();
      this.toast(format(config.strings.caught, { n, digit: data.digit }));
      this.pulseTracker();
    } catch {
      this.toast(config.strings.error);
    }
  };

  /* -------------------------------- Dialog -------------------------------- */

  openProgress() {
    beacon('tracker_open');
    track('ghost_hunt_open', { found_count: Object.keys(this.state.found).length });
    this.openPanel('progress');
  }

  /** @param {'progress' | 'golden'} panel */
  openPanel(panel) {
    const { dialog, progressPanel, goldenPanel } = this.refs;
    progressPanel.hidden = panel !== 'progress';
    goldenPanel.hidden = panel !== 'golden';
    this.render();
    if (dialog.open) return;
    const active = document.activeElement;
    this.opener = active instanceof HTMLElement && active !== document.body ? active : null;
    dialog.showModal();
  }

  /** Return focus to the opener (a caught golden ghost is gone, so fall back to the tracker). */
  onClose = () => {
    const { tracker } = this.refs;
    const target = this.opener?.isConnected ? this.opener : tracker.hidden ? null : tracker;
    target?.focus({ preventScroll: true });
    this.opener = null;
  };

  render() {
    const total = this.layout?.total || 5;
    const found = this.state.found;
    const count = Object.keys(found).length;
    const { tracker, count: countEl, found: foundEl, bar, slots, result, promo, applyLink, codeForm } = this.refs;

    tracker.hidden = !(count > 0 || this.state.promo || this.debug);
    countEl.textContent = `${count}/${total}`;
    foundEl.textContent = format(config.strings.foundCount, { count, total });
    bar?.style.setProperty('width', `${Math.min(100, (count / total) * 100)}%`);

    slots.replaceChildren(
      ...Array.from({ length: total }, (_, index) => {
        const n = index + 1;
        const digit = found[n] ? String(found[n]).replace(/\D/g, '') : '?';
        const item = document.createElement('li');
        item.className = `ghost-hunt__slot${found[n] ? ' is-found' : ''}`;
        item.setAttribute('aria-label', `${format(config.strings.slot, { n })}: ${found[n] || '?'}`);
        item.innerHTML = `<span class="ghost-hunt__slot-n" aria-hidden="true">${n}</span><span class="ghost-hunt__slot-digit" aria-hidden="true">${digit}</span>`;
        return item;
      }),
    );

    if (this.state.promo) {
      codeForm.hidden = true;
      result.hidden = false;
      promo.textContent = this.state.promo;
      applyLink.href = `/discount/${encodeURIComponent(this.state.promo)}?redirect=${encodeURIComponent(
        config.routes.cart,
      )}`;
    }
  }

  /** @param {SubmitEvent} event */
  verifyCode = async (event) => {
    event.preventDefault();
    const { codeInput, codeMessage } = this.refs;
    const code = codeInput.value.replace(/\D/g, '');
    if (!code) return;

    codeMessage.textContent = '';
    codeInput.removeAttribute('aria-invalid');
    try {
      const { status, data } = await api('/verify', { code });
      track('ghost_hunt_code_submit', { success: !!data.ok });
      if (data.ok && data.discount_code) {
        this.state.promo = data.discount_code;
        saveState(this.state);
        track('ghost_hunt_promo_revealed', { discount_code: data.discount_code });
        this.render();
        return;
      }
      codeMessage.textContent =
        status === 429
          ? config.strings.rateLimited
          : status === 403
            ? config.strings.inactive
            : config.strings.wrongCode;
      codeInput.setAttribute('aria-invalid', 'true');
    } catch {
      codeMessage.textContent = config.strings.error;
    }
  };

  /** @param {MouseEvent} event */
  copyPromo = async (event) => {
    if (!this.state.promo) return;
    const button = /** @type {HTMLElement} */ (event.currentTarget);
    beacon('promo_copy');
    track('ghost_hunt_promo_copy', { discount_code: this.state.promo });
    try {
      await navigator.clipboard.writeText(this.state.promo);
      // The toast sits behind the modal, so confirm on the button itself.
      const label = button.textContent;
      button.textContent = config.strings.copied;
      setTimeout(() => (button.textContent = label), 2000);
    } catch {
      // Clipboard can be blocked; the code is still visible to copy by hand.
    }
  };

  /** Tracks the "apply to cart" click; the /discount/CODE link itself applies the code and goes to the cart. */
  applyPromo = () => {
    beacon('promo_apply');
    track('ghost_hunt_promo_apply', { discount_code: this.state.promo || '' });
  };

  /* -------------------------------- Golden -------------------------------- */

  buildGoldenFields() {
    this.refs.goldenFields.replaceChildren(
      ...GOLDEN_FIELDS.map((field) => {
        const input = document.createElement('input');
        input.id = `GhostHuntGolden-${field.name}`;
        input.name = field.name;
        input.type = field.type;
        input.required = field.required;
        if (field.autocomplete) input.autocomplete = /** @type {any} */ (field.autocomplete);

        const label = document.createElement('label');
        label.htmlFor = input.id;
        const text = config.strings[field.name] || field.name;

        if (field.type === 'checkbox') {
          label.className = 'checkbox ghost-hunt__consent';
          const span = document.createElement('span');
          span.textContent = text;
          label.append(input, span);
          return label;
        }
        const wrapper = document.createElement('div');
        wrapper.className = 'field';
        label.className = 'field__label';
        label.textContent = text;
        input.className = 'input';
        wrapper.append(label, input);
        return wrapper;
      }),
    );
  }

  /** @param {SubmitEvent} event */
  claimGolden = async (event) => {
    event.preventDefault();
    const { goldenForm, goldenMessage } = this.refs;
    const submit = goldenForm.querySelector('[type="submit"]');

    /** @type {Record<string, string>} */
    const body = {};
    let valid = true;
    for (const field of GOLDEN_FIELDS) {
      const input = /** @type {HTMLInputElement} */ (goldenForm.elements.namedItem(field.name));
      const value = field.type === 'checkbox' ? (input.checked ? 'yes' : '') : input.value.trim();
      const ok = input.checkValidity() && (!field.required || !!value);
      input.setAttribute('aria-invalid', String(!ok));
      valid &&= ok;
      body[field.name] = value;
    }
    if (!valid) {
      goldenMessage.textContent = config.strings.invalid;
      return;
    }

    goldenMessage.textContent = '';
    submit?.setAttribute('disabled', '');
    try {
      const { status, data } = await api('/golden/claim', body);
      if (status === 200 && data.ok) {
        this.finishGolden('won');
      } else if (status === 409) {
        this.finishGolden('taken');
      } else if (status === 400) {
        for (const name of data.fields || []) {
          goldenForm.elements.namedItem(name)?.setAttribute?.('aria-invalid', 'true');
        }
        goldenMessage.textContent = config.strings.invalid;
      } else {
        goldenMessage.textContent = status === 403 ? config.strings.inactive : config.strings.error;
      }
    } catch {
      goldenMessage.textContent = config.strings.error;
    } finally {
      submit?.removeAttribute('disabled');
    }
  };

  /** @param {'won' | 'taken'} outcome */
  finishGolden(outcome) {
    const { goldenForm, goldenSuccess, goldenTaken } = this.refs;
    track('ghost_hunt_golden_claim', { result: outcome });
    this.state.golden = outcome;
    saveState(this.state);
    sessionSet(LAYOUT_KEY, null);
    goldenForm.hidden = true;
    goldenSuccess.hidden = outcome !== 'won';
    goldenTaken.hidden = outcome !== 'taken';
    this.vanish('golden');
  }

  /** Shows the golden form again (debug resets). */
  resetGoldenPanel() {
    this.refs.goldenForm.hidden = false;
    this.refs.goldenSuccess.hidden = true;
    this.refs.goldenTaken.hidden = true;
  }

  /* ------------------------------- Feedback ------------------------------- */

  /** @param {string} message */
  toast(message) {
    const { toast } = this.refs;
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.remove('is-visible');
    void toast.offsetWidth;
    toast.classList.add('is-visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
      toast.hidden = true;
    }, 3500);
  }

  pulseTracker() {
    const { tracker } = this.refs;
    tracker.classList.remove('is-pulsing');
    void tracker.offsetWidth;
    tracker.classList.add('is-pulsing');
  }

  /* --------------------------------- Debug -------------------------------- */

  renderDebugPanel() {
    document.querySelector('.ghost-hunt-debug')?.remove();

    const panel = document.createElement('details');
    panel.className = 'ghost-hunt-debug';
    panel.open = sessionGet('ghostHunt:debugOpen') !== false;
    panel.addEventListener('toggle', () => sessionSet('ghostHunt:debugOpen', panel.open));

    const layout = this.layout;
    const root = String(config.routes.root || '/').replace(/\/?$/, '/');
    /** @param {any} spot */
    const linkFor = (spot) =>
      spot.type === 'product'
        ? `${root}products/${spot.handle}`
        : spot.type === 'collection'
          ? `${root}collections/${spot.handle}`
          : root;
    /** @param {any} spot */
    const where = (spot) =>
      spot.type === 'home'
        ? `home · image ${spot.anchor + 1}`
        : spot.type === 'collection'
          ? `${spot.handle} · card ${spot.anchor + 1}`
          : `${spot.handle} · photo ${spot.anchor + 1}`;

    const rows = (layout.ghosts || [])
      .map((/** @type {any} */ spot) => {
        const here = this.placed.has(`n${spot.n}`) ? ' ← here' : '';
        const done = this.state.found[spot.n] ? ' ✓' : '';
        return `<li><a href="${linkFor(spot)}">#${spot.n} ${where(spot)}</a>${done}${here}</li>`;
      })
      .join('');

    const golden = config.golden;
    const goldenRow = golden.product
      ? `<li><a href="${root}products/${golden.product}">GOLD ${golden.product} · photo ${golden.anchor + 1}</a> ${
          layout.golden?.available ? '(test available)' : '(test claimed)'
        }${golden.enabled ? '' : ' · off for customers'}</li>`
      : '<li>GOLD: no product set in theme settings</li>';

    const offset = Number(sessionGet(OFFSET_KEY)) || 0;
    const until = new Date(layout.ends_at).toLocaleString();

    panel.innerHTML = `
      <summary>👻 Ghost Hunt debug</summary>
      <p>Period ${layout.period}${offset ? ` (offset ${offset > 0 ? '+' : ''}${offset})` : ' (today)'} · until ${until}
        <br>Game for customers: <b>${config.enabled ? 'ON' : 'OFF'}</b></p>
      <div class="ghost-hunt-debug__row">
        <button type="button" data-action="prev">‹ prev</button>
        <button type="button" data-action="today">today</button>
        <button type="button" data-action="next">next ›</button>
      </div>
      <ol>${rows}${goldenRow}</ol>
      <div class="ghost-hunt-debug__row">
        <button type="button" data-action="open">Open tracker</button>
        <button type="button" data-action="reset">Reset my progress</button>
        <button type="button" data-action="golden">Reset test golden</button>
        <button type="button" data-action="exit">Exit debug</button>
      </div>`;

    panel.addEventListener('click', (event) => {
      const action = /** @type {HTMLElement} */ (event.target).closest('[data-action]')?.getAttribute('data-action');
      if (action) this.debugAction(action);
    });
    document.body.append(panel);
  }

  /** @param {string} action */
  async debugAction(action) {
    const offset = Number(sessionGet(OFFSET_KEY)) || 0;

    if (action === 'prev' || action === 'next' || action === 'today') {
      const next = action === 'today' ? 0 : offset + (action === 'next' ? 1 : -1);
      sessionSet(OFFSET_KEY, next || null);
      await this.reload();
    } else if (action === 'open') {
      this.openProgress();
    } else if (action === 'reset') {
      this.state = { found: {} };
      saveState(this.state);
      this.refs.codeForm.hidden = false;
      this.refs.result.hidden = true;
      this.resetGoldenPanel();
      await this.reload();
    } else if (action === 'golden') {
      await api('/debug/reset', {});
      this.state.golden = undefined;
      saveState(this.state);
      this.resetGoldenPanel();
      await this.reload();
    } else if (action === 'exit') {
      try {
        localStorage.removeItem(DEBUG_KEY);
      } catch {}
      sessionSet(OFFSET_KEY, null);
      const url = new URL(location.href);
      url.searchParams.delete('ghosthunt');
      location.href = url.toString();
    }
  }

  async reload() {
    for (const key of [...this.placed.keys()]) this.remove(key);
    this.layout = await fetchLayout({ force: true });
    this.render();
    this.placeAll();
    this.renderDebugPanel();
  }
}

if (!customElements.get('ghost-hunt-app')) customElements.define('ghost-hunt-app', GhostHuntApp);

/* ---------------------------------- Mount ----------------------------------- */

if (config && !document.querySelector('ghost-hunt-app')) {
  const template = /** @type {HTMLTemplateElement | null} */ (document.getElementById('GhostHuntTemplate'));
  if (template) document.body.append(template.content.cloneNode(true));
}
