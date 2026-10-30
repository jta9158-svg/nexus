// Contexto que o Claude recebe sobre o projeto. Sempre consultado com a
// identidade da pessoa (RLS), então o Claude só "vê" o que ela pode ver.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const tz = 'America/Sao_Paulo';

export function nowBrasilia(): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }).format(new Date());
}

function monthBounds(offset = 0): { from: string; to: string; label: string } {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(first), to: iso(last), label: new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(first) };
}

const STATUS: Record<string, string> = {
  a_fazer: 'a fazer',
  em_andamento: 'em andamento',
  em_revisao: 'em revisão',
  concluida: 'concluída',
  cancelada: 'cancelada',
};

export async function projectContext(client: SupabaseClient, projectId: string): Promise<string> {
  const { data: p } = await client.from('projects').select('*').eq('id', projectId).maybeSingle();
  if (!p) return '';
  const lines: string[] = [];
  lines.push(`## Projeto: ${p.name}`);
  lines.push(`Situação: ${p.status}${p.roblox_place_id ? ` · Place ID do Roblox: ${p.roblox_place_id}` : ''}`);
  if (p.description) lines.push(`Descrição: ${p.description}`);

  const { data: tasks } = await client
    .from('project_tasks')
    .select('title, kind, status, priority, due_date, assignee_id, updated_at')
    .eq('project_id', projectId)
    .neq('status', 'cancelada')
    .order('updated_at', { ascending: false })
    .limit(80);
  if (tasks?.length) {
    const ids = Array.from(new Set(tasks.map((t) => t.assignee_id).filter(Boolean)));
    const { data: people } = ids.length ? await client.from('profiles').select('id, display_name').in('id', ids) : { data: [] };
    const name = (id: string | null) => (id ? people?.find((x) => x.id === id)?.display_name ?? 'alguém' : 'sem responsável');
    const open = tasks.filter((t) => t.status !== 'concluida');
    lines.push(`\n### Tarefas (fonte: quadro do projeto no NEXUS) — ${open.length} abertas, ${tasks.length - open.length} concluídas`);
    for (const t of tasks.slice(0, 60)) {
      lines.push(`- [${STATUS[t.status] ?? t.status}] (${t.kind}, prioridade ${t.priority}) ${t.title} — ${name(t.assignee_id)}${t.due_date ? `, prazo ${t.due_date}` : ''}`);
    }
  } else {
    lines.push('\nNenhuma tarefa registrada no projeto.');
  }

  const { data: canFinance } = await client.rpc('has_server_perm', { p_server: p.server_id, p_perm: 'view_finance' });
  if (canFinance) {
    for (const off of [0, -1]) {
      const r = monthBounds(off);
      const { data: sum } = await client.rpc('finance_summary', { p_server: p.server_id, p_from: r.from, p_to: r.to, p_project: projectId });
      if (sum?.length) {
        lines.push(`\n### Finanças do projeto em ${r.label} (${r.from} a ${r.to}; fonte: lançamentos registrados no NEXUS)`);
        for (const s of sum) {
          lines.push(
            `- ${s.currency}: recebido ${s.receita_recebida}, pendente ${s.receita_pendente}, estimado ${s.receita_estimada}, bruto ${s.receita_bruta}, taxas ${s.taxas}, despesas pagas ${s.despesa_paga}, despesas pendentes ${s.despesa_pendente}, resultado recebido ${s.resultado_recebido}, resultado previsto ${s.resultado_previsto} (${s.lancamentos} lançamentos)`,
          );
        }
      } else {
        lines.push(`\nFinanças em ${r.label}: nenhum lançamento registrado para este projeto.`);
      }
    }
  } else {
    lines.push('\nFinanças: a pessoa não tem permissão para ver os dados financeiros deste servidor.');
  }

  const { data: exps } = await client.from('roblox_experiences').select('universe_id, name').eq('project_id', projectId);
  for (const e of exps ?? []) {
    const { data: st } = await client
      .from('roblox_stats')
      .select('playing, visits, favorites, source, fetched_at')
      .eq('universe_id', e.universe_id)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (st) {
      lines.push(
        `\n### Roblox: ${e.name ?? e.universe_id} — jogando ${st.playing}, visitas ${st.visits}, favoritos ${st.favorites} (fonte: ${st.source}, coletado em ${st.fetched_at})`,
      );
    }
  }
  lines.push('\nReceita em Robux direto da conta Roblox: indisponível (integração oficial ainda não conectada).');
  return lines.join('\n');
}

export function baseSystemPrompt(person: { display_name: string; username: string }, extra = ''): string {
  return [
    'Você é a NEXUS IA, a assistente de IA integrada ao NEXUS — o app que reúne comunicação, IA, desenvolvimento de jogos Roblox e gestão financeira da equipe. Você foi feita com o Claude, da Anthropic (se perguntarem, pode dizer).',
    'Responda em português do Brasil, de forma clara, amigável e direta. Use Markdown simples quando ajudar (listas, código).',
    `Data e hora atuais: ${nowBrasilia()} (horário de Brasília).`,
    `Pessoa falando com você: ${person.display_name} (@${person.username}).`,
    'Regras importantes:',
    '- Use apenas os dados do contexto abaixo e da conversa. Se faltar informação, diga exatamente o que falta. Nunca invente números (receita, Robux, jogadores, visitas).',
    '- Ao falar de dinheiro, informe o período analisado e diferencie recebido, pendente e estimado.',
    '- Para código Roblox, use Luau e boas práticas do Roblox Studio (server/client, RemoteEvents seguros, desempenho no celular).',
    '- Você não executa ações sozinha nesta conversa; se a pessoa quiser algo demorado ou que mexa em arquivos, sugira criar uma tarefa no NEXUS Companion.',
    extra,
  ]
    .filter(Boolean)
    .join('\n');
}
