// Gera todos os ícones do NEXUS a partir dos SVGs em /brand.
// Uso: cd tools && npm install && node make-icons.mjs
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const brand = (f) => resolve(root, 'brand', f);
const out = (f) => resolve(root, f);

const APP_ICON = brand('nexus-app-icon.svg');
const MARK = brand('nexus-mark.svg');
const BG = '#0B0F1A';

async function ensure(file) {
  await mkdir(dirname(file), { recursive: true });
  return file;
}

async function svgToPng(svg, size, file) {
  await sharp(svg, { density: Math.max(72, Math.ceil((size / 64) * 72 * 1.5)) })
    .resize(size, size)
    .png()
    .toFile(await ensure(file));
  return file;
}

// Marca centralizada sobre fundo sólido, ocupando `scale` do quadro (zona segura para ícones adaptativos).
async function markOnBg(size, scale, file, background = BG) {
  const inner = Math.round(size * scale);
  const mark = await sharp(MARK, { density: 600 }).resize(inner, inner).png().toBuffer();
  const off = Math.round((size - inner) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, left: off, top: off }])
    .png()
    .toFile(await ensure(file));
  return file;
}

async function markTransparent(size, scale, file) {
  const inner = Math.round(size * scale);
  const mark = await sharp(MARK, { density: 600 }).resize(inner, inner).png().toBuffer();
  const off = Math.round((size - inner) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, left: off, top: off }])
    .png()
    .toFile(await ensure(file));
  return file;
}

async function main() {
  // Brand exports
  await svgToPng(APP_ICON, 1024, out('brand/nexus-app-icon-1024.png'));
  await svgToPng(MARK, 512, out('brand/nexus-mark-512.png'));

  // Web / PWA
  const web = 'apps/web/public';
  await copyFile(MARK, await ensure(out(`${web}/favicon.svg`)));
  await svgToPng(APP_ICON, 192, out(`${web}/icons/icon-192.png`));
  await svgToPng(APP_ICON, 512, out(`${web}/icons/icon-512.png`));
  await markOnBg(512, 0.56, out(`${web}/icons/icon-maskable-512.png`));
  await markOnBg(180, 0.62, out(`${web}/icons/apple-touch-icon.png`));
  await svgToPng(MARK, 32, out(`${web}/icons/favicon-32.png`));
  await svgToPng(MARK, 96, out(`${web}/icons/mark-96.png`));

  // Desktop (Electron / instalador NSIS)
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const bufs = [];
  for (const s of sizes) {
    bufs.push(await sharp(APP_ICON, { density: 300 }).resize(s, s).png().toBuffer());
  }
  const ico = await pngToIco(bufs);
  await writeFile(await ensure(out('apps/desktop/build/icon.ico')), ico);
  await svgToPng(APP_ICON, 512, out('apps/desktop/build/icon.png'));
  await svgToPng(MARK, 32, out('apps/desktop/build/tray.png'));
  await svgToPng(MARK, 64, out('apps/desktop/build/tray@2x.png'));

  // Site de download
  await copyFile(MARK, await ensure(out('apps/site/assets/nexus-mark.svg')));
  await svgToPng(APP_ICON, 192, out('apps/site/assets/icon-192.png'));
  await markOnBg(180, 0.62, out('apps/site/assets/apple-touch-icon.png'));

  // Android (Capacitor) — fontes para ícone adaptativo
  await svgToPng(APP_ICON, 1024, out('apps/mobile/resources/icon.png'));
  await markTransparent(1024, 0.5, out('apps/mobile/resources/icon-foreground.png'));
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BG } })
    .png()
    .toFile(await ensure(out('apps/mobile/resources/icon-background.png')));
  await markOnBg(2732, 0.18, out('apps/mobile/resources/splash.png'));

  console.log('Ícones gerados.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
