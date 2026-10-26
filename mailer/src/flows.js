// Every automated email: what triggers it (theme tracking, the Shopify custom pixel, schedule) and how it's built.
// LuxeMail keeps its own mailing list and doesn't rely on Shopify showing customer emails. Marketing email
// only goes to addresses that ticked the consent box (or opted in on their Shopify account), checked again
// right before every send.
import { now, HOUR, DAY, cleanEmail, localParts, getKV, setKV, money, esc, hmacHex, sendingReady } from './util.js';
import {
  verifyOrder, createPersonalCode, createSharedCode, gql, productByHandle, recommendations, collectionProducts, latestArticles, shopifyHasOrders, abandonedCheckouts, shopifyOrderedSince, recentOrdersFor, ordersSince, boughtProductIds,
} from './shopify.js';
import {
  enqueue, layout, heading, para, button, offerCard, tierCard, tierNudge, productGrid, articleList, letterArticles, letterItems, letterLink, sendViaResend, toneFor,
  unsubscribeUrl, sentTodayCount,
} from './email.js';

export const CONSENT_TEXT = 'Signed up to the email list (form says: By signing up you agree to get our emails)';
const str = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));

/* ======================= Mailing list ======================= */

export async function subscriber(env, email) {
  return env.DB.prepare('SELECT * FROM subscribers WHERE email = ?').bind(email).first();
}

/** Simple per-IP limit so nobody can use the sign-up beacon to sign up lists of strangers. */
export async function rateLimited(env, ip, max) {
  if (!ip) return false;
  const key = `rl:${await hmacHex(env.UNSUB_SECRET, ip)}:${Math.floor(now() / HOUR)}`;
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
  const n = row ? Number(row.v) : 0;
  if (n >= max) return true;
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v, expires_at) VALUES (?, ?, ?)').bind(key, String(n + 1), now() + 2 * HOUR).run();
  return false;
}

/**
 * Someone joined: they ticked "Email me deals and new arrivals" on a form, or are signed in with
 * "accepts marketing" on their Shopify account. That's express consent (Spam Act), so they're subscribed
 * straight away and the welcome series starts. Returns the welcome email's job id, to send it right away.
 */
export async function subscribe(env, { email, firstName, source, page, ip }) {
  const existing = await subscriber(env, email);
  if (existing && existing.status === 'subscribed') {
    if (firstName && !existing.first_name) await env.DB.prepare('UPDATE subscribers SET first_name = ? WHERE email = ?').bind(firstName, email).run();
    return null;
  }
  // Signed-in customers are only added once automatically: if they unsubscribed, that stands even though
  // their Shopify account may still say "accepts marketing". Only ticking the box on a form adds them again.
  if (existing && source === 'account') return null;
  if (await rateLimited(env, ip, 5)) return null;
  await env.DB.prepare(`INSERT INTO subscribers (email, first_name, status, source, consent_text, consent_page, requested_at, confirmed_at)
      VALUES (?, ?, 'subscribed', ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET status = 'subscribed', first_name = COALESCE(excluded.first_name, subscribers.first_name),
        source = excluded.source, consent_text = excluded.consent_text, consent_page = excluded.consent_page,
        requested_at = excluded.requested_at, confirmed_at = excluded.confirmed_at, unsubscribed_at = NULL`)
    .bind(email, firstName, source, source === 'account' ? 'Accepts marketing on their store account' : source === 'checkout' ? 'Ticked "Email me with news and offers" at checkout' : CONSENT_TEXT, page, now(), now()).run();
  await env.DB.prepare('DELETE FROM suppressions WHERE email = ?').bind(email).run();
  // A returning subscriber gets a fresh welcome series (the dedupe keys include the sign-up day).
  const day = new Date(now() * 1000).toISOString().slice(0, 10);
  const data = { firstName };
  const id = await enqueue(env, { email, flow: 'welcome1', dedupe: `welcome1:${email}:${day}`, priority: 1, data });
  await enqueue(env, { email, flow: 'welcome2', dedupe: `welcome2:${email}:${day}`, priority: 4, data, sendAfter: now() + 3 * DAY });
  // The 15% last-call code goes to an address once ever, so re-subscribing can't farm new codes.
  await enqueue(env, { email, flow: 'welcome3', dedupe: `welcome3:${email}`, priority: 4, data, sendAfter: now() + 7 * DAY });
  return id;
}

/**
 * The subscriber's own welcome code (unique, 10%, single use, 30 days), created once per address ever.
 * The site's sign-up message and the welcome emails both use it. If two requests arrive together,
 * only the one that claims the row creates the code; the other waits for it.
 */
/**
 * People who subscribe outside the website (Facebook and Instagram sign-ups, the Shop app, checkout on another
 * channel, or added in Shopify admin) only exist as Shopify customers marked "subscribed". Every 30 minutes this
 * copies them onto LuxeMail's list. Needs the app's read_customers permission; until then it records why and stops.
 * The first run welcomes people who subscribed in the last 30 days and adds older subscribers quietly; later runs
 * welcome every new sign-up, just like the website forms.
 * Anyone who unsubscribed through LuxeMail is never re-added from here.
 */
export async function syncShopifySubscribers(env) {
  if (!(await sendingReady(env))) return;
  const since = await getKV(env, 'cust_sync_at');
  const first = !since;
  let cursor = null, last = since, added = 0;
  for (let page = 0; page < 3; page++) {
    let data;
    try {
      data = await gql(env, `query($q: String!, $after: String){ customers(first: 100, after: $after, sortKey: UPDATED_AT, query: $q){
          nodes { email firstName updatedAt emailMarketingConsent { marketingState consentUpdatedAt } }
          pageInfo { hasNextPage endCursor } } }`,
        { q: `email_marketing_state:SUBSCRIBED${since ? ` updated_at:>'${since}'` : ''}`, after: cursor });
    } catch (e) {
      const msg = String(e && e.message || e);
      await setKV(env, 'customer_sync', /access|read_customers|denied/i.test(msg) ? 'needs read_customers permission' : 'error: ' + msg.slice(0, 120));
      return;
    }
    const conn = data.customers;
    for (const c of conn.nodes) {
      last = c.updatedAt;
      const email = cleanEmail(c.email);
      if (!email || !c.emailMarketingConsent || c.emailMarketingConsent.marketingState !== 'SUBSCRIBED') continue;
      if (await env.DB.prepare('SELECT 1 FROM suppressions WHERE email = ?').bind(email).first()) continue;
      if (await subscriber(env, email)) continue;
      await env.DB.prepare(`INSERT OR IGNORE INTO subscribers (email, first_name, status, source, consent_text, consent_page, requested_at, confirmed_at)
          VALUES (?, ?, 'subscribed', 'shopify', ?, NULL, ?, ?)`)
        .bind(email, c.firstName || null, 'Subscribed to email marketing in Shopify (e.g. Facebook, Instagram or Shop sign-up)', now(), now()).run();
      added++;
      // Welcome everyone new; on the first run only those who subscribed in the last 30 days (older subscribers join quietly).
      const optedAt = Date.parse(c.emailMarketingConsent.consentUpdatedAt || c.updatedAt || 0) / 1000;
      if (!first || optedAt > now() - 30 * DAY) {
        const day = new Date(now() * 1000).toISOString().slice(0, 10);
        const d = { firstName: c.firstName || null };
        await enqueue(env, { email, flow: 'welcome1', dedupe: `welcome1:${email}:${day}`, priority: 1, data: d });
        await enqueue(env, { email, flow: 'welcome2', dedupe: `welcome2:${email}:${day}`, priority: 4, data: d, sendAfter: now() + 3 * DAY });
        await enqueue(env, { email, flow: 'welcome3', dedupe: `welcome3:${email}`, priority: 4, data: d, sendAfter: now() + 7 * DAY });
      }
    }
    cursor = conn.pageInfo.endCursor;
    if (!conn.pageInfo.hasNextPage) { cursor = null; break; }
  }
  // Only move the start point forward once a full pass has finished, so a long first import resumes where it left off.
  if (!cursor) await setKV(env, 'cust_sync_at', last || new Date().toISOString());
  else if (last) await setKV(env, 'cust_sync_at', last);
  await setKV(env, 'customer_sync', `ok, ${added} added ${new Date().toISOString().slice(0, 16)}`);
}

/**
 * Abandoned checkouts straight from Shopify (website, Facebook, Instagram, Shop), so reminders don't depend on the
 * pixel. Only subscribers' checkouts are kept; a checkout that later became an order is marked completed.
 * Shopify's own "return to checkout" link is stored so the email button reopens their exact checkout.
 */
