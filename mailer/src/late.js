// Late orders: spots orders that are behind and acts before the customer goes to their bank.
//  - Owner page: /late?key=UNSUB_SECRET lists every order that's behind and what to do.
//  - Customer: "your order is being prepared" when it hasn't shipped after LATE_SHIP_DAYS, and "running a little late"
//    (tracking link + reply-for-refund-or-reship offer) once it passes the delivery promise. One of each per order.
//  - Owners (LATE_ALERT_EMAILS): an alert as soon as an order falls behind or turns urgent, plus the morning summary. Order emails are service messages,
//    so they go to every customer (not only subscribers), but never to addresses that bounced or marked us as spam.
// Thresholds (days since the order was placed) are in wrangler.toml: LATE_SHIP_DAYS, LATE_PROMISE_DAYS, LATE_URGENT_DAYS.
import { now, DAY, esc, localParts, getKV, setKV, sendingReady } from './util.js';
import { gql } from './shopify.js';
import { layout, sendViaResend, unsubscribeUrl, sentTodayCount } from './email.js';
import { nextSendTime, timeZoneForAddress } from './timing.js';

const days = (iso) => (iso ? (Date.now() - Date.parse(iso)) / (DAY * 1000) : 0);
const fmt = (iso) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'Australia/Sydney' });

/** Every paid, uncancelled order from the last 60 days that hasn't been delivered, with how late it is. */
export async function lateOrders(env) {
  const shipDays = Number(env.LATE_SHIP_DAYS || 7);
  const promise = Number(env.LATE_PROMISE_DAYS || 21);
  const urgent = Number(env.LATE_URGENT_DAYS || 28);
  const since = new Date(Date.now() - 60 * DAY * 1000).toISOString().slice(0, 10);
  const out = [];
  let cursor = null;
  for (let page = 0; page < 3; page++) {
    const d = await gql(env, `query($q:String!,$a:String){ orders(first: 100, after: $a, sortKey: CREATED_AT, reverse: true, query: $q){ nodes {
        id name email createdAt displayFinancialStatus displayFulfillmentStatus totalPriceSet { shopMoney { amount currencyCode } }
        customer { firstName } shippingAddress { firstName name city provinceCode countryCodeV2 }
        fulfillments(first: 5) { createdAt deliveredAt displayStatus trackingInfo(first: 1) { number } } }
        pageInfo { hasNextPage endCursor } } }`, { q: `created_at:>=${since} -status:cancelled`, a: cursor });
    for (const o of d.orders.nodes) {
      if (!['PAID', 'PARTIALLY_REFUNDED'].includes(o.displayFinancialStatus)) continue;
      const fs = (o.fulfillments || []).filter((f) => f.displayStatus !== 'CANCELED');
      if (fs.length && fs.every((f) => f.deliveredAt || f.displayStatus === 'DELIVERED')) continue;
      const age = days(o.createdAt);
      const shipped = fs.length ? fs.map((f) => f.createdAt).sort()[0] : null;
      const number = (fs.map((f) => (f.trackingInfo || [])[0]).find(Boolean) || {}).number || null;
      const parcel = number ? await env.DB.prepare('SELECT status, scans FROM parcels WHERE number = ?').bind(number.replace(/\s+/g, '').toUpperCase()).first() : null;
      const pstatus = parcel ? parcel.status : null;
      const scans = parcel ? JSON.parse(parcel.scans || '[]') : [];
      if (pstatus === 'Delivered') continue; // the carrier says delivered, even if Shopify hasn't caught up
      let level = null, why = null, todo = null;
      if (!fs.length && age >= shipDays) {
        level = age >= promise ? 'urgent' : 'late';
        why = `Not shipped yet, ${Math.floor(age)} days after the order`;
        todo = age >= promise ? 'Ship it today or refund it now: it is past the delivery promise.' : 'Chase the supplier and add tracking in Shopify.';
      } else if (fs.length && ['Exception', 'DeliveryFailure', 'Expired'].includes(pstatus)) {
        level = 'urgent'; why = `Carrier problem: ${pstatus === 'DeliveryFailure' ? 'delivery attempt failed' : pstatus === 'Expired' ? 'tracking stopped updating' : 'exception'}${scans[0] ? ` (${scans[0].text})` : ''}`;
        todo = 'Check with the forwarder; offer the customer a reship or refund.';
      } else if (fs.length && pstatus === 'AvailableForPickup') {
        level = 'late'; why = 'Waiting for the customer to collect it'; todo = 'Email the customer that the parcel is ready to collect.';
      } else if (fs.length && shipped && days(shipped) >= 5 && (!pstatus || pstatus === 'NotFound') && !scans.length) {
        level = age >= promise ? 'urgent' : 'late';
        why = `Shipped ${Math.floor(days(shipped))} days ago but the tracking number has no scans yet`;
        todo = 'Check the tracking number is right and the parcel has really left the forwarder.';
      } else if (age >= urgent) {
        level = 'urgent'; why = `Not delivered, ${Math.floor(age)} days after the order (promise is ${promise})`; todo = 'Refund or reship now, before the customer opens a dispute or chargeback.';
      } else if (age >= promise) {
        level = 'late'; why = `Past the ${promise}-day delivery promise (${Math.floor(age)} days), still in transit`; todo = 'The customer gets an automatic update email; watch for a reply.';
      }
      if (!level) continue;
      out.push({ id: o.id, name: o.name, email: o.email, createdAt: o.createdAt, age: Math.floor(age), level, why, todo, number, pstatus,
        lastScan: scans[0] || null, firstName: (o.shippingAddress && o.shippingAddress.firstName) || (o.customer && o.customer.firstName) || null,
        place: o.shippingAddress ? [o.shippingAddress.city, o.shippingAddress.provinceCode, o.shippingAddress.countryCodeV2].filter(Boolean).join(', ') : '',
        country: o.shippingAddress && o.shippingAddress.countryCodeV2, province: o.shippingAddress && o.shippingAddress.provinceCode,
        total: o.totalPriceSet ? `${o.totalPriceSet.shopMoney.currencyCode === 'USD' ? '$' : o.totalPriceSet.shopMoney.currencyCode + ' '}${Number(o.totalPriceSet.shopMoney.amount).toFixed(2)}` : '',
        pastPromise: age >= promise, shipped: !!fs.length });
    }
    if (!d.orders.pageInfo.hasNextPage) break;
    cursor = d.orders.pageInfo.endCursor;
  }
  // Orders the owner has said they're dealing with (kv 'late_handled:#451159A' = their note): kept on the list, but no
  // alerts and no automatic customer emails. Set with /late?key=...&handle=%23451159A&note=..., cleared with &unhandle=.
  const { results: marks } = await env.DB.prepare(`SELECT k, v FROM kv WHERE k LIKE 'late_handled:%'`).all();
  const handled = Object.fromEntries((marks || []).map((m) => [m.k.slice('late_handled:'.length), m.v]));
  for (const o of out) if (handled[o.name] != null) o.handled = handled[o.name] || 'Owner is handling it';
  return out.sort((a, b) => (a.level === b.level ? b.age - a.age : a.level === 'urgent' ? -1 : 1));
}

