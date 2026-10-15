// @ts-check
/**
 * <cart-upsell data-url data-exclude data-limit> — when it comes into view, loads complementary products
 * (sections/cart-upsell.liquid through the recommendations endpoint), drops products already in the cart and
 * shows up to `data-limit` rows. Responses are cached per URL, so cart re-renders don't refetch.
 */
import { parseHTML } from '@theme/utils';

/** @type {Map<string, Promise<string>>} */
const cache = new Map();
/** @type {Map<string, string>} */
const resolved = new Map();

class CartUpsell extends HTMLElement {
  connectedCallback() {
    if (!this.dataset.url) return;
    // Already loaded (e.g. the drawer was just re-rendered): render right away to avoid a flash.
    const ready = resolved.get(this.dataset.url);
    if (ready !== undefined) return this.render(ready);
    this.observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        this.observer?.disconnect();
        this.load();
      },
      { rootMargin: '200px' }
    );
    this.observer.observe(this);
  }

  disconnectedCallback() {
    this.observer?.disconnect();
  }

  async load() {
    const url = /** @type {string} */ (this.dataset.url);
    if (!cache.has(url)) {
      cache.set(
        url,
        fetch(url)
          .then((res) => (res.ok ? res.text() : ''))
          .catch(() => '')
          .then((html) => {
            resolved.set(url, html);
            return html;
          })
      );
    }
    const html = await cache.get(url);
    if (this.isConnected) this.render(html || '');
  }

  /** @param {string} html */
  render(html) {
    if (!html) return;
    const exclude = (this.dataset.exclude || '').split(',');
    const limit = Number(this.dataset.limit) || 3;
    const rows = [...parseHTML(html).querySelectorAll('[data-upsell-list] > [data-product-id]')]
      .filter((row) => !exclude.includes(/** @type {HTMLElement} */ (row).dataset.productId || ''))
      .slice(0, limit);
    const list = this.querySelector('[data-upsell-list]');
    const inner = /** @type {HTMLElement | null} */ (this.querySelector('.cart-upsell__inner'));
    if (!rows.length || !list || !inner) return;
    list.replaceChildren(...rows.map((row) => document.importNode(row, true)));
    inner.hidden = false;
  }
}

if (!customElements.get('cart-upsell')) customElements.define('cart-upsell', CartUpsell);