export async function syncShopifyCheckouts(env) {
  if (!(await sendingReady(env))) return;
  let list;
  try { list = await abandonedCheckouts(env, new Date((now() - 6 * DAY) * 1000).toISOString()); } catch (e) { console.error('abandoned checkouts', e); return; }
  for (const c of list) {
    const email = cleanEmail(c.customer && c.customer.email);
    if (!email) continue;
    const member = await subscriber(env, email);
    if (!member || member.status !== 'subscribed') continue;
    const token = 'shop:' + String(c.id).replace(/\D/g, '');
    const started = Math.floor(Date.parse(c.createdAt) / 1000);
    const known = await env.DB.prepare('SELECT completed FROM checkouts WHERE token = ?').bind(token).first();
    let completed = c.completedAt ? 1 : 0;
    if (!completed && !(known && known.completed) && (await shopifyOrderedSince(env, email, c.createdAt))) completed = 1;
    const items = c.lineItems.nodes.filter((l) => l.variant).map((l) => ({
      variantId: String(l.variant.id).replace(/\D/g, ''), qty: l.quantity, handle: l.variant.product ? l.variant.product.handle : null, title: l.title,
    }));
    await env.DB.prepare(`INSERT INTO checkouts (token, email, first_name, total, items, started_at, updated_at, completed, recover_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(token) DO UPDATE SET completed = MAX(checkouts.completed, excluded.completed), items = excluded.items,
          total = excluded.total, updated_at = excluded.updated_at, recover_url = excluded.recover_url`)
      .bind(token, email, (c.customer && c.customer.firstName) || member.first_name || null,
        c.subtotalPriceSet ? String(c.subtotalPriceSet.shopMoney.amount) : null, JSON.stringify(items),
        started, Math.floor(Date.parse(c.updatedAt) / 1000), completed, c.abandonedCheckoutUrl || null).run();
  }
}

/**
 * New orders from Shopify (every channel): recorded for subscribers (stops reminders, builds VIP and win-back
 * history) and their thank-you email is queued. The quiet period below holds it until the order has arrived.
 */
export async function syncShopifyOrders(env) {
  if (!(await sendingReady(env))) return;
  let list;
  try { list = await ordersSince(env, new Date((now() - 2 * DAY) * 1000).toISOString()); } catch (e) { console.error('orders sync', e); return; }
  for (const o of list) {
    const email = cleanEmail(o.email);
    if (!email || o.cancelledAt) continue;
    const member = await subscriber(env, email);
    if (!member || member.status !== 'subscribed') continue;
    const orderId = String(o.id).replace(/\D/g, '');
    const handles = o.lineItems.nodes.map((l) => l.product && l.product.handle).filter(Boolean);
    const firstName = (o.customer && o.customer.firstName) || member.first_name || null;
    const totalCents = o.totalPriceSet ? Math.round(parseFloat(o.totalPriceSet.shopMoney.amount) * 100) : null;
    await env.DB.prepare(`INSERT INTO orders (id, email, first_name, total_cents, handles, verified, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(id) DO UPDATE SET verified = 1, total_cents = COALESCE(excluded.total_cents, orders.total_cents)`)
      .bind(orderId, email, firstName, totalCents, JSON.stringify(handles), Math.floor(Date.parse(o.createdAt) / 1000)).run();
    await env.DB.prepare('UPDATE checkouts SET completed = 1 WHERE email = ? AND started_at <= ?').bind(email, Math.floor(Date.parse(o.createdAt) / 1000)).run();
    // They bought: drop any cart, checkout or browse reminder still waiting to go out.
    await env.DB.prepare(`UPDATE sends SET status = 'skipped', error = 'ordered', sent_at = ? WHERE email = ? AND status = 'queued'
        AND flow IN ('checkout1', 'checkout2', 'cart1', 'cart2', 'browse')`).bind(now(), email).run();
    await enqueue(env, { email, flow: 'postpurchase', dedupe: `postpurchase:${orderId}`, priority: 3, data: { firstName, handles }, sendAfter: now() + 7 * DAY });
  }
}

/**
 * After someone orders, we leave them alone until the order has arrived: until Shopify shows it delivered (plus a
 * day), or, without a delivery update, 3 weeks after it shipped (4 weeks after ordering if it hasn't shipped yet),
 * and never longer than 5 weeks. Returns the time the quiet period ends (0 when there's none).
 */
export async function quietUntil(env, email) {
  let orders;
  try { orders = await recentOrdersFor(env, email); } catch (e) { console.error('quiet check', e); return 0; }
  let until = 0;
  for (const o of orders) {
    if (o.cancelledAt) continue;
    const placed = Date.parse(o.createdAt) / 1000;
    const fs = o.fulfillments || [];
    const delivered = fs.map((f) => f.deliveredAt && Date.parse(f.deliveredAt) / 1000).filter(Boolean);
    const shipped = fs.map((f) => Date.parse(f.createdAt) / 1000).filter(Boolean);
    let end;
    if (delivered.length && delivered.length === fs.length) end = Math.max(...delivered) + DAY;
    else if (shipped.length) end = Math.min(...shipped) + 21 * DAY;
    else end = placed + 28 * DAY;
    until = Math.max(until, Math.min(end, placed + 35 * DAY));
  }
  return until > now() ? until : 0;
}

/** Someone who has bought before: the first-order welcome code isn't for them. */
export async function isReturningCustomer(env, email) {
  const row = await env.DB.prepare('SELECT id FROM orders WHERE email = ? LIMIT 1').bind(email).first();
  return !!row || (await shopifyHasOrders(env, email));
}

export async function welcomeCodeFor(env, email) {
  if (env.PREVIEW) return createPersonalCode(env, { prefix: 'WELCOME10', percent: 10, days: 30, title: 'Welcome 10%' });
  const read = () => env.DB.prepare('SELECT code, ends_at FROM welcome_codes WHERE email = ?').bind(email).first();
  let row = await read();
  if (row && row.code) return { code: row.code, endsAt: row.ends_at };
  if (!row && (await isReturningCustomer(env, email))) {
    const e = new Error('Returning customer: no first-order code'); e.returning = true; throw e;
  }
  const claim = await env.DB.prepare('INSERT OR IGNORE INTO welcome_codes (email, code, ends_at, created_at) VALUES (?, NULL, NULL, ?)').bind(email, now()).run();
  if (claim.meta && claim.meta.changes) {
    try {
      const { code, endsAt } = await createPersonalCode(env, { prefix: 'WELCOME10', percent: 10, days: 30, title: 'Welcome 10%' });
      await env.DB.prepare('UPDATE welcome_codes SET code = ?, ends_at = ? WHERE email = ?').bind(code, endsAt, email).run();
      return { code, endsAt };
    } catch (e) {
      await env.DB.prepare('DELETE FROM welcome_codes WHERE email = ? AND code IS NULL').bind(email).run(); // let a later try make it
      throw e;
    }
  }
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500));
    row = await read();
    if (row && row.code) return { code: row.code, endsAt: row.ends_at };
  }
  throw new Error('welcome code still being created');
}

export async function unsubscribe(env, email, reason = 'unsubscribed') {
  await env.DB.prepare('INSERT OR REPLACE INTO suppressions (email, reason, at) VALUES (?, ?, ?)').bind(email, reason, now()).run();
  await env.DB.prepare(`UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE email = ?`).bind(now(), email).run();
  await env.DB.prepare(`UPDATE sends SET status = 'skipped', error = ? WHERE email = ? AND status = 'queued'`).bind(reason, email).run();
}

/** The consent check before every send: our own list, never Shopify's marketing status. */
export async function mayEmail(env, email, flow) {
  const suppressed = await env.DB.prepare('SELECT email FROM suppressions WHERE email = ?').bind(email).first();
  const s = await subscriber(env, email);
  return !!s && s.status === 'subscribed' && !suppressed;
}

/* ======================= Inputs ======================= */

/**
 * Theme beacon. Body: { cid, t?, h?, p?, ti?, e?, fn?, c?, src?, pg? }
 *  - t = view | cart | wishlist | unwishlist: browsing activity for this browser.
 *  - e with c = 1: newsletter form with the consent box ticked (src = footer/popup/...), or a signed-in
 *    customer whose Shopify account accepts marketing (src = account). Subscribes them.
 */
