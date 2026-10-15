// @ts-check
/**
 * Tiny global behaviours that every page needs. Feature modules are loaded by the sections that use them.
 */
import { EVENTS } from '@theme/utils';

// Keep every cart count badge in sync.
document.addEventListener(EVENTS.cartUpdated, (event) => {
  const { cart } = /** @type {CustomEvent} */ (event).detail || {};
  if (!cart) return;
  document.querySelectorAll('[data-cart-count]').forEach((el) => {
    el.textContent = cart.item_count > 0 ? String(cart.item_count) : '';
    el.toggleAttribute('hidden', cart.item_count === 0);
  });
});

// Close open <details data-auto-close> when clicking outside or pressing Escape.
document.addEventListener('click', (event) => {
  document.querySelectorAll('details[data-auto-close][open]').forEach((details) => {
    if (!details.contains(/** @type {Node} */ (event.target))) details.removeAttribute('open');
  });
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  document.querySelectorAll('details[data-auto-close][open]').forEach((details) => {
    details.removeAttribute('open');
    /** @type {HTMLElement | null} */ (details.querySelector('summary'))?.focus();
  });
});
