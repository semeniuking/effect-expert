/**
 * Ghost Hunt by Effect Expert: Cloudflare Worker backend.
 *
 * GET  /layout              -> today's ghost placement + whether the golden ghost is still available
 * POST /catch {n}           -> {digit} for white ghost n
 * POST /verify {code}       -> {ok, discount_code} when the 5-digit code is right (rate limited)
 * POST /golden/claim {...}  -> first valid claim wins (200), everyone after gets 409
 * GET  /admin               -> winner + stats (Authorization: Bearer ADMIN_TOKEN)
 * POST /admin/golden/reset  -> {id: 'live' | 'test'} un-claims a golden ghost (admin only)
 *
 * Requests with `X-Debug-Key: DEBUG_KEY` ignore campaign dates, can preview other periods
 * (`/layout?offset=1`), use the 'test' golden ghost and may reset it via POST /debug/reset.
 */
import { buildLayout, seedFor } from './layout.js';

const RATE_LIMIT_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_S = 600;
const MAX_FIELD_LENGTH = 200;

export default {
  /**
   * @param {Request} request
   * @param {Record<string, any>} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      const response = await route(request, env, ctx);
      for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
      return response;
    } catch (error) {
      console.error(error);
      return json({ error: 'server_error' }, 500, cors);
    }
  },
};

/**
 * @param {Request} request
 * @param {Record<string, any>} env
 * @param {ExecutionContext} ctx
 * @returns {Promise<Response>}
 */
async function route(request, env, ctx) {
  const url = new URL(request.url);
  const debug = isDebug(request, env);
  const key = `${request.method} ${url.pathname.replace(/\/+$/, '') || '/'}`;

  switch (key) {
    case 'GET /':
      return json({ name: 'ghost-hunt', ok: true });
    case 'GET /layout':
      return getLayout(url, env, debug);
    case 'POST /catch':
      return postCatch(request, env, ctx, debug);
    case 'POST /verify':
      return postVerify(request, env, ctx, debug);
    case 'POST /golden/claim':
      return postGoldenClaim(request, env, ctx, debug);
    case 'POST /debug/reset':
      if (!debug) return json({ error: 'forbidden' }, 403);
      await env.DB.prepare('UPDATE golden SET claimed_at = NULL, data = NULL, ip = NULL, ua = NULL WHERE id = ?')
        .bind('test')
        .run();
      return json({ ok: true });
    case 'GET /admin':
      if (!isAdmin(request, env)) return json({ error: 'forbidden' }, 403);
      return getAdmin(env);
    case 'POST /admin/golden/reset': {
      if (!isAdmin(request, env)) return json({ error: 'forbidden' }, 403);
      const { id } = await readBody(request);
      if (!['live', 'test'].includes(id)) return json({ error: 'bad_id' }, 400);
      await env.DB.prepare('UPDATE golden SET claimed_at = NULL, data = NULL, ip = NULL, ua = NULL WHERE id = ?')
        .bind(id)
        .run();
      return json({ ok: true, id });
    }
    default:
      return json({ error: 'not_found' }, 404);
  }
}

/* ---------------------------------- Layout --------------------------------- */

/**
 * @param {URL} url
 * @param {Record<string, any>} env
 * @param {boolean} debug
 */
async function getLayout(url, env, debug) {
  const campaign = campaignState(env);
  const goldenId = debug ? 'test' : 'live';
  const noStore = { 'Cache-Control': 'no-store' };

  if (!campaign.active && !debug) {
    return json({ active: false, starts_at: campaign.startsAt, ends_at: campaign.endsAt }, 200, noStore);
  }

  const offset = debug ? clamp(Number(url.searchParams.get('offset')) || 0, -30, 30) : 0;
  const { period, endsAt } = currentPeriod(env, offset);
  const layout = await loadOrCreateLayout(env, period);
  const golden = await env.DB.prepare('SELECT claimed_at FROM golden WHERE id = ?').bind(goldenId).first();

  return json(
    {
      active: true,
      debug,
      period,
      offset,
      ends_at: new Date(endsAt).toISOString(),
      total: secretCode(env).length,
      ghosts: layout.ghosts,
      golden: { available: !golden?.claimed_at },
    },
    200,
    debug ? noStore : { 'Cache-Control': 'public, max-age=60' }
  );
}

/**
 * @param {Record<string, any>} env
 * @param {number} offset - number of periods to shift (debug preview)
 */
function currentPeriod(env, offset = 0) {
  const periodMs = Math.max(1, Number(env.SHUFFLE_HOURS) || 24) * 3_600_000;
  const tzMs = (Number(env.SHUFFLE_TZ_OFFSET_MIN) || 0) * 60_000;
  const period = Math.floor((Date.now() + tzMs) / periodMs) + offset;
  return { period, endsAt: (period + 1) * periodMs - tzMs };
}

/**
 * @param {Record<string, any>} env
 * @param {number} period
 * @returns {Promise<{ghosts: any[]}>}
 */
async function loadOrCreateLayout(env, period) {
  const stored = await env.DB.prepare('SELECT json FROM layouts WHERE period = ?').bind(period).first();
  if (stored) return JSON.parse(stored.json);

  let pool;
  try {
    pool = await fetchPool(env);
  } catch (error) {
    console.error('Pool fetch failed', error);
    // Fall back to the most recent layout so the game keeps working if the store is unreachable.
    const latest = await env.DB.prepare('SELECT json FROM layouts ORDER BY period DESC LIMIT 1').first();
    if (latest) return JSON.parse(latest.json);
    pool = { products: [], collections: [] };
  }

  const layout = {
    ghosts: buildLayout({
      seed: await seedFor(env.LAYOUT_SALT, period),
      total: secretCode(env).length,
      distribution: env.DISTRIBUTION || 'home:1,collection:1,product:3',
      products: pool.products,
      collections: pool.collections,
    }),
  };

  // Only persist layouts built from a real pool, so a temporary outage doesn't freeze a bad layout.
  if (pool.products.length || pool.collections.length) {
    await env.DB.prepare('INSERT OR IGNORE INTO layouts (period, json, created_at) VALUES (?, ?, ?)')
      .bind(period, JSON.stringify(layout), new Date().toISOString())
      .run();
    const saved = await env.DB.prepare('SELECT json FROM layouts WHERE period = ?').bind(period).first();
    if (saved) return JSON.parse(saved.json);
  }

  return layout;
}

/**
 * Reads products and collections from the storefront's public JSON endpoints.
 * @param {Record<string, any>} env
 */
async function fetchPool(env) {
  const shop = String(env.SHOP_URL || '').replace(/\/+$/, '');
  if (!shop) throw new Error('SHOP_URL is not set');

  const poolCollection = String(env.POOL_COLLECTION || '').trim();
  const exclude = new Set(
    splitList(env.EXCLUDE_COLLECTIONS).concat(['frontpage', 'all', poolCollection].filter(Boolean))
  );

  let products = [];
  if (poolCollection) {
    products = (await fetchJson(`${shop}/collections/${poolCollection}/products.json?limit=250`).catch(() => null))
      ?.products;
  }
  if (!products?.length) products = (await fetchJson(`${shop}/products.json?limit=250`)).products || [];

  const { collections = [] } = await fetchJson(`${shop}/collections.json?limit=250`);

  return {
    products: products
      .filter((product) => product.images?.length)
      .map((product) => ({ handle: product.handle, images: product.images.length })),
    collections: collections
      .filter((collection) => !exclude.has(collection.handle) && collection.products_count !== 0)
      .map((collection) => collection.handle),
  };
}

/* ---------------------------------- Game ----------------------------------- */

/**
 * @param {Request} request
 * @param {Record<string, any>} env
 * @param {ExecutionContext} ctx
 * @param {boolean} debug
 */
async function postCatch(request, env, ctx, debug) {
  if (!debug && !campaignState(env).active) return json({ error: 'inactive' }, 403);

  const { n } = await readBody(request);
  const code = secretCode(env);
  const index = Number(n);
  if (!Number.isInteger(index) || index < 1 || index > code.length) return json({ error: 'bad_ghost' }, 400);

  if (!debug) ctx.waitUntil(increment(env, `catch:${index}`));
  return json({ n: index, digit: code[index - 1] });
}

/**
 * @param {Request} request
 * @param {Record<string, any>} env
 * @param {ExecutionContext} ctx
 * @param {boolean} debug
 */
async function postVerify(request, env, ctx, debug) {
  if (!debug && !campaignState(env).active) return json({ error: 'inactive' }, 403);

  const ip = clientIp(request);
  const now = Math.floor(Date.now() / 1000);

  if (!debug) {
    const recent = await env.DB.prepare('SELECT COUNT(*) AS count FROM attempts WHERE ip = ? AND ts > ?')
      .bind(ip, now - RATE_LIMIT_WINDOW_S)
      .first();
    if ((recent?.count || 0) >= RATE_LIMIT_ATTEMPTS) return json({ ok: false, error: 'rate_limited' }, 429);
    await env.DB.prepare('INSERT INTO attempts (ip, ts) VALUES (?, ?)').bind(ip, now).run();
    if (Math.random() < 0.02) {
      ctx.waitUntil(env.DB.prepare('DELETE FROM attempts WHERE ts < ?').bind(now - 86_400).run());
    }
  }

  const { code } = await readBody(request);
  const ok = String(code ?? '').replace(/\D/g, '') === secretCode(env);

  if (!debug) ctx.waitUntil(increment(env, ok ? 'verify:ok' : 'verify:fail'));
  if (!ok) return json({ ok: false, error: 'wrong_code' });

  return json({ ok: true, discount_code: env.DISCOUNT_CODE || '' });
}

/**
 * @param {Request} request
 * @param {Record<string, any>} env
 * @param {ExecutionContext} ctx
 * @param {boolean} debug
 */
async function postGoldenClaim(request, env, ctx, debug) {
  if (!debug && !campaignState(env).active) return json({ error: 'inactive' }, 403);

  const body = await readBody(request);
  const { fields, errors } = validateClaim(body, env);
  if (errors.length) return json({ ok: false, error: 'invalid', fields: errors }, 400);

  const id = debug ? 'test' : 'live';
  const result = await env.DB.prepare(
    'UPDATE golden SET claimed_at = ?, data = ?, ip = ?, ua = ? WHERE id = ? AND claimed_at IS NULL'
  )
    .bind(
      new Date().toISOString(),
      JSON.stringify(fields),
      clientIp(request),
      (request.headers.get('User-Agent') || '').slice(0, 300),
      id
    )
    .run();

  if (result.meta.changes !== 1) return json({ ok: false, error: 'taken' }, 409);

  ctx.waitUntil(notifyTelegram(env, fields, debug));
  return json({ ok: true });
}

/**
 * Required fields come from GOLDEN_REQUIRED (default "name,phone,email"), so the form can change
 * without touching this code. Any extra fields (up to 10) are stored as-is.
 * @param {Record<string, any>} body
 * @param {Record<string, any>} env
 */
function validateClaim(body, env) {
  const required = splitList(env.GOLDEN_REQUIRED || 'name,phone,email');
  /** @type {Record<string, string>} */
  const fields = {};
  const errors = [];

  for (const [key, value] of Object.entries(body || {}).slice(0, 10)) {
    if (!/^[a-z_]{1,32}$/.test(key)) continue;
    fields[key] = String(value ?? '').trim().slice(0, MAX_FIELD_LENGTH);
  }

  for (const key of required) {
    if (!fields[key]) errors.push(key);
  }
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) errors.push('email');
  if (fields.phone) {
    const digits = fields.phone.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) errors.push('phone');
  }

  return { fields, errors: [...new Set(errors)] };
}