export async function recordEvent(env, body, ip = null) {
  const cid = typeof body.cid === 'string' ? body.cid.slice(0, 64) : null;
  if (!cid) return null;
  const email = cleanEmail(body.e);
  const firstName = str(body.fn, 60);
  let job = null;
  if (email && Number(body.c) === 1) {
    const source = ['account', 'footer', 'popup', 'homepage', 'password', 'newsletter'].includes(body.src) ? body.src : 'newsletter';
    job = await subscribe(env, { email, firstName, source, page: str(body.pg, 300), ip });
    // Only browsers that gave consent are linked to an email, so their activity can personalise emails.
    await env.DB.prepare(`INSERT INTO clients (client_id, email, first_name, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(client_id) DO UPDATE SET email = excluded.email, first_name = COALESCE(excluded.first_name, clients.first_name), updated_at = excluded.updated_at`)
      .bind(cid, email, firstName, now()).run();
    await env.DB.prepare('UPDATE events SET email = ? WHERE client_id = ? AND email IS NULL').bind(email, cid).run();
  }
  const type = ['view', 'cart', 'wishlist', 'unwishlist'].includes(body.t) ? body.t : null;
  if (!type || !body.h) return job;
  const known = (await env.DB.prepare('SELECT email FROM clients WHERE client_id = ?').bind(cid).first())?.email || null;
  await env.DB.prepare('INSERT INTO events (client_id, email, type, handle, product_id, title, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(cid, known, type, String(body.h).slice(0, 200), str(body.p, 40), str(body.ti, 200), now()).run();
  return job;
}

function pixelItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 20).map((l) => ({
    variantId: str(l && l.variantId, 40) && String(l.variantId).replace(/\D/g, ''),
    qty: Math.max(1, Math.min(99, Number(l && l.qty) || 1)),
    handle: str(l && l.handle, 200),
    title: str(l && l.title, 200),
  })).filter((l) => l.variantId || l.handle);
}

/**
 * Shopify custom pixel (mailer/pixel.js). Body: { t: 'checkout' | 'order', token, e, fn, total, items, order }
 * Checkouts are only stored for subscribers. A completed checkout always stops its reminders.
 */