const TD = 'padding:7px 10px;border-bottom:1px solid #E5E7EB;vertical-align:top;font-size:14px;';
const TH = 'padding:7px 10px;border-bottom:2px solid #1E4FA8;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#1E4FA8;';

export function lateHtml(env, all, title) {
  const list = all.filter((o) => !o.handled), mine = all.filter((o) => o.handled);
  const urgent = list.filter((o) => o.level === 'urgent').length;
  const rows = list.map((o) => `<tr><td style="${TD}white-space:nowrap;"><strong>${esc(o.name)}</strong><br><span style="color:#667085;">${esc(fmt(o.createdAt))} · ${o.age} days</span></td>`
    + `<td style="${TD}"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:700;background:${o.level === 'urgent' ? '#FEE4E2;color:#B42318' : '#FEF0C7;color:#93370D'};">${o.level === 'urgent' ? 'Urgent' : 'Late'}</span><br>${esc(o.why)}${o.lastScan ? `<br><span style="color:#667085;">Last scan: ${esc(o.lastScan.text)}${o.lastScan.place ? `, ${esc(o.lastScan.place)}` : ''}</span>` : ''}</td>`
    + `<td style="${TD}">${esc(o.todo)}</td><td style="${TD}">${esc(o.firstName || '')}<br><span style="color:#667085;">${esc(o.email || '')}<br>${esc(o.place)}</span></td>`
    + `<td style="${TD}white-space:nowrap;">${esc(o.total)}${o.number ? `<br><span style="color:#667085;">${esc(o.number)}</span>` : ''}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;color:#0B1220;max-width:1100px;"><h2 style="margin:0 0 6px;">${esc(title)}</h2>
<p style="margin:0 0 16px;">${list.length ? `${list.length} order${list.length === 1 ? ' is' : 's are'} behind${urgent ? `, <strong style="color:#B42318;">${urgent} urgent</strong>` : ''}. Refunding or reshipping before a customer goes to their bank keeps it off your chargeback rate.` : 'Nothing is behind. Every order is on track.'}</p>
${list.length ? `<table style="border-collapse:collapse;width:100%;"><tr><th style="${TH}">Order</th><th style="${TH}">What's wrong</th><th style="${TH}">What to do</th><th style="${TH}">Customer</th><th style="${TH}">Total / tracking</th></tr>${rows}</table>` : ''}
${mine.length ? `<h3 style="margin:22px 0 6px;">You're handling these (no alerts or automatic emails)</h3><table style="border-collapse:collapse;width:100%;">${mine.map((o) => `<tr><td style="${TD}white-space:nowrap;"><strong>${esc(o.name)}</strong><br><span style="color:#667085;">${o.age} days</span></td><td style="${TD}">${esc(o.handled)}</td><td style="${TD}">${esc(o.why)}</td><td style="${TD}">${esc(o.firstName || '')}<br><span style="color:#667085;">${esc(o.email || '')}</span></td></tr>`).join('')}</table>` : ''}
<p style="color:#667085;font-size:12px;margin-top:14px;">Late = not shipped after ${Number(env.LATE_SHIP_DAYS || 7)} days, no tracking scans 5 days after shipping, a carrier problem, or past the ${Number(env.LATE_PROMISE_DAYS || 21)}-day delivery promise. Urgent = ${Number(env.LATE_URGENT_DAYS || 28)}+ days, a carrier problem, or unshipped past the promise. Customers past the promise get one automatic update email.</p></div>`;
}

/**
 * Customer emails (plain service messages, one of each per order):
 *  - 'prep': not shipped after LATE_SHIP_DAYS: "your order is being prepared".
 *  - 'late': past the delivery promise: "running a little late", with tracking and a refund-or-reship offer.
 */
function customerEmail(env, o, kind) {
  const track = `${env.STORE_URL}/pages/track-your-order?order=${encodeURIComponent(o.name.replace('#', ''))}`;
  const hi = o.firstName ? `Hi ${esc(o.firstName)},` : 'Hi there,';
  const P = (h) => `<p style="margin:0 0 16px;">${h}</p>`;
  const sign = `<p style="margin:0;">Thanks for your patience,<br>The ${esc(env.BRAND)} team</p>`;
  const btn = `<p style="margin:0 0 20px;"><a href="${track}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#1E4FA8;color:#ffffff;font-weight:700;text-decoration:none;">Track my order</a></p>`;
  if (kind === 'prep') {
    const body = P(hi)
      + P(`Thanks again for your order <strong>${esc(o.name)}</strong>. Just a quick update: it's being prepared. Every order is checked by hand before it leaves us, and yours is taking a few extra days.`)
      + P(`We'll email your tracking number as soon as it's on its way, and you can check its status any time here:`)
      + btn
      + P(`Any questions, just reply to this email and we'll get back to you.`) + sign;
    return { subject: `Your order ${o.name} is being prepared`, html: layout(env, { letter: true, preheader: 'A quick update on your order.', body, unsubUrl: env.STORE_URL, reason: `About your order ${o.name}` }) };
  }
  const body = P(hi)
    + (o.shipped
      ? P(`Your order <strong>${esc(o.name)}</strong> is taking a little longer than we expected. It's on its way to you, and you can follow every update here:`) + btn
      : P(`Your order <strong>${esc(o.name)}</strong> is taking longer than we expected to leave us, and we're sorry for the wait. We're on it and will email your tracking number as soon as it ships.`))
    + P(`If it hasn't arrived within the next 7 days, or you'd rather not wait, just reply to this email and we'll refund you or send a replacement. No need to contact your bank; we'll sort it out directly.`)
    + sign;
  return { subject: `An update on your order ${o.name}`, html: layout(env, { letter: true, preheader: 'A quick update on your delivery.', body, unsubUrl: env.STORE_URL, reason: `About your order ${o.name}` }) };
}

