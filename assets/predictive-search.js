// @ts-check
/**
 * <predictive-search>: debounced suggestions inside the search dialog.
 * Fetches sections/predictive-search.liquid through the predictive search endpoint, cancels stale requests
 * with AbortController and caches answers per query. Popular-search chips show while the field is empty.
 * Arrow keys move between the input and the results.
 */
import { debounce, fetchSection, theme } from '@theme/utils';

if (!customElements.get('predictive-search')) {
  class PredictiveSearch extends HTMLElement {
    /** @type {AbortController | undefined} */
    #controller;
    /** @type {Map<string, string>} */
    #cache = new Map();
    /** @type {HTMLInputElement | null} */
    #input = null;
    /** @type {HTMLElement | null} */
    #results = null;
    /** @type {HTMLElement | null} */
    #status = null;
    /** @type {HTMLElement | null} */
    #popular = null;

    connectedCallback() {
      this.#input = /** @type {HTMLInputElement | null} */ (this.querySelector('input[type="search"]'));
      this.#results = /** @type {HTMLElement | null} */ (this.querySelector('[data-search-results]'));
      this.#status = /** @type {HTMLElement | null} */ (this.querySelector('[data-search-status]'));
      this.#popular = /** @type {HTMLElement | null} */ (this.querySelector('[data-search-popular]'));
      if (!this.#input || !this.#results) return;

      this.#input.addEventListener('input', this.#onInput);
      this.addEventListener('keydown', this.#onKeydown);
      if (this.#input.value.trim()) this.#onInput();
    }

    #onInput = debounce(() => {
      const query = this.#input?.value.trim() || '';
      if (!query) return this.#clear();
      this.#search(query);
    }, 250);

    /** @param {string} query */
    async #search(query) {
      const cached = this.#cache.get(query);
      if (cached !== undefined) return this.#render(cached);

      this.#controller?.abort();
      this.#controller = new AbortController();
      this.#results?.setAttribute('aria-busy', 'true');

      const params = new URLSearchParams({
        q: query,
        'resources[type]': 'product,collection,query',
        'resources[limit]': '6',
        'resources[limit_scope]': 'each',
      });
      try {
        const doc = await fetchSection(`${theme().routes.predictiveSearch}?${params}`, 'predictive-search', this.#controller.signal);
        const html = doc.querySelector('[data-predictive-results]')?.outerHTML || '';
        this.#cache.set(query, html);
        // Ignore answers for a query the shopper has already changed.
        if (this.#input?.value.trim() === query) this.#render(html);
      } catch (error) {
        if (/** @type {Error} */ (error).name !== 'AbortError') this.#clear();
      } finally {
        this.#results?.removeAttribute('aria-busy');
      }
    }

    /** @param {string} html */
    #render(html) {
      if (!this.#results) return;
      this.#results.innerHTML = html;
      this.#results.hidden = !html;
      if (this.#popular) this.#popular.hidden = Boolean(html);
      if (this.#status) this.#status.textContent = this.#results.querySelector('[data-results-status]')?.textContent?.trim() || '';
    }

    #clear() {
      this.#controller?.abort();
      if (this.#results) {
        this.#results.innerHTML = '';
        this.#results.hidden = true;
      }
      if (this.#popular) this.#popular.hidden = false;
      if (this.#status) this.#status.textContent = '';
    }

    /** @param {KeyboardEvent} event */
    #onKeydown = (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = /** @type {HTMLElement[]} */ (
        [...this.querySelectorAll('[data-result]')].filter((el) => /** @type {HTMLElement} */ (el).offsetParent !== null)
      );
      if (!items.length || !this.#input) return;
      event.preventDefault();
      const index = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
      const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
      if (next < 0) this.#input.focus();
      else items[Math.min(next, items.length - 1)].focus();
    };
  }

  customElements.define('predictive-search', PredictiveSearch);
}
