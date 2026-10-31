// Testes do compartilhamento de tela: escolha do codificador e configuração de cada qualidade.
// Uso: node --experimental-strip-types tests/screenShare.test.mjs
import assert from 'node:assert/strict';
import { chooseScreenEncoder, screenShareSettings, SCREEN_QUALITIES, isScreenQuality } from '../src/lib/screenShare.ts';

let ok = 0;
const t = (name, fn) => {
  fn();
  ok++;
  console.log('  ✔', name);
};
const all = new Set(['vp8', 'vp9', 'h264', 'av1']);

t('usa a placa de vídeo quando ela acelera (AV1 > VP9 > H.264)', () => {
  assert.deepEqual(chooseScreenEncoder('fluida', { av1: true, h264: true }, all), { codec: 'av1', hardware: true });
  assert.deepEqual(chooseScreenEncoder('fluida', { vp9: true, h264: true }, all), { codec: 'vp9', hardware: true });
  assert.deepEqual(chooseScreenEncoder('maxima', { h264: true }, all), { codec: 'h264', hardware: true });
  // a placa acelera AV1, mas o navegador não codifica AV1: vai para o próximo
  assert.deepEqual(chooseScreenEncoder('fluida', { av1: true, h264: true }, new Set(['vp8', 'vp9', 'h264'])), { codec: 'h264', hardware: true });
});

t('sem placa de vídeo: 60 fps com H.264 (mais leve); o resto com VP9', () => {
  assert.deepEqual(chooseScreenEncoder('maxima', {}, all), { codec: 'h264', hardware: false });
  assert.deepEqual(chooseScreenEncoder('fluida', {}, all), { codec: 'vp9', hardware: false });
  assert.deepEqual(chooseScreenEncoder('nitida', {}, all), { codec: 'vp9', hardware: false });
  assert.deepEqual(chooseScreenEncoder('maxima', {}, new Set(['vp8', 'vp9'])), { codec: 'vp9', hardware: false });
  assert.deepEqual(chooseScreenEncoder('fluida', {}, new Set(['vp8'])), { codec: 'vp8', hardware: false });
});

t('Máxima: 1080p a 60 fps, mantendo os quadros (liso) e com prioridade alta', () => {
  const { capture, publish } = screenShareSettings('maxima', { codec: 'h264', hardware: true });
  assert.deepEqual(capture.resolution, { width: 1920, height: 1080, frameRate: 60 });
  assert.equal(capture.contentHint, 'motion');
  assert.equal(publish.degradationPreference, 'maintain-framerate');
  assert.equal(publish.screenShareEncoding.maxFramerate, 60);
  assert.equal(publish.screenShareEncoding.maxBitrate, 9_000_000);
  assert.equal(publish.screenShareEncoding.priority, 'high');
  // camada menor de H.264 com os MESMOS 60 fps (quem vê em janela pequena continua liso)
  assert.equal(publish.screenShareSimulcastLayers.length, 1);
  assert.equal(publish.screenShareSimulcastLayers[0].encoding.maxFramerate, 60);
  assert.equal(publish.screenShareSimulcastLayers[0].width, 1280);
  assert.equal(publish.backupCodec, false);
});

t('AV1/VP9: uma resolução só (sem a antiga camada de 3 fps) e VP8 de reserva', () => {
  for (const q of ['maxima', 'fluida', 'nitida', 'economica']) {
    const { publish } = screenShareSettings(q, { codec: 'vp9', hardware: false });
    assert.equal(publish.videoCodec, 'vp9');
    assert.deepEqual(publish.screenShareSimulcastLayers, []);
    assert.equal(publish.backupCodec, true);
  }
});

t('Fluida é 30 fps; Texto nítido mantém a resolução (até 1440p); Econômica 720p a 30 fps', () => {
  const f = screenShareSettings('fluida', { codec: 'vp9', hardware: false });
  assert.equal(f.capture.resolution.frameRate, 30);
  assert.equal(f.publish.degradationPreference, 'maintain-framerate');
  const n = screenShareSettings('nitida', { codec: 'vp9', hardware: false });
  assert.deepEqual(n.capture.resolution, { width: 2560, height: 1440, frameRate: 15 });
  assert.equal(n.publish.degradationPreference, 'maintain-resolution');
  assert.equal(n.capture.contentHint, 'detail');
  const e = screenShareSettings('economica', { codec: 'vp9', hardware: false });
  assert.deepEqual(e.capture.resolution, { width: 1280, height: 720, frameRate: 30 });
  assert.ok(e.publish.screenShareEncoding.maxBitrate <= 2_000_000);
});

t('lista de qualidades e preferências antigas', () => {
  assert.deepEqual(SCREEN_QUALITIES.map((q) => q.key), ['maxima', 'fluida', 'nitida', 'economica']);
  assert.ok(isScreenQuality('nitida') && isScreenQuality('maxima') && !isScreenQuality('ultra') && !isScreenQuality(null));
});

console.log(`${ok} testes do compartilhamento de tela passaram`);