const owners = (env) => String(env.LATE_ALERT_EMAILS || env.ADMIN_EMAIL).split(',').map((e) => e.trim()).filter(Boolean);
const liveLink = (env) => `<p style="font-family:Arial,sans-serif;"><a href="${env.PUBLIC_URL}/late?key=${env.UNSUB_SECRET}">Open the live list</a></p>`;

/** Scheduled: once a morning (owner digest) and every run (customer updates, at a sensible local time). */
export async function checkLateOrders(env) {
  if (!(await sendingReady(env))) return;
  const t = now();
  if (t < Number((await getKV(env, 'late_next')) || 0)) return;
  await setKV(env, 'late_next', String(t + 3 * 3600)); // every 3 hours is plenty
  const list = await lateOrders(env);
  await setKV(env, 'late_status', `ok ${new Date().toISOString().slice(0, 16)}: ${list.filter((o) => !o.handled).length} behind, ${list.filter((o) => o.level === 'urgent' && !o.handled).length} urgent, ${list.filter((o) => o.handled).length} being handled`);

  // Customer updates, once each, in their daytime, inside the daily send limit. Orders already past the urgent mark
  // are left to the owner to handle personally.
  const shipDays = Number(env.LATE_SHIP_DAYS || 7);
  const urgentDays = Number(env.LATE_URGENT_DAYS || 28);
  const jobs = [];
  for (const o of list) {
    if (!o.email || o.age >= urgentDays || o.handled) continue;
    if (!o.shipped && o.age >= shipDays) jobs.push([o, 'prep']);
    if (o.pastPromise) jobs.push([o, 'late']);
  }
  for (const [o, kind] of jobs) {
    const email = String(o.email).trim().toLowerCase();
    const dedupe = `${kind === 'prep' ? 'late-prep' : 'late'}:${o.name}`;
    if (await env.DB.prepare('SELECT id FROM sends WHERE dedupe = ?').bind(dedupe).first()) continue;
    if (await env.DB.prepare(`SELECT email FROM suppressions WHERE email = ? AND reason IN ('bounced', 'marked as spam', 'invalid address')`).bind(email).first()) continue;
    if (nextSendTime(env, 'checkout1', timeZoneForAddress(o.country, o.province), now())) continue; // overnight there: next run
    if (await sentTodayCount(env) >= Number(env.DAILY_SEND_LIMIT || 95)) break;
    const m = customerEmail(env, o, kind);
    try {
      const res = await sendViaResend(env, { to: email, subject: m.subject, html: m.html, unsubUrl: await unsubscribeUrl(env, email) });
      await env.DB.prepare(`INSERT INTO sends (email, flow, dedupe, status, created_at, sent_at) VALUES (?, ?, ?, 'sent', ?, ?)`).bind(email, kind === 'prep' ? 'late-prep' : 'late', dedupe, now(), now()).run();
      if (res && res.id) await env.DB.prepare('INSERT OR IGNORE INTO deliveries (resend_id, email, flow, sent_at) VALUES (?, ?, ?, ?)').bind(res.id, email, 'late', now()).run();
    } catch (e) { console.error('late email', o.name, e); }
  }

  // Owner alert straight away when an order newly becomes late, or late turns urgent.
  const fresh = [];
  for (const o of list) {
    if (o.handled) continue;
    if (!(await env.DB.prepare('SELECT id FROM sends WHERE dedupe = ?').bind(`alert:${o.name}:${o.level}`).first())) fresh.push(o);
  }
  if (fresh.length) {
    const urgent = fresh.filter((o) => o.level === 'urgent').length;
    const subject = `${urgent ? 'Urgent: ' : ''}${fresh.length} order${fresh.length === 1 ? '' : 's'} just fell behind (${fresh.map((o) => o.name).slice(0, 4).join(', ')}${fresh.length > 4 ? '...' : ''})`;
    const html = lateHtml(env, fresh, 'Orders that just fell behind') + liveLink(env);
    let ok = false;
    for (const to of owners(env)) {
      try { await sendViaResend(env, { to, subject, html, unsubUrl: env.STORE_URL }); ok = true; } catch (e) { console.error('late alert', to, e); }
    }
    if (ok) for (const o of fresh) {
      await env.DB.prepare(`INSERT OR IGNORE INTO sends (email, flow, dedupe, status, created_at, sent_at) VALUES (?, 'late-alert', ?, 'sent', ?, ?)`).bind(owners(env)[0], `alert:${o.name}:${o.level}`, now(), now()).run();
    }
  }

  // Morning summary from 8 am Sydney, only when something is behind.
  const { hour, ymd } = localParts(env);
  if (hour >= 8 && (await getKV(env, 'late_digest_ran')) !== ymd) {
    await setKV(env, 'late_digest_ran', ymd);
    const open = list.filter((o) => !o.handled);
    if (open.length && !fresh.length) {
      const urgent = open.filter((o) => o.level === 'urgent').length;
      const subject = `${urgent ? `${urgent} urgent, ` : ''}${open.length} order${open.length === 1 ? '' : 's'} running late`;
      for (const to of owners(env)) {
        try { await sendViaResend(env, { to, subject, html: lateHtml(env, list, 'Orders running late') + liveLink(env), unsubUrl: env.STORE_URL }); } catch (e) { console.error('late digest', to, e); }
      }
    }
  }
}
