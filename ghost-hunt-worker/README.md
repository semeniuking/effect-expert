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
| `POST /debug/reset` | Debug only: un-claims the `test` golden ghost |
| `GET /admin`, `POST /admin/golden/reset` | `Authorization: Bearer ADMIN_TOKEN` |

To change the golden ghost form, edit `GOLDEN_FIELDS` in `assets/ghost-hunt.js` (plus a label in `locales/*.json` → `ghost_hunt`) and `GOLDEN_REQUIRED` here.
