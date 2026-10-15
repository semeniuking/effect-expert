// @ts-check
/**
 * Cart AJAX API wrapper. Every mutation also asks Shopify to re-render the cart sections
 * (cart drawer, cart page) and broadcasts `cart:updated` so UI pieces can refresh themselves.
 */
import { theme, emit, EVENTS } from '@theme/utils';

/** Section files re-rendered after every cart change. Only those present on the page are requested. */
function sectionsToRender() {
  return [...document.querySelectorAll('[data-cart-section]')].map((el) => /** @type {HTMLElement} */ (el).dataset.cartSection).filter(Boolean);
}

/**
 * @param {string} url
 * @param {Record<string, any> | FormData} body
 * @param {string} source
 */
async function post(url, body, source) {
  const sections = [...new Set(sectionsToRender())];
  let init;
  if (body instanceof FormData) {
    if (sections.length) body.append('sections', sections.join(','));
    body.append('sections_url', location.pathname);
    init = { method: 'POST', headers: { Accept: 'application/json' }, body };
  } else {
    init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...body, sections, sections_url: location.pathname }),
    };
  }
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok || data.status) {
    const message = data.description || data.message || theme().strings.cartError;
    emit(EVENTS.cartError, { message, source });
    throw new Error(message);
  }
  const cart = data.items && data.token ? data : await getCart();
  emit(EVENTS.cartUpdated, { cart, sections: data.sections || {}, source });
  return data;
}

export function getCart() {
  return fetch(`${theme().routes.cart}.js`, { headers: { Accept: 'application/json' } }).then((r) => r.json());
}

/** @param {FormData} formData */
export function addToCart(formData) {
  return post(`${theme().routes.cartAdd}.js`, formData, 'add');
}

/**
 * @param {string} key - line item key
 * @param {number} quantity
 */
export function changeLine(key, quantity) {
  return post(`${theme().routes.cartChange}.js`, { id: key, quantity }, 'change');
}

/** @param {Record<string, any>} update - e.g. { note } or { discount } */
export function updateCart(update) {
  return post(`${theme().routes.cartUpdate}.js`, update, 'update');
}

export function openCart() {
  if (theme().cartType === 'page') {
    location.href = theme().routes.cart;
    return;
  }
  emit(EVENTS.cartOpen);
}
