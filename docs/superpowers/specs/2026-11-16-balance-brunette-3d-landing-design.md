# BALANCE MIX Brunette — 3D scroll landing (proof of concept)

## Intent
Show the Effect Expert client that we can ship a real-time, photoreal 3D product page.
One product, one page, Apple-style pinned scroll: each scroll step moves the camera to one
part of the product and explains it. It is a demo to win future work, not a theme change.

## Product (source: effect-expert.com/products/balance-mix-brunette)
- Eyelash-extension tray "BALANCE" by EFFECT EXPERT, colour Brunette, price 480 ₴.
- Clear acrylic hinged case (~76 × 164 × 9 mm per half). Lid is the left half when open
  (empty, clear); tray is the right half. Two hinge knuckles on the shared long edge,
  one snap-clasp tab on each free long edge.
- Closed: the lid shows a white card: two dark lash-swatch bars (top/bottom), boxed
  "EFFECT / EXPERT" logo, B/W portrait (`assets/portrait.jpg`), "HANDS CREATE - WORLD ADMIRE".
- Open: white insert card, top-left boxed EFFECT EXPERT logo, "BALĀNCE" wordmark top-right
  (macron over the second A), 20 strips. Per row a small left tag "L / 0.07" and a right
  length number. Mixed lengths 6,6,7,7,8,8,9,9,9,10,10,10,10,11,11,11,11,12,12,13 mm.
  A white tape across the bottom of the lash bases is printed "L 0.07 13MM".
- Per strip: light-yellow sticky tape at the base, ~180 fibres standing side by side
  along the strip, each fibre curling up out of the card toward the top of the tray.
- Fibre: premium elastic fibre, rich brunette (dark chocolate, ≈ #3a2420, highlights ≈ #6b4a3e),
  no green/blue cast, tapers from ⅔ of its length to a fine point, even unbroken tips.
- Options: Bend B, C, CC, D, L, LB, LC, L SOFT, M · Thickness 0.05, 0.07, 0.1 · Length 4-7, 6-13, 14-20 mm.
- References: `landing-3d/balance-brunette/reference/*.jpg|png`.

## Goals
- Real 3D geometry (individual fibres, refracting acrylic), not a 2D image.
- Pinned scroll story, one feature per step, with a callout line anchored to the 3D point.
- Finale: live configurator (bend / thickness) that rebuilds fibres, price, buy link.
- 60 fps desktop, usable on a modern phone (reduced fibre count).

## Non-goals
- No Shopify theme integration, no cart API, no CMS. Standalone static page.

## Anti-goals
- Looks like a flat photo or a cheap toy render. Janky scroll. Console errors.

## Decisions (Claude's calls, user delegated the how)
- Three.js r170 (ES modules, importmap from cdn.jsdelivr.net), GSAP 3.12.5 + ScrollTrigger (cdnjs). No build step.
- All printed graphics drawn to canvas textures at runtime (crisp at any zoom).
- Copy in Ukrainian (store language) with an EN toggle.
- Lives in `landing-3d/balance-brunette/` (outside theme folders). Published as a private Artifact for sharing.
