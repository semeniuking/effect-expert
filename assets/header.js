// @ts-check
/**
 * <header-component>: sticky shadow on scroll, --header-height on :root, burger drawer,
 * search dialog open/close, and the cart link that opens the cart drawer.
 */
import { closeOnBackdrop } from '@theme/utils';
import { openCart } from '@theme/cart';

if (!customElements.get('header-component')) {
  class HeaderComponent extends HTMLElement {
    /** @type {HTMLElement | null} */
    #opener = null;
    #desktop = matchMedia('(min-width: 1100px)');
    /** @type {ResizeObserver | undefined} */
    #resizeObserver;
    /** @type {HTMLDialogElement | null} */
    #drawer = null;
    /** @type {HTMLDialogElement | null} */
    #search = null;
    #onScroll = () => this.classList.toggle('is-scrolled', window.scrollY > 0);
    #onBreakpoint = () => {
      if (this.#desktop.matches && this.#drawer?.open) this.#drawer.close();
    };

    connectedCallback() {
      this.#drawer = /** @type {HTMLDialogElement | null} */ (this.querySelector('#HeaderDrawer'));
      this.#search = /** @type {HTMLDialogElement | null} */ (document.getElementById('SearchDialog'));

      this.#resizeObserver = new ResizeObserver(([entry]) => {
        const height = entry.borderBoxSize?.[0]?.blockSize ?? this.offsetHeight;
        document.documentElement.style.setProperty('--header-height', `${Math.round(height)}px`);
      });
      this.#resizeObserver.observe(this);

      if (this.hasAttribute('data-sticky')) {
        window.addEventListener('scroll', this.#onScroll, { passive: true });
        this.#onScroll();
      }

      this.#desktop.addEventListener('change', this.#onBreakpoint);
      this.addEventListener('click', this.#onClick);

      for (const dialog of [this.#drawer, this.#search]) {
        if (!dialog) continue;
        closeOnBackdrop(dialog);
        dialog.addEventListener('close', () => this.#onDialogClose(dialog));
      }
    }

    disconnectedCallback() {
      this.#resizeObserver?.disconnect();
      window.removeEventListener('scroll', this.#onScroll);
      this.#desktop.removeEventListener('change', this.#onBreakpoint);
    }

    /** @param {MouseEvent} event */
    #onClick = (event) => {
      const target = /** @type {HTMLElement} */ (event.target);
      const trigger = /** @type {HTMLElement | null} */ (
        target.closest('[data-drawer-open], [data-drawer-close], [data-search-open], [data-search-close], [data-cart-drawer]')
      );
      if (!trigger) return;

      if (trigger.matches('[data-drawer-open]')) {
        this.#open(this.#drawer, trigger);
      } else if (trigger.matches('[data-drawer-close]')) {
        this.#drawer?.close();
      } else if (trigger.matches('[data-search-open]')) {
        if (!this.#search) return;
        event.preventDefault();
        this.#open(this.#search, trigger);
        /** @type {HTMLInputElement | null} */ (this.#search.querySelector('input[type="search"]'))?.focus();
      } else if (trigger.matches('[data-search-close]')) {
        this.#search?.close();
      } else if (trigger.matches('[data-cart-drawer]')) {
        event.preventDefault();
        openCart();
      }
    };

    /**
     * @param {HTMLDialogElement | null} dialog
     * @param {HTMLElement} opener
     */
    #open(dialog, opener) {
      if (!dialog || dialog.open) return;
      this.#opener = opener;
      dialog.showModal();
      opener.setAttribute('aria-expanded', 'true');
    }

    /** @param {HTMLDialogElement} dialog */
    #onDialogClose(dialog) {
      const opener = this.#opener;
      this.#opener = null;
      this.querySelectorAll(`[aria-controls="${dialog.id}"][aria-expanded]`).forEach((el) => el.setAttribute('aria-expanded', 'false'));
      if (opener?.isConnected && opener.offsetParent !== null) opener.focus();
    }
  }

  customElements.define('header-component', HeaderComponent);
}
