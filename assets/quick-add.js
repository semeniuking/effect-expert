// @ts-check
/**
 * <quick-add-dialog> — delegated click on `[data-quick-add="<product url>"]`: fetches `<url>?section_id=quick-add`,
 * injects it into the dialog and opens it with showModal(). Closes on the close button, backdrop, Escape and after
 * a successful add (`product-form:added`), then returns focus to the trigger.
 */
import { closeOnBackdrop, parseHTML } from '@theme/utils';

class QuickAddDialog extends HTMLElement {
  /** @type {HTMLElement | null} */
  trigger = null;
  /** @type {AbortController | undefined} */
  controller;

  connectedCallback() {
    this.dialog = /** @type {HTMLDialogElement} */ (this.querySelector('dialog'));
    this.content = /** @type {HTMLElement} */ (this.querySelector('[data-quick-add-content]'));
    closeOnBackdrop(this.dialog);
    this.dialog.addEventListener('close', this.onClose);
    this.addEventListener('product-form:added', this.close);
    this.querySelector('[data-quick-add-close]')?.addEventListener('click', this.close);
    document.addEventListener('click', this.onDocumentClick);
  }

  disconnectedCallback() {
    document.removeEventListener('click', this.onDocumentClick);
  }

  close = () => this.dialog?.close();

  /** @param {MouseEvent} event */
  onDocumentClick = async (event) => {
    const trigger = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('[data-quick-add]'));
    const href = trigger?.dataset.quickAdd;
    if (!trigger || !href) return;
    event.preventDefault();
    this.trigger = trigger;
    this.controller?.abort();
    this.controller = new AbortController();
    trigger.classList.add('is-loading');
    trigger.setAttribute('aria-busy', 'true');
    try {
      const url = new URL(href, location.origin);
      url.searchParams.set('section_id', 'quick-add');
      const res = await fetch(url, { signal: this.controller.signal });
      if (!res.ok) throw new Error(`Quick add request failed: ${res.status}`);
      const doc = parseHTML(await res.text());
      const section = doc.querySelector('.shopify-section') || doc.body;
      this.render(section);
      this.dialog?.showModal();
    } catch (error) {
      if (/** @type {Error} */ (error).name === 'AbortError') return;
      location.href = href;
    } finally {
      trigger.classList.remove('is-loading');
      trigger.removeAttribute('aria-busy');
    }
  };

  /** @param {Element} section */
  render(section) {
    const content = /** @type {HTMLElement} */ (this.content);
    content.replaceChildren(document.importNode(section, true));
    // Parsed scripts never run; re-create them (each module URL executes only once per page).
    content.querySelectorAll('script[src]').forEach((old) => {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = /** @type {HTMLScriptElement} */ (old).src;
      old.replaceWith(script);
    });
  }

  onClose = () => {
    this.content?.replaceChildren();
    this.trigger?.focus();
    this.trigger = null;
  };
}

if (!customElements.get('quick-add-dialog')) customElements.define('quick-add-dialog', QuickAddDialog);
