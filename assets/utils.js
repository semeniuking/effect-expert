// @ts-check
/**
 * Shared helpers for Effect Expert theme modules.
 * Import via the import map: `import { fetchSections } from '@theme/utils';`
 */

/** @returns {Window['Theme']} */
export const theme = () => /** @type {any} */ (window).Theme;

/**
 * Debounce a function.
 * @template {(...args: any[]) => void} T
 * @param {T} fn
 * @param {number} wait
 * @returns {T}
 */
export function debounce(fn, wait = 250) {
  /** @type {number | undefined} */
  let t;
  return /** @type {T} */ (
    (...args) => {
      clearTimeout(t);
      t = window.setTimeout(() => fn(...args), wait);
    }
  );
}

/**
 * Parse an HTML string into a document.
 * @param {string} html
 */
export function parseHTML(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

/**
 * Fetch a URL and return it rendered by one section (Section Rendering API).
 * @param {string} url - page URL (may contain a query string)
 * @param {string} sectionId - section id or section file name
 * @param {AbortSignal} [signal]
 * @returns {Promise<Document>}
 */
export async function fetchSection(url, sectionId, signal) {
  const u = new URL(url, location.origin);
  u.searchParams.set('section_id', sectionId);
  const res = await fetch(u.toString(), { signal });
  if (!res.ok) throw new Error(`Section request failed: ${res.status}`);
  return parseHTML(await res.text());
}

/**
 * Replace the contents of every element matching `selector` in `root` with the matching element in `source`.
 * Elements missing in the source are left untouched.
 * @param {ParentNode} root
 * @param {ParentNode} source
 * @param {string[]} selectors
 */
export function replaceFrom(root, source, selectors) {
  for (const selector of selectors) {
    const targets = root.querySelectorAll(selector);
    const sources = source.querySelectorAll(selector);
    targets.forEach((target, i) => {
      const next = sources[i];
      if (next) target.replaceWith(document.importNode(next, true));
    });
  }
}

/**
 * Format cents with the shop's money format.
 * @param {number} cents
 * @param {string} [format]
 */
export function formatMoney(cents, format) {
  const fmt = format || theme()?.moneyFormat || '{{amount}}';
  const value = (Number(cents) || 0) / 100;
  /** @param {number} n @param {number} d @param {string} t @param {string} s */
  const fixed = (n, d, t, s) => {
    const [int, dec] = n.toFixed(d).split('.');
    return int.replace(/\B(?=(\d{3})+(?!\d))/g, t) + (dec ? s + dec : '');
  };
  // Like Liquid's money_without_trailing_zeros: "₴675.00" → "₴675", "₴675.50" stays.
  const trim = (/** @type {string} */ s) => s.replace(/[.,]00$/, '');
  return fmt.replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => trim((() => {
    switch (key) {
      case 'amount_no_decimals':
        return fixed(value, 0, ',', '.');
      case 'amount_with_comma_separator':
        return fixed(value, 2, '.', ',');
      case 'amount_no_decimals_with_comma_separator':
        return fixed(value, 0, '.', ',');
      case 'amount_with_space_separator':
        return fixed(value, 2, ' ', ',');
      case 'amount_no_decimals_with_space_separator':
        return fixed(value, 0, ' ', ',');
      case 'amount_with_apostrophe_separator':
        return fixed(value, 2, "'", '.');
      default:
        return fixed(value, 2, ',', '.');
    }
  })()));
}

/**
 * Lock or unlock page scroll (used by non-modal overlays).
 * @param {boolean} lock
 */
export function lockScroll(lock) {
  document.documentElement.style.overflow = lock ? 'hidden' : '';
}

/**
 * Close a <dialog> when its backdrop is clicked.
 * @param {HTMLDialogElement} dialog
 */
export function closeOnBackdrop(dialog) {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const { clientX: x, clientY: y } = /** @type {MouseEvent} */ (event);
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) dialog.close();
  });
}

/** Theme-wide custom event names. */
export const EVENTS = {
  /** detail: { cart, sections, source } */
  cartUpdated: 'cart:updated',
  /** Opens the cart drawer (or navigates to /cart when cart type is page). */
  cartOpen: 'cart:open',
  /** detail: { message } */
  cartError: 'cart:error',
  /** detail: { sectionId, variant } */
  variantChange: 'variant:change',
};

/**
 * Dispatch a theme event on document.
 * @param {string} name
 * @param {any} [detail]
 */
export function emit(name, detail) {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}
