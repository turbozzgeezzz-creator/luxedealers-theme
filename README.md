# LuxeDealers theme (luxedealers.com)

A custom Shopify Online Store 2.0 theme for LuxeDealers: brand-new luxury watches, jewellery, bags,
fashion and accessories, sold worldwide. It is a separate theme from tech.luxedealers.com.

## Connect to Shopify

The theme folders are at the root of this repo, so Shopify can sync it directly:

1. In Shopify admin, go to **Online Store > Themes > Add theme > Connect from GitHub**.
2. Pick the `turbozzgeezzz-creator` account, the `luxedealers-theme` repo and the `main` branch.
3. The theme appears in your theme library. Click **Customize** to preview it. Publish it yourself when you're happy.

Every push to `main` updates the connected theme. Changes made in the theme editor are committed back to
`main` by Shopify (mostly `config/settings_data.json` and `templates/*.json`), so pull before editing locally.

Shopify's GitHub sync silently skips a file whose schema breaks its rules (for example a section or block
name over 25 characters) and keeps the old version. After a push, check the theme editor shows the change.

## Design: white, gold and sapphire

Everything comes from the LD diamond logo (`assets/logo-mark.webp`).

- **All white.** White pages, a soft warm grey for image backgrounds, hairline lines, square corners.
  Photos do the work.
- **Gold is metal.** A polished gold gradient for highlights, button hovers, the shimmering LUXE in the
  name and progress lines. A deeper gold (`#8A6420`, 5.4:1 on white) for readable gold text.
- **Sapphire, sparingly.** The diamond blue is only the keyboard focus ring and the New badge.
- **Type.** Playfair Display for headings, Montserrat in spaced capitals for labels and navigation. Both
  come from Shopify's font library and can be changed in **Theme settings > Typography**.

| Setting | Default | Used for |
|---|---|---|
| Page background | `#FFFFFF` | Pages, header, drawers |
| Soft panels | `#F7F6F3` | Image backgrounds, quiet bands |
| Text | `#111111` | Text, dark buttons, announcement bar |
| Secondary text | `#666460` | Captions, descriptions |
| Gold | `#B8892E` | Gold gradient, lines, accents |
| Gold text | `#8A6420` | Small headings, brand names, sale prices |
| Sapphire | `#0E60B6` | Focus ring, New badge |

All colours are in **Theme settings > Colors**. Upload a different logo in **Theme settings > Logo**.

## Animation

**Theme settings > Animation** sets the level: Off, Subtle or Full. Visitors whose device asks for reduced
motion always get it off.

- Headlines slide up line by line, sections fade and rise in, images uncover from the bottom.
- The hero slowly zooms each photo, with a gold progress line under each slide name. Hover pauses it,
  and there's a pause button.
- The header turns transparent over the homepage hero, then shrinks and goes solid on scroll, with a thin
  gold reading-progress line.
- Mega menu links cascade in. Product cards swap to their second photo on hover, and Quick add slides up.
- The scrolling text band, a parallax lookbook and banner, pulsing hotspots, and a floating LD mark on the
  newsletter. The wishlist heart pops when saved, and the bag count bounces when an item is added.
- Pages fade into each other in browsers that support view transitions (turn off in Animation settings).

## Homepage sections

| Section | What it does |
|---|---|
| Hero slideshow | Full-screen image or video slides with phone-specific images. With no photo, the slide shows a white plate with the LD mark and dark text. |
| Scrolling text | Department names or brand logos in a slow loop. |
| Department tiles | One tile per collection, using the collection image or its first product photo. The first can be large. |
| Product rail | A sliding row or grid, with up to five tabs (for example New in, Watches, Jewellery). |
| Image with text | Editorial photo with an optional overlapping second photo, text and up to three facts. Only use facts that are true. |
| Shop the look | One photo with up to six product points, plus the matching product list with quick add. |
| Video banner | Full-width muted looping video or photo with parallax. |
| Brands | Your brand names or logos. With no blocks, it lists the real vendors in your catalogue. |
| Promises | Icon, title and text, for example Brand new, Delivered worldwide, Secure checkout. |
| Journal posts | Latest blog posts. Hidden when the blog is empty. |
| Newsletter | Sign-up with an unticked consent box. |
| Recently viewed | The shopper's own browsing, stored on their device. Hidden until there's something to show. |

## Photos

