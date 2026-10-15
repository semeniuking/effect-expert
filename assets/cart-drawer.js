// @ts-check
/**
 * <cart-drawer> — opens its <dialog> on `cart:open` (or a click on [data-cart-open]) and swaps in the
 * re-rendered drawer from `cart:updated` (sections['cart-drawer']), keeping the open state, scroll and focus.
 */
import { EVENTS, closeOnBackdrop, parseHTML } from '@theme/utils';

const SECTION = 'cart-drawer';

class CartDrawer extends HTMLElement {
  connectedCallback() {
    this.dialog = /** @type {HTMLDialogElement | null} */ (this.querySelector('dialog'));
    if (!this.dialog) return;
    closeOnBackdrop(this.dialog);
    this.dialog.addEventListener('close', this.onClose);
    this.addEventListener('click', this.onClick);
    document.addEventListener(EVENTS.cartOpen, this.open);
    document.addEventListener(EVENTS.cartUpdated, this.onUpdated);
    document.addEventListener('click', this.onOpenClick);
  }

  disconnectedCallback() {
    document.removeEventListener(EVENTS.cartOpen, this.open);
    document.removeEventListener(EVENTS.cartUpdated, this.onUpdated);
    document.removeEventListener('click', this.onOpenClick);
  }

  open = () => {
    const dialog = this.dialog;
    if (!dialog || dialog.open) return;
    const active = document.activeElement;
    // Keep the original opener when the drawer is reopened from inside another dialog (e.g. quick add).
    if (active instanceof HTMLElement && !this.contains(active)) this.opener = active;
    dialog.showModal();
  };

  close = () => this.dialog?.close();

  onClose = () => {
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = null;
  };

  /** @param {Event} event */
  onClick = (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest('[data-cart-close]')) this.close();
  };

  /** Header cart links marked with [data-cart-open] open the drawer instead of navigating. @param {Event} event */
  onOpenClick = (event) => {
    const trigger = /** @type {HTMLElement} */ (event.target).closest?.('[data-cart-open]');
    if (!trigger) return;
    event.preventDefault();
    this.open();
  };

  /** @param {Event} event */
  onUpdated = (event) => {
    const html = /** @type {CustomEvent} */ (event).detail?.sections?.[SECTION];
    const current = this.querySelector('.drawer__inner');
    if (!html || !current) return;
    const next = parseHTML(html).querySelector(`[data-cart-section="${SECTION}"] .drawer__inner`);
    if (!next) return;

    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    const focusId = active && current.contains(active) ? active.id : '';
    const keepValue = active?.matches('[data-preserve-value]') ? /** @type {HTMLTextAreaElement} */ (active) : null;
    const selection = keepValue ? [keepValue.selectionStart, keepValue.selectionEnd] : null;
    const openDetails = [...current.querySelectorAll('details[id][open]')].map((d) => d.id);
    const scroll = current.querySelector('.drawer__body')?.scrollTop || 0;
    const hadFocus = !!active && current.contains(active);

    current.innerHTML = next.innerHTML;

    openDetails.forEach((id) => document.getElementById(id)?.setAttribute('open', ''));
    const body = current.querySelector('.drawer__body');
    if (body) body.scrollTop = scroll;

    if (!hadFocus || !this.dialog?.open) return;
    const target = focusId ? /** @type {HTMLElement | null} */ (document.getElementById(focusId)) : null;
    if (target) {
      if (keepValue && 'value' in target) {
        /** @type {HTMLTextAreaElement} */ (target).value = keepValue.value;
        if (selection) /** @type {HTMLTextAreaElement} */ (target).setSelectionRange(selection[0], selection[1]);
      }
      target.focus({ preventScroll: true });
    } else {
      // The focused element is gone (e.g. a removed line): keep focus inside the dialog.
      /** @type {HTMLElement | null} */ (current.querySelector('[data-cart-close]'))?.focus({ preventScroll: true });
    }
  };
}

if (!customElements.get('cart-drawer')) customElements.define('cart-drawer', CartDrawer);