export async function recordPixel(env, body) {
  const token = str(body.token, 100);
  const email = cleanEmail(body.e);
  if (!token) return;
  const items = pixelItems(body.items);
  let member = email ? await subscriber(env, email) : null;
  // Ticked "Email me with news and offers" at checkout: that's consent, so they join the list
  // (and get checkout reminders) even if they never used a sign-up form.
  if (email && body.am === true && body.t === 'checkout' && !(member && member.status === 'subscribed')) {
    await subscribe(env, { email, firstName: str(body.fn, 60), source: 'checkout', page: '/checkout', ip: null });
    member = await subscriber(env, email);
  }
  const isMember = member && member.status === 'subscribed';

  if (body.t === 'checkout') {
    if (!isMember) return;
    await env.DB.prepare(`INSERT INTO checkouts (token, email, first_name, total, items, started_at, updated_at, completed)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(token) DO UPDATE SET email = excluded.email, first_name = COALESCE(excluded.first_name, checkouts.first_name),
          total = excluded.total, items = CASE WHEN excluded.items = '[]' THEN checkouts.items ELSE excluded.items END, updated_at = excluded.updated_at`)
      .bind(token, email, str(body.fn, 60) || member.first_name, str(body.total, 20), JSON.stringify(items), now(), now()).run();
    return;
  }

  if (body.t !== 'order') return;
  await env.DB.prepare('UPDATE checkouts SET completed = 1 WHERE token = ?').bind(token).run();
  if (!isMember || !body.order) return;
  await env.DB.prepare('UPDATE checkouts SET completed = 1 WHERE email = ? AND updated_at > ?').bind(email, now() - 7 * DAY).run();
  const orderId = String(body.order).replace(/\D/g, '').slice(0, 30);
  if (!orderId) return;
  // Pixel data can be forged, so the order (and its total, which drives VIP) is checked in Shopify.
  // An order Shopify can't confirm is kept as unverified: it still stops reminders but doesn't count towards VIP.
  let verified = null;
  try { verified = await verifyOrder(env, orderId); } catch (e) { console.error('verifyOrder', e); }
  const handles = items.map((i) => i.handle).filter(Boolean);
  await env.DB.prepare(`INSERT OR IGNORE INTO orders (id, email, first_name, total_cents, handles, verified, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(orderId, email, str(body.fn, 60) || member.first_name, verified ? verified.totalCents : null, JSON.stringify(handles), verified ? 1 : 0, now()).run();
  await enqueue(env, { email, flow: 'postpurchase', dedupe: `postpurchase:${orderId}`, priority: 3,
    data: { firstName: str(body.fn, 60) || member.first_name, handles }, sendAfter: now() + 7 * DAY });
}

/* ======================= Scheduled scans ======================= */

async function orderedSince(env, email, since) {
  const row = await env.DB.prepare('SELECT id FROM orders WHERE email = ? AND created_at >= ? LIMIT 1').bind(email, since).first();
  return !!row;
}

async function sentRecently(env, email, flow, seconds) {
  const row = await env.DB.prepare(`SELECT id FROM sends WHERE email = ? AND flow = ? AND created_at > ? LIMIT 1`).bind(email, flow, now() - seconds).first();
  return !!row;
}

export async function scanAbandonment(env) {
  const t = now();
  // Abandoned checkout (from the pixel): a reminder after 4 hours, then a 5% code after 2 days.
  const { results: checkouts } = await env.DB.prepare(
    `SELECT * FROM checkouts WHERE completed = 0 AND updated_at < ? AND updated_at > ?`).bind(t - 4 * HOUR, t - 6 * DAY).all();
  // One reminder chain per person: only their newest abandoned checkout, and nothing if a different checkout
  // already got a reminder in the last 3 days.
  const newest = new Map();
  for (const ck of checkouts) if (!newest.has(ck.email) || ck.updated_at > newest.get(ck.email).updated_at) newest.set(ck.email, ck);
  for (const ck of newest.values()) {
    if (await orderedSince(env, ck.email, ck.started_at - HOUR)) continue;
    const other = await env.DB.prepare(`SELECT id FROM sends WHERE email = ? AND flow IN ('checkout1', 'checkout2') AND dedupe NOT LIKE ?
        AND status IN ('queued', 'sent') AND created_at > ? LIMIT 1`).bind(ck.email, `%:${ck.token}`, t - 3 * DAY).first();
    if (other) continue;
    const items = JSON.parse(ck.items || '[]');
    if (!items.length) continue;
    const data = { token: ck.token, items, firstName: ck.first_name, subtotal: ck.total, url: ck.recover_url || null };
    if (t - ck.updated_at < 2 * DAY) {
      await enqueue(env, { email: ck.email, flow: 'checkout1', dedupe: `checkout1:${ck.token}`, priority: 1, data });
    } else {
      await enqueue(env, { email: ck.email, flow: 'checkout2', dedupe: `checkout2:${ck.token}`, priority: 1, data });
    }
  }

  // Added to cart, never checked out: reminder after 4 hours, then a 5% code a day later.
  const { results: carts } = await env.DB.prepare(
    `SELECT email, MIN(at) AS first_at, MAX(at) AS last_at, GROUP_CONCAT(DISTINCT handle) AS handles
       FROM events WHERE type = 'cart' AND email IS NOT NULL AND at > ? GROUP BY email`).bind(t - 3 * DAY).all();
  for (const c of carts) {
    if (await orderedSince(env, c.email, c.first_at)) continue;
    const startedCheckout = await env.DB.prepare('SELECT token FROM checkouts WHERE email = ? AND updated_at >= ? LIMIT 1').bind(c.email, c.first_at).first();
    if (startedCheckout) continue; // the checkout flow covers them
    const handles = (c.handles || '').split(',').slice(0, 4);
    const day = new Date(c.first_at * 1000).toISOString().slice(0, 10);
    if (t - c.last_at > 4 * HOUR) {
      await enqueue(env, { email: c.email, flow: 'cart1', dedupe: `cart1:${c.email}:${day}`, priority: 2, data: { handles } });
    }
    const cart1 = await env.DB.prepare(`SELECT sent_at FROM sends WHERE dedupe = ? AND status = 'sent'`).bind(`cart1:${c.email}:${day}`).first();
    if (cart1 && t - cart1.sent_at > 20 * HOUR) {
      await enqueue(env, { email: c.email, flow: 'cart2', dedupe: `cart2:${c.email}:${day}`, priority: 2, data: { handles } });
    }
  }

  // Viewed products but didn't add to cart or buy: one email, at most once a week.
  const { results: views } = await env.DB.prepare(
    `SELECT email, MAX(at) AS last_at, MIN(at) AS first_at FROM events
       WHERE type = 'view' AND email IS NOT NULL AND at BETWEEN ? AND ? GROUP BY email`).bind(t - 3 * DAY, t - DAY).all();
  for (const v of views) {
    if (await orderedSince(env, v.email, v.first_at)) continue;
    const carted = await env.DB.prepare(`SELECT id FROM events WHERE email = ? AND type = 'cart' AND at >= ? LIMIT 1`).bind(v.email, v.first_at).first();
    if (carted || await sentRecently(env, v.email, 'browse', 7 * DAY)) continue;
    const { results: top } = await env.DB.prepare(`SELECT handle, COUNT(*) AS n, MAX(at) AS last FROM events WHERE email = ? AND type = 'view' AND at >= ?
        GROUP BY handle ORDER BY n DESC, last DESC LIMIT 4`).bind(v.email, v.first_at).all();
    if (!top.length) continue;
    const week = Math.floor(t / (7 * DAY));
    await enqueue(env, { email: v.email, flow: 'browse', dedupe: `browse:${v.email}:${week}`, priority: 3, data: { handle: top[0].handle, alts: top.slice(1).map((x) => x.handle) } });
  }

  // Wishlist: items saved 3+ days ago and still not bought; at most every 14 days.
  const { results: wishers } = await env.DB.prepare(
    `SELECT DISTINCT email FROM events WHERE type = 'wishlist' AND email IS NOT NULL AND at < ?`).bind(t - 3 * DAY).all();
  for (const w of wishers) {
    if (await sentRecently(env, w.email, 'wishlist', 14 * DAY)) continue;
    const handles = await currentWishlist(env, w.email);
    if (!handles.length) continue;
    const fortnight = Math.floor(t / (14 * DAY));
    await enqueue(env, { email: w.email, flow: 'wishlist', dedupe: `wishlist:${w.email}:${fortnight}`, priority: 4, data: { handles: handles.slice(0, 4) } });
  }
}

async function currentWishlist(env, email) {
  const { results } = await env.DB.prepare(
    `SELECT handle, type, MAX(at) AS at FROM events WHERE email = ? AND type IN ('wishlist','unwishlist') GROUP BY handle, type`).bind(email).all();
  const latest = {};
  for (const r of results) if (!latest[r.handle] || latest[r.handle].at < r.at) latest[r.handle] = r;
  return Object.values(latest).filter((r) => r.type === 'wishlist').map((r) => r.handle);
}

/** Once a day: VIP welcome and win-back, from our own (verified) order history. */
export async function scanDaily(env) {
  const { ymd, hour } = localParts(env);
  if (hour < 10 || (await getKV(env, 'daily_ran')) === ymd) return;
  await setKV(env, 'daily_ran', ymd);
  await env.DB.prepare(`DELETE FROM kv WHERE k LIKE 'rl:%' AND expires_at < ?`).bind(now()).run();
  const vipCents = Number(env.VIP_SPEND_CENTS || 25000);
  const { results: vips } = await env.DB.prepare(
    `SELECT s.email, s.first_name FROM subscribers s JOIN orders o ON o.email = s.email AND o.verified = 1
      WHERE s.status = 'subscribed' GROUP BY s.email HAVING SUM(o.total_cents) >= ?`).bind(vipCents).all();
  for (const m of vips) {
    await enqueue(env, { email: m.email, flow: 'vip', dedupe: `vip:${m.email}`, priority: 3, data: { firstName: m.first_name } });
  }
  const quarter = `${new Date().getUTCFullYear()}Q${Math.floor(new Date().getUTCMonth() / 3) + 1}`;
  const { results: lapsed } = await env.DB.prepare(
    `SELECT s.email, s.first_name FROM subscribers s JOIN orders o ON o.email = s.email
      WHERE s.status = 'subscribed' GROUP BY s.email HAVING MAX(o.created_at) < ?`).bind(now() - Number(env.LAPSED_DAYS || 60) * DAY).all();
  for (const m of lapsed) {
    await enqueue(env, { email: m.email, flow: 'winback', dedupe: `winback:${m.email}:${quarter}`, priority: 4, data: { firstName: m.first_name } });
  }
}

const THEMES = ['new', 'deals', 'picks', 'best'];

/** Every second Tuesday from 6:30 pm Sydney time: the fortnightly email to the whole list, rotating 4 themes. */
export async function scanFortnightly(env) {
  const { day, hour, minute, ymd } = localParts(env);
  if (day !== 2 || hour < 18 || (hour === 18 && minute < 30)) return;
  const last = await getKV(env, 'fortnight_last');
  if (last && (Date.parse(ymd) - Date.parse(last)) < 13 * DAY * 1000) return;
  await setKV(env, 'fortnight_last', ymd);
  const index = Number((await getKV(env, 'fortnight_index')) || 0);
  await setKV(env, 'fortnight_index', (index + 1) % THEMES.length);
  const theme = THEMES[index % THEMES.length];
  const { results } = await env.DB.prepare(`SELECT email, first_name FROM subscribers WHERE status = 'subscribed'`).all();
  if (!results.length) return;
  // New arrivals and blog fortnights carry a subscriber code (one shared code, 7 days, once per customer).
  let offer = null;
  if (theme === 'new' || theme === 'blog') {
    try {
      offer = await createSharedCode(env, theme === 'new'
        ? { prefix: 'NEWIN10', percent: 10, days: 7, title: 'Subscribers 10% off New arrivals', collection: 'new-arrivals' }
        : { prefix: 'INSIDER10', percent: 10, days: 7, title: 'Subscribers 10% off everything' });
    } catch (e) { console.error('fortnight code', e); } // the email falls back to spend-and-save
  }
  for (const m of results) {
    await enqueue(env, { email: m.email, flow: 'fortnight', dedupe: `fortnight:${ymd}:${m.email}`, priority: 6,
      data: { theme, firstName: m.first_name, offer } });
  }
}

/**
 * Weekly journal: every Sunday from 10 am, one email with the week's new blog posts (we post daily, so this
 * replaces seven emails with one). Skipped if nothing new was published. Same consent rules as everything else.
 */
export async function scanWeeklyJournal(env) {
  const { day, hour, ymd } = localParts(env);
  if (day !== 0 || hour < 10) return;
  if ((await getKV(env, 'journal_last')) === ymd) return;
  await setKV(env, 'journal_last', ymd);
  const since = new Date(Date.now() - 7 * DAY * 1000).toISOString();
  const articles = await latestArticles(env, 6, since);
  if (!articles.length) return;
  const { results } = await env.DB.prepare(`SELECT email, first_name FROM subscribers WHERE status = 'subscribed'`).all();
  for (const m of results) {
    await enqueue(env, { email: m.email, flow: 'journal', dedupe: `journal:${ymd}:${m.email}`, priority: 6, data: { firstName: m.first_name, since } });
  }
}

/* ======================= Building each email ======================= */

const SIGN = (env) => `<p style="margin:0 0 16px;">Any questions, just reply to this email.</p><p style="margin:0;">Thanks,<br>The ${esc(env.BRAND)} team</p>`;

const hi = (name) => (name ? `Hi ${esc(name)},` : 'Hi there,');

async function productsForHandles(env, handles, skip = new Set()) {
  const out = [];
  for (const h of handles || []) { const p = await productByHandle(env, h); if (p && p.available && !skip.has(String(p.id))) out.push(p); }
  return out;
}

/** The product a subscriber cares about most recently: last viewed, else first item of their last order. */
async function seedProductId(env, email) {
  const lastView = await env.DB.prepare(`SELECT product_id FROM events WHERE email = ? AND product_id IS NOT NULL ORDER BY at DESC LIMIT 1`).bind(email).first();
  if (lastView) return lastView.product_id;
  const lastOrder = await env.DB.prepare('SELECT handles FROM orders WHERE email = ? ORDER BY created_at DESC LIMIT 1').bind(email).first();
  const handle = lastOrder ? JSON.parse(lastOrder.handles || '[]')[0] : null;
  const product = handle ? await productByHandle(env, handle) : null;
  return product ? product.id : null;
}

async function personalPicks(env, email, limit = 4) {
  const seed = await seedProductId(env, email);
  if (seed) {
    const recs = await recommendations(env, seed, limit);
    if (recs.length >= 2) return recs;
  }
  return collectionProducts(env, env.BEST_COLLECTION || 'shop-all', limit);
}

// Department banners for the "Picked for you" email, matched to what the subscriber has been looking at.
const INTEREST_BANNERS = {
  handbags: ['banner-picks-bags.jpg', 'Bags picked for you'],
  'sneakers-1': ['banner-picks-shoes.jpg', 'Shoes picked for you'],
  clothing: ['banner-picks-clothing.jpg', 'Clothing picked for you'],
  accessories: ['banner-picks-accessories.jpg', 'Accessories for you'],
  jewellery: ['banner-picks-accessories.jpg', 'Jewellery picked for you'],
};

async function interestBanner(env, email) {
  const seed = await seedProductId(env, email);
  if (seed) {
    const data = await gql(env, `query($id: ID!){ product(id: $id){ collections(first: 10){ nodes{ handle } } } }`,
      { id: `gid://shopify/Product/${String(seed).replace(/\D/g, '')}` });
    const handles = data.product ? data.product.collections.nodes.map((c) => c.handle) : [];
    const match = handles.find((h) => INTEREST_BANNERS[h]);
    if (match) return INTEREST_BANNERS[match];
  }
  return ['banner-picks-everyone.jpg', 'Picked for you this fortnight'];
}

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', timeZone: 'Australia/Sydney' });

