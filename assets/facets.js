// @ts-check
/**
 * <facet-filters> wraps the collection and search sections. It handles filtering, sorting and "load more" with
 * the Section Rendering API, and the filters drawer.
 *
 * Markup contract:
 * - form[data-facets-form]: the GET form with filter inputs (the sort <select> joins it through `form=`)
 * - dialog[data-facets-drawer], opened by [data-facets-open] and closed by [data-facets-close]
 * - a[data-facet-link]: chip, "clear all" and reset links; a[data-load-more]: link to the next page
 * - swapped after each update: REPLACE below; [data-facets-count] only gets its text updated (live region)
 * Without JS the form submits normally and every link is a real link.
 */
import { closeOnBackdrop, debounce, fetchSection, replaceFrom } from '@theme/utils';

const REPLACE = [
  '[data-facets-list]',
  '[data-facets-active]',
  '[data-facets-results]',
  '[data-facets-show]',
  '[data-facets-badge]',
  '[data-facets-quick]',
];

class FacetFilters extends HTMLElement {
  /** @type {AbortController | undefined} */
  controller;
  /** @type {HTMLElement | null} */
  trigger = null;

  connectedCallback() {
    this.sectionId = this.dataset.sectionId || '';
    this.current = location.pathname + location.search;
    this.form = /** @type {HTMLFormElement | null} */ (this.querySelector('form[data-facets-form]'));
    this.drawer = /** @type {HTMLDialogElement | null} */ (this.querySelector('dialog[data-facets-drawer]'));
    this.applyPrice = debounce(() => this.applyForm(), 700);
    this.addEventListener('change', this.onChange);
    this.addEventListener('input', this.onInput);
    this.addEventListener('submit', this.onSubmit);
    this.addEventListener('click', this.onClick);
    window.addEventListener('popstate', this.onPopState);
    if (this.drawer) {
      closeOnBackdrop(this.drawer);
      this.drawer.addEventListener('close', this.onDrawerClose);
    }
    this.desktop = window.matchMedia('(min-width: 1100px)');
    this.desktop.addEventListener('change', this.onBreakpoint);
  }

  disconnectedCallback() {
    window.removeEventListener('popstate', this.onPopState);
    this.desktop?.removeEventListener('change', this.onBreakpoint);
  }

  /** @param {Event} event */
  onChange = (event) => {
    const target = /** @type {HTMLInputElement} */ (event.target);
    if (target.matches('[data-sort-proxy]')) {
      const sort = /** @type {HTMLSelectElement | null} */ (this.querySelector('select[name="sort_by"]'));
      if (sort) sort.value = target.value;
    } else if (!this.form || target.form !== this.form || target.matches('[data-price-input]')) {
      return;
    }
    this.applyForm();
  };

  /** @param {Event} event */
  onInput = (event) => {
    if (/** @type {HTMLElement} */ (event.target).matches('[data-price-input]')) this.applyPrice?.();
  };

  /** @param {SubmitEvent} event */
  onSubmit = (event) => {
    if (event.target !== this.form) return;
    event.preventDefault();
    this.applyForm();
  };

