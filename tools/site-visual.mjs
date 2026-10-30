// Captura a página de download emulando Windows, iPhone, iPad e Android.
// Uso: node tools/site-visual.mjs [pasta-de-saida]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, '..', 'apps', 'site');
const out = resolve(process.argv[2] || join(here, 'site-screens'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const http = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end("window.NEXUS_SITE={repo:'exemplo/nexus',appUrl:'./app/',windowsAvailable:true,apkAvailable:true,version:'0.1.0'};");
  }
  let p = join(site, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) p = join(p, 'index.html');
  try {
    const body = await readFile(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => http.listen(4320, r));
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const ipadSafari = { ...devices['iPad Pro 11'], userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' };
const cases = [
  ['site-windows', { viewport: { width: 1280, height: 900 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' }],
  ['site-iphone', devices['iPhone 15 Pro']],
  ['site-ipad', ipadSafari],
  ['site-android', devices['Pixel 7']],
];
for (const [name, opts] of cases) {
  const ctx = await browser.newContext({ ...opts, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:4320/');
  await page.waitForTimeout(800);
  const detected = await page.textContent('#detected');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await page.screenshot({ path: join(out, name + '.png'), fullPage: name !== 'site-windows' ? false : false });
  await page.screenshot({ path: join(out, name + '-full.png'), fullPage: true });
  console.log(name, '|', detected, '| rolagem horizontal:', overflow, errors.length ? '| ERROS: ' + errors.join(';') : '');
  await ctx.close();
}
await browser.close();
http.close();