/** Rebuilds the checkout as a cart link (/cart/variant:qty,...), which also takes a discount code. */
function cartLink(env, items, code) {
  const lines = (items || []).filter((i) => i.variantId).map((i) => `${i.variantId}:${i.qty || 1}`);
  if (!lines.length) return code ? `${env.STORE_URL}/discount/${code}?redirect=/cart` : `${env.STORE_URL}/cart`;
  return `${env.STORE_URL}/cart/${lines.join(',')}${code ? `?discount=${encodeURIComponent(code)}` : ''}`;
}

export const builders = {
  async welcome1(env, email, d) {
    const wc = await welcomeCodeFor(env, email).catch((e) => { if (e.returning) return null; throw e; });
    const picks = await collectionProducts(env, env.BEST_COLLECTION || 'shop-all', 4);
    if (!wc) {
      return {
        subject: `You're on the ${env.BRAND} list`,
        preheader: 'New arrivals, restocks and subscriber-only offers, straight to your inbox.',
        banner: 'banner-welcome.jpg', bannerAlt: 'Welcome to the list',
        body: heading('Welcome back') + para(`${hi(d.firstName)} thanks for joining the list, and for shopping with us before. You'll be first to hear about new arrivals, restocks and subscriber-only offers.`)
          + button('Shop new arrivals', `${env.STORE_URL}/collections/new-arrivals`)
          + productGrid(picks, { heading: 'Top picks right now' }),
      };
    }
    const { code, endsAt } = wc;
    return {
      subject: `Welcome to ${env.BRAND}: here's 10% off`,
      preheader: `Your code ${code} is inside, plus a few of our most-loved picks.`,
      banner: 'banner-welcome.jpg', bannerAlt: 'Welcome, here is 10% off your first order',
      body: heading('Welcome to LuxeDealers') + para(`${hi(d.firstName)} thanks for joining. We hand-pick bags, shoes, clothing and accessories. Shipping is free on every order, worldwide, with tracking, and if anything isn't right we'll refund or reship it.`)
        + offerCard(env, { theme: 'welcome', big: '10%', unit: 'off', title: 'Your welcome gift: 10% off your order', code,
          fine: `Your own code: single use, valid until ${fmtDate(endsAt)}. Can't be combined with other discounts. The button applies it for you.` })
        + button('Start shopping', `${env.STORE_URL}/discount/${code}?redirect=/collections/all`)
        + productGrid(picks, { heading: 'Top picks right now' }),
    };
  },
  async welcome2(env, email, d) {
    if (await orderedSince(env, email, 0)) return null;
    const wc = await welcomeCodeFor(env, email).catch((e) => { if (e.returning) return null; throw e; });
    if (!wc) return null;
    const { code, endsAt } = wc;
    if (Date.parse(endsAt) < Date.now() + DAY * 1000) return null;
    const picks = await collectionProducts(env, 'new-arrivals', 4);
    return {
      subject: 'Still deciding? Your 10% is waiting',
      preheader: `${code} still takes 10% off, until ${fmtDate(endsAt)}.`,
      banner: 'banner-picks-everyone.jpg', bannerAlt: 'Fresh picks for you',
      body: heading('Your 10% is still here') + para(`${hi(d.firstName)} in case you missed it, your welcome code is ready whenever you are.`)
        + offerCard(env, { theme: 'reminder', big: '10%', unit: 'still yours', title: 'Your welcome code hasn\'t been used yet', code,
          fine: `Single use, valid until ${fmtDate(endsAt)}. Can't be combined with other discounts.` })
        + productGrid(picks, { heading: 'Just landed' })
        + button('Use my 10%', `${env.STORE_URL}/discount/${code}?redirect=/collections/all`),
    };
  },
  async welcome3(env, email, d) {
    if (await orderedSince(env, email, 0)) return null;
    if (!env.PREVIEW && (await isReturningCustomer(env, email))) return null;
    const { code, endsAt } = await createPersonalCode(env, { prefix: 'WELCOME15', percent: 15, days: 3, title: 'Welcome last call 15%' });
    const picks = await collectionProducts(env, env.BEST_COLLECTION || 'shop-all', 4);
    return {
      subject: 'Last call: 15% off, for 3 days',
      preheader: `${code} takes 15% off until ${fmtDate(endsAt)}.`,
      banner: 'banner-last-call.jpg', bannerAlt: 'Last call: 15% off, ends in 3 days',
      body: heading('Last call: 15% off') + para(`${hi(d.firstName)} you've been with us a week, so here's our best new-member offer: 15% off your order, for the next 3 days.`)
        + offerCard(env, { theme: 'lastcall', big: '15%', unit: '3 days only', title: 'Your new-member offer', code,
          fine: `Single use, valid until ${fmtDate(endsAt)}. Can't be combined with other discounts. The button applies it for you.` })
        + button('Use my 15%', `${env.STORE_URL}/discount/${code}?redirect=/collections/all`)
        + productGrid(picks, { heading: 'Top picks right now' }),
    };
  },
  async checkout1(env, email, d) {
    const ck = await env.DB.prepare('SELECT completed FROM checkouts WHERE token = ?').bind(d.token).first();
    if (ck && ck.completed) return null;
    const products = await productsForHandles(env, (d.items || []).map((i) => i.handle));
    if (!products.length) return null;
    // Reminders are short personal-style letters: they read as service emails, not adverts (better inbox placement).
    return {
      letter: true,
      subject: 'Did something go wrong at checkout?',
      preheader: 'Your items are still available.',
      body: `<p style="margin:0 0 16px;">${hi(d.firstName)}</p><p style="margin:0 0 16px;">You started a checkout with us but didn't finish. If something went wrong, or you have a question about sizing or shipping, just reply and we'll help.</p><p style="margin:0 0 8px;">Your items are still available:</p>`
        + letterItems(products) + letterLink('Finish my order', d.url || cartLink(env, d.items)) + SIGN(env),
    };
  },
  async checkout2(env, email, d) {
    const ck = await env.DB.prepare('SELECT completed FROM checkouts WHERE token = ?').bind(d.token).first();
    if (ck && ck.completed) return null;
    const products = await productsForHandles(env, (d.items || []).map((i) => i.handle));
    if (!products.length) return null;
    const { code, endsAt } = await createPersonalCode(env, { prefix: 'BACK5', percent: 5, days: 7, title: 'Abandoned checkout 5%' });
    return {
      letter: true,
      subject: 'Still deciding? A code for your order',
      preheader: `Your items are still available, and ${code} takes 5% off.`,
      body: `<p style="margin:0 0 16px;">${hi(d.firstName)}</p><p style="margin:0 0 16px;">Your items are still waiting at checkout. To help you decide, here's a code for 5% off: <strong>${esc(code)}</strong> (single use, until ${fmtDate(endsAt)}). The link below applies it for you.</p>`
        + letterItems(products) + letterLink('Finish my order with 5% off', d.url ? `${d.url}${d.url.includes('?') ? '&' : '?'}discount=${encodeURIComponent(code)}` : cartLink(env, d.items, code)) + SIGN(env),
    };
  },
  async cart1(env, email, d) {
    const products = await productsForHandles(env, d.handles, await boughtProductIds(env, email));
    if (!products.length) return null;
    return {
      letter: true,
      subject: 'You left these in your cart',
      preheader: 'The things you added are still available.',
      body: `<p style="margin:0 0 16px;">Hi there,</p><p style="margin:0 0 8px;">You added these to your cart and they're still in stock. Your cart is saved on the device you used.</p>`
        + letterItems(products) + letterLink('Back to my cart', `${env.STORE_URL}/cart`) + SIGN(env),
    };
  },
  async cart2(env, email, d) {
    const products = await productsForHandles(env, d.handles, await boughtProductIds(env, email));
    if (!products.length) return null;
    const { code, endsAt } = await createPersonalCode(env, { prefix: 'BACK5', percent: 5, days: 7, title: 'Abandoned cart 5%' });
    return {
      letter: true,
      subject: 'A code for what\'s in your cart',
      preheader: `${code} takes 5% off your cart.`,
      body: `<p style="margin:0 0 16px;">Hi there,</p><p style="margin:0 0 16px;">Still thinking it over? Here's a code for 5% off what's in your cart: <strong>${esc(code)}</strong> (single use, until ${fmtDate(endsAt)}). The link below applies it for you.</p>`
        + letterItems(products) + letterLink('Use my 5% code', `${env.STORE_URL}/discount/${code}?redirect=/cart`) + SIGN(env),
    };
  },
  async browse(env, email, d) {
    // Most-viewed first; never a product they already own.
    const bought = await boughtProductIds(env, email);
    const [product] = await productsForHandles(env, [d.handle, ...(d.alts || [])], bought);
    if (!product) return null;
    const recs = (await recommendations(env, product.id, 6)).filter((p) => p.handle !== product.handle && !bought.has(String(p.id))).slice(0, 2);
    return {
      letter: true,
      subject: `Still thinking about the ${product.title.split(/[,|(]/)[0].trim()}?`,
      preheader: 'The one you were looking at is still in stock.',
      body: `<p style="margin:0 0 16px;">Hi there,</p><p style="margin:0 0 8px;">You were looking at this recently, and it's still in stock:</p>`
        + letterItems([product]) + (recs.length ? `<p style="margin:0 0 8px;">You might also like:</p>` + letterItems(recs) : '') + SIGN(env),
    };
  },
  async wishlist(env, email, d) {
    const products = await productsForHandles(env, d.handles, await boughtProductIds(env, email));
    if (!products.length) return null;
    return {
      subject: 'Your wishlist misses you',
      preheader: 'The things you saved are still in stock.',
      banner: 'banner-wishlist.jpg', bannerAlt: 'Your saved picks',
      body: heading('Your saved picks') + para('You saved these to your wishlist. Good news: they\'re still in stock.')
        + productGrid(products) + button('View my wishlist', `${env.STORE_URL}/pages/wishlist`),
    };
  },
  async postpurchase(env, email, d) {
    const bought = (d.handles || [])[0] ? await productByHandle(env, d.handles[0]) : null;
    const recs = bought ? (await recommendations(env, bought.id, 5)).filter((p) => !(d.handles || []).includes(p.handle)).slice(0, 4) : [];
    const picks = recs.length ? recs : await collectionProducts(env, env.BEST_COLLECTION || 'shop-all', 4);
    const { code, endsAt } = await createPersonalCode(env, { prefix: 'NEXT10', percent: 10, days: 30, title: 'Thank-you 10% next order' });
    return {
      subject: 'A thank-you: 10% off your next order',
      preheader: `${code} takes 10% off your next order, until ${fmtDate(endsAt)}.`,
      banner: 'banner-next-order.jpg', bannerAlt: 'A thank-you gift: 10% off your next order',
      body: heading('Thanks for shopping with us!') + para(`${hi(d.firstName)} we hope you're enjoying your order. As a thank-you, here's 10% off your next one.`)
        + offerCard(env, { theme: 'thanks', big: '10%', unit: 'next order', title: 'A thank-you gift for your next order', code,
          fine: `Single use, valid until ${fmtDate(endsAt)}. Can't be combined with other discounts. The button applies it for you.` })
        + button('Use my 10%', `${env.STORE_URL}/discount/${code}?redirect=/collections/all`)
        + productGrid(picks, { heading: recs.length ? 'Goes great with your order' : 'Top picks right now' })
        + para('Anything not right with your order? Just reply to this email and we\'ll sort it out.'),
      // A week before the code ends, remind them (skipped if they've ordered again by then).
      afterSend: () => enqueue(env, { email, flow: 'nextreminder', dedupe: `nextreminder:${code}`, priority: 4,
        data: { firstName: d.firstName, code, endsAt, since: now() }, sendAfter: Math.floor(Date.parse(endsAt) / 1000) - 7 * DAY }),
    };
  },
  async nextreminder(env, email, d) {
    if (await orderedSince(env, email, d.since)) return null;
    if (Date.parse(d.endsAt) < Date.now() + DAY * 1000) return null;
    const picks = await personalPicks(env, email, 4);
    return {
      subject: `Your 10% ends ${fmtDate(d.endsAt)}`,
      preheader: `${d.code} still takes 10% off your next order.`,
      banner: 'banner-next-reminder.jpg', bannerAlt: 'Your 10% is still waiting',
      body: heading('Your 10% is still waiting') + para(`${hi(d.firstName)} a quick reminder: your thank-you code still takes 10% off your next order, until ${fmtDate(d.endsAt)}.`)
        + offerCard(env, { theme: 'thanks', big: '10%', unit: 'next order', title: 'Your thank-you code', code: d.code,
          fine: `Single use, valid until ${fmtDate(d.endsAt)}. Can't be combined with other discounts. The button applies it for you.` })
        + button('Use my 10%', `${env.STORE_URL}/discount/${d.code}?redirect=/collections/all`)
        + productGrid(picks, { heading: 'Picked for you' }),
    };
  },

  async vip(env, email, d) {
    const { code, endsAt } = await createPersonalCode(env, { prefix: 'VIP15', percent: 15, days: 30, title: 'VIP thank-you 15%' });
    const picks = await collectionProducts(env, 'new-arrivals', 4);
    return {
      subject: 'You\'re a VIP. Here\'s 15% off',
      preheader: 'Thanks for being one of our best customers.',
      banner: 'banner-vip.jpg', bannerAlt: 'You are a VIP: 15% off your next order',
      body: heading('Welcome to VIP') + para(`${hi(d.firstName)} you're one of our best customers. Thank you! Here's 15% off your next order.`)
        + offerCard(env, { theme: 'vip', big: '15%', unit: 'off', title: 'A VIP thank-you, just for you', code,
          fine: `Single use, valid until ${fmtDate(endsAt)}. Can't be combined with other discounts. The button applies it for you.` })
        + productGrid(picks, { heading: 'New this fortnight' })
        + button('Use my 15%', `${env.STORE_URL}/discount/${code}?redirect=/collections/all`),
    };
  },
  async winback(env, email, d) {
    const { code, endsAt } = await createPersonalCode(env, { prefix: 'COMEBACK15', percent: 15, days: 14, title: 'Win-back 15%' });
    const picks = await collectionProducts(env, 'new-arrivals', 4);
    return {
      subject: 'We miss you. Here\'s 15% off',
      preheader: 'See what\'s new since your last visit.',
      banner: 'banner-winback.jpg', bannerAlt: 'We miss you',
      body: heading('It\'s been a while!') + para(`${hi(d.firstName)} here's what's new since your last visit, plus 15% off your next order.`)
        + offerCard(env, { theme: 'winback', big: '15%', unit: 'off', title: 'Welcome back: 15% off your next order', code,
          fine: `Single use, valid until ${fmtDate(endsAt)}. Can't be combined with other discounts. The button applies it for you.` })
        + productGrid(picks, { heading: 'New since your last visit' })
        + button('Use my 15%', `${env.STORE_URL}/discount/${code}?redirect=/collections/all`),
    };
  },
  async journal(env, email, d) {
    const articles = await latestArticles(env, 6, d.since || new Date(Date.now() - 7 * DAY * 1000).toISOString());
    if (!articles.length) return null;
    const lead = articles[0];
    // A plain letter (no products, prices or images) so it reads as news, not an advert.
    return {
      letter: true,
      subject: articles.length > 1 ? `This week in the journal: ${lead.title}` : lead.title,
      preheader: `${articles.length} new ${articles.length === 1 ? 'story' : 'stories'} from the style desk this week.`,
      body: `<p style="margin:0 0 16px;">${hi(d.firstName)}</p><p style="margin:0 0 20px;">Here's what's new on the ${esc(env.BRAND)} journal this week: buying tips, style notes and what to look for.</p>`
        + letterArticles(articles)
        + `<p style="margin:24px 0 0;">Happy reading,<br>The ${esc(env.BRAND)} team</p>`,
    };
  },
  async fortnight(env, email, d) {
    const intro = `${hi(d.firstName)} here's what's worth a look this fortnight, picked by our team.`;
    // Each theme carries a different offer: a New arrivals code, spend-and-save, or a sitewide subscriber code.
    const insider = (unit, title, where, redirect) => d.offer
      ? offerCard(env, { theme: 'insider', big: '10%', unit, title, code: d.offer.code,
          fine: `${where} until ${fmtDate(d.offer.endsAt)}. Once per customer. Can't be combined with other discounts.` })
        + button('Use my 10%', `${env.STORE_URL}/discount/${d.offer.code}?redirect=${redirect}`)
      : tierCard(env);
    if (d.theme === 'new') {
      const p = await collectionProducts(env, 'new-arrivals', 4);
      return { subject: d.offer ? 'Just landed, and 10% off for subscribers' : 'Just landed: new this fortnight', preheader: 'Fresh arrivals, picked by our team.', banner: 'banner-new-arrivals.jpg', bannerAlt: 'New arrivals this fortnight',
        body: heading('New arrivals') + para(intro) + insider('new arrivals', 'Subscriber code: 10% off New arrivals', 'Valid on the New arrivals collection', '/collections/new-arrivals')
          + productGrid(p) + (d.offer ? '' : button('See what\'s new', `${env.STORE_URL}/collections/new-arrivals`)) };
    }
    if (d.theme === 'deals') {
      // Genuine price drops (compare-at prices). No code: the reduced prices are the offer, and multi-buy still applies.
      const p = await collectionProducts(env, 'deals', 6);
      if (p.length >= 2) {
        return { _theme: 'deals', subject: 'Price drops on selected styles', preheader: 'Selected items reduced, and they still count towards Buy 2 or 3+ savings.', banner: 'banner-best-sellers.jpg', bannerAlt: 'Price drops',
          body: heading('Price drops') + para(`${hi(d.firstName)} we've reduced selected styles across bags, shoes, jackets and more. Here are a few worth a look.`)
            + productGrid(p) + tierCard(env) + button('Shop price drops', `${env.STORE_URL}/collections/deals`) };
      }
      d = { ...d, theme: 'best' };
    }
    if (d.theme === 'best') {
      const p = await collectionProducts(env, env.BEST_COLLECTION || 'shop-all', 4);
      return { _theme: 'best', subject: 'Our top picks right now', preheader: 'Hand-picked by our team this fortnight.', banner: 'banner-best-sellers.jpg', bannerAlt: 'Top picks this fortnight',
        body: heading('Top picks right now') + para(intro) + productGrid(p) + tierCard(env) + button('Shop all', `${env.STORE_URL}/collections/${env.BEST_COLLECTION || 'shop-all'}`) };
    }
    if (d.theme === 'blog') {
      const articles = await latestArticles(env, 3);
      const p = await personalPicks(env, email, 2);
      return { subject: d.offer ? 'New stories, plus 10% off for subscribers' : 'From the style desk: new stories worth a read', preheader: 'Style notes and buying tips from our team.', banner: 'banner-blog.jpg', bannerAlt: 'New stories worth a read',
        body: heading('From the style desk') + para(`${hi(d.firstName)} a few stories from our team, plus a couple of picks for you.`)
          + articleList(articles) + insider('subscribers only', 'A subscriber code, on everything', 'Valid on everything', '/collections/all')
          + productGrid(p, { heading: 'Picked for you' }) + (d.offer ? '' : button('Read the journal', `${env.STORE_URL}/blogs/news`)) };
    }
    const p = await personalPicks(env, email, 4);
    const [banner, bannerAlt] = await interestBanner(env, email);
    return { subject: 'Picked for you this fortnight', preheader: 'Chosen from what you\'ve looked at and bought.', banner, bannerAlt,
      body: heading('Picked for you') + para(intro) + productGrid(p) + tierCard(env) + button('Shop your picks', `${env.STORE_URL}/collections/all`) };
  },

};

