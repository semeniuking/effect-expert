# Ghost Hunt backend (Cloudflare Worker + D1)

This is the small backend for the Halloween "Полювання на привидів" game in the theme (`snippets/ghost-hunt.liquid`, `assets/ghost-hunt.js`).

It isn't a Shopify app or an embed. It's a standalone Worker URL that the theme calls with `fetch()`. The D1 database is attached to the Worker through the `[[d1_databases]]` binding in `wrangler.toml`, so only the Worker can read or write it.

| What | Where |
|---|---|
| Where the 5 white ghosts are (shuffled every `SHUFFLE_HOURS`, same for everyone) | Worker: `DISTRIBUTION`, `POOL_COLLECTION`, `LAYOUT_SALT` |
| Ghost digits / secret code | Worker secret `SECRET_CODE` (ghost N shows digit N) |
| Promo code shown for the right code | Worker secret `DISCOUNT_CODE` (create the discount in Shopify too) |
| "Golden ghost already caught" for everyone | D1 table `golden` (row `live`; debug uses row `test`) |
| On/off, Worker URL, golden ghost spot, texts, ghost size | Theme editor → Theme settings → **Ghost Hunt** |

Deployed at **https://ghost-hunt.ghost-hunt-worker.workers.dev** (D1 `ghost-hunt`, id in `wrangler.toml`).

## Launch configuration (28–31.10.2026)

- `DISTRIBUTION = "collection@rozhidnyky,collection@eyelashes,collection@glue,collection@pre-care,product@rozhidnyky|eyelashes|glue|pre-care"`: one ghost on each category page (on a product card) and one on a product page from those categories. Entries are `type[@category|category][:count]`; `type` is `home`, `collection` or `product`.
- `CAMPAIGN_START` / `CAMPAIGN_END`: outside these dates the game, popup and tracker disappear.
- `GOLDEN_START = "2026-10-31T00:00:00+02:00"`: the golden ghost appears, and the announcement popup switches to its golden version (shown once more to everyone). Claims before that get 403 `golden_not_started`. Debug mode ignores it.
- Shopify discount `GHOSTHUNT10`: 10%, no minimum, **100 uses total**, once per customer. When it runs out, tick "Промокоди закінчились" in Theme settings → Ghost Hunt.
- Golden winner: their contacts are on the dashboard (and in Telegram if `TELEGRAM_*` secrets are set). Issue a 3 000 грн gift card in Shopify → Products → Gift cards to their email.

## One-time setup

```bash
cd ghost-hunt-worker
npm install
npx wrangler login                       # or export CLOUDFLARE_API_TOKEN=...
npx wrangler d1 create ghost-hunt        # copy database_id into wrangler.toml
npm run db:init                          # creates tables in the remote D1

npx wrangler secret put SECRET_CODE      # e.g. 31415
npx wrangler secret put DISCOUNT_CODE    # e.g. GHOSTHUNT10
npx wrangler secret put LAYOUT_SALT      # any random string
npx wrangler secret put DEBUG_KEY        # e.g. a long random word, for ?ghosthunt=<key>
npx wrangler secret put ADMIN_TOKEN      # for /admin
# optional instant alert when the golden ghost is caught:
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID

npm run deploy                           # prints https://ghost-hunt.<account>.workers.dev
```

Then:
1. Check `[vars]` in `wrangler.toml`: `SHOP_URL`, `ALLOWED_ORIGINS` (all storefront domains), `CAMPAIGN_START` / `CAMPAIGN_END`, `DISTRIBUTION`, `SHUFFLE_TZ_OFFSET_MIN`. Redeploy after changing them.
2. In Shopify, create the discount with the same code as `DISCOUNT_CODE`: 10%, minimum 1,500 UAH, once per customer.
3. Optional: create a collection `ghost-hunt-pool` to limit which products can get a ghost. Without it, any product with photos can.
4. In the theme editor → Theme settings → Ghost Hunt, paste the Worker URL and pick the golden ghost's product, photo and position. Keep "Увімкнути гру" ("Enable game") **off** until launch.

## Internal testing (debug mode)

Open any store page with `?ghosthunt=<DEBUG_KEY>`. The key is remembered in that browser until you open `?ghosthunt=off`.