The theme ships no stock photos. Every image slot shows a white plate with the LD mark until you add a photo:

- **Hero, banners, editorial, lookbook, popup:** pick or upload in the theme editor. The editor's image
  picker also offers Shopify's free stock photos.
- **Department tiles:** use the collection image or its first product photo automatically.
- **Products and collections:** add photos in Shopify admin. Cards show the second photo on hover.

## Product pages

- Photo grid on desktop (or a slider), with hover zoom and a full-screen zoom view. Swipe gallery on phones.
- Colour options show as swatches when the option values have swatch colours or images in admin.
  Other options show as buttons, and combinations that aren't available are crossed out.
- **Stock line from real inventory:** *In stock*, *Only N left* (at or below **Theme settings > Product cards
  > Low stock**, default 3) or *Available to order* for continue-selling variants.
- Express checkout buttons, a sticky Add to bag bar, wishlist, and share links.
- **Details tab:** Brand, Condition (Brand new), Reference (SKU), plus your own rows from the product
  metafield `custom.details`. That can be JSON (`{"Case": "41 mm", "Movement": "Automatic"}`), multi-line
  text (`Name: Value` per line) or rich text.
- **Size guide, delivery and care tabs:** set in the theme editor under Product > Details tabs.
- **Ratings** show only when a reviews app writes the standard `reviews.rating` metafields. No reviews are invented.

## Selling internationally

- **Country and currency selector** in the header, phone menu and footer. It lists the countries in
  **Settings > Markets**. The language selector appears when you add languages.
- Prices show in the shopper's currency. The product page says duties and taxes are shown at checkout.
- No copy mentions a single country. Check your own policy pages say the same.
- **Free shipping bar:** set **Theme settings > Cart > Free shipping from** (store currency). It shows only to
  shoppers paying in your store currency, because the theme can't convert other currencies exactly. Create
  the matching free rate in **Settings > Shipping and delivery** first.

## Email sign-up and welcome offer

- Sign-up forms (homepage, footer, popup, password page) use Shopify's customer form, tagged `newsletter`
  plus where they signed up. Each has an **unticked consent box that must be ticked** (Spam Act and GDPR).
- **Email popup** (Theme editor > Email popup): after a delay or on exit intent, shown once. It's hidden on
  the cart, account and password pages and for signed-in customers who already accept marketing.
- **Welcome code:** enter it in **Theme settings > Welcome offer** and create the same code in
  **Discounts**. Subscribers then see it with Copy and Apply buttons. With no code, no offer is mentioned.

## Pages to create

In **Online Store > Pages > Add page**, set the title, then choose the template under *Theme template*:

| Page | Template | Contents |
|---|---|---|
| About us | `about` | Story, two image-with-text panels and promises, all editable |
| Contact | `contact` | Your details from Theme settings > Store details, the contact form and a short FAQ |
| FAQ | `faq` | Questions with FAQ data for search engines |
| Wishlist | `wishlist` | Saved pieces. Then pick this page in Header > Wishlist page to show the heart icon. |

Generate Privacy, Terms, Refund and Shipping policies in **Settings > Policies**. The footer links to them.
Check the FAQ answers match your real policies before publishing.

## Menus and collections

- **Main menu** (`main-menu`): top-level items are the navigation. Give an item second-level links (column
  titles) and third-level links to build its mega menu. Add a **Mega menu images** block in the header to
  show up to two photos in an item's dropdown.
- **Search suggestions** (optional menu with the handle `search-suggestions`): shown as popular searches.
- The homepage points to collections with the handles `watches`, `jewellery`, `bags`, `fashion` and
  `accessories`. Create them, or pick other collections in the theme editor.
- **Filters:** add them in the **Search & Discovery** app. The filter drawer shows only what's set up there.

## What the theme never does

No fake reviews, visitor counters, "X people are viewing", countdown timers or invented stock levels.
Badges and stock lines come from real product data (publish date, compare-at price, inventory).

## Files

- `layout/` theme and password layouts
- `sections/` every section (header and footer groups are JSON)
- `snippets/` cards, price, forms, icons, placeholders
- `assets/theme.css` the whole design system, `assets/theme.js` all behaviour (no build step)
- `templates/` page templates. `product.card.liquid` renders one card for the wishlist and recently viewed.
- `package.sh` builds a zip for manual upload (not needed with GitHub sync)
