// @ts-check
/**
 * <cart-items> — quantity stepper, quantity input and remove links for cart lines ([data-key]) inside it.
 * Changes go through `changeLine` with a per-line loading state; errors from `cart:error` show on the line.
 * When the element itself carries [data-cart-section] (the cart page), it also swaps in its re-rendered HTML on `cart:updated`.
 */
import { changeLine } from '@theme/cart';
import { EVENTS, parseHTML } from '@theme/utils';

class CartItems extends HTMLElement {
  /** @type {Map<string, number>} */
  timers = new Map();
  /** @type {HTMLElement | null} */
  pendingLine = null;

  connectedCallback() {
    this.addEventListener('click', this.onClick);
    this.addEventListener('change', this.onChange);
    document.addEventListener(EVENTS.cartError, this.onError);
    if (this.dataset.cartSection) document.addEventListener(EVENTS.cartUpdated, this.onUpdated);
  }

  disconnectedCallback() {
    document.removeEventListener(EVENTS.cartError, this.onError);
    document.removeEventListener(EVENTS.cartUpdated, this.onUpdated);
    this.timers.forEach((t) => clearTimeout(t));
  }

  /** @param {Event} event */
  onClick = (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('[data-qty], [data-remove]');
    const line = /** @type {HTMLElement | null} */ (button?.closest('[data-key]'));
    if (!button || !line || !this.contains(line)) return;
    event.preventDefault();
    if (button.hasAttribute('data-remove')) return this.update(line, 0);

    const input = this.inputOf(line);
    if (!input) return;
    const step = Number(input.step) || 1;
    const max = input.max ? Number(input.max) : Infinity;
    const next = Math.min(max, Math.max(0, (Number(input.value) || 0) + (button.dataset.qty === 'plus' ? step : -step)));
    input.value = String(next);
    // Let quick repeated taps settle into one request.
    const key = /** @type {string} */ (line.dataset.key);
    clearTimeout(this.timers.get(key));
    this.timers.set(key, window.setTimeout(() => this.update(line, next), 350));
  };

  /** @param {Event} event */
  onChange = (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (!input.matches('.quantity__input')) return;
    const line = /** @type {HTMLElement | null} */ (input.closest('[data-key]'));
    if (line) this.update(line, Math.max(0, parseInt(input.value, 10) || 0));
  };

  /** @param {HTMLElement} line */
  inputOf(line) {
    return /** @type {HTMLInputElement | null} */ (line.querySelector('.quantity__input'));
  }

  /**
   * @param {HTMLElement} line
   * @param {number} quantity
   */
  async update(line, quantity) {
    const key = /** @type {string} */ (line.dataset.key);
    this.timers.delete(key);
    if (quantity === Number(line.dataset.quantity)) return;
    const error = /** @type {HTMLElement | null} */ (line.querySelector('[data-line-error]'));
    if (error) error.hidden = true;
    this.pendingLine = line;
    line.classList.add('is-loading');
    line.setAttribute('aria-busy', 'true');
    try {
      await changeLine(key, quantity);
    } catch {
      const input = this.inputOf(line);
      if (input) input.value = line.dataset.quantity || '1';
    } finally {
      this.pendingLine = null;
      line.classList.remove('is-loading');
      line.removeAttribute('aria-busy');
    }
  }

  /** @param {Event} event */
  onError = (event) => {
    if (!this.pendingLine) return;
    const message = /** @type {CustomEvent} */ (event).detail?.message || window.Theme.strings.cartError;
    const target = /** @type {HTMLElement | null} */ (
      this.pendingLine.querySelector('[data-line-error]') || this.querySelector('[data-cart-error]')
    );
    if (!target) return;
    target.textContent = message;
    target.hidden = false;
  };

  /** @param {Event} event */
  onUpdated = (event) => {
    const name = this.dataset.cartSection;
    const html = /** @type {CustomEvent} */ (event).detail?.sections?.[name || ''];
    if (!html) return;
    const next = parseHTML(html).querySelector(`[data-cart-section="${name}"]`);
    if (!next) return;

    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    const hadFocus = !!active && this.contains(active);
    const focusId = hadFocus ? active.id : '';
    const keepValue = hadFocus && active.matches('[data-preserve-value]') ? /** @type {HTMLTextAreaElement} */ (active) : null;
    const selection = keepValue ? [keepValue.selectionStart, keepValue.selectionEnd] : null;
    const openDetails = [...this.querySelectorAll('details[id][open]')].map((d) => d.id);

    this.innerHTML = next.innerHTML;

    openDetails.forEach((id) => document.getElementById(id)?.setAttribute('open', ''));
    if (!hadFocus) return;
    const target = focusId ? /** @type {HTMLElement | null} */ (document.getElementById(focusId)) : null;
    if (target) {
      if (keepValue && 'value' in target) {
        /** @type {HTMLTextAreaElement} */ (target).value = keepValue.value;
        if (selection) /** @type {HTMLTextAreaElement} */ (target).setSelectionRange(selection[0], selection[1]);
      }
      target.focus({ preventScroll: true });
    } else {
      const heading = /** @type {HTMLElement | null} */ (this.querySelector('h1'));
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  };
}

if (!customElements.get('cart-items')) customElements.define('cart-items', CartItems);