  /** @param {MouseEvent} event */
  onClick = (event) => {
    const el = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (event.target).closest(
        'a[data-facet-link], a[data-load-more], [data-facets-open], [data-facets-close]'
      )
    );
    if (!el) return;
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0;
    if (el.matches('a[data-facet-link]') && !modified) {
      event.preventDefault();
      this.render(/** @type {HTMLAnchorElement} */ (el).href);
    } else if (el.matches('a[data-load-more]') && !modified) {
      event.preventDefault();
      this.loadMore(/** @type {HTMLAnchorElement} */ (el));
    } else if (el.matches('[data-facets-open]') && this.drawer) {
      this.trigger = el;
      el.setAttribute('aria-expanded', 'true');
      this.drawer.showModal();
    }
    if (el.matches('[data-facets-close]')) this.drawer?.close();
  };

  onDrawerClose = () => {
    this.trigger?.setAttribute('aria-expanded', 'false');
    this.trigger?.focus();
    this.trigger = null;
  };

  onBreakpoint = () => {
    const sidebar = this.drawer?.classList.contains('facets-drawer--sidebar');
    if (sidebar && this.desktop?.matches && this.drawer?.open) this.drawer.close();
  };

  onPopState = () => {
    if (location.pathname + location.search !== this.current) this.render(location.href, false);
  };

  applyForm() {
    if (!this.form) return;
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(this.form)) {
      if (typeof value === 'string' && value.trim() !== '') params.append(key, value);
    }
    const base = (this.form.getAttribute('action') || location.pathname).split('?')[0];
    this.render(`${base}?${params}`);
  }

  /**
   * @param {string} url
   * @param {boolean} [updateHistory]
   */
  async render(url, updateHistory = true) {
    this.controller?.abort();
    this.controller = new AbortController();
    this.querySelector('[data-facets-results]')?.setAttribute('aria-busy', 'true');
    try {
      const doc = await fetchSection(url, this.sectionId, this.controller.signal);
      this.swap(doc);
      if (updateHistory) history.replaceState(history.state, '', url);
      this.current = location.pathname + location.search;
    } catch (error) {
      if (/** @type {Error} */ (error).name !== 'AbortError') location.assign(url);
    }
  }

  /** @param {Document} doc */
  swap(doc) {
    /** @type {Map<string, boolean>} */
    const open = new Map();
    this.querySelectorAll('details[data-filter]').forEach((d) => {
      open.set(/** @type {HTMLElement} */ (d).dataset.filter || '', /** @type {HTMLDetailsElement} */ (d).open);
    });
    const focusedId = this.contains(document.activeElement) ? document.activeElement?.id : '';

    replaceFrom(this, doc, REPLACE);
    const counts = doc.querySelectorAll('[data-facets-count]');
    this.querySelectorAll('[data-facets-count]').forEach((el, i) => {
      if (counts[i]) el.textContent = counts[i].textContent;
    });

    this.querySelectorAll('details[data-filter]').forEach((d) => {
      const state = open.get(/** @type {HTMLElement} */ (d).dataset.filter || '');
      if (state !== undefined) /** @type {HTMLDetailsElement} */ (d).open = state;
    });
    if (focusedId) document.getElementById(focusedId)?.focus();
    this.hydrate(this);
  }

  /** @param {HTMLAnchorElement} link */
  async loadMore(link) {
    link.classList.add('is-loading');
    link.setAttribute('aria-busy', 'true');
    try {
      const doc = await fetchSection(link.href, this.sectionId);
      const grid = this.querySelector('[data-facets-grid]');
      const next = doc.querySelector('[data-facets-grid]');
      if (!grid || !next) throw new Error('Missing grid');
      const items = Array.from(next.children, (node) => document.importNode(node, true));
      grid.append(...items);
      replaceFrom(this, doc, ['[data-facets-pagination]']);
      items.forEach((item) => this.hydrate(/** @type {HTMLElement} */ (item)));
      this.hydrate(/** @type {HTMLElement} */ (this.querySelector('[data-facets-pagination]') || grid));
      /** @type {HTMLElement | null | undefined} */ (items[0]?.querySelector('a:not([tabindex="-1"])'))?.focus();
    } catch {
      location.assign(link.href);
    }
  }

  /**
   * Strip `section_id` from links rendered by the Section Rendering API and run module scripts in new markup.
   * @param {HTMLElement} root
   */
  hydrate(root) {
    root.querySelectorAll('a[href*="section_id="]').forEach((a) => {
      const link = /** @type {HTMLAnchorElement} */ (a);
      const u = new URL(link.href);
      u.searchParams.delete('section_id');
      link.href = u.pathname + u.search;
    });
    root.querySelectorAll('script[src]').forEach((old) => {
      const script = document.createElement('script');
      script.type = /** @type {HTMLScriptElement} */ (old).type;
      script.src = /** @type {HTMLScriptElement} */ (old).src;
      old.replaceWith(script);
    });
  }
}

if (!customElements.get('facet-filters')) customElements.define('facet-filters', FacetFilters);
