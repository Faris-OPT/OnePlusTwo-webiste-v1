#!/usr/bin/env node
/* Make a social sharing image (1200 x 630) for every page and point its og:image at it.

   Run from the repository root, after the other build scripts:

       node tools/build-og-images.js

   Needs Node with Playwright and Chromium (npm i playwright; npx playwright install chromium).
   Images are written to assets/img/og/<page>.jpg. Each image shows the page's main heading,
   a small label (the breadcrumb, or the blog category) and the OnePlusTwo logo, in the brand
   colours and fonts. Pages without an <h1> keep the default assets/img/og-image.png. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://www.oneplustwo.co.uk';
const OUT = path.join(ROOT, 'assets/img/og');
const SKIP = new Set(['404.html']);

function pages() {
  const list = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map((f) => f);
  for (const dir of ['blog', 'hardware']) {
    const d = path.join(ROOT, dir);
    if (fs.existsSync(d)) fs.readdirSync(d).filter((f) => f.endsWith('.html')).forEach((f) => list.push(`${dir}/${f}`));
  }
  return list.filter((f) => !SKIP.has(f));
}

const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|’/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function card(title, label) {
  const data = (f, type) => `data:${type};base64,` + fs.readFileSync(path.join(ROOT, f)).toString('base64');
  const font = (f) => data('assets/fonts/' + f, 'font/woff2');
  const logo = data('assets/img/logo-dark.png', 'image/png');
  const size = title.length > 60 ? 64 : title.length > 40 ? 76 : 88;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:B;src:url(${font('bricolage.woff2')}) format("woff2");font-weight:600 800}
@font-face{font-family:F;src:url(${font('figtree.woff2')}) format("woff2");font-weight:300 900}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px;overflow:hidden}
body{background:#FCFBF7;font-family:F,sans-serif;color:#161616;position:relative;padding:70px 80px;display:flex;flex-direction:column;justify-content:space-between}
.blob{position:absolute;border-radius:50%;background:#E4F8EE;z-index:-1}
.label{display:inline-block;background:#04D98B;color:#161616;font-weight:700;font-size:26px;padding:10px 22px;border-radius:999px;align-self:flex-start}
h1{font-family:B;font-weight:800;font-size:${size}px;line-height:1.05;letter-spacing:-.02em;max-width:1000px}
.foot{display:flex;align-items:center;justify-content:space-between}
.foot img{height:54px}
.foot span{font-weight:600;font-size:26px;color:#036B45}
</style></head><body>
<div class="blob" style="width:520px;height:520px;right:-150px;top:-200px"></div>
<div class="blob" style="width:300px;height:300px;left:-120px;bottom:-170px"></div>
${label ? `<span class="label">${esc(label)}</span>` : '<span></span>'}
<h1>${esc(title)}</h1>
<div class="foot"><img src="${logo}" alt=""><span>oneplustwo.co.uk</span></div>
</body></html>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  let made = 0;
  for (const file of pages()) {
    const full = path.join(ROOT, file);
    let html = fs.readFileSync(full, 'utf8');
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    const h1 = main.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (!h1) continue;
    const crumb = main.match(/<a class="breadcrumb" href="[^"]*">([\s\S]*?)<\/a>/);
    const lbl = main.match(/<span class="label">([\s\S]*?)<\/span>/);
    const label = crumb ? decode(crumb[1]) : lbl ? decode(lbl[1]) : '';
    const name = file.replace(/\.html$/, '').replace(/\//g, '-');
    const out = path.join(OUT, `${name}.jpg`);
    await page.setContent(card(decode(h1[1]), label), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: out, type: 'jpeg', quality: 82 });
    const url = `${SITE}/assets/img/og/${name}.jpg`;
    const updated = html.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${url}">`);
    if (updated !== html) fs.writeFileSync(full, updated);
    made++;
  }
  await browser.close();
  console.log(`Made ${made} social images`);
})();
