// Footer images for LuxeMail. Dark-mode mail apps (Gmail's app especially) recolour backgrounds and text but never
// images, so the footer's background tile and text are drawn here. Run: node tools/footer.mjs  (needs Playwright)
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright'; // npm i playwright (or NODE_PATH)

const theme = new URL('../../assets/', import.meta.url);
const dir = new URL('../public/footer/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const font = (f) => `data:font/woff2;base64,${readFileSync(new URL(f, theme)).toString('base64')}`;
const CSS = `@font-face{font-family:P;src:url(${font('poppins-500.woff2')});font-weight:500}
@font-face{font-family:P;src:url(${font('poppins-700.woff2')});font-weight:700}
*{margin:0}body{background:transparent}span{display:inline-block;font-family:P;white-space:nowrap}`;

// [file, html]: each image is cropped to its text, drawn at 3x and shown at 1x.
const PARTS = [
  ['new-in', '<span style="font-weight:700;font-size:13px;line-height:20px;color:#FFD966">New in</span>'],
  ['bags', '<span style="font-weight:700;font-size:13px;line-height:20px;color:#FFD966">Bags</span>'],
  ['shop-all', '<span style="font-weight:700;font-size:13px;line-height:20px;color:#FFD966">Shop all</span>'],
  ['dot', '<span style="font-weight:700;font-size:13px;line-height:20px;color:#8FB0E8;padding:0 9px">·</span>'],
  ['help', '<span style="font-weight:500;font-size:13px;line-height:20px;color:#E3EBFA">Questions? Email <u style="color:#FFFFFF">support@luxedealers.com</u></span>'],
  ['unsub', '<span style="font-weight:500;font-size:12px;line-height:18px;color:#C3D3F0">Signed up for LuxeDealers emails&nbsp;&nbsp;·&nbsp;&nbsp;<u style="color:#E3EBFA">Unsubscribe</u></span>'],
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ deviceScaleFactor: 3 });
const sizes = {};
for (const [name, html] of PARTS) {
  await page.setContent(`<html><head><style>${CSS}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const el = await page.$('span');
  const box = await el.boundingBox();
  await el.screenshot({ path: `${dir}${name}.png`, omitBackground: true });
  sizes[name] = [Math.ceil(box.width), Math.ceil(box.height)];
}
// Background tile (solid footer colour) so the footer stays dark even when a mail app flips background colours.
const tile = await browser.newPage({ deviceScaleFactor: 1 });
await tile.setViewportSize({ width: 8, height: 8 });
await tile.setContent('<body style="margin:0;background:#1E4FA8"></body>');
await tile.screenshot({ path: `${dir}bg.png` });
await browser.close();
console.log(JSON.stringify(sizes));
