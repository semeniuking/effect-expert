// @ts-check
/**
 * <product-form> — wraps a Shopify product form (`{% form 'product' %}`) and adds to cart via AJAX.
 * Opens the cart drawer on success; shows errors in an optional `[data-form-error]` element inside.
 */
import { addToCart, openCart } from '@theme/cart';

class ProductForm extends HTMLElement {
  connectedCallback() {
    this.form = this.querySelector('form');
    if (!this.form) return;
    this.form.addEventListener('submit', this.onSubmit);
  }

  disconnectedCallback() {
    this.form?.removeEventListener('submit', this.onSubmit);
  }

  /** @param {SubmitEvent} event */
  onSubmit = async (event) => {
    event.preventDefault();
    const form = /** @type {HTMLFormElement} */ (this.form);
    const button = /** @type {HTMLButtonElement | null} */ (form.querySelector('[type="submit"][name="add"]'));
    if (!button || button.getAttribute('aria-disabled') === 'true' || button.disabled) return;
    const error = /** @type {HTMLElement | null} */ (this.querySelector('[data-form-error]'));
    if (error) error.hidden = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    try {
      await addToCart(new FormData(form));
      this.dispatchEvent(new CustomEvent('product-form:added', { bubbles: true }));
      openCart();
    } catch (e) {
      if (error) {
        error.textContent = /** @type {Error} */ (e).message;
        error.hidden = false;
      }
    } finally {
      button.classList.remove('is-loading');
      button.removeAttribute('aria-busy');
    }
  };
}

if (!customElements.get('product-form')) customElements.define('product-form', ProductForm);
