// @ts-check
/**
 * <cart-note> — saves the order note with `updateCart({ note })` shortly after the shopper stops typing.
 */
import { updateCart } from '@theme/cart';
import { debounce } from '@theme/utils';

class CartNote extends HTMLElement {
  connectedCallback() {
    this.addEventListener('input', this.onInput);
  }

  disconnectedCallback() {
    this.removeEventListener('input', this.onInput);
  }

  /** @param {string} note */
  save = debounce((note) => {
    updateCart({ note }).catch(() => {});
  }, 700);

  /** @param {Event} event */
  onInput = (event) => {
    const field = /** @type {HTMLTextAreaElement} */ (event.target);
    if (field.name === 'note') this.save(field.value);
  };
}

if (!customElements.get('cart-note')) customElements.define('cart-note', CartNote);
