// LuxeMail custom pixel. Paste into Shopify admin: Settings > Customer events > LuxeMail (or Add custom pixel), then Save and Connect.
// 1. Checkout reminders: tells LuxeMail about checkouts and completed orders (stops reminders, sends the post-purchase
//    email, builds the VIP and win-back history). LuxeMail only ever emails confirmed subscribers.
// 2. Checkout report: every step of every checkout (started, contact, address, delivery, payment, paid), plus any error
//    message the checkout showed, so the owner can see where shoppers stop. Report only; it never emails anyone.
// deploy.sh fills in ENDPOINT with the Worker's address.
const ENDPOINT = 'https://luxemail-main.turbozzgeezzz.workers.dev/p';

let lastToken = null;

function handleFrom(url) {
  const m = /\/products\/([^/?#]+)/.exec(url || '');
  return m ? decodeURIComponent(m[1]) : null;
}

const amount = (m) => (m && m.amount != null ? String(m.amount) : null);

function post(body) {
  fetch(ENDPOINT, { method: 'POST', body: JSON.stringify(body), keepalive: true, mode: 'no-cors', headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
}

function send(type, step, event) {
  const checkout = event.data && event.data.checkout;
  if (!checkout || !checkout.token) return;
  lastToken = checkout.token;
  const addr = checkout.shippingAddress || checkout.billingAddress || {};
  const ctx = event.context || {};
  const nav = ctx.navigator || {};
  const doc = ctx.document || {};
  post({
    t: type,
    step,
    token: checkout.token,
    e: checkout.email || null,
    am: checkout.buyerAcceptsEmailMarketing === true,
    fn: addr.firstName || null,
    ln: addr.lastName || null,
    ph: checkout.phone || addr.phone || null,
    cc: addr.countryCode || null,
    pc: addr.provinceCode || null,
    city: addr.city || null,
    cur: checkout.currencyCode || null,
    total: amount(checkout.subtotalPrice),
    ship: checkout.shippingLine ? amount(checkout.shippingLine.price) : null,
    tax: amount(checkout.totalTax),
    grand: amount(checkout.totalPrice),
    disc: (checkout.discountApplications || []).map((d) => d.title || d.type || '').filter(Boolean).slice(0, 5),
    order: checkout.order ? String(checkout.order.id) : null,
    ua: nav.userAgent || null,
    ref: doc.referrer || null,
    items: (checkout.lineItems || []).map((l) => ({
      variantId: l.variant ? String(l.variant.id) : null,
      qty: l.quantity,
      handle: l.variant && l.variant.product ? handleFrom(l.variant.product.url) : null,
      title: l.title,
      variant: l.variant ? l.variant.title || null : null,
      price: l.variant ? amount(l.variant.price) : null,
    })),
  });
}

analytics.subscribe('checkout_started', (event) => send('checkout', 1, event));
analytics.subscribe('checkout_contact_info_submitted', (event) => send('checkout', 2, event));
analytics.subscribe('checkout_address_info_submitted', (event) => send('checkout', 3, event));
analytics.subscribe('checkout_shipping_info_submitted', (event) => send('checkout', 4, event));
analytics.subscribe('payment_info_submitted', (event) => send('checkout', 5, event));
analytics.subscribe('checkout_completed', (event) => send('order', 6, event));

// Error messages the checkout shows the shopper (card declined, address not recognised, item sold out...).
analytics.subscribe('alert_displayed', (event) => {
  const a = (event.data && event.data.alert) || {};
  if (!lastToken) return;
  post({ t: 'alert', token: lastToken, alert: [a.type, a.target, a.value].filter(Boolean).join(' | ').slice(0, 300) });
});
