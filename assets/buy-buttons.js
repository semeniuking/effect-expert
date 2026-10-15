// @ts-check
/**
 * <buy-buttons> — quantity stepper (−/+ within min/max/step) and the live total in the add button
 * (`[data-total]` = button[data-price] × quantity). Recomputes after `variant:change` swaps the button.
 */
import { formatMoney, EVENTS } from '@theme/utils';

class BuyButtons extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', this.onClick);
    this.addEventListener('input', this.update);
    document.addEventListener(EVENTS.variantChange, this.update);
    this.update();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.onClick);
    this.removeEventListener('input', this.update);
    document.removeEventListener(EVENTS.variantChange, this.update);
  }

  get input() {
    return /** @type {HTMLInputElement | null} */ (this.querySelector('.quantity__input'));
  }

  /** @param {MouseEvent} event */
  onClick = (event) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('[data-step]'));
    const input = this.input;
    if (!button || !input) return;
    const step = Number(input.step) || 1;
    const min = Number(input.min) || 1;
    const max = Number(input.max) || Infinity;
    const value = (Number(input.value) || min) + Number(button.dataset.step) * step;
    input.value = String(Math.min(max, Math.max(min, value)));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    this.update();
  };

  update = () => {
    const input = this.input;
    const qty = Math.max(1, Number(input?.value) || 1);
    const add = /** @type {HTMLElement | null} */ (this.querySelector('[name="add"]'));
    const total = this.querySelector('[data-total]');
    if (add && total) total.textContent = formatMoney(Number(add.dataset.price) * qty);
    if (!input) return;
    const [minus, plus] = /** @type {NodeListOf<HTMLButtonElement>} */ (this.querySelectorAll('[data-step]'));
    if (minus) minus.disabled = qty <= (Number(input.min) || 1);
    if (plus) plus.disabled = !!input.max && qty >= Number(input.max);
  };
}

if (!customElements.get('buy-buttons')) customElements.define('buy-buttons', BuyButtons);
