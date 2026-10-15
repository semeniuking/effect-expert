// @ts-check
/**
 * <sticky-atc> — bottom add-to-cart bar. Visible once the main product form (`product-form[data-main]` in the
 * same section) has scrolled above the viewport; its button submits that form so quantity and variant match.
 */
class StickyAtc extends HTMLElement {
  /** @type {IntersectionObserver | undefined} */
  observer;

  connectedCallback() {
    this.addEventListener('click', this.onClick);
    const target = this.target;
    if (!target) return;
    this.observer = new IntersectionObserver(([entry]) => {
      this.toggle(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    this.observer.observe(target);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.onClick);
    this.observer?.disconnect();
  }

  get target() {
    const root = this.closest('.shopify-section') || document;
    return root.querySelector('product-form[data-main]');
  }

  /** @param {boolean} show */
  toggle(show) {
    this.classList.toggle('is-visible', show);
    this.inert = !show;
    this.setAttribute('aria-hidden', String(!show));
    // Lets other floating UI (e.g. the Ghost Hunt counter) move above the bar while it is visible.
    const bar = /** @type {HTMLElement | null} */ (this.firstElementChild);
    document.documentElement.style.setProperty('--sticky-atc-offset', show && bar ? `${bar.offsetHeight}px` : '0px');
  }

  /** @param {MouseEvent} event */
  onClick = (event) => {
    if (!(/** @type {HTMLElement} */ (event.target).closest('[data-sticky-add]'))) return;
    this.target?.querySelector('form')?.requestSubmit();
  };
}

if (!customElements.get('sticky-atc')) customElements.define('sticky-atc', StickyAtc);
