/**
 * Ghost Hunt by Effect Expert: Cloudflare Worker backend.
 *
 * GET  /layout              -> today's ghost placement + whether the golden ghost is still available
 * POST /catch {n}           -> {digit} for white ghost n
 * POST /verify {code}       -> {ok, discount_code} when the 5-digit code is right (rate limited)
 * POST /golden/claim {...}  -> first valid claim wins (200), everyone after gets 409
 * POST /event {type}        -> client funnel events (tracker_open, promo_copy, promo_apply, golden_found)
 * GET  /admin               -> winner + stats (Authorization: Bearer ADMIN_TOKEN)
 * GET  /admin/dashboard     -> the same stats as an HTML page (?token=ADMIN_TOKEN works in a browser)
 * POST /admin/golden/reset  -> {id: 'live' | 'test'} un-claims a golden ghost (admin only)
 *
 * Requests with `X-Debug-Key: DEBUG_KEY` ignore campaign dates, can preview other periods
 * (`/layout?offset=1`), use the 'test' golden ghost and may reset it via POST /debug/reset.
 */
import { buildGoldenSpot, buildLayout, categoryHandles, seedFor } from './layout.js';

const RATE_LIMIT_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_S = 600;
const MAX_FIELD_LENGTH = 200;
const CLIENT_EVENTS = ['tracker_open', 'promo_copy', 'promo_apply', 'golden_found', 'popup_start'];

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
    case 'POST /event':
      return postEvent(request, env, ctx, debug);
    case 'POST /debug/reset':
      if (!debug) return json({ error: 'forbidden' }, 403);
      await env.DB.prepare('UPDATE golden SET claimed_at = NULL, data = NULL, ip = NULL, ua = NULL WHERE id = ?')
        .bind('test')
        .run();
      return json({ ok: true });
    case 'GET /admin':
      if (!isAdmin(request, env)) return json({ error: 'forbidden' }, 403);
      return getAdmin(env);
    case 'GET /admin/dashboard':
      if (!isAdmin(request, env)) return json({ error: 'forbidden' }, 403);
      return getDashboard(env);
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
  const goldenAvailable = goldenLive(env, debug) && !golden?.claimed_at;
  // The spot is only revealed while the golden ghost can still be caught.
  const goldenSpot = goldenAvailable ? await loadOrCreateGoldenSpot(env) : null;

  return json(
    {
      active: true,
      debug,
      period,
      offset,
      ends_at: new Date(endsAt).toISOString(),
      total: secretCode(env).length,
      ghosts: layout.ghosts,
      golden: { live: goldenLive(env, debug), available: goldenAvailable, ...(goldenSpot || {}) },
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
    pool = { products: [], collections: [], categories: {} };
  }

  const layout = {
    ghosts: buildLayout({
      seed: await seedFor(env.LAYOUT_SALT, period),
      total: secretCode(env).length,
      distribution: distribution(env),
      products: pool.products,
      collections: pool.collections,
      categories: pool.categories,
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
 * The golden ghost's spot is chosen once for the whole campaign (stored as period -1) and never moves.
 * @param {Record<string, any>} env
 * @returns {Promise<{handle: string, anchor: number, x: number, y: number} | null>}
 */
async function loadOrCreateGoldenSpot(env) {
  const stored = await env.DB.prepare('SELECT json FROM layouts WHERE period = -1').first();
  if (stored) return JSON.parse(stored.json);

  let products = [];
  try {
    products = (await fetchPool(env)).products;
    // "Less obvious" products: skip anything in the main categories / best-sellers (GOLDEN_EXCLUDE).
    const shop = String(env.SHOP_URL || '').replace(/\/+$/, '');
    const excluded = new Set();
    for (const handle of splitList(env.GOLDEN_EXCLUDE)) {
      const data = await fetchJson(`${shop}/collections/${encodeURIComponent(handle)}/products.json?limit=250`).catch(
        () => null
      );
      for (const product of data?.products || []) excluded.add(product.handle);
    }
    const hidden = products.filter((product) => !excluded.has(product.handle));
    if (hidden.length) products = hidden;
  } catch (error) {
    console.error('Golden pool fetch failed', error);
    return null;
  }

  const spot = buildGoldenSpot({ seed: await seedFor(env.LAYOUT_SALT, -1), products });
  if (!spot) return null;

  await env.DB.prepare('INSERT OR IGNORE INTO layouts (period, json, created_at) VALUES (-1, ?, ?)')
    .bind(JSON.stringify(spot), new Date().toISOString())
    .run();
  const saved = await env.DB.prepare('SELECT json FROM layouts WHERE period = -1').first();
  return saved ? JSON.parse(saved.json) : spot;
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

  /** @param {any[]} list */
  const toPool = (list) =>
    list
      .filter((product) => product.images?.length)
      .map((product) => ({ handle: product.handle, images: product.images.length }));

  // Product lists of the categories named in DISTRIBUTION (e.g. product@glue|pre-care).
  /** @type {Record<string, {handle: string, images: number}[]>} */
  const categories = {};
  for (const handle of categoryHandles(distribution(env), secretCode(env).length)) {
    const data = await fetchJson(`${shop}/collections/${encodeURIComponent(handle)}/products.json?limit=250`).catch(
      () => null
    );
    categories[handle] = toPool(data?.products || []);
  }

  return {
    categories,
    products: toPool(products),
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

  const { n, player } = await readBody(request);
  const code = secretCode(env);
  const index = Number(n);
  if (!Number.isInteger(index) || index < 1 || index > code.length) return json({ error: 'bad_ghost' }, 400);

  if (!debug) {
    ctx.waitUntil(
      Promise.all([increment(env, `catch:${index}`), logCatch(env, playerId(player), index, code.length)])
    );
  }
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

  const { code, player } = await readBody(request);
  const ok = String(code ?? '').replace(/\D/g, '') === secretCode(env);

  if (!debug) {
    ctx.waitUntil(
      Promise.all([
        increment(env, ok ? 'verify:ok' : 'verify:fail'),
        logEvent(env, ok ? 'verify_ok' : 'verify_fail', playerId(player)),
      ])
    );
  }
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

  if (!goldenLive(env, debug)) return json({ ok: false, error: 'golden_not_started' }, 403);

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

  const player = playerId(body.player);
  if (result.meta.changes !== 1) {
    if (!debug) ctx.waitUntil(logEvent(env, 'golden_taken', player));
    return json({ ok: false, error: 'taken' }, 409);
  }

  if (!debug) ctx.waitUntil(logEvent(env, 'golden_won', player));
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

  for (const [key, value] of Object.entries(body || {}).slice(0, 11)) {
    if (key === 'player' || !/^[a-z_]{1,32}$/.test(key)) continue;
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
      stats: await getStats(env),
    },
    200,
    { 'Cache-Control': 'no-store' }
  );
}

/* -------------------------------- Analytics -------------------------------- */

/**
 * Client-side funnel events that the Worker can't see by itself.
 * @param {Request} request
 * @param {Record<string, any>} env
 * @param {ExecutionContext} ctx
 * @param {boolean} debug
 */
async function postEvent(request, env, ctx, debug) {
  const { type, player } = await readBody(request);
  if (!CLIENT_EVENTS.includes(type)) return json({ error: 'bad_event' }, 400);
  if (!debug && campaignState(env).active) ctx.waitUntil(logEvent(env, type, playerId(player)));
  return json({ ok: true });
}

/**
 * @param {Record<string, any>} env
 * @param {string} type
 * @param {string | null} player
 * @param {number | null} [n]
 */
function logEvent(env, type, player, n = null) {
  const now = new Date();
  return env.DB.prepare('INSERT INTO events (ts, day, type, n, player) VALUES (?, ?, ?, ?, ?)')
    .bind(Math.floor(now.getTime() / 1000), localDay(env, now), type, n, player)
    .run()
    .catch((error) => console.error('logEvent failed', error));
}

/**
 * Logs a catch and, the first time a player has caught every ghost, a `complete` event.
 * @param {Record<string, any>} env
 * @param {string | null} player
 * @param {number} n
 * @param {number} total
 */
async function logCatch(env, player, n, total) {
  await logEvent(env, 'catch', player, n);
  if (!player) return;

  const row = await env.DB.prepare(
    `SELECT COUNT(DISTINCT CASE WHEN type = 'catch' THEN n END) AS found,
            SUM(type = 'complete') AS completed
       FROM events WHERE player = ? AND type IN ('catch', 'complete')`
  )
    .bind(player)
    .first();
  if (row && row.found >= total && !row.completed) await logEvent(env, 'complete', player);
}

/**
 * @param {Record<string, any>} env
 */
async function getStats(env) {
  const [byDay, byGhost, totals] = await Promise.all([
    env.DB.prepare(
      `SELECT day,
              COUNT(DISTINCT CASE WHEN type = 'catch' THEN player END) AS players,
              SUM(type = 'catch') AS catches,
              SUM(type = 'complete') AS completed,
              SUM(type = 'verify_ok') AS codes_ok,
              SUM(type = 'verify_fail') AS codes_wrong,
              SUM(type = 'promo_copy') AS promo_copies,
              SUM(type = 'promo_apply') AS promo_applies,
              SUM(type = 'tracker_open') AS tracker_opens,
              SUM(type = 'golden_found') AS golden_found,
              SUM(type = 'popup_start') AS popup_starts
         FROM events GROUP BY day ORDER BY day DESC`
    ).all(),
    env.DB.prepare(
      `SELECT n, COUNT(DISTINCT player) AS players FROM events WHERE type = 'catch' GROUP BY n ORDER BY n`
    ).all(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT CASE WHEN type = 'popup_start' THEN player END) AS popup_starts,
              COUNT(DISTINCT CASE WHEN type = 'catch' THEN player END) AS players,
              COUNT(DISTINCT CASE WHEN type = 'complete' THEN player END) AS completed,
              COUNT(DISTINCT CASE WHEN type = 'verify_ok' THEN player END) AS got_promo,
              COUNT(DISTINCT CASE WHEN type = 'promo_apply' THEN player END) AS applied_promo
         FROM events`
    ).first(),
  ]);

  return { totals, by_day: byDay.results, by_ghost: byGhost.results };
}

/**
 * Read-only stats page for the team (open /admin/dashboard?token=ADMIN_TOKEN in a browser).
 * @param {Record<string, any>} env
 */
async function getDashboard(env) {
  const [stats, golden] = await Promise.all([
    getStats(env),
    env.DB.prepare("SELECT claimed_at, data FROM golden WHERE id = 'live'").first(),
  ]);
  const esc = (/** @type {unknown} */ value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  const totals = stats.totals || {};
  const winner = golden?.claimed_at
    ? `знайдено ${esc(golden.claimed_at)} — ${esc(
        Object.entries(JSON.parse(golden.data || '{}'))
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ')
      )}`
    : 'ще не знайдено';

  const dayRows = stats.by_day
    .map(
      (/** @type {any} */ row) =>
        `<tr><td>${esc(row.day)}</td><td>${row.players}</td><td>${row.catches}</td><td>${row.completed}</td><td>${row.codes_ok}</td><td>${row.codes_wrong}</td><td>${row.promo_copies}</td><td>${row.promo_applies}</td><td>${row.golden_found}</td><td>${row.popup_starts}</td></tr>`
    )
    .join('');
  const ghostRows = stats.by_ghost
    .map((/** @type {any} */ row) => `<tr><td>#${row.n}</td><td>${row.players}</td></tr>`)
    .join('');

  const html = `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Ghost Hunt — статистика</title>
<style>
  :root{color-scheme:light dark}
  body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;background:#faf8f5;color:#1b1325}
  main{max-width:980px;margin:0 auto}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:16px 0 24px}
  .card{background:#fff;border:1px solid #e6e0d8;border-radius:12px;padding:14px}
  .card b{display:block;font-size:30px;font-variant-numeric:tabular-nums}
  .scroll{overflow-x:auto;margin-bottom:28px}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e6e0d8}
  th,td{padding:8px 10px;text-align:right;border-bottom:1px solid #f0ebe4;white-space:nowrap;font-variant-numeric:tabular-nums}
  th:first-child,td:first-child{text-align:left}
  @media (prefers-color-scheme:dark){body{background:#151019;color:#eee}.card,table{background:#1f1826;border-color:#33293d}th,td{border-color:#2a2232}}
</style></head><body><main>
<h1>👻 Ghost Hunt — статистика</h1>
<div class="cards">
  <div class="card"><b>${totals.popup_starts ?? 0}</b>натиснули «Розпочати пошуки»</div>
  <div class="card"><b>${totals.players ?? 0}</b>гравців (впіймали хоч одного)</div>
  <div class="card"><b>${totals.completed ?? 0}</b>знайшли всіх привидів</div>
  <div class="card"><b>${totals.got_promo ?? 0}</b>отримали промокод</div>
  <div class="card"><b>${totals.applied_promo ?? 0}</b>натиснули «Застосувати»</div>
</div>
<p><b>Золотий привид:</b> ${winner}</p>
<h2>По днях (за Києвом)</h2>
<div class="scroll"><table><tr><th>День</th><th>Гравці</th><th>Впіймано</th><th>Всі привиди</th><th>Код ✓</th><th>Код ✗</th><th>Скопіювали</th><th>Застосували</th><th>Золотий знайшли</th><th>Почали з попапу</th></tr>${
    dayRows || '<tr><td colspan="10">Ще немає даних</td></tr>'
  }</table></div>
<h2>По привидах</h2>
<div class="scroll"><table><tr><th>Привид</th><th>Гравців впіймало</th></tr>${
    ghostRows || '<tr><td colspan="2">Ще немає даних</td></tr>'
  }</table></div>
<p>Замовлення з промокодом — у Shopify: Знижки або Аналітика → Звіти. Тестова гра (debug) не рахується.</p>
</main></body></html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

/**
 * Calendar day in the store's time zone, for daily stats.
 * @param {Record<string, any>} env
 * @param {Date} date
 */
function localDay(env, date) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: env.TIMEZONE || 'Europe/Kyiv' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Random per-browser id sent by the theme, so stats can count people rather than clicks.
 * @param {unknown} value
 * @returns {string | null}
 */
function playerId(value) {
  const id = String(value ?? '');
  return /^[a-zA-Z0-9-]{8,64}$/.test(id) ? id : null;
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
 * The golden ghost appears at GOLDEN_START (empty = from the campaign start). Debug ignores it.
 * @param {Record<string, any>} env
 * @param {boolean} debug
 */
function goldenLive(env, debug) {
  if (debug || !env.GOLDEN_START) return true;
  return Date.now() >= Date.parse(env.GOLDEN_START);
}

/**
 * @param {Record<string, any>} env
 * @returns {string}
 */
function distribution(env) {
  return env.DISTRIBUTION || 'home:1,collection:1,product:3';
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
  if (!env.ADMIN_TOKEN) return false;
  const header = request.headers.get('Authorization') || '';
  const token = new URL(request.url).searchParams.get('token') || '';
  return safeEqual(header, `Bearer ${env.ADMIN_TOKEN}`) || safeEqual(token, env.ADMIN_TOKEN);
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
