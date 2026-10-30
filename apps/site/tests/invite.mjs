// Teste da página de convite do site (servidor simulado só no teste).
// Uso: node apps/site/tests/invite.mjs [pasta-de-saida]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = resolve(process.argv[2] || join(here, '..', '..', '..', 'tmp-screens'));
const SB = 'https://demo-nexus.supabase.co';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };

const http = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(`window.NEXUS_SITE = { repo: 'exemplo/nexus', appUrl: './app/', windowsAvailable: true, apkAvailable: true, version: '9.9.9', supabaseUrl: '${SB}', supabaseKey: 'sb_publishable_teste' };`);
  }
  try {
    const file = join(root, path === '/' ? 'index.html' : path);
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => http.listen(4320, r));
await mkdir(out, { recursive: true });
const browser = await chromium.launch();

for (const [name, opts, query] of [
  ['site-convite-pc', { viewport: { width: 1280, height: 900 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36' }, '?convite=aB3dE5fG7h'],
  ['site-convite-android', { ...devices['Pixel 7'] }, '?convite=aB3dE5fG7h&semapp=1'],
  ['site-convite-iphone', { ...devices['iPhone 15 Pro'] }, '?convite=aB3dE5fG7h'],
]) {
  const ctx = await browser.newContext({ ...opts, locale: 'pt-BR', colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(`${SB}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ server_id: 'x', name: 'Servidor de JOSE', description: null, icon_url: null, banner_url: null, member_count: 3, valid: true, reason: null, requires_pin: true, already_member: false }]),
    }),
  );
  await page.goto(`http://localhost:4320/${query}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, `${name}.png`) });
  const nome = await page.getByText('Servidor de JOSE').count();
  const hrefs = await page.$$eval('#invite a', (as) => as.map((a) => a.getAttribute('href')));
  const abrir = hrefs.find((h) => h && (h.startsWith('nexus://') || h.startsWith('intent://')));
  const web = hrefs.find((h) => h && h.includes('/app/#convite=aB3dE5fG7h'));
  console.log(`${name}: ${errors.length ? 'ERROS: ' + errors.join(' | ') : 'ok'} · servidor ${nome ? 'visível' : 'NÃO visível'} · abrir no app ${abrir ? abrir.split('#')[0] : '—'} · navegador ${web ? 'ok' : 'FALTANDO'}`);
  await ctx.close();
}
await browser.close();
http.close();
