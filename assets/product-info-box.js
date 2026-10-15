// @ts-check
/**
 * <product-info-box> — keeps the "free shipping: X left" line in sync with the cart after `cart:updated`.
 * The rest of the box (bonus for the selected variant) is re-rendered by variant-picker.js.
 */
import { formatMoney, EVENTS } from '@theme/utils';

class ProductInfoBox extends HTMLElement {
  connectedCallback() {
    document.addEventListener(EVENTS.cartUpdated, this.onCart);
  }

  disconnectedCallback() {
    document.removeEventListener(EVENTS.cartUpdated, this.onCart);
  }

  /** @param {Event} event */
  onCart = (event) => {
    const { cart } = /** @type {CustomEvent} */ (event).detail || {};
    const line = this.querySelector('[data-free-shipping]');
    if (!cart || !line) return;
    const remaining = Number(this.dataset.threshold) - Number(cart.total_price);
    line.textContent =
      remaining > 0
        ? (this.dataset.remainingText || '').replace('[[remaining]]', formatMoney(remaining))
        : this.dataset.reachedText || '';
  };
}

if (!customElements.get('product-info-box')) customElements.define('product-info-box', ProductInfoBox);