// Each email gets its own colour scheme and banner (see TONES in email.js and tools/assets.mjs).
const FLOW_BANNERS = {
  welcome1: 'b-welcome1.jpg', welcome2: 'b-welcome2.jpg', welcome3: 'b-welcome3.jpg', checkout1: 'b-checkout1.jpg', checkout2: 'b-checkout2.jpg',
  cart1: 'b-cart1.jpg', cart2: 'b-cart2.jpg', browse: 'b-browse.jpg', wishlist: 'b-wishlist.jpg', postpurchase: 'b-postpurchase.jpg',
  nextreminder: 'b-nextreminder.jpg', vip: 'b-vip.jpg', winback: 'b-winback.jpg', 'fortnight:new': 'b-new.jpg', 'fortnight:best': 'b-best.jpg', 'fortnight:deals': 'b-deals.jpg', journal: 'b-journal.jpg',
};
for (const [key, build] of Object.entries(builders)) {
  builders[key] = async (env, email, d) => {
    const out = await build(env, email, d);
    if (!out) return out;
    const theme = out._theme || d.theme;
    const k = key === 'fortnight' ? `fortnight:${theme}` : key;
    return { ...out, tone: toneFor(key, key === 'fortnight' ? theme : null), banner: FLOW_BANNERS[k] || out.banner };
  };
}

