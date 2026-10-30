// Copia o app web compilado (apps/web/dist) para apps/mobile/www (usado pelo Capacitor).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const src = path.resolve(__dirname, '..', '..', 'web', 'dist');
const dst = path.resolve(__dirname, '..', 'www');
if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('\n✘ apps/web/dist não existe. Rode antes:  cd apps/web && npm ci && npm run build\n');
  process.exit(1);
}
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
for (const f of fs.readdirSync(dst)) if (/^(sw\.js|workbox-.*\.js)$/.test(f)) fs.rmSync(path.join(dst, f));
console.log('✔ App web copiado para apps/mobile/www');
