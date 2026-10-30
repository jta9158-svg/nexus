// Testes das regras de organização de canais (lib/layout.ts).
// Uso: node --experimental-strip-types tests/layout.test.mjs
import assert from 'node:assert/strict';
import { groupChannels, moveChannel, moveCategory, nudgeChannel, nudgeCategory } from '../src/lib/layout.ts';

const t0 = '2026-10-01T00:00:00Z';
const cat = (id, position) => ({ id, server_id: 's', name: id, position, created_at: t0 });
const ch = (id, kind, category_id, position) => ({ id, server_id: 's', name: id, kind, topic: null, position, is_private: false, user_limit: null, claude_enabled: true, category_id, created_at: t0 });
const cats = [cat('info', 0), cat('texto', 1), cat('voz', 2)];
const chans = [
  ch('regras', 'text', 'info', 0),
  ch('geral', 'text', 'texto', 0),
  ch('memes', 'text', 'texto', 1),
  ch('lobby', 'voice', 'voz', 0),
  ch('partida', 'voice', 'voz', 1),
  ch('solto', 'text', null, 0),
];
let pass = 0;
const test = (name, fn) => {
  fn();
  pass++;
  console.log(`  ✔ ${name}`);
};
const order = (list, catId) => groupChannels(list, cats).find((g) => (g.category?.id ?? null) === catId).channels.map((c) => c.id);

test('canais sem categoria aparecem primeiro, depois as categorias em ordem', () => {
  const g = groupChannels(chans, cats);
  assert.deepEqual(g.map((x) => x.category?.id ?? null), [null, 'info', 'texto', 'voz']);
});
test('arrastar canal para outra categoria, antes de outro canal', () => {
  const r = moveChannel(chans, cats, 'regras', 'texto', 'memes');
  assert.deepEqual(order(r.channels, 'texto'), ['geral', 'regras', 'memes']);
  assert.ok(r.channelPatch.some((p) => p.id === 'regras' && p.category_id === 'texto'));
});
test('soltar no fim da categoria', () => {
  const r = moveChannel(chans, cats, 'geral', 'texto', null);
  assert.deepEqual(order(r.channels, 'texto'), ['memes', 'geral']);
});
test('texto fica sempre acima de voz na mesma categoria', () => {
  const r = moveChannel(chans, cats, 'memes', 'voz', 'lobby');
  assert.deepEqual(order(r.channels, 'voz'), ['memes', 'lobby', 'partida']);
  const r2 = moveChannel(chans, cats, 'partida', 'texto', 'geral');
  assert.deepEqual(order(r2.channels, 'texto'), ['geral', 'memes', 'partida']);
});
test('tirar da categoria (sem categoria)', () => {
  const r = moveChannel(chans, cats, 'geral', null, null);
  assert.deepEqual(order(r.channels, null), ['solto', 'geral']);
  assert.equal(r.channels.find((c) => c.id === 'geral').category_id, null);
});
test('soltar o canal em cima dele mesmo não muda nada', () => {
  assert.equal(moveChannel(chans, cats, 'geral', 'texto', 'geral'), null);
});
test('mover para cima e para baixo', () => {
  const r = nudgeChannel(chans, cats, 'memes', -1);
  assert.deepEqual(order(r.channels, 'texto'), ['memes', 'geral']);
  const r2 = nudgeChannel(chans, cats, 'geral', 1);
  assert.deepEqual(order(r2.channels, 'texto'), ['memes', 'geral']);
  assert.equal(nudgeChannel(chans, cats, 'geral', -1), null);
});
test('reordenar categorias', () => {
  const r = moveCategory(chans, cats, 'voz', 'info');
  assert.deepEqual(groupChannels(r.channels, r.categories).filter((g) => g.category).map((g) => g.category.id), ['voz', 'info', 'texto']);
  assert.equal(moveCategory(chans, cats, 'info', 'info'), null);
  const r2 = nudgeCategory(chans, cats, 'info', 1);
  assert.deepEqual(groupChannels(r2.channels, r2.categories).filter((g) => g.category).map((g) => g.category.id), ['texto', 'info', 'voz']);
});
test('canal de categoria apagada aparece sem categoria', () => {
  const g = groupChannels([...chans, ch('orfao', 'text', 'apagada', 3)], cats);
  assert.ok(g[0].category === null && g[0].channels.some((c) => c.id === 'orfao'));
});
console.log(`${pass} testes de organização passaram`);