- The game runs **only for you**, even while it's switched off in theme settings and outside campaign dates.
- A debug panel (top-left) lists today's ghost spots with links, marks the ghosts with red outlines, and lets you:
  - preview the next or previous shuffles
  - reset your progress
  - reset the test golden ghost
- Your progress is stored separately from normal play, and golden ghost claims go to the `test` row. The real (`live`) golden ghost is never used up by testing.
- A wrong key does nothing. The Worker has to confirm it.

## Admin

```bash
# winner + stats (ghost catches, right/wrong codes)
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://ghost-hunt.<account>.workers.dev/admin

# emergency: make the real golden ghost available again
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"live"}' https://ghost-hunt.<account>.workers.dev/admin/golden/reset
```

## Analytics

**Built-in stats page** (no setup): open `https://ghost-hunt.<account>.workers.dev/admin/dashboard?token=ADMIN_TOKEN` in a browser. It shows:
- players, how many found all ghosts, got the promo code, and clicked "Застосувати"
- a per-day table (Kyiv time): players, catches, codes right/wrong, copies, applies, golden ghost found
- how many players caught each ghost
- the golden ghost winner

A "player" is one browser, identified by a random id kept in localStorage. Debug play is never counted. The same numbers are in `GET /admin` under `stats`.

**Orders with the promo code:** Shopify admin → Discounts → `GHOSTHUNT10`, or Analytics → Reports → Sales by discount.

**Shopify customer events / Google Analytics.** The theme publishes these events through `Shopify.analytics.publish`, and also pushes them to `dataLayer` and `gtag` when present:

| Event | Data |
|---|---|
| `ghost_hunt_start` | first ghost caught in this browser |
| `ghost_hunt_catch` | `ghost_number`, `found_count`, `total` |
| `ghost_hunt_complete` | `total`; all ghosts found |
| `ghost_hunt_open` | `found_count`; tracker opened |
| `ghost_hunt_code_submit` | `success` |
| `ghost_hunt_promo_revealed` | `discount_code` |
| `ghost_hunt_promo_copy` / `ghost_hunt_promo_apply` | `discount_code` |
| `ghost_hunt_golden_found` | golden ghost clicked |
| `ghost_hunt_golden_claim` | `result`: `won` or `taken` |

To send them to GA4, add a custom pixel in Shopify admin → Settings → Customer events → Add custom pixel. Paste this, set your GA4 ID, then Save and Connect:

```js
const GA_ID = 'G-XXXXXXXXXX';
const script = document.createElement('script');
script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
script.async = true;
document.head.appendChild(script);
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', GA_ID, { send_page_view: false });

[
  'ghost_hunt_start', 'ghost_hunt_catch', 'ghost_hunt_complete', 'ghost_hunt_open',
  'ghost_hunt_code_submit', 'ghost_hunt_promo_revealed', 'ghost_hunt_promo_copy',
  'ghost_hunt_promo_apply', 'ghost_hunt_golden_found', 'ghost_hunt_golden_claim',
].forEach((name) => analytics.subscribe(name, (event) => gtag('event', name, event.customData || {})));
```

## Local development

```bash
cp .dev.vars.example .dev.vars
npm run db:init:local
npm run dev                               # http://localhost:8787
curl localhost:8787/layout
```

## API

| Route | |
|---|---|
| `GET /layout` | Current layout `{active, period, ends_at, total, ghosts:[{n,type,handle,anchor,x,y,rot}], golden:{available}}` |
| `POST /catch {n}` | `{digit}` |
| `POST /verify {code}` | `{ok, discount_code}`. 10 attempts per IP per 10 min. |
| `POST /golden/claim {name, phone, email, …}` | 200 for the first valid claim, 409 after that. Required fields come from `GOLDEN_REQUIRED`. |
| `POST /event {type}` | Client funnel step: `tracker_open`, `promo_copy`, `promo_apply`, `golden_found` |
| `POST /debug/reset` | Debug only: un-claims the `test` golden ghost |
| `GET /admin`, `GET /admin/dashboard`, `POST /admin/golden/reset` | `Authorization: Bearer ADMIN_TOKEN` (the dashboard also accepts `?token=`) |

All `POST` bodies may include `player` (the per-browser id) for stats.

To change the golden ghost form, edit `GOLDEN_FIELDS` in `assets/ghost-hunt.js` (plus a label in `locales/*.json` → `ghost_hunt`) and `GOLDEN_REQUIRED` here.
