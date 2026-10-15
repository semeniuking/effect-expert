# Effect Expert theme — architecture & conventions

The theme is **zero-build**: Liquid, plain CSS with custom properties, and small vanilla JS web components loaded as
ES modules through an import map. You don't need a bundler. Shopify serves and minifies everything in `assets/`.

## Folders

| Folder      | What goes there                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout/`   | `theme.liquid` (header group → main → footer group → cart drawer → quick add) and `password.liquid`                                                     |
| `sections/` | Section shells. Most accept `@theme` + `@app` blocks via `{% content_for 'blocks' %}`                                                                   |
| `blocks/`   | Theme blocks. Public blocks (`heading.liquid`) can be added anywhere; files starting with `_` are private to the parent that lists them               |
| `snippets/` | Render helpers. Every snippet starts with a LiquidDoc `{% doc %}` block                                                                                 |
| `assets/`   | `base.css` (global, render-blocking) and JS modules                                                                                                     |
| `locales/`  | `en.default.json` + `uk.json` (storefront), `en.default.schema.json` + `uk.schema.json` (editor labels)                                                 |

## Design tokens

`snippets/theme-styles.liquid` turns theme settings into CSS custom properties.

**Every color scheme** sets these properties (use them, never hard-coded colors):

```
--color-bg  --color-surface  --color-surface-alt  --color-text  --color-text-muted
--color-accent  --color-on-accent  --color-line  --color-line-strong
--color-button  --color-button-text  --color-button-hover  --color-button-hover-text
--color-sale  --color-success  --color-focus  --color-shadow
```

To apply a scheme, add the class `color-{{ section.settings.color_scheme }}` to an element.

**Global properties:**

```
--font-display  --font-display-weight  --font-body  --font-body-weight  --font-body-weight-bold
--text-display  --text-h1  --text-h2  --text-h3  --text-body  --display-case
--page-width  --gutter (responsive)  --grid-gap  --radius-button  --radius-card  --radius-media
--card-ratio  --hover-zoom  --logo-height  --logo-height-mobile  --section-space-scale
```

Breakpoints: mobile is up to 749px, tablet starts at 750px, desktop starts at 1100px. The header switches to the burger menu below 1100px.

## Base classes (assets/base.css)

- **Layout:**
  - `.section` (uses the `--pt` / `--pb` inline vars)
  - `.section__inner` (page-width container)
  - `.section--full`, `.section--narrow`
  - `.page-width`, `.stack`
  - `.grid` (uses `--cols`, `--cols-tablet`, `--cols-mobile`); add `.grid--rail-mobile` for a swipe rail on mobile
- **Section heading:** `.section-header` > `.section-header__titles` (eyebrow + h2) + `.link-arrow`. Render it with `snippets/section-heading.liquid`.
- **Type:** `.display`, `.h1`, `.h2`, `.h3`, `.eyebrow`, `.text-lg`, `.text-sm`, `.text-xs`, `.text-muted`, `.text-accent`, `.rte`, `.link-arrow`
- **Buttons:** `.button` plus a modifier:
  - styles: `--secondary`, `--accent`, `--link`
  - sizes: `--sm`, `--lg`, `--full`
  - states: `.is-loading`

  `.icon-button` is a 44×44 icon-only button.
- **Forms:**
  - `.field`, `.field__label`
  - `.input`, `.select`, `.textarea`
  - `.input-group` (an input joined to a button)
  - `.checkbox`
  - `.form-message`, `--error`, `--success`
- **Pills and chips:** `.pill` is for variant and filter options. Put it on a `<label>` right after a radio/checkbox input; `.is-active`, `.is-unavailable` and `.pill--sm` are available. `.chip` is for active filters and suggestions.
- **Badges:** `.badge`, `--sale`, `--dark`, `--accent`, `--muted`
- **Media:** `.media` (uses `--ratio` and `--fit`)
- **Price:** `.price`, `.price__sale`, `.price__compare`
- **Cards and tiles:** `.product-card` comes from `snippets/product-card.liquid`; `.tile` and `.tile__media` are collection tiles.
- **Accordion:** `.accordion` on a `<details>`, `.accordion__summary` with `.icon-plus-minus`, `.accordion__content`
- **Overlays:**
  - `.drawer` (`--left`, `--bottom`) on a `<dialog>`, with `.drawer__inner`, `__header`, `__title`, `__body`, `__footer`
  - `.modal`
- **Quantity stepper:** `.quantity` (`--sm`) with `.quantity__button` and `.quantity__input`
- **Small parts:**
  - `.breadcrumbs`
  - `.progress` with `.progress__bar`
  - `.pagination` with `__list` and `__item`
  - `.visually-hidden`, `.hide-mobile`, `.hide-desktop`, `.full-width-link`

## Snippets you should reuse

| Snippet                                                                      | What it does                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `icon` (`name`, `size`)                                                      | Stroke icons: search, account, cart, menu, close, chevrons, arrow-right, plus, minus, check, filter, socials, phone, mail, truck, gift, trash |
| `image` (`image`, `sizes`, `widths`, `class`, `alt`, `priority`, `placeholder`) | Responsive `image_tag` or a placeholder                                              |
| `price` (`product` / `variant`, `show_from`)                                 | Price display                                                                        |
| `product-card` (`product`, `sizes`, `priority`, `show_action`)               | The card: add for a single variant, quick-add for multiple variants                  |
| `social-icons`                                                               | Social profiles from settings                                                        |
| `section-heading`                                                            | Eyebrow, title and "see all" link built from section settings                        |

## JavaScript

- The import map (`snippets/scripts.liquid`) exposes `@theme/utils` and `@theme/cart`.
- A section loads its own module with `<script type="module" src="{{ 'x.js' | asset_url }}"></script>`. A module that appears several times on a page still runs only once.
- Each module defines one custom element and guards it with `if (!customElements.get(name))`. Use `// @ts-check` and JSDoc.
- Events (from `EVENTS` in `utils.js`):
  - `cart:updated` with `{ cart, sections }`, fired after every cart mutation
  - `cart:open`
  - `cart:error`
  - `variant:change`
- `cart.js` re-renders every element that has a `data-cart-section="<section-file-name>"` attribute. It sends those names as the `sections` parameter, and the matching `cart:updated` listener swaps in the HTML.
- `window.Theme` holds the routes, `cartType`, `moneyFormat` and a few strings.
- The page must work without JS where possible: real forms, links, and `<details>` elements.

## Schema & translations

- All editor labels are `t:` keys stored in `locales/en.default.schema.json`.
  - Reuse `t:shared.*` (color_scheme, padding_top / padding_bottom, section_width, heading, gap, alignment…) and `t:categories.*`.
  - Section keys go under `t:sections.<name>.*` and block keys under `t:blocks.<name>.*`.
- Storefront strings use `{{ 'area.key' | t }}`, stored in `locales/en.default.json` and `locales/uk.json`.
- Merchant content (default headings, button labels) is written in Ukrainian directly in settings defaults and templates.
- Run Theme Check before committing. It validates schemas, translations and Liquid.

## Customizing in the theme editor

- **Colors:** Theme settings → Colors. There are five schemes: Paper, Warm, Ink, Cocoa and Dark. Each one can be edited, and any section or group block can pick one.
- **Fonts and sizes:** Theme settings → Typography.
- **Rearranging:** add **Section** (the flexible one) and nest Group, Heading, Text, Button and Image blocks inside it in any order. The Hero, Text with buttons and Image with text presets are all built this way.
- **Product page:** the info column is made of blocks that can be reordered or hidden. Apps such as reviews or Yotpo can be added as app blocks.
