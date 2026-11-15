// Checkout report for the owner: where shoppers stop in checkout, from the custom pixel's step-by-step data.
// Page: /report?key=UNSUB_SECRET (&days=7). Email: every morning to ADMIN_EMAIL with yesterday's checkouts.
import { now, DAY, esc, localParts, getKV, setKV, sendingReady } from './util.js';
import { sendViaResend } from './email.js';

export const STEPS = ['', 'Started checkout', 'Entered email/phone', 'Entered address', 'Chose delivery', 'Entered payment', 'Paid'];
// What a checkout that stopped at each step had NOT done yet.
const STOPPED = ['', 'Left before entering their email', 'Left after their email, before the address', 'Left after the address, before delivery',
  'Left at delivery/shipping, before payment', 'Left after entering payment (declined or changed mind?)', 'Paid'];

const n = (v) => (v == null || v === '' ? null : Number(v));
const fmtMoney = (v, cur) => (v == null || v === '' ? '' : `${cur && cur !== 'USD' ? cur + ' ' : '$'}${Number(v).toFixed(2)}`);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');

export async function funnelData(env, since, until = now()) {
  const { results: all } = await env.DB.prepare('SELECT * FROM funnel WHERE started_at >= ? AND started_at < ? ORDER BY started_at DESC').bind(since, until).all();
  // The report is about the countries the store advertises to (MAIN_MARKETS). Checkouts from elsewhere are mostly bots,
  // click farms or people outside the ad audience; they're counted separately so they don't hide the real drop-off.
  const markets = String(env.MAIN_MARKETS || 'US,CA,AU,NZ').split(',').map((c) => c.trim().toUpperCase());
  const countryOf = (r) => r.country || r.visitor_country || null;
  const results = all.filter((r) => !countryOf(r) || markets.includes(countryOf(r)));
  const outside = all.filter((r) => countryOf(r) && !markets.includes(countryOf(r)));
  const outsideBy = new Map();
  for (const r of outside) { const g = outsideBy.get(countryOf(r)) || { name: countryOf(r), started: 0, paid: 0 }; g.started++; if (r.step >= 6) g.paid++; outsideBy.set(g.name, g); }
  const reached = [0, 0, 0, 0, 0, 0, 0];
  for (const r of results) for (let s = 1; s <= Math.min(6, r.step || 1); s++) reached[s]++;
  const groupBy = (key) => {
    const m = new Map();
    for (const r of results) {
      const k = r[key] || 'Unknown';
      const g = m.get(k) || { name: k, started: 0, paid: 0 };
      g.started++; if (r.step >= 6) g.paid++;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.started - a.started);
  };
  const shipping = results.filter((r) => n(r.shipping) != null);
  const avgShip = (rows) => (rows.length ? rows.reduce((s, r) => s + n(r.shipping), 0) / rows.length : null);
  const alerts = new Map();
  for (const r of results) for (const a of (r.alerts ? JSON.parse(r.alerts) : [])) alerts.set(a, (alerts.get(a) || 0) + 1);
  return {
    rows: results,
    reached,
    markets,
    outside: { total: outside.length, paid: outside.filter((r) => r.step >= 6).length, countries: [...outsideBy.values()].sort((a, b) => b.started - a.started) },
    byDevice: groupBy('device'),
    byBrowser: groupBy('browser'),
    byCountry: results.map((r) => ({ ...r, c: r.country || r.visitor_country })).reduce((m, r) => {
      const k = r.c || 'Unknown'; const g = m.get(k) || { name: k, started: 0, paid: 0 }; g.started++; if (r.step >= 6) g.paid++; m.set(k, g); return m;
    }, new Map()),
    shipPaid: avgShip(shipping.filter((r) => r.step >= 6)),
    shipLeft: avgShip(shipping.filter((r) => r.step < 6)),
    freeShipLeft: shipping.filter((r) => r.step < 6 && n(r.shipping) === 0).length,
    paidShipLeft: shipping.filter((r) => r.step < 6 && n(r.shipping) > 0).length,
    alerts: [...alerts.entries()].sort((a, b) => b[1] - a[1]),
  };
}

