# Effect Expert — Shopify theme

This is the custom theme for the Effect Expert store, built from the "Effect Expert — Website" design and the Effect Expert design system. It replaces the prebuilt Ritual theme.

- **Zero-build.** It's plain Liquid, CSS custom properties and small vanilla-JS web components (ES modules with an import map). There's nothing to compile, and Shopify's CDN serves and minifies the assets.
- **Customizable.** It has 5 editable color schemes, font pickers, a type scale, radii and page width. Sections are made of **nested theme blocks**, so content can be added, rearranged and nested in the theme editor.
- **Fast.**
  - About 6 KB of gzipped global CSS.
  - JS is loaded only by the sections that use it.
  - Responsive images are lazy-loaded.
  - Fonts come from the Shopify CDN.
  - Third-party chat widgets load after the first user interaction.
- **Languages.** Ukrainian and English (`locales/uk.json`, `locales/en.default.json`).

## Preview it in Shopify

1. Go to **Online Store → Themes → Add theme → Connect from GitHub** and choose this repository and the branch you want to preview.
2. Shopify creates an unpublished theme that stays in sync with the branch. Use **Customize** to edit it or **Preview** to look at it. The live theme isn't affected until you **Publish**.
3. Re-check these after connecting:
   - **App embeds:** turn on Yotpo Loyalty under Customize → App embeds.
   - **Theme settings → Integrations:** paste the KeyCRM chat token, and check that Get Checkout and the AI assistant are on.
   - **Theme settings → Social media & contacts:** add your phone, email and Telegram/Viber links.
   - **Logo for dark backgrounds:** upload it, because the footer is dark.

## Local development (optional)

```bash
npm install
shopify theme dev --store effect-expert   # live preview with hot reload
npm run check:node                        # Theme Check (Liquid, schemas, translations)
npm run format                            # Prettier for Liquid/CSS/JS
npm run size                              # asset size vs. performance budget
```

## Structure

See [`docs/THEME.md`](docs/THEME.md) for the architecture, design tokens, CSS classes, JS events and conventions.

| Page        | Template                         | Main pieces                                                                          |
| ----------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| Home        | `templates/index.json`           | Slideshow, hero, benefits, catalog tiles, Топ продаж, EXPERT band, cashback, Instagram |
| Collection  | `templates/collection.json`      | Filters (Search & Discovery), sort, grid, load more, mobile filter drawer            |
| Product     | `templates/product.json`         | Gallery, variant pills, add to cart, info box, accordion, sticky bar, «Купують разом» |
| Cart        | drawer + `templates/cart.json`   | Free-shipping bar, upsell, note, promo code, checkout                                |
| Search      | `templates/search.json`          | Predictive search popup + results page                                               |
| Policies    | `/policies/*` + `page.policy`    | Styled Shopify policies; a page template with a side nav for content pages          |
| Other pages | 404, page, contact, blog, article, list-collections, password, gift card |                                                              |
