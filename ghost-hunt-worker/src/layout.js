/**
 * Deterministic ghost layout: the same period + salt + pool always gives the same placement,
 * so every visitor sees the ghosts in the same spots until the next shuffle.
 */

const HOME_ANCHORS = 6;
const COLLECTION_ANCHORS = 8;
const PRODUCT_ANCHORS = 4;
const TYPES = ['home', 'collection', 'product'];

/**
 * @typedef {object} Spec
 * @property {'home' | 'collection' | 'product'} type
 * @property {string[] | null} handles - categories to draw from; null = the whole store pool
 */

/**
 * @typedef {{handle: string, images: number}} PoolProduct
 */

/**
 * @param {number} seed - 32-bit seed
 * @returns {() => number} PRNG returning floats in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {string} salt
 * @param {number} period
 * @returns {Promise<number>}
 */
export async function seedFor(salt, period) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt || 'ghost-hunt'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`period:${period}`));
  return new DataView(sig).getUint32(0);
}

/**
 * Parses the DISTRIBUTION setting. Each comma-separated entry is `type[@handle|handle][:count]`:
 *   "home:1,collection:1,product:3"                    — anywhere in the store
 *   "collection@glue,product@glue|pre-care:2"          — limited to those category handles
 * The list is padded with `product` (or trimmed) to `total` entries.
 *
 * @param {string} distribution
 * @param {number} total - number of white ghosts (length of the secret code)
 * @returns {Spec[]}
 */
export function parseDistribution(distribution, total) {
  /** @type {Spec[]} */
  const specs = [];
  for (const part of String(distribution || '').split(',')) {
    const match = part.trim().match(/^(\w+)(?:@([^:]+))?(?::(\d+))?$/);
    if (!match || !TYPES.includes(match[1])) continue;
    const type = /** @type {Spec['type']} */ (match[1]);
    const handles = match[2] ? match[2].split('|').map((h) => h.trim()).filter(Boolean) : null;
    const amount = match[3] === undefined ? 1 : Number(match[3]);
    for (let i = 0; i < amount; i++) specs.push({ type, handles: handles?.length ? handles : null });
  }
  while (specs.length < total) specs.push({ type: 'product', handles: null });
  return specs.slice(0, total);
}

/**
 * Every category handle referenced by product specs (their product lists must be fetched).
 * @param {string} distribution
 * @param {number} total
 * @returns {string[]}
 */
export function categoryHandles(distribution, total) {
  const handles = new Set();
  for (const spec of parseDistribution(distribution, total)) {
    if (spec.type === 'product') for (const handle of spec.handles || []) handles.add(handle);
  }
  return [...handles];
}

/**
 * The golden ghost's spot: a random product page, buried on a later photo (3rd or further when the product has
 * that many; otherwise its last photo). Products with 3+ photos are preferred. Built once per campaign (the caller
 * seeds it with a fixed period) so it never moves.
 *
 * @param {object} options
 * @param {number} options.seed
 * @param {PoolProduct[]} options.products - candidates (already filtered to "less obvious" products)
 * @returns {{handle: string, anchor: number, x: number, y: number} | null}
 */
export function buildGoldenSpot({ seed, products }) {
  const random = mulberry32(seed);
  const int = (/** @type {number} */ max) => Math.floor(random() * max);
  if (!products.length) return null;

  const deep = products.filter((product) => product.images >= 3);
  const pool = deep.length ? deep : products;
  const product = pool[int(pool.length)];
  const last = Math.max(0, product.images - 1);
  const anchor = product.images >= 3 ? 2 + int(Math.min(last, 5) - 1) : last;

  return { handle: product.handle, anchor, x: 15 + int(61), y: 15 + int(61) };
}

/**
 * @param {object} options
 * @param {number} options.seed
 * @param {number} options.total
 * @param {string} options.distribution
 * @param {PoolProduct[]} options.products - store-wide product pool
 * @param {string[]} options.collections - store-wide collection pool
 * @param {Record<string, PoolProduct[]>} [options.categories] - products per category handle
 * @returns {{n: number, type: string, handle?: string, anchor: number, x: number, y: number, rot: number}[]}
 */
export function buildLayout({ seed, total, distribution, products, collections, categories = {} }) {
  const random = mulberry32(seed);
  const int = (/** @type {number} */ max) => Math.floor(random() * max);
  const between = (/** @type {number} */ min, /** @type {number} */ max) => Math.round(min + random() * (max - min));
  /** @template T @param {T[]} list @returns {T | undefined} */
  const pick = (list) => (list.length ? list[int(list.length)] : undefined);

  const specs = parseDistribution(distribution, total);

  // Fisher–Yates so ghost #1 is not always on the same page type.
  for (let i = specs.length - 1; i > 0; i--) {
    const j = int(i + 1);
    [specs[i], specs[j]] = [specs[j], specs[i]];
  }

  const usedProducts = new Set();
  const usedCollections = new Set();
  const usedHomeAnchors = new Set();

  return specs.map((spec, index) => {
    const ghost = {
      n: index + 1,
      type: spec.type,
      anchor: 0,
      x: between(10, 75),
      y: between(10, 75),
      rot: between(-20, 20),
    };

    if (spec.type === 'product') {
      const pool = spec.handles ? spec.handles.flatMap((handle) => categories[handle] || []) : products;
      const fresh = pool.filter((product) => !usedProducts.has(product.handle));
      const product = pick(fresh.length ? fresh : pool);
      if (product) {
        usedProducts.add(product.handle);
        ghost.handle = product.handle;
        ghost.anchor = int(Math.max(1, Math.min(product.images, PRODUCT_ANCHORS)));
        return ghost;
      }
    } else if (spec.type === 'collection') {
      const pool = spec.handles || collections;
      const fresh = pool.filter((handle) => !usedCollections.has(handle));
      const handle = pick(fresh.length ? fresh : pool);
      if (handle) {
        usedCollections.add(handle);
        ghost.handle = handle;
        ghost.anchor = int(COLLECTION_ANCHORS);
        return ghost;
      }
    }

    // Home page, or the fallback when a pool is empty.
    ghost.type = 'home';
    let anchor = int(HOME_ANCHORS);
    for (let i = 0; usedHomeAnchors.has(anchor) && i < HOME_ANCHORS; i++) anchor = (anchor + 1) % HOME_ANCHORS;
    usedHomeAnchors.add(anchor);
    ghost.anchor = anchor;
    return ghost;
  });
}
