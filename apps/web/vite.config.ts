import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Política de segurança de conteúdo (só no build de produção; o modo dev
// do Vite precisa de scripts inline).
const CSP = [
  "default-src 'self'",
  // blob: e 'wasm-unsafe-eval': o anti-ruído (Krisp) roda num AudioWorklet criado
  // pelo próprio app e usa WebAssembly. Nada de scripts de outros sites.
  "script-src 'self' blob: 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: mediastream: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'nexus-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    cspPlugin(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'],
      manifest: {
        id: './',
        name: 'NEXUS',
        short_name: 'NEXUS',
        description: 'Comunicação, IA e gestão dos seus jogos Roblox em um só lugar.',
        lang: 'pt-BR',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        background_color: '#0B0E14',
        theme_color: '#0B0E14',
        categories: ['social', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,ico,webmanifest}'],
        // O anti-ruído (~6 MB) não entra na instalação: baixa só na primeira call e fica guardado.
        globIgnores: ['**/krisp-*.js'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // Nada de API em cache: mensagens, Claude e chamadas sempre pela rede.
        runtimeCaching: [
          {
            urlPattern: /\/assets\/krisp-[^/]+\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'nexus-anti-ruido', expiration: { maxEntries: 2 } },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    host: true,
  },
});
