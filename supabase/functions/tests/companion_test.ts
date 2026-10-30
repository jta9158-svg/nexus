import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { modeInstruction } from '../_shared/companion.ts';

Deno.test('cada modo gera uma instrução própria para as tarefas', () => {
  const modes = ['quando_chamado', 'participante_ativo', 'segundo_plano', 'hibrido'];
  const texts = modes.map((m) => modeInstruction(m));
  assertEquals(new Set(texts).size, 4);
  assertStringIncludes(modeInstruction('quando_chamado'), 'Só quando chamado');
  assertStringIncludes(modeInstruction('segundo_plano'), 'bloqueante');
});

Deno.test('sem configuração, usa o modo híbrido (padrão)', () => {
  assert(modeInstruction(null).includes('Híbrido'));
  assert(modeInstruction('qualquer-coisa').includes('Híbrido'));
});
