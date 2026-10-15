// @ts-check
/**
 * <media-gallery> — one scroll-snap track of product media. Desktop: thumbnail buttons swap the visible slide.
 * Mobile: swipe, with a "1 / 4" counter and progress dashes. Scrolls to the variant's featured media on
 * `variant:change` and pauses videos that leave the view.
 */
import { EVENTS } from '@theme/utils';

class MediaGallery extends HTMLElement {
  index = 0;
  /** @type {number | undefined} */
  frame;

  connectedCallback() {
    this.track = /** @type {HTMLElement | null} */ (this.querySelector('[data-track]'));
    if (!this.track) return;
    this.slides = /** @type {HTMLElement[]} */ ([...this.track.children]);
    this.track.addEventListener('scroll', this.onScroll, { passive: true });
    this.addEventListener('click', this.onClick);
    document.addEventListener(EVENTS.variantChange, this.onVariant);
    const start = Number(this.dataset.start) || 0;
    if (start) this.go(start, false);
  }

  disconnectedCallback() {
    this.track?.removeEventListener('scroll', this.onScroll);
    this.removeEventListener('click', this.onClick);
    document.removeEventListener(EVENTS.variantChange, this.onVariant);
  }

  /**
   * @param {number} i
   * @param {boolean} [smooth]
   */
  go(i, smooth = true) {
    const slide = this.slides?.[i];
    if (!slide || !this.track) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.track.scrollTo({ left: slide.offsetLeft, behavior: smooth && !reduce ? 'smooth' : 'auto' });
    this.setActive(i);
  }

  /** @param {number} i */
  setActive(i) {
    if (i === this.index && this.dataset.ready) return;
    this.index = i;
    this.dataset.ready = 'true';
    const counter = this.querySelector('[data-counter]');
    if (counter) counter.textContent = String(i + 1);
    this.querySelectorAll('[data-index]').forEach((thumb) => {
      const on = Number(/** @type {HTMLElement} */ (thumb).dataset.index) === i;
      if (on) thumb.setAttribute('aria-current', 'true');
      else thumb.removeAttribute('aria-current');
    });
    this.querySelectorAll('[data-dot]').forEach((dot, n) => dot.classList.toggle('is-active', n === i));
    this.slides?.forEach((slide, n) => {
      if (n !== i) slide.querySelectorAll('video').forEach((video) => video.pause());
    });
  }

  onScroll = () => {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      const track = /** @type {HTMLElement} */ (this.track);
      this.setActive(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)));
    });
  };

  /** @param {MouseEvent} event */
  onClick = (event) => {
    const thumb = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('[data-index]'));
    if (thumb) this.go(Number(thumb.dataset.index));
  };

  /** @param {Event} event */
  onVariant = (event) => {
    const { sectionId, variant } = /** @type {CustomEvent} */ (event).detail || {};
    if (sectionId !== this.dataset.sectionId || !variant?.featured_media) return;
    const i = (this.slides || []).findIndex((s) => s.dataset.mediaId === String(variant.featured_media.id));
    if (i > -1) this.go(i);
  };
}

if (!customElements.get('media-gallery')) customElements.define('media-gallery', MediaGallery);
