// Sending at the right local time for each subscriber.
//
// Every subscriber gets a time zone (IANA name, e.g. "America/New_York"), from, in order of preference:
//  - their browser, when they sign up or browse the store (Cloudflare tells the Worker the visitor's time zone),
//  - the Shopify custom pixel at checkout (same: the shopper's own browser),
//  - their Shopify customer address (country, and state/province where a country spans several zones).
// Unknown time zones fall back to DEFAULT_TIMEZONE (most LuxeDealers customers are in the US).
//
// When to send. Email-marketing benchmarks (Klaviyo, Omnisend, Mailchimp and GetResponse send-time studies) keep
// finding the same two peaks in the recipient's own time: late morning (around 10 am) and the evening (around 8 pm,
// strongest for online shopping). Nobody reads email sent at 2 am; it's buried by morning.
//  - Newsletters and non-urgent emails: only inside 10 am-12 pm or 7-9 pm local time.
//  - Reminders (checkout, cart, welcome, thank-you): keep their delay, but never between 10 pm and 7:30 am local.

const US_STATES = {
  // Eastern
  CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York',
  IN: 'America/Indiana/Indianapolis', KY: 'America/New_York', ME: 'America/New_York', MD: 'America/New_York', MA: 'America/New_York',
  MI: 'America/Detroit', NH: 'America/New_York', NJ: 'America/New_York', NY: 'America/New_York', NC: 'America/New_York',
  OH: 'America/New_York', PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York', VT: 'America/New_York',
  VA: 'America/New_York', WV: 'America/New_York', PR: 'America/Puerto_Rico', VI: 'America/St_Thomas',
  // Central
  AL: 'America/Chicago', AR: 'America/Chicago', IL: 'America/Chicago', IA: 'America/Chicago', KS: 'America/Chicago',
  LA: 'America/Chicago', MN: 'America/Chicago', MS: 'America/Chicago', MO: 'America/Chicago', NE: 'America/Chicago',
  ND: 'America/Chicago', OK: 'America/Chicago', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', WI: 'America/Chicago',
  // Mountain
  AZ: 'America/Phoenix', CO: 'America/Denver', ID: 'America/Boise', MT: 'America/Denver', NM: 'America/Denver', UT: 'America/Denver', WY: 'America/Denver',
  // Pacific and beyond
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles', OR: 'America/Los_Angeles', WA: 'America/Los_Angeles',
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu', GU: 'Pacific/Guam',
};
const CA_PROVINCES = {
  NL: 'America/St_Johns', NS: 'America/Halifax', NB: 'America/Halifax', PE: 'America/Halifax', QC: 'America/Toronto', ON: 'America/Toronto',
  MB: 'America/Winnipeg', SK: 'America/Regina', AB: 'America/Edmonton', BC: 'America/Vancouver', YT: 'America/Whitehorse',
  NT: 'America/Yellowknife', NU: 'America/Iqaluit',
};
const AU_STATES = {
  NSW: 'Australia/Sydney', ACT: 'Australia/Sydney', VIC: 'Australia/Melbourne', TAS: 'Australia/Hobart', QLD: 'Australia/Brisbane',
  SA: 'Australia/Adelaide', NT: 'Australia/Darwin', WA: 'Australia/Perth',
};
const MX_STATES = { BC: 'America/Tijuana', BCS: 'America/Mazatlan', SON: 'America/Hermosillo', SIN: 'America/Mazatlan', NAY: 'America/Mazatlan', CHH: 'America/Chihuahua', ROO: 'America/Cancun' };
// One main zone per country (where a country spans several, the most populous one).
const COUNTRIES = {
  US: 'America/Chicago', CA: 'America/Toronto', AU: 'Australia/Sydney', NZ: 'Pacific/Auckland', GB: 'Europe/London', IE: 'Europe/Dublin',
  MX: 'America/Mexico_City', BR: 'America/Sao_Paulo', AR: 'America/Argentina/Buenos_Aires', CL: 'America/Santiago', CO: 'America/Bogota', PE: 'America/Lima',
  FR: 'Europe/Paris', DE: 'Europe/Berlin', IT: 'Europe/Rome', ES: 'Europe/Madrid', PT: 'Europe/Lisbon', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels',
  CH: 'Europe/Zurich', AT: 'Europe/Vienna', SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki', PL: 'Europe/Warsaw',
  CZ: 'Europe/Prague', GR: 'Europe/Athens', RO: 'Europe/Bucharest', HU: 'Europe/Budapest', TR: 'Europe/Istanbul', RU: 'Europe/Moscow', UA: 'Europe/Kyiv',
  AE: 'Asia/Dubai', SA: 'Asia/Riyadh', QA: 'Asia/Qatar', KW: 'Asia/Kuwait', IL: 'Asia/Jerusalem', IN: 'Asia/Kolkata', PK: 'Asia/Karachi',
  SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur', PH: 'Asia/Manila', ID: 'Asia/Jakarta', TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh', HK: 'Asia/Hong_Kong',
  TW: 'Asia/Taipei', CN: 'Asia/Shanghai', JP: 'Asia/Tokyo', KR: 'Asia/Seoul', ZA: 'Africa/Johannesburg', NG: 'Africa/Lagos', KE: 'Africa/Nairobi',
  EG: 'Africa/Cairo', JM: 'America/Jamaica', TT: 'America/Port_of_Spain', DO: 'America/Santo_Domingo', FJ: 'Pacific/Fiji',
};