/* ======================= Outbox ======================= */

/**
 * Sends queued emails, at most DAILY_SEND_LIMIT per 24 hours, after a fresh consent check.
 * With `id`, sends just that one job now (the welcome email, right after sign-up).
 */
const REMINDERS = ['checkout1', 'checkout2', 'cart1', 'cart2', 'browse'];
const DROP_WHEN_QUIET = ['fortnight', 'journal', 'browse', 'wishlist', 'cart1', 'cart2', 'welcome2', 'welcome3', 'winback'];

export async function drainOutbox(env, { id } = {}) {
  // Master switch: until the sending domain is approved, jobs stay queued and nothing is sent.
  if (!(await sendingReady(env))) return { sent: 0, reason: 'sending not live (switch off or domain not verified)' };
  const budget = Number(env.DAILY_SEND_LIMIT || 95) - (await sentTodayCount(env));
  if (budget <= 0) return { sent: 0, reason: 'daily limit reached' };
  const { results } = id
    ? await env.DB.prepare(`SELECT * FROM sends WHERE status = 'queued' AND id = ?`).bind(id).all()
    : await env.DB.prepare(`SELECT * FROM sends WHERE status = 'queued' AND created_at <= ? ORDER BY priority ASC, created_at ASC LIMIT ?`)
      .bind(now(), Math.min(budget, Number(env.BATCH_SIZE || 6))).all();
  let sent = 0;
  const quiet = new Map(); // email -> end of their post-order quiet period (looked up once per run)
  for (const job of results) {
    const mark = (status, error = null) => env.DB.prepare('UPDATE sends SET status = ?, error = ?, sent_at = ? WHERE id = ?')
      .bind(status, error, now(), job.id).run();
    try {
      if (!(await mayEmail(env, job.email, job.flow))) { await mark('skipped', 'not subscribed'); continue; }
      // One newsletter-style email per person per 20 hours. Time-sensitive emails (checkout and cart reminders,
      // the first welcome, thank-you) only need a 2-hour gap, so a welcome never holds back a checkout reminder.
      const urgent = ['checkout1', 'checkout2', 'cart1', 'cart2', 'welcome1', 'postpurchase'].includes(job.flow);
      const recent = await env.DB.prepare(`SELECT id FROM sends WHERE email = ? AND status = 'sent' AND sent_at > ? LIMIT 1`)
        .bind(job.email, now() - (urgent ? 2 : 20) * HOUR).first();
      if (recent) {
        await env.DB.prepare('UPDATE sends SET created_at = ? WHERE id = ?').bind(now() + (urgent ? 1 : 6) * HOUR, job.id).run();
        continue;
      }
      // Just ordered: dated emails are dropped, the rest (thank-you, next-order reminder, VIP...) wait until the
      // order has arrived. A reminder for a new checkout they started still goes.
      if (!['checkout1', 'checkout2'].includes(job.flow)) {
        if (!quiet.has(job.email)) quiet.set(job.email, await quietUntil(env, job.email));
        const q = quiet.get(job.email);
        if (q) {
          if (DROP_WHEN_QUIET.includes(job.flow)) await mark('skipped', 'recent order');
          else await env.DB.prepare('UPDATE sends SET created_at = ? WHERE id = ?').bind(q, job.id).run();
          continue;
        }
      }
      // Cart, checkout and browse reminders: one last check that they haven't ordered since (our own records,
      // then Shopify itself in case this run's order sync hasn't caught up).
      if (REMINDERS.includes(job.flow)) {
        const payload = JSON.parse(job.payload || '{}');
        const ck = payload.token ? await env.DB.prepare('SELECT started_at FROM checkouts WHERE token = ?').bind(payload.token).first() : null;
        const since = (ck && ck.started_at ? ck.started_at : job.created_at - 3 * DAY) - HOUR;
        if (await orderedSince(env, job.email, since)
          || await shopifyOrderedSince(env, job.email, new Date(since * 1000).toISOString())) {
          await mark('skipped', 'ordered');
          continue;
        }
      }
      const builder = builders[job.flow];
      const { results: seenRows } = await env.DB.prepare('SELECT DISTINCT handle FROM shown WHERE email = ? AND at > ?').bind(job.email, now() - 60 * DAY).all();
      const jobEnv = { ...env, _who: job.email, _seen: new Set(seenRows.map((r) => r.handle)), _shown: [] };
      const email = builder ? await builder(jobEnv, job.email, JSON.parse(job.payload || '{}')) : null;
      if (!email) { await mark('skipped', 'nothing to send'); continue; }
      const unsubUrl = await unsubscribeUrl(env, job.email);
      let res;
      try {
        res = await sendViaResend(env, { to: job.email, subject: email.subject, unsubUrl, html: layout(env, { ...email, unsubUrl }) });
      } catch (e) {
        // Resend rejects addresses that can't receive mail (422): never try them again.
        if (/Resend 422/.test(String(e && e.message)) && /to|email|address|recipient/i.test(String(e.message))) {
          await unsubscribe(env, job.email, 'invalid address');
          await mark('skipped', 'invalid address');
          continue;
        }
        throw e;
      }
      await mark('sent');
      if (res && res.id) await env.DB.prepare('INSERT OR IGNORE INTO deliveries (resend_id, email, flow, sent_at) VALUES (?, ?, ?, ?)').bind(res.id, job.email, job.flow, now()).run();
      for (const h of jobEnv._shown.slice(0, 12)) await env.DB.prepare('INSERT INTO shown (email, handle, at) VALUES (?, ?, ?)').bind(job.email, h, now()).run();
      sent++;
      if (email.afterSend) await email.afterSend().catch((e) => console.error('afterSend', job.flow, e));
    } catch (err) {
      const msg = String(err && err.message || err);
      // Cloudflare caps outbound requests per run: leave the job queued for the next run instead of failing it.
      if (/too many subrequests/i.test(msg)) break;
      await mark('error', msg.slice(0, 500));
    }
  }
  return { sent };
}

