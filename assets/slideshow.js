// @ts-check
/**
 * <slide-show>: enhances a CSS scroll-snap track with line indicators, autoplay and arrow keys.
 * Markup: [data-track] > [data-slide]…, [data-dot="i"] buttons, optional [data-toggle] pause button.
 * Autoplay pauses on hover / focus, while the tab is hidden, and is off for prefers-reduced-motion.
 */
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

class SlideShow extends HTMLElement {
  index = 0;
  /** @type {number | undefined} */
  timer;
  /** Reasons autoplay is currently held: 'hover' | 'focus' | 'hidden' | 'user' | 'editor' */
  holds = new Set();
  frame = 0;

  connectedCallback() {
    this.track = /** @type {HTMLElement} */ (this.querySelector('[data-track]'));
    this.slides = /** @type {HTMLElement[]} */ ([...this.track.querySelectorAll('[data-slide]')]);
    this.dots = /** @type {HTMLButtonElement[]} */ ([...this.querySelectorAll('[data-dot]')]);
    this.toggle = /** @type {HTMLButtonElement | null} */ (this.querySelector('[data-toggle]'));
    this.autoplay = this.dataset.autoplay === 'true' && this.slides.length > 1;
    this.interval = Math.max(2000, Number(this.dataset.interval) || 6000);

    this.dots.forEach((dot, i) => dot.addEventListener('click', () => this.go(i)));
    this.toggle?.addEventListener('click', () => this.setUserPaused(!this.holds.has('user')));
    this.track.addEventListener('scroll', this.onScroll, { passive: true });
    this.addEventListener('keydown', this.onKeydown);

    if (this.autoplay) {
      if (reducedMotion.matches) this.setUserPaused(true);
      this.addEventListener('pointerenter', () => this.hold('hover', true));
      this.addEventListener('pointerleave', () => this.hold('hover', false));
      this.addEventListener('focusin', () => this.hold('focus', true));
      this.addEventListener('focusout', (e) => {
        if (!this.contains(/** @type {Node | null} */ (e.relatedTarget))) this.hold('focus', false);
      });
      document.addEventListener('visibilitychange', this.onVisibility);
    }

    if (window.Shopify?.designMode) {
      this.addEventListener('shopify:block:select', this.onEditorSelect);
      this.addEventListener('shopify:block:deselect', () => this.hold('editor', false));
    }

    this.update(0);
    this.restart();
  }

  disconnectedCallback() {
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** @param {number} i */
  go(i, focus = false) {
    const n = this.slides?.length || 0;
    if (!n || !this.track) return;
    const next = (i + n) % n;
    const slide = this.slides?.[next];
    if (!slide) return;
    this.track.scrollTo({ left: slide.offsetLeft, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    this.update(next);
    if (focus) {
      const target = /** @type {HTMLElement | null} */ (slide.querySelector('a[href]'));
      (target || slide).focus({ preventScroll: true });
    }
    this.restart();
  }

  /** @param {number} i */
  update(i) {
    this.index = i;
    this.slides?.forEach((slide, n) => {
      slide.inert = n !== i;
    });
    this.dots?.forEach((dot, n) => {
      if (n === i) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  }

  onScroll = () => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (!this.track) return;
      const i = Math.round(Math.abs(this.track.scrollLeft) / (this.track.clientWidth || 1));
      if (i !== this.index && this.slides?.[i]) {
        this.update(i);
        this.restart();
      }
    });
  };

  /** @param {KeyboardEvent} e */
  onKeydown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const active = document.activeElement;
    const onDot = active instanceof HTMLElement && active.hasAttribute('data-dot');
    this.go(this.index + step, !onDot);
    if (onDot) this.dots?.[this.index]?.focus();
  };

  onVisibility = () => this.hold('hidden', document.hidden);

  /** @param {Event} e */
  onEditorSelect = (e) => {
    const i = this.slides?.indexOf(/** @type {HTMLElement} */ (e.target)) ?? -1;
    this.hold('editor', true);
    if (i > -1) this.go(i);
  };

  /** @param {boolean} paused */
  setUserPaused(paused) {
    if (!this.toggle) return;
    this.toggle.classList.toggle('is-paused', paused);
    this.toggle.setAttribute('aria-label', (paused ? this.toggle.dataset.labelPlay : this.toggle.dataset.labelPause) || '');
    this.hold('user', paused);
  }

  /** @param {string} reason @param {boolean} on */
  hold(reason, on) {
    if (on) this.holds.add(reason);
    else this.holds.delete(reason);
    this.restart();
  }

  restart() {
    clearTimeout(this.timer);
    if (!this.autoplay || this.holds.size) return;
    this.timer = window.setTimeout(() => this.go(this.index + 1), this.interval);
  }
}

if (!customElements.get('slide-show')) customElements.define('slide-show', SlideShow);
