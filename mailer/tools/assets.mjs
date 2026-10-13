// Draws LuxeMail's email images in the LuxeDealers look: header, banners and icons (black and gold,
// Cinzel + Poppins, the theme's gold illustrations). Run: node tools/assets.mjs  (needs Playwright + Pillow)
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright'; // npm i playwright (or NODE_PATH)

const root = new URL('../', import.meta.url);
const theme = new URL('../../assets/', import.meta.url);
const font = (f) => `data:font/woff2;base64,${readFileSync(new URL(f, theme)).toString('base64')}`;
const art = (n) => `data:image/svg+xml;base64,${readFileSync(new URL(`lx-${n}.svg`, theme)).toString('base64')}`;
const out = (p) => new URL(p, root).pathname;
const tmp = mkdtempSync(join(tmpdir(), 'lxm-'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const CSS = `@font-face{font-family:C;src:url(${font('cinzel.woff2')});font-weight:400 900}
@font-face{font-family:P;src:url(${font('poppins-500.woff2')});font-weight:500}
@font-face{font-family:P;src:url(${font('poppins-700.woff2')});font-weight:700}
*{box-sizing:border-box}body{margin:0;background:transparent}`;
const GEM = `<svg viewBox="0 0 48 48" width="100%" height="100%"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7A5412"/><stop offset=".3" stop-color="#E2B957"/><stop offset=".5" stop-color="#FFF1C1"/><stop offset=".7" stop-color="#D4A73E"/><stop offset="1" stop-color="#8A6116"/></linearGradient></defs>
<circle cx="24" cy="24" r="22.5" fill="#0D0B07" stroke="url(#g)" stroke-width="1.6"/><g stroke="url(#g)" stroke-width="1.5" stroke-linejoin="round" fill="none"><path d="M12 19.5 17.5 13h13l5.5 6.5L24 36z"/><path d="M12 19.5h24M17.5 13l3.2 6.5L24 13l3.3 6.5L30.5 13M20.7 19.5 24 36l3.3-16.5"/></g><path d="M17.5 13h13l5.5 6.5H12z" fill="url(#g)" opacity=".28"/></svg>`;
const WORD = `background:linear-gradient(100deg,#B8892E,#F6DE97 45%,#D4AF37 60%,#9C7A22);-webkit-background-clip:text;color:transparent`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function shot(html, w, h, file, { jpg = false, transparent = false } = {}) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><head><style>${CSS}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const png = jpg ? join(tmp, 'x.png') : file;
  await page.screenshot({ path: png, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
  if (jpg) execFileSync('python3', ['-c', `import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).convert('RGB').save(sys.argv[2],'JPEG',quality=86,optimize=True,progressive=True)`, png, file]);
  console.log('  ', file.split('/public/')[1]);
}

// Header, 600x100 shown at 2x.
await shot(`<div style="width:1200px;height:200px;background:#0D0B07;display:flex;align-items:center;justify-content:center;gap:26px;border-bottom:2px solid #3A2B12">
<img src="data:image/png;base64,${readFileSync(new URL('ld-mark.png', theme)).toString('base64')}" style="width:104px;height:104px;object-fit:contain"><div style="font-family:C;font-weight:600;font-size:58px;letter-spacing:4px;${WORD}">LUXE<span style="font-weight:500">DEALERS</span></div></div>`, 1200, 200, out('public/brand/header.png'));

// Banners, 600x260 shown at 2x.
const BANNERS = {
  'banner-welcome': ['Welcome gift', '10% off', 'your first order', 'gift'],
  'banner-reminder': ['A little extra', 'Here\'s 5% off', 'to finish up', 'coupon'],
  'banner-last-call': ['3 days only', 'Last call:', '15% off', 'diamond'],
  'banner-checkout': ['Saved for you', 'Your bag', 'is waiting', 'bag'],
  'banner-browse': ['Still thinking?', 'You looked,', 'we noticed', 'watch'],
  'banner-wishlist': ['Your wishlist', 'Your saved', 'picks', 'tote'],
  'banner-next-order': ['Thank you', '10% off', 'your next order', 'parcel'],
  'banner-next-reminder': ['Still yours', 'Your 10% is', 'still waiting', 'coupon'],
  'banner-vip': ['VIP', 'You\'re one of', 'our best', 'ring'],
  'banner-winback': ['It\'s been a while', 'We miss', 'you', 'perfume'],
  'banner-new-arrivals': ['Just landed', 'New', 'arrivals', 'sneaker'],
  'banner-best-sellers': ['This fortnight', 'Top picks', 'right now', 'watch'],
  'banner-blog': ['The journal', 'Stories', 'worth a read', 'necklace'],
  'banner-picks-everyone': ['Picked for you', 'Fresh picks', 'for you', 'sunglasses'],
  'banner-picks-bags': ['Picked for you', 'Bags', 'for you', 'bag'],
  'banner-picks-shoes': ['Picked for you', 'Shoes', 'for you', 'heel'],
  'banner-picks-clothing': ['Picked for you', 'Clothing', 'for you', 'hoodie'],
  'banner-picks-accessories': ['Picked for you', 'Accessories', 'for you', 'sunglasses'],
};
for (const [name, [eyebrow, l1, l2, ill]] of Object.entries(BANNERS)) {
  await shot(`<div style="position:relative;width:1200px;height:520px;overflow:hidden;background:radial-gradient(ellipse at 78% 50%,#3A2B12 0%,#1A140A 38%,#0D0B07 70%)">
<div style="position:absolute;inset:22px;border:1.5px solid rgba(212,175,55,.35);border-radius:22px"></div>
<div style="position:absolute;right:40px;top:30px;width:460px;height:460px;background:url(${art(ill)}) center/contain no-repeat;filter:drop-shadow(0 18px 30px rgba(0,0,0,.5))"></div>
<div style="position:absolute;left:84px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;justify-content:center">
<div style="font-family:P;font-weight:500;font-size:24px;letter-spacing:7px;text-transform:uppercase;color:#E6C463">${esc(eyebrow)}</div>
<div style="width:64px;height:2px;background:#D4AF37;margin:26px 0 28px"></div>
<div style="font-family:C;font-weight:700;font-size:80px;line-height:1.04;color:#FFFFFF">${esc(l1)}<br><span style="${WORD}">${esc(l2)}</span></div></div></div>`, 1200, 520, out(`public/banners/${name}.jpg`), { jpg: true });
}

// Icons, 96x96 transparent (shown at 44-48px).
const stroke = (c) => `fill="none" stroke="${c}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`;
const GLYPHS = {
  gift: '<rect x="4" y="9" width="16" height="4" rx="1"/><path d="M5.5 13v7.5h13V13M12 9v11.5M12 9C10 5 6.5 5 7 7.5S12 9 12 9zm0 0c2-4 5.5-4 5-1.5S12 9 12 9z"/>',
  tag: '<path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12l9 9-9 9z"/><circle cx="8" cy="8" r="1.6"/>',
  crown: '<path d="M3.5 8 7 11.5 12 5l5 6.5L20.5 8 19 18H5z"/><path d="M5 20.5h14"/>',
  heart: '<path d="M12 20s-7.5-4.6-8.6-9.4C2.7 7.4 4.7 4.5 7.8 4.5c1.9 0 3.3 1.1 4.2 2.6.9-1.5 2.3-2.6 4.2-2.6 3.1 0 5.1 2.9 4.4 6.1C19.5 15.4 12 20 12 20z"/>',
  sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  truck: '<path d="M2.5 6h11v10h-11zM13.5 9.5h4l3 3.5v3h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  refund: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"/><path d="M12 8v4l2.5 2"/>',
  chat: '<path d="M4 5.5h16v10H9.5L5 19.5v-4H4z"/><path d="M8 10.5h.01M12 10.5h.01M16 10.5h.01"/>',
};
for (const [n, g] of Object.entries(GLYPHS)) {
  const offer = ['gift', 'tag', 'crown', 'heart', 'sparkles'].includes(n);
  const svg = offer
    ? `<svg viewBox="0 0 24 24" width="96" height="96"><g ${stroke('#F1D27A')} transform="translate(2.4 2.4) scale(.8)">${g}</g></svg>`
    : `<svg viewBox="0 0 24 24" width="96" height="96"><circle cx="12" cy="12" r="11.6" fill="#0D0B07"/><g ${stroke('#E6C463')} transform="translate(5.4 5.4) scale(.55)" stroke-width="2.2">${g}</g></svg>`;
  await shot(svg, 96, 96, out(`public/icons/${offer ? 'offer' : 'trust'}-${n}.png`), { transparent: true });
}
const SOCIAL = {
  instagram: '<rect x="5" y="5" width="14" height="14" rx="4"/><circle cx="12" cy="12" r="3.3"/><circle cx="16.2" cy="7.8" r=".6" fill="#E6C463"/>',
  facebook: '<path d="M13.2 19.5v-6.6h2.3l.4-2.7h-2.7V8.6c0-.8.3-1.3 1.4-1.3H16V4.9c-.3 0-1.1-.1-2.1-.1-2.1 0-3.4 1.2-3.4 3.5v2h-2.3v2.7h2.3v6.6"/>',
  tiktok: '<path d="M13.5 4.5v10.3a2.9 2.9 0 1 1-2.6-2.9M13.5 4.5c.3 2.2 1.8 3.7 4 3.9"/>',
};
for (const [n, g] of Object.entries(SOCIAL)) {
  await shot(`<svg viewBox="0 0 24 24" width="72" height="72"><circle cx="12" cy="12" r="11.3" fill="none" stroke="#6B5323" stroke-width=".9"/><g ${stroke('#E6C463')} stroke-width="1.5">${g}</g></svg>`, 72, 72, out(`public/icons/social-${n}.png`), { transparent: true });
}
await browser.close();