/**
 * @param {Record<string, any>} env
 * @param {Record<string, string>} fields
 * @param {boolean} debug
 */
async function notifyTelegram(env, fields, debug) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;

  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  const text = `${debug ? '[TEST] ' : ''}👻✨ Золотого привида знайдено!\n\n${lines.join('\n')}`;

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  }).catch((error) => console.error('Telegram notify failed', error));
}

/**
 * @param {Record<string, any>} env
 */
async function getAdmin(env) {
  const [golden, counters] = await Promise.all([
    env.DB.prepare('SELECT * FROM golden').all(),
    env.DB.prepare('SELECT * FROM counters ORDER BY key').all(),
  ]);

  return json(
    {
      campaign: campaignState(env),
      period: currentPeriod(env).period,
      golden: golden.results.map((row) => ({ ...row, data: row.data ? JSON.parse(row.data) : null })),
      counters: Object.fromEntries(counters.results.map((row) => [row.key, row.value])),
    },
    200,
    { 'Cache-Control': 'no-store' }
  );
}

/* --------------------------------- Helpers --------------------------------- */

/**
 * @param {Record<string, any>} env
 */
function campaignState(env) {
  const now = Date.now();
  const startsAt = env.CAMPAIGN_START || null;
  const endsAt = env.CAMPAIGN_END || null;
  const started = !startsAt || now >= Date.parse(startsAt);
  const ended = !!endsAt && now > Date.parse(endsAt);
  return { active: started && !ended, startsAt, endsAt };
}

