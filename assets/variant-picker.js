// @ts-check
/**
 * <variant-picker> — on option change, requests the section again with `option_values` (Section Rendering API)
 * and swaps the picker plus every `[data-variant-update]` element (price, inventory, add button, info box,
 * sticky bar…) inside the same `.shopify-section`. Updates `?variant=` and emits `variant:change`.
 * Works on the product page and inside the quick-add dialog (data-section-id="quick-add").
 */
import { parseHTML, emit, EVENTS } from '@theme/utils';

class VariantPicker extends HTMLElement {
  /** @type {AbortController | undefined} */
  controller;

  connectedCallback() {
    this.addEventListener('change', this.onChange);
  }

  disconnectedCallback() {
    this.removeEventListener('change', this.onChange);
    this.controller?.abort();
  }

  /** Option value ids of the current selection, in option order. */
  get selectedIds() {
    return [...this.querySelectorAll('input:checked, select')].map((el) =>
      el instanceof HTMLSelectElement ? el.selectedOptions[0]?.dataset.optionValueId : /** @type {HTMLElement} */ (el).dataset.optionValueId
    );
  }

  onChange = async () => {
    const { url, sectionId } = this.dataset;
    if (!url || !sectionId) return;
    this.controller?.abort();
    this.controller = new AbortController();
    const root = this.closest('.shopify-section') || document;
    root.querySelectorAll('[data-variant-update]').forEach((el) => el.setAttribute('aria-busy', 'true'));
    try {
      const params = new URLSearchParams({ option_values: this.selectedIds.join(','), section_id: sectionId });
      const res = await fetch(`${url}?${params}`, { signal: this.controller.signal });
      if (!res.ok) throw new Error(String(res.status));
      this.render(parseHTML(await res.text()), root);
    } catch (error) {
      if (/** @type {Error} */ (error).name === 'AbortError') return;
      root.querySelectorAll('[data-variant-update]').forEach((el) => el.removeAttribute('aria-busy'));
      console.error(error);
    }
  };

  /**
   * @param {Document} doc
   * @param {ParentNode} root
   */
  render(doc, root) {
    const next = doc.getElementById(this.id);
    if (next) {
      const focusedId = this.contains(document.activeElement) ? document.activeElement?.id : null;
      this.innerHTML = next.innerHTML;
      if (focusedId) /** @type {HTMLElement | null} */ (this.querySelector(`#${CSS.escape(focusedId)}`))?.focus();
    }

    root.querySelectorAll('[data-variant-update]').forEach((el) => {
      const fresh = el.id && doc.getElementById(el.id);
      if (fresh) el.replaceWith(document.importNode(fresh, true));
      else el.removeAttribute('aria-busy');
    });

    /** @type {any} */
    let variant = null;
    try {
      variant = JSON.parse(this.querySelector('[data-variant-json]')?.textContent || 'null');
    } catch {}

    if (this.hasAttribute('data-update-url')) {
      const u = new URL(location.href);
      if (variant?.id) u.searchParams.set('variant', variant.id);
      else u.searchParams.delete('variant');
      history.replaceState(history.state, '', u.toString());
    }

    emit(EVENTS.variantChange, { sectionId: this.dataset.sectionId, variant });
  }
}

if (!customElements.get('variant-picker')) customElements.define('variant-picker', VariantPicker);
