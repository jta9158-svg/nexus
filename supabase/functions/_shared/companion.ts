// Regras do Claude Companion que valem para as tarefas em segundo plano.

export type CompanionMode = 'quando_chamado' | 'participante_ativo' | 'segundo_plano' | 'hibrido';

/** Como o modo escolhido pela pessoa muda o jeito de trabalhar nas tarefas. */
export function modeInstruction(mode: string | null | undefined): string {
  switch (mode) {
    case 'quando_chamado':
      return 'Modo escolhido: "Só quando chamado". Faça somente o que foi pedido, sem sugestões extras. Pergunte apenas o indispensável.';
    case 'participante_ativo':
      return 'Modo escolhido: "Participante ativo". Além do pedido, você pode registrar sugestões úteis (perguntar_usuario com bloqueante=false e urgência baixa) e citá-las no resumo final.';
    case 'segundo_plano':
      return 'Modo escolhido: "Trabalhador em segundo plano". Priorize terminar a tarefa. Só faça pergunta bloqueante quando uma decisão importante impedir o avanço; observações ficam para o resumo final.';
    default:
      return 'Modo escolhido: "Híbrido". Trabalhe de forma independente e pergunte quando uma decisão for realmente necessária.';
  }
}