/**
 * @param {Record<string, any>} env
 * @returns {string}
 */
function secretCode(env) {
  return String(env.SECRET_CODE || '').replace(/\D/g, '');
}

/**
 * @param {Request} request
 * @param {Record<string, any>} env
 */
function isDebug(request, env) {
  const key = request.headers.get('X-Debug-Key');
  return !!env.DEBUG_KEY && !!key && safeEqual(key, env.DEBUG_KEY);
}

/**
 * @param {Request} request
 * @param {Record<string, any>} env
 */
function isAdmin(request, env) {
  const header = request.headers.get('Authorization') || '';
  return !!env.ADMIN_TOKEN && safeEqual(header, `Bearer ${env.ADMIN_TOKEN}`);
}

/**
 * @param {string} a
 * @param {string} b
 */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Allows exact origins and wildcard subdomains ("*.shopifypreview.com") from ALLOWED_ORIGINS.
 * @param {Request} request
 * @param {Record<string, any>} env
 * @returns {Record<string, string>}
 */
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = splitList(env.ALLOWED_ORIGINS);
  const matches = allowed.some((pattern) => {
    if (pattern === '*') return true;
    if (pattern.startsWith('*.')) {
      try {
        const { protocol, hostname } = new URL(origin);
        return protocol === 'https:' && hostname.endsWith(pattern.slice(1));
      } catch {
        return false;
      }
    }
    return pattern === origin;
  });

  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Debug-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin, X-Debug-Key',
  };
  if (origin && matches) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

/**
 * @param {Request} request
 * @returns {Promise<Record<string, any>>}
 */
async function readBody(request) {
  const text = await request.text();
  if (text.length > 4096) return {};
  try {
    const body = JSON.parse(text || '{}');
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} url
 */
async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'ghost-hunt-worker' } });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

/**
 * @param {Record<string, any>} env
 * @param {string} key
 */
function increment(env, key) {
  return env.DB.prepare(
    'INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1'
  )
    .bind(key)
    .run();
}

/**
 * @param {Request} request
 */
function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {unknown} data
 * @param {number} [status]
 * @param {Record<string, string>} [headers]
 */
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}
