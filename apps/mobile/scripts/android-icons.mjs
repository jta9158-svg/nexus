// Gera ícones (inclusive adaptativo) e telas de abertura do Android a partir de apps/mobile/resources.
// Usa o sharp instalado em tools/ (cd tools && npm install).
import { createRequire } from 'node:module';
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '..', '..', '..', 'tools', 'package.json'));
const sharp = require('sharp');
const res = resolve(here, '..', 'android', 'app', 'src', 'main', 'res');
const src = (f) => resolve(here, '..', 'resources', f);
const BG = '#0B0E14';

if (!existsSync(res)) {
  console.error('Rode "npx cap add android" antes.');
  process.exit(1);
}

const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const fg = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

for (const [d, size] of Object.entries(legacy)) {
  const dir = join(res, `mipmap-${d}`);
  await sharp(src('icon.png')).resize(size, size).png().toFile(join(dir, 'ic_launcher.png'));
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
  await sharp(src('icon.png')).resize(size, size).composite([{ input: mask, blend: 'dest-in' }]).png().toFile(join(dir, 'ic_launcher_round.png'));
  await sharp(src('icon-foreground.png')).resize(fg[d], fg[d]).png().toFile(join(dir, 'ic_launcher_foreground.png'));
}
writeFileSync(join(res, 'values', 'ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);

// Telas de abertura: mesmo tamanho dos arquivos do modelo, com a marca centralizada.
const mark = src('icon-foreground.png');
for (const dir of readdirSync(res)) {
  const file = join(res, dir, 'splash.png');
  if (!existsSync(file) || !statSync(file).isFile()) continue;
  const meta = await sharp(file).metadata();
  const w = meta.width, h = meta.height;
  const side = Math.round(Math.min(w, h) * 0.42);
  const logo = await sharp(mark).resize(side, side).png().toBuffer();
  const out = await sharp({ create: { width: w, height: h, channels: 4, background: BG } })
    .composite([{ input: logo, left: Math.round((w - side) / 2), top: Math.round((h - side) / 2) }])
    .png()
    .toBuffer();
  writeFileSync(file, out);
}
console.log('✔ Ícones e telas de abertura do Android gerados');
