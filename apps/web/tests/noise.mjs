// Teste do ANTI-RUÍDO (Krisp) com o app compilado de verdade (mesma política de
// segurança do app): carrega o pacote do anti-ruído, liga o filtro num microfone
// falso com barulho e mede o som antes e depois.
//
// Uso: npm run build && node tests/noise.mjs <arquivo.wav>
// Para ligar o filtro, a LiveKit Cloud confere o projeto; sem as variáveis
// LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET o teste só confere se o
// filtro carrega (sem medir).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');
const wav = resolve(process.argv[2] || '');
const lk = { url: process.env.LIVEKIT_URL, key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET };

const krispFile = (await readdir(join(dist, 'assets'))).find((f) => /^krisp-.*\.js$/.test(f));
if (!krispFile) throw new Error('Pacote do anti-ruído (krisp-*.js) não está no build.');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
const http = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const b = await readFile(join(dist, p === '/' ? 'index.html' : p));
    res.writeHead(200, { 'Content-Type': types[extname(p) || '.html'] || 'application/octet-stream' });
    res.end(b);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(4321);

function token() {
  if (!lk.key || !lk.secret) return '';
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ iss: lk.key, sub: 'teste-anti-ruido', nbf: now - 10, exp: now + 600, video: { room: 'nexus-teste-anti-ruido', roomJoin: true, canPublish: true } });
  return `${h}.${p}.${createHmac('sha256', lk.secret).update(`${h}.${p}`).digest('base64url')}`;
}

const browser = await chromium.launch({
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } } : {}),
  args: ['--ignore-certificate-errors', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
});
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
const problems = [];
page.on('console', (m) => {
  if (/Refused|Content Security Policy|WORKLET|WebAssembly/i.test(m.text())) problems.push(m.text().slice(0, 220));
});
// O app em si não precisa abrir: só a página com a política de segurança dele.
await page.route(/supabase\.co/, (r) => r.abort());
await page.goto('http://localhost:4321/index.html');
const result = await page.evaluate(
  async ({ file, url, tok }) => {
    const out = { carregou: false, ligado: null, bruto: [], filtrado: [], erro: null };
    try {
      const mod = await import(`/assets/${file}`);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const track = stream.getAudioTracks()[0];
      const ctx = new AudioContext({ sampleRate: 48000 });
      await ctx.resume();
      const meter = (t, arr) => {
        const an = ctx.createAnalyser();
        an.fftSize = 2048;
        ctx.createMediaStreamSource(new MediaStream([t])).connect(an);
        const buf = new Float32Array(an.fftSize);
        setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let s = 0;
          for (const v of buf) s += v * v;
          arr.push(Math.sqrt(s / buf.length));
        }, 100);
      };
      meter(track, out.bruto);
      if (!mod.isKrispNoiseFilterSupported()) throw new Error('navegador sem suporte');
      const proc = mod.KrispNoiseFilter();
      await proc.init({ kind: 'audio', track, audioContext: ctx });
      out.carregou = !!proc.processedTrack;
      if (tok) {
        await proc.onPublish({ engine: { url, token: tok }, name: 'nexus-teste-anti-ruido', localParticipant: { identity: 'teste-anti-ruido', sid: 'PA_teste' }, getSid: async () => 'RM_teste' });
        for (let i = 0; i < 40 && !proc.isEnabled(); i++) await new Promise((r) => setTimeout(r, 250));
        out.ligado = proc.isEnabled();
        meter(proc.processedTrack, out.filtrado);
        await new Promise((r) => setTimeout(r, 7000));
      }
    } catch (e) {
      out.erro = String(e?.message || e);
    }
    return out;
  },
  { file: krispFile, url: lk.url, tok: token() },
);
const pct = (arr, q) => {
  const v = arr.slice(-60).filter((x) => x > 0).sort((a, b) => a - b);
  return v.length ? +(20 * Math.log10(v[Math.min(v.length - 1, Math.floor(q * v.length))])).toFixed(1) : null;
};
console.log(`anti-ruído: pacote ${krispFile} ${result.carregou ? 'carregou' : 'NÃO carregou'} com a política de segurança do app${result.erro ? ` · erro: ${result.erro}` : ''}`);
if (result.ligado !== null) {
  console.log(`anti-ruído: filtro ${result.ligado ? 'ligado pela LiveKit Cloud' : 'NÃO ligou'} · pausas (só barulho): ${pct(result.bruto, 0.1)} dBFS → ${pct(result.filtrado, 0.1)} dBFS · voz: ${pct(result.bruto, 0.9)} → ${pct(result.filtrado, 0.9)} dBFS`);
}
if (problems.length) console.log('avisos:', problems.slice(0, 4).join(' | '));
await browser.close();
http.close();
if (!result.carregou || result.ligado === false) process.exitCode = 1;
