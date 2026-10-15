/**
 * Deterministic ghost layout: the same period + salt + pool always gives the same placement,
 * so every visitor sees the ghosts in the same spots until the next shuffle.
 */

const HOME_ANCHORS = 6;
const COLLECTION_ANCHORS = 8;
const PRODUCT_ANCHORS = 4;

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
 * Parses "home:1,collection:1,product:3" into ['home', 'collection', 'product', 'product', 'product'].
 * @param {string} distribution
 * @param {number} total - number of white ghosts (length of the secret code)
 * @returns {string[]}
 */
export function parseDistribution(distribution, total) {
  const types = [];
  for (const part of String(distribution || '').split(',')) {
    const [type, count] = part.split(':').map((s) => s.trim());
    if (!['home', 'collection', 'product'].includes(type)) continue;
    const amount = Number(count) || 0;
    for (let i = 0; i < amount; i++) types.push(type);
  }
  while (types.length < total) types.push('product');
  return types.slice(0, total);
}

/**
 * @param {object} options
 * @param {number} options.seed
 * @param {number} options.total
 * @param {string} options.distribution
 * @param {{handle: string, images: number}[]} options.products
 * @param {string[]} options.collections
 * @returns {{n: number, type: string, handle?: string, anchor: number, x: number, y: number, rot: number}[]}
 */
export function buildLayout({ seed, total, distribution, products, collections }) {
  const random = mulberry32(seed);
  const int = (max) => Math.floor(random() * max);
  const between = (min, max) => Math.round(min + random() * (max - min));

  const types = parseDistribution(distribution, total);

  // Fisher–Yates so ghost #1 is not always on the same page type.
  for (let i = types.length - 1; i > 0; i--) {
    const j = int(i + 1);
    [types[i], types[j]] = [types[j], types[i]];
  }

  const productPool = [...products];
  const collectionPool = [...collections];
  const usedHomeAnchors = new Set();

  return types.map((type, index) => {
    const ghost = {
      n: index + 1,
      type,
      anchor: 0,
      x: between(10, 75),
      y: between(10, 75),
      rot: between(-20, 20),
    };

    if (type === 'product' && productPool.length) {
      const product = productPool.splice(int(productPool.length), 1)[0];
      // Refill when there are fewer products than product ghosts.
      if (!productPool.length) productPool.push(...products);
      ghost.handle = product.handle;
      ghost.anchor = int(Math.max(1, Math.min(product.images, PRODUCT_ANCHORS)));
    } else if (type === 'collection' && collectionPool.length) {
      ghost.handle = collectionPool.splice(int(collectionPool.length), 1)[0];
      if (!collectionPool.length) collectionPool.push(...collections);
      ghost.anchor = int(COLLECTION_ANCHORS);
    } else {
      ghost.type = 'home';
      let anchor = int(HOME_ANCHORS);
      for (let i = 0; usedHomeAnchors.has(anchor) && i < HOME_ANCHORS; i++) anchor = (anchor + 1) % HOME_ANCHORS;
      usedHomeAnchors.add(anchor);
      ghost.anchor = anchor;
    }

    return ghost;
  });
}