export function validTimeZone(tz) {
  if (typeof tz !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (_) { return null; }
}

/** Best time zone for a Shopify-style address: country code plus state/province code. */
export function timeZoneForAddress(country, province) {
  const c = String(country || '').toUpperCase();
  const p = String(province || '').toUpperCase().replace(/^[A-Z]{2}-/, '');
  if (c === 'US' && US_STATES[p]) return US_STATES[p];
  if (c === 'CA' && CA_PROVINCES[p]) return CA_PROVINCES[p];
  if (c === 'AU' && AU_STATES[p]) return AU_STATES[p];
  if (c === 'MX' && MX_STATES[p]) return MX_STATES[p];
  return COUNTRIES[c] || null;
}

/** The visitor's time zone and country from Cloudflare's request data (their own connection). */
export function fromRequest(request) {
  const cf = (request && request.cf) || {};
  return { tz: validTimeZone(cf.timezone), country: typeof cf.country === 'string' ? cf.country.slice(0, 2) : null };
}

/** Records a subscriber's time zone (and country) when we learn it. Browser-based sources win over addresses. */
export async function rememberTimeZone(env, email, { tz, country, source }) {
  tz = validTimeZone(tz);
  if (!email || !tz) return;
  // 'browser' (sign-up, browsing, checkout) beats 'address' (Shopify customer address).
  const keep = source === 'address' ? "AND (tz IS NULL OR tz_source = 'address')" : '';
  await env.DB.prepare(`UPDATE subscribers SET tz = ?, country = COALESCE(?, country), tz_source = ? WHERE email = ? ${keep}`)
    .bind(tz, country || null, source || 'browser', email).run();
}

function localClock(tz, unix) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(unix * 1000));
  const get = (t) => Number((parts.find((x) => x.type === t) || {}).value || 0);
  return get('hour') * 60 + get('minute'); // minutes since local midnight
}

// Windows in minutes since local midnight.
const PEAK = [[10 * 60, 12 * 60], [19 * 60, 21 * 60]]; // 10 am-12 pm, 7-9 pm
const AWAKE = [[7 * 60 + 30, 22 * 60]]; // 7:30 am-10 pm

export const URGENT_FLOWS = ['checkout1', 'checkout2', 'cart1', 'cart2', 'welcome1', 'postpurchase'];

/**
 * If now is a good local time for this email, returns 0. Otherwise returns the unix time of the start of the
 * next good window for that person (checked on a 15-minute grid, so it's at most 15 minutes late).
 */
export function nextSendTime(env, flow, tz, unix) {
  const zone = validTimeZone(tz) || validTimeZone(env.DEFAULT_TIMEZONE) || 'America/Chicago';
  const windows = URGENT_FLOWS.includes(flow) ? AWAKE : PEAK;
  const inWindow = (t) => { const m = localClock(zone, t); return windows.some(([a, b]) => m >= a && m < b); };
  if (inWindow(unix)) return 0;
  const step = 15 * 60;
  let t = Math.ceil(unix / step) * step;
  for (let i = 0; i < 4 * 24 + 4; i++, t += step) if (inWindow(t)) return t;
  return unix + 3600; // can't happen; never block an email for good
}