const TD = 'padding:6px 10px;border-bottom:1px solid #E5E7EB;vertical-align:top;';
const TH = 'padding:6px 10px;border-bottom:2px solid #1E4FA8;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#1E4FA8;';

function table(head, rows) {
  return `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:0 0 20px;"><tr>${head.map((h) => `<th style="${TH}">${esc(h)}</th>`).join('')}</tr>${rows.join('')}</table>`;
}

function whenLocal(env, unix) {
  return new Date(unix * 1000).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** The report as HTML (used by both the page and the email). */
export async function funnelHtml(env, since, until, title) {
  const d = await funnelData(env, since, until);
  const total = d.reached[1];
  const funnelRows = STEPS.slice(1).map((label, i) => {
    const s = i + 1, got = d.reached[s], prev = s === 1 ? total : d.reached[s - 1];
    const lost = s === 1 ? 0 : prev - got;
    return `<tr><td style="${TD}">${esc(label)}</td><td style="${TD}text-align:right;"><strong>${got}</strong></td><td style="${TD}text-align:right;">${pct(got, total)}</td>`
      + `<td style="${TD}text-align:right;color:${lost ? '#B42318' : '#667085'};">${s === 1 ? '' : lost ? `-${lost}` : '0'}</td></tr>`;
  });
  // Where most people left: the biggest drop between two steps.
  let worst = null;
  for (let s = 2; s <= 6; s++) { const lost = d.reached[s - 1] - d.reached[s]; if (lost > 0 && (!worst || lost > worst.lost)) worst = { s, lost }; }
  const headline = !total ? 'No checkouts recorded in this period yet.'
    : `${total} checkout${total === 1 ? '' : 's'} from ${esc(d.markets.join(', '))}, ${d.reached[6]} paid (${pct(d.reached[6], total)}).`
      + (worst ? ` Most people left between <strong>${esc(STEPS[worst.s - 1].toLowerCase())}</strong> and <strong>${esc(STEPS[worst.s].toLowerCase())}</strong> (${worst.lost}).` : '');
  const groupRows = (list) => list.slice(0, 8).map((g) => `<tr><td style="${TD}">${esc(g.name)}</td><td style="${TD}text-align:right;">${g.started}</td><td style="${TD}text-align:right;">${g.paid}</td><td style="${TD}text-align:right;">${pct(g.paid, g.started)}</td></tr>`);
  const parts = [];
  if (d.shipLeft != null) parts.push(`average <strong>${fmtMoney(d.shipLeft)}</strong> for people who left`);
  if (d.shipPaid != null) parts.push(`<strong>${fmtMoney(d.shipPaid)}</strong> for people who paid`);
  const left = d.paidShipLeft + d.freeShipLeft;
  const ship = parts.length
    ? `<p>Shipping price shown at checkout: ${parts.join(' vs ')}.${left ? ` Of the ${left} who left after seeing a delivery price, ${d.paidShipLeft} had to pay for shipping and ${d.freeShipLeft} had free shipping.` : ''}</p>`
    : '';
  const alerts = d.alerts.length
    ? `<h3 style="margin:24px 0 8px;">Error messages shoppers saw</h3>${table(['Message', 'Checkouts'], d.alerts.slice(0, 10).map(([a, c]) => `<tr><td style="${TD}">${esc(a)}</td><td style="${TD}text-align:right;">${c}</td></tr>`))}`
    : '';
  const people = d.rows.filter((r) => r.step < 6).slice(0, 60).map((r) => {
    const items = r.items ? JSON.parse(r.items) : [];
    const what = items.map((i) => `${esc(i.title || '')}${i.variant ? ` (${esc(i.variant)})` : ''}${i.qty > 1 ? ` x${i.qty}` : ''}`).join('<br>');
    const who = [r.name, r.email, r.phone].filter(Boolean).map(esc).join('<br>') || '<span style="color:#667085;">Anonymous (left before typing an email)</span>';
    const where = [r.city, r.region, r.country || r.visitor_country].filter(Boolean).map(esc).join(', ');
    const alerts = r.alerts ? JSON.parse(r.alerts).map((a) => `<br><span style="color:#B42318;">${esc(a)}</span>`).join('') : '';
    return `<tr><td style="${TD}white-space:nowrap;">${esc(whenLocal(env, r.started_at))}</td><td style="${TD}">${who}</td><td style="${TD}">${esc(STOPPED[r.step] || '')}${alerts}</td>`
      + `<td style="${TD}">${what}</td><td style="${TD}text-align:right;white-space:nowrap;">${fmtMoney(r.subtotal, r.currency)}${r.shipping != null ? `<br><span style="color:#667085;">+ ${fmtMoney(r.shipping, r.currency)} ship</span>` : ''}</td>`
      + `<td style="${TD}">${[r.device, r.browser].filter(Boolean).map(esc).join(', ')}${where ? `<br><span style="color:#667085;">${where}</span>` : ''}</td></tr>`;
  });
  return `<div style="font-family:Arial,sans-serif;color:#0B1220;max-width:1100px;">
<h2 style="margin:0 0 6px;">${esc(title)}</h2><p style="margin:0 0 18px;">${headline}</p>
${table(['Step', 'Checkouts', 'Of all', 'Dropped before this step'], funnelRows)}${ship}${alerts}
<h3 style="margin:24px 0 8px;">By device</h3>${table(['Device', 'Checkouts', 'Paid', 'Paid %'], groupRows(d.byDevice))}
<h3 style="margin:24px 0 8px;">By browser or app</h3>${table(['Browser', 'Checkouts', 'Paid', 'Paid %'], groupRows(d.byBrowser))}
<h3 style="margin:24px 0 8px;">By country</h3>${table(['Country', 'Checkouts', 'Paid', 'Paid %'], groupRows([...d.byCountry.values()].sort((a, b) => b.started - a.started)))}
<h3 style="margin:24px 0 8px;">Checkouts that didn't finish</h3>${people.length ? table(['When (Sydney)', 'Who', 'Where they stopped', 'Cart', 'Value', 'Device / location'], people) : '<p>None.</p>'}
${d.outside.total ? `<h3 style="margin:24px 0 8px;">Other countries (not in the numbers above)</h3><p>${d.outside.total} checkout${d.outside.total === 1 ? '' : 's'} from countries you don't advertise to, ${d.outside.paid} paid. Mostly bots, click farms or people outside your ad audience.</p>${table(['Country', 'Checkouts', 'Paid', 'Paid %'], d.outside.countries.slice(0, 10).map((g) => `<tr><td style="${TD}">${esc(g.name)}</td><td style="${TD}text-align:right;">${g.started}</td><td style="${TD}text-align:right;">${g.paid}</td><td style="${TD}text-align:right;">${pct(g.paid, g.started)}</td></tr>`))}` : ''}
<p style="color:#667085;font-size:12px;">Times are Sydney time. Anonymous means they left before typing an email; Shopify doesn't know who they are either. Shop Pay and other express checkouts that finish on Shop's own pages may only show their first step.</p></div>`;
}

/** Every morning from 8 am Sydney: yesterday's checkouts to ADMIN_EMAIL (skipped when there were none). */
export async function dailyCheckoutReport(env) {
  if (!(await sendingReady(env))) return;
  const { hour, ymd } = localParts(env);
  if (hour < 8 || (await getKV(env, 'checkout_report_ran')) === ymd) return;
  await setKV(env, 'checkout_report_ran', ymd);
  const offset = Number(env.TIMEZONE_OFFSET_HOURS || 10) * 3600;
  const todayStart = Math.floor((now() + offset) / DAY) * DAY - offset;
  const since = todayStart - DAY;
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM funnel WHERE started_at >= ? AND started_at < ?').bind(since, todayStart).first();
  if (!row || !row.c) return;
  const html = await funnelHtml(env, since, todayStart, `Checkouts yesterday`);
  const link = `${env.PUBLIC_URL}/report?key=${env.UNSUB_SECRET}&days=7`;
  await sendViaResend(env, { to: env.ADMIN_EMAIL, subject: `Checkout report: ${row.c} checkout${row.c === 1 ? '' : 's'} yesterday`,
    html: html + `<p style="font-family:Arial,sans-serif;"><a href="${link}">See the last 7 days</a></p>`, unsubUrl: env.STORE_URL });
}
