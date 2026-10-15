// @ts-check
/**
 * <cart-discount> — applies and removes discount codes with `updateCart({ discount: 'A,B' })`.
 * Applied codes come from [data-codes]; a code the cart can't use is removed again and an error is shown.
 */
import { updateCart } from '@theme/cart';

class CartDiscount extends HTMLElement {
  connectedCallback() {
    this.addEventListener('submit', this.onSubmit);
    this.addEventListener('click', this.onClick);
  }

  disconnectedCallback() {
    this.removeEventListener('submit', this.onSubmit);
    this.removeEventListener('click', this.onClick);
  }

  get codes() {
    return (this.dataset.codes || '')
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean);
  }

  /** Section root this element is rendered in; the element itself is replaced after each cart update. */
  get root() {
    const name = /** @type {HTMLElement | null} */ (this.closest('[data-cart-section]'))?.dataset.cartSection;
    return name ? `[data-cart-section="${name}"] ` : '';
  }

  /** @param {Event} event */
  onSubmit = async (event) => {
    event.preventDefault();
    const form = /** @type {HTMLFormElement} */ (event.target);
    const input = /** @type {HTMLInputElement} */ (form.elements.namedItem('discount'));
    const button = /** @type {HTMLButtonElement | null} */ (form.querySelector('[type="submit"]'));
    const code = input.value.trim();
    if (!code) return input.focus();
    const existing = this.codes;
    if (existing.some((c) => c.toLowerCase() === code.toLowerCase())) {
      input.value = '';
      return;
    }
    const root = this.root;
    const errorEl = /** @type {HTMLElement | null} */ (this.querySelector('[data-discount-error]'));
    const template = errorEl?.dataset.template || '';
    const generic = errorEl?.dataset.generic || '';
    if (errorEl) errorEl.hidden = true;
    button?.classList.add('is-loading');
    try {
      const cart = await updateCart({ discount: [...existing, code].join(',') });
      if (!isApplied(cart, code)) {
        await updateCart({ discount: existing.join(',') }).catch(() => {});
        showError(root, template.replace('%CODE%', code));
      }
    } catch (e) {
      showError(root, /** @type {Error} */ (e).message || generic);
    } finally {
      button?.classList.remove('is-loading');
    }
  };

  /** @param {Event} event */
  onClick = (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('[data-remove-code]');
    if (!(button instanceof HTMLElement)) return;
    const remove = (button.dataset.removeCode || '').toLowerCase();
    button.classList.add('is-loading');
    updateCart({ discount: this.codes.filter((c) => c.toLowerCase() !== remove).join(',') })
      .catch(() => {})
      .finally(() => button.classList.remove('is-loading'));
  };
}

/**
 * @param {any} cart - cart JSON returned by /cart/update.js
 * @param {string} code
 */
function isApplied(cart, code) {
  const c = code.toLowerCase();
  if (Array.isArray(cart.discount_codes)) {
    return cart.discount_codes.some((/** @type {any} */ d) => String(d.code).toLowerCase() === c && d.applicable);
  }
  const titles = [
    ...(cart.cart_level_discount_applications || []),
    ...(cart.items || []).flatMap((/** @type {any} */ i) => (i.line_level_discount_allocations || []).map((/** @type {any} */ a) => a.discount_application)),
  ].map((a) => String(a?.title).toLowerCase());
  return titles.includes(c);
}

/**
 * Show the message in the freshly rendered discount block.
 * @param {string} root
 * @param {string} message
 */
function showError(root, message) {
  const el = /** @type {HTMLElement | null} */ (document.querySelector(`${root}[data-discount-error]`));
  if (!el || !message) return;
  el.textContent = message;
  el.hidden = false;
}

if (!customElements.get('cart-discount')) customElements.define('cart-discount', CartDiscount);