/* ======================= Weekly report ======================= */

export async function weeklyReport(env) {
  if (!(await sendingReady(env))) return;
  const { day, hour, ymd } = localParts(env);
  if (day !== 1 || hour < 9 || (await getKV(env, 'report_ran')) === ymd) return;
  await setKV(env, 'report_ran', ymd);
  const since = now() - 7 * DAY;
  const { results } = await env.DB.prepare(
    `SELECT flow, status, COUNT(*) AS n FROM sends WHERE created_at > ? GROUP BY flow, status ORDER BY flow`).bind(since).all();
  const { results: errors } = await env.DB.prepare(
    `SELECT flow, error, COUNT(*) AS n FROM sends WHERE status = 'error' AND created_at > ? GROUP BY flow, error LIMIT 10`).bind(since).all();
  const rows = results.map((r) => `<tr><td style="padding:4px 10px;">${esc(r.flow)}</td><td style="padding:4px 10px;">${esc(r.status)}</td><td style="padding:4px 10px;text-align:right;">${r.n}</td></tr>`).join('');
  const errs = errors.map((e) => `<li>${esc(e.flow)}: ${esc(e.error)} (${e.n})</li>`).join('');
  const { results: blocked } = await env.DB.prepare(`SELECT reason, COUNT(*) AS n FROM suppressions WHERE at > ? AND reason IN ('bounced', 'marked as spam', 'invalid address') GROUP BY reason`).bind(since).all();
  const blockedLine = blocked.length ? `<p>Addresses stopped this week (never emailed again): ${blocked.map((b) => `${esc(b.reason)} ${b.n}`).join(', ')}.</p>` : '';
  const html = `<div style="font-family:Arial,sans-serif;color:#0B1220;"><h2>LuxeMail weekly report</h2>
<p>Emails in the last 7 days:</p><table style="border-collapse:collapse;border:1px solid #ddd;">${rows || '<tr><td style="padding:6px;">No emails this week.</td></tr>'}</table>
${blockedLine}${errs ? `<p><strong>Errors to look at:</strong></p><ul>${errs}</ul>` : '<p>No errors. Everything is running.</p>'}</div>`;
  await sendViaResend(env, { to: env.ADMIN_EMAIL, subject: `LuxeMail weekly report (${ymd})`, html, unsubUrl: env.STORE_URL });
}

/* ======================= Bounces and spam complaints ======================= */

/**
 * A few times an hour, ask Resend what happened to recent emails. A hard bounce (the address doesn't exist or the
 * mailbox refuses mail) or a spam complaint puts that address on the suppression list, so it's never emailed again:
 * no wasted sends, and our sending reputation stays clean. Temporary problems (mailbox full, server busy) are
 * Resend's "delivery_delayed" and are left alone; Resend retries those itself.
 */
export async function checkDeliveries(env) {
  const readKey = env.RESEND_READ_KEY || env.RESEND_API_KEY; // a Full access key, kept separate from the sending key
  if (!readKey) return;
  const t = now();
  // One-off catch-up for emails sent before tracking started: page through Resend's recent sends (a few pages a run).
  if ((await getKV(env, 'bounce_backfill')) !== 'done') {
    let after = await getKV(env, 'bounce_backfill_after');
    for (let page = 0; page < 4; page++) {
      let body;
      try {
        const res = await fetch(`https://api.resend.com/emails?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`, { headers: { Authorization: `Bearer ${readKey}` } });
        if (!res.ok) {
          await setKV(env, 'bounce_check', `Resend refused (${res.status})${res.status === 401 || res.status === 403 ? ': the API key can only send; add a Full access key as RESEND_READ_KEY in Cloudflare' : ''}`);
          if (res.status !== 401 && res.status !== 403) await setKV(env, 'bounce_backfill', 'done');
          break;
        }
        body = await res.json();
        await setKV(env, 'bounce_check', 'ok');
      } catch (e) { break; }
      const list = body.data || [];
      for (const m of list) {
        const to = cleanEmail(Array.isArray(m.to) ? m.to[0] : m.to);
        if (!to) continue;
        if (m.last_event === 'bounced') await unsubscribe(env, to, 'bounced');
        else if (m.last_event === 'complained') await unsubscribe(env, to, 'marked as spam');
      }
      if (!body.has_more || !list.length) { await setKV(env, 'bounce_backfill', 'done'); break; }
      after = list[list.length - 1].id;
      await setKV(env, 'bounce_backfill_after', after);
    }
  }
  const { results } = await env.DB.prepare(`SELECT resend_id, email FROM deliveries
      WHERE (last_event IS NULL OR last_event IN ('sent', 'queued', 'scheduled', 'delivery_delayed'))
        AND sent_at < ? AND sent_at > ? AND (checked_at IS NULL OR checked_at < ?)
      ORDER BY checked_at IS NOT NULL, checked_at ASC LIMIT 8`).bind(t - 10 * 60, t - 3 * DAY, t - HOUR).all();
  for (const d of results) {
    let event = null;
    try {
      const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(d.resend_id)}`, { headers: { Authorization: `Bearer ${readKey}` } });
      if (!res.ok) {
        await setKV(env, 'bounce_check', `Resend refused (${res.status})${res.status === 401 || res.status === 403 ? ': the API key can only send; add a Full access key as RESEND_READ_KEY in Cloudflare' : ''}`);
        await env.DB.prepare('UPDATE deliveries SET checked_at = ? WHERE resend_id = ?').bind(t, d.resend_id).run();
        continue;
      }
      await setKV(env, 'bounce_check', 'ok');
      event = (await res.json()).last_event || null;
    } catch (e) {
      if (/too many subrequests/i.test(String(e && e.message))) break;
      continue;
    }
    await env.DB.prepare('UPDATE deliveries SET checked_at = ?, last_event = ? WHERE resend_id = ?').bind(t, event, d.resend_id).run();
    if (event === 'bounced') await unsubscribe(env, d.email, 'bounced');
    else if (event === 'complained') await unsubscribe(env, d.email, 'marked as spam');
  }
}
