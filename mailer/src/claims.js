// Order help & refunds (theme: /pages/order-help, snippets/order-help.liquid). A customer with a problem tells us here
// instead of going to their bank: the order is checked against Shopify (number + email), the owners get an alert with
// everything they need, and the customer gets a confirmation with a reference and a clear timeline. Refunds and
// replacements stay manual: the owner decides and does them in Shopify.
import { now, DAY, esc, cleanEmail } from './util.js';
import { gql } from './shopify.js';
import { layout, sendViaResend } from './email.js';

export const REASONS = {
  not_arrived: "My order hasn't arrived",
  damaged: 'Item arrived damaged or faulty',
  wrong: 'Wrong item, size or colour',
  missing: 'Item missing from my order',
  other: 'Something else',
};
const WANTS = { refund: 'A refund', replacement: 'A replacement', help: 'Just need help' };

const str = (v, n) => (v == null ? '' : String(v).trim().slice(0, n));

function ownerList(env) {
  return String(env.LATE_ALERT_EMAILS || env.ADMIN_EMAIL).split(',').map((e) => e.trim()).filter(Boolean);
}

/**
 * Body: { o: order number, e: email, r: reason key, w: want key, d: details }.
 * Returns { status, body } for the JSON response.
 */
export async function submitClaim(env, body) {
  const num = str(body && body.o, 30).replace(/^#/, '').toUpperCase();
  const email = cleanEmail(body && body.e);
  const reason = REASONS[body && body.r] ? body.r : null;
  const want = WANTS[body && body.w] ? body.w : 'help';
  const details = str(body && body.d, 1500);
  if (!/^[A-Z0-9-]{3,20}$/.test(num) || !email || !reason) return { status: 400, body: { error: 'missing' } };

  const d = await gql(env, `query($q:String!){ orders(first: 3, query: $q){ nodes { id legacyResourceId name email createdAt cancelledAt
      displayFinancialStatus displayFulfillmentStatus totalPriceSet { shopMoney { amount currencyCode } } shippingAddress { firstName name city provinceCode countryCodeV2 }
      lineItems(first: 10) { nodes { title variantTitle quantity } } } } }`, { q: `name:#${num}` });
  const order = d.orders.nodes.find((x) => x.name.replace('#', '').toUpperCase() === num && cleanEmail(x.email) === email);
  if (!order) return { status: 404, body: { error: 'not_found' } };

  // One open request per order: a second submit returns the same reference (and adds the new details).
  const existing = await env.DB.prepare(`SELECT id, details FROM claims WHERE order_name = ? AND status = 'open' AND created_at > ?`).bind(order.name, now() - 30 * DAY).first();
  const ref = `R-${num}`;
  if (existing) {
    if (details && !String(existing.details || '').includes(details)) {
      await env.DB.prepare('UPDATE claims SET details = ? WHERE id = ?').bind(`${existing.details || ''}\n---\n${details}`.slice(0, 4000), existing.id).run();
    }
    return { status: 200, body: { ok: true, ref, again: true } };
  }
  await env.DB.prepare(`INSERT INTO claims (order_name, order_id, email, reason, want, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`)
    .bind(order.name, String(order.legacyResourceId), email, reason, want, details, now()).run();
  // The customer is talking to us: no more automatic late-order emails for this order (the owner sees it as handled).
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v, expires_at) VALUES (?, ?, NULL)')
    .bind(`late_handled:${order.name}`, `Customer asked for help on the website (${REASONS[reason]}, wants ${WANTS[want].toLowerCase()})`).run();

  const first = (order.shippingAddress && order.shippingAddress.firstName) || '';
  const store = String(env.SHOP_DOMAIN || '').replace('.myshopify.com', '');
  const adminUrl = `https://admin.shopify.com/store/${store}/orders/${order.legacyResourceId}`;
  const money = order.totalPriceSet ? `${order.totalPriceSet.shopMoney.currencyCode === 'USD' ? '$' : order.totalPriceSet.shopMoney.currencyCode + ' '}${Number(order.totalPriceSet.shopMoney.amount).toFixed(2)}` : '';
  const items = order.lineItems.nodes.map((l) => `${esc(l.title)}${l.variantTitle ? ` (${esc(l.variantTitle)})` : ''} x${l.quantity}`).join('<br>');
  const age = Math.floor((Date.now() - Date.parse(order.createdAt)) / (DAY * 1000));

  // Owners: everything needed to decide, and a button straight to the order.
  const ownerHtml = `<div style="font-family:Arial,sans-serif;color:#0B1220;max-width:640px;">
<h2 style="margin:0 0 8px;">${esc(REASONS[reason])}: ${esc(order.name)}</h2>
<p style="margin:0 0 14px;">${esc(first || order.shippingAddress && order.shippingAddress.name || '')} (${esc(email)}) wants <strong>${esc(WANTS[want].toLowerCase())}</strong>. Reply to them within 1 business day to keep this away from their bank.</p>
<table style="border-collapse:collapse;font-size:14px;">
<tr><td style="padding:4px 12px 4px 0;color:#667085;">Order</td><td>${esc(order.name)}, ${esc(money)}, placed ${age} days ago</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#667085;">Status</td><td>${esc(order.displayFinancialStatus)} · ${esc(order.displayFulfillmentStatus)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#667085;vertical-align:top;">Items</td><td>${items}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#667085;">Ships to</td><td>${esc([order.shippingAddress && order.shippingAddress.city, order.shippingAddress && order.shippingAddress.provinceCode, order.shippingAddress && order.shippingAddress.countryCodeV2].filter(Boolean).join(', '))}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#667085;vertical-align:top;">Their message</td><td>${details ? esc(details).replace(/\n/g, '<br>') : '<em>(none)</em>'}</td></tr>
</table>
<p style="margin:18px 0;"><a href="${adminUrl}" style="display:inline-block;padding:11px 20px;border-radius:999px;background:#1E4FA8;color:#fff;font-weight:700;text-decoration:none;">Open the order in Shopify</a></p>
<p style="color:#667085;font-size:12px;">Reference ${esc(ref)}. The customer was told: a reply within 1 business day; approved refunds issued within 2 business days and showing on their statement within 5-10 business days.</p></div>`;
  for (const to of ownerList(env)) {
    try { await sendViaResend(env, { to, subject: `Refund/help request ${order.name}: ${REASONS[reason]}`, html: ownerHtml, unsubUrl: env.STORE_URL }); } catch (e) { console.error('claim owner email', to, e); }
  }

  // Customer: confirmation with the reference and the timeline (a service message; reply goes to support).
  const P = (h) => `<p style="margin:0 0 16px;">${h}</p>`;
  const body2 = P(first ? `Hi ${esc(first)},` : 'Hi there,')
    + P(`Thanks for letting us know about order <strong>${esc(order.name)}</strong>. We've got your request (reference <strong>${esc(ref)}</strong>) and our team will reply within 1 business day.`)
    + P(`<strong>What happens next</strong><br>If we approve a refund, we'll issue it within 2 business days and it usually shows on your statement within 5-10 business days. A replacement ships with free tracked delivery.`)
    + (['damaged', 'wrong', 'missing'].includes(reason) ? P('To speed things up, reply to this email with a photo of the item (or of everything you received, if something is missing).') : '')
    + P(`There's no need to contact your bank: we'll sort this out with you directly, and it's much quicker this way.`)
    + `<p style="margin:0;">Thanks,<br>The ${esc(env.BRAND)} team</p>`;
  try {
    await sendViaResend(env, { to: email, subject: `We've received your request for order ${order.name} (${ref})`,
      html: layout(env, { letter: true, preheader: "We'll reply within 1 business day.", body: body2, unsubUrl: env.STORE_URL, reason: `About your order ${order.name}` }), unsubUrl: env.STORE_URL });
    await env.DB.prepare(`INSERT OR IGNORE INTO sends (email, flow, dedupe, status, created_at, sent_at) VALUES (?, 'claim', ?, 'sent', ?, ?)`).bind(email, `claim:${order.name}:${now()}`, now(), now()).run();
  } catch (e) { console.error('claim customer email', e); }

  return { status: 200, body: { ok: true, ref, name: order.name } };
}
