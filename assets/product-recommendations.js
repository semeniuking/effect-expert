// @ts-check
/**
 * <product-recommendations> — when the element nears the viewport, fetches
 * `routes.product_recommendations_url?product_id=&limit=&intent=&section_id=` and swaps in the rendered grid.
 * Falls back to a second intent (data-fallback, e.g. "related") when the first returns no products.
 */
import { parseHTML } from '@theme/utils';

class ProductRecommendations extends HTMLElement {
  connectedCallback() {
    if (this.querySelector('[data-recommendations]')) return;
    this.observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        this.observer?.disconnect();
        this.load();
      },
      { rootMargin: '0px 0px 400px 0px' }
    );
    this.observer.observe(this);
  }

  disconnectedCallback() {
    this.observer?.disconnect();
  }

  async load() {
    const { fallback, intent } = this.dataset;
    for (const current of [intent, fallback].filter(Boolean)) {
      try {
        const content = await this.fetchIntent(/** @type {string} */ (current));
        if (content) return this.render(content);
      } catch (error) {
        console.error(error);
        return;
      }
    }
  }

  /** @param {string} intent */
  async fetchIntent(intent) {
    const { url, productId, limit, sectionId } = this.dataset;
    const params = new URLSearchParams({ product_id: productId || '', limit: limit || '4', intent, section_id: sectionId || '' });
    const res = await fetch(`${url}?${params}`);
    if (!res.ok) throw new Error(`Recommendations request failed: ${res.status}`);
    return parseHTML(await res.text()).querySelector('product-recommendations [data-recommendations]');
  }

  /** @param {Element} content */
  render(content) {
    this.replaceChildren(document.importNode(content, true));
    // Scripts inserted this way don't run; re-create them (modules execute once per URL).
    this.querySelectorAll('script[src]').forEach((old) => {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = /** @type {HTMLScriptElement} */ (old).src;
      old.replaceWith(script);
    });
  }
}

if (!customElements.get('product-recommendations')) customElements.define('product-recommendations', ProductRecommendations);
