# LuxeMail: LuxeDealers' own email automation

A Cloudflare Worker (free tier) with a D1 database, sending through Resend. Shopify ignores this folder; it isn't part of the theme.
Live at `https://luxemail-main.turbozzgeezzz.workers.dev` (`/health` shows the status).

## Status: switched on, waiting for DNS

`SENDING_ENABLED = "1"`. Mail goes out from `hello@mail.luxedealers.com` (replies go to support@luxedealers.com) as soon as Resend
shows `mail.luxedealers.com` as verified. The Worker checks every 20 minutes, so nothing else needs doing once the DNS records are in.
Until then sign-ups, browsing and checkouts are recorded and emails wait in the queue; no discount codes are created.

DNS records for mail.luxedealers.com (add in the luxedealers.com DNS):

| Type | Name | Value | Priority |
|---|---|---|---|
| TXT | resend._domainkey.mail | (DKIM key shown in Resend > Domains > mail.luxedealers.com) | |
| MX | send.mail | feedback-smtp.us-east-1.amazonses.com | 10 |
| TXT | send.mail | v=spf1 include:amazonses.com ~all | |
| TXT | _dmarc.mail | v=DMARC1; p=none; | |

After that: switch off the SendWILL popup embed (Theme settings > App embeds) so LuxeMail's popup and welcome code take over,
and paste `pixel.js` into Shopify admin > Settings > Customer events > Add custom pixel, then Connect.

## What LuxeMail may do in Shopify

Read products, collections, blog posts and orders, and **create discount codes**. Nothing else: it never edits customers,
products, webhooks or settings. Unsubscribes are kept in LuxeMail's own list.

## Who gets email

Only people on LuxeMail's own list (Spam Act):
- anyone who signs up with a newsletter form (footer, pop-up, homepage, password page; the form says they agree to marketing emails), or
- signed-in customers whose Shopify account already accepts marketing.

Every email says why they're getting it and has a one-click unsubscribe. Consent is re-checked right before every send.

## What it sends

| Flow | When | Offer |
|---|---|---|
| welcome1 | Straight after sign-up | Unique WELCOME10-XXXXX: 10%, single use, 30 days |
| welcome2 | Day 3, if no order | The same code |
| welcome3 | Day 7, if no order (once per address ever) | Unique WELCOME15-XXXXX: 15%, 3 days |
| checkout1 / checkout2 | Checkout not finished: after 4 h, then 2 days | checkout2: unique BACK5-XXXXX, 5%, 7 days |
| cart1 / cart2 | Added to bag, no checkout: after 4 h, then 20 h later | cart2: unique BACK5-XXXXX |
| browse | Viewed products 1-3 days ago, no cart or order; max weekly | none |
| wishlist | Saved items 3+ days ago, not bought; max fortnightly | none |
| postpurchase | 7 days after an order | Unique NEXT10-XXXXX: 10% off next order, 30 days |
| nextreminder | A week before that code ends, if no new order | The same code |
| vip | Verified orders total VIP_SPEND_CENTS+ | Unique VIP15-XXXXX: 15%, 30 days |
| winback | Last order LAPSED_DAYS+ ago; once a quarter | Unique COMEBACK15-XXXXX: 15%, 14 days |
| fortnight | Every second Tuesday evening, whole list, rotating: new arrivals (NEWIN10 shared code), picked for you, top picks, journal (INSIDER10 shared code) | |
| weekly report | Mondays to ADMIN_EMAIL | |

Rules: one email per person per 20 hours; at most DAILY_SEND_LIMIT a day; every code is a real Shopify discount whose
expiry is stated in the email; previews never create codes. Spend-and-save tiers appear in emails only when
TIER1_SPEND_CENTS is set (match them to the automatic discounts in Shopify).

## Inputs

- `POST /t`: theme beacon (`assets/theme.js`): product views, bag adds, wishlist saves, sign-ups. The theme's endpoint is
  Theme settings > Email tracking.
- `POST /p`: Shopify custom pixel (`pixel.js`): checkouts and orders. Ignored unless the email is a subscriber.
- `/u`: unsubscribe.

## Deploy

With CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, RESEND_API_KEY, MAIN_SHOPIFY_CLIENT_ID and MAIN_SHOPIFY_CLIENT_SECRET set: `./deploy.sh`
(safe to rerun). Preview any email: `/preview?flow=welcome1&key=UNSUB_SECRET` (fortnight takes `&theme=new|picks|best|blog`).
Email images: `node tools/assets.mjs`.
