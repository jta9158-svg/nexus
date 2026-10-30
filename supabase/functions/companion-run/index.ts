// NEXUS — Executor de tarefas do Claude Companion (segundo plano, no servidor).
// POST { task_id }                      (dono da tarefa, com a sessão)
// POST { task_id, run_id } + x-nexus-internal   (continuação automática)
//
// O trabalho roda aqui no servidor, então continua mesmo com o app fechado.
// Cada chamada trabalha ~100 s e salva o estado; se precisar de mais tempo,
// ela se chama de novo. Perguntas bloqueantes pausam só esta tarefa.
import { env, handleError, HttpError, json, preflight, readJson, runInBackground } from '../_shared/http.ts';
import { adminClient, isInternal, requireUser, rpc } from '../_shared/supabase.ts';
import { apiKey, createMessage, estimateCost, textOf, type ChatMessage, type ContentBlock, type ToolDef } from '../_shared/anthropic.ts';
import { nowBrasilia } from '../_shared/context.ts';
import { modeInstruction } from '../_shared/companion.ts';

type Admin = ReturnType<typeof adminClient>;

interface TaskState {
  run_id?: string;
  messages?: ChatMessage[];
  pending?: { tool_use_id: string; question_id: string } | null;
  partial_results?: ContentBlock[];
}

interface Task {
  id: string;
  owner_id: string;
  server_id: string | null;
  project_id: string | null;
  title: string;
  instructions: string;
  status: string;
  state: TaskState;
  steps: number;
  max_steps: number;
  progress: number;
  input_tokens: number;
  output_tokens: number;
  heartbeat_at: string | null;
}

const SLICE_MS = 100_000;
const STALE_MS = 3 * 60_000;
const MAX_TOOL_TEXT = 60_000;

const TOOLS: ToolDef[] = [
  {
    name: 'atualizar_progresso',
    description: 'Atualiza a barra de progresso e a nota de andamento que a pessoa vê. Use a cada etapa importante.',
    input_schema: {
      type: 'object',
      properties: { percentual: { type: 'integer', minimum: 0, maximum: 100 }, nota: { type: 'string', description: 'O que está fazendo agora (curto).' } },
      required: ['percentual', 'nota'],
    },
  },
  {
    name: 'perguntar_usuario',
    description:
      'Faz uma pergunta à pessoa dona da tarefa. Use bloqueante=true só quando não der para continuar sem a decisão (a tarefa pausa até a resposta). Para dúvidas que não bloqueiam, use bloqueante=false e continue o trabalho.',
    input_schema: {
      type: 'object',
      properties: {
        pergunta: { type: 'string' },
        opcoes: { type: 'array', items: { type: 'string' }, description: 'Opções curtas para a pessoa escolher (opcional).' },
        urgencia: { type: 'string', enum: ['baixa', 'media', 'alta'] },
        bloqueante: { type: 'boolean' },
      },
      required: ['pergunta', 'urgencia', 'bloqueante'],
    },
  },
  {
    name: 'listar_tarefas_projeto',
    description: 'Lista as tarefas, bugs e melhorias do projeto vinculado a esta tarefa.',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['a_fazer', 'em_andamento', 'em_revisao', 'concluida', 'todas'] } } },
  },
  {
    name: 'criar_tarefa_projeto',
    description: 'Registra uma tarefa, bug ou melhoria no quadro do projeto. Requer a permissão "modificar_projetos".',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        tipo: { type: 'string', enum: ['tarefa', 'bug', 'melhoria'] },
        prioridade: { type: 'string', enum: ['baixa', 'media', 'alta', 'critica'] },
        descricao: { type: 'string' },
      },
      required: ['titulo', 'tipo', 'prioridade'],
    },
  },
  {
    name: 'listar_arquivos',
    description: 'Lista arquivos da área de Arquivos do servidor (scripts, documentos, modelos). Requer a permissão "acessar_arquivos".',
    input_schema: { type: 'object', properties: { busca: { type: 'string' }, pasta: { type: 'string' } } },
  },
  {
    name: 'ler_arquivo',
    description: 'Lê o conteúdo de um arquivo de texto/código (até ~300 KB) pelo id retornado em listar_arquivos. Requer "acessar_arquivos".',
    input_schema: { type: 'object', properties: { arquivo_id: { type: 'string' } }, required: ['arquivo_id'] },
  },
  {
    name: 'resumo_financeiro',
    description: 'Resumo financeiro (recebido, pendente, estimado, despesas, resultado) por moeda num período. Requer "ver_financas".',
    input_schema: {
      type: 'object',
      properties: { de: { type: 'string', description: 'AAAA-MM-DD' }, ate: { type: 'string', description: 'AAAA-MM-DD' } },
      required: ['de', 'ate'],
    },
  },
  {
    name: 'ler_mensagens_canal',
    description: 'Lê as mensagens recentes de um canal de texto do servidor (pelo nome). Requer "ler_mensagens".',
    input_schema: { type: 'object', properties: { canal: { type: 'string' }, limite: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['canal'] },
  },
];

const SCOPE: Record<string, string | null> = {
  atualizar_progresso: null,
  perguntar_usuario: null,
  listar_tarefas_projeto: null,
  criar_tarefa_projeto: 'modificar_projetos',
  listar_arquivos: 'acessar_arquivos',
  ler_arquivo: 'acessar_arquivos',
  resumo_financeiro: 'ver_financas',
  ler_mensagens_canal: 'ler_mensagens',
};

function clip(s: string, n = MAX_TOOL_TEXT): string {
  return s.length > n ? s.slice(0, n) + `\n…[cortado: ${s.length - n} caracteres a mais]` : s;
}

async function log(admin: Admin, task: Task, level: 'info' | 'aviso' | 'erro', event: string, message: string, details: Record<string, unknown> = {}) {
  await admin.rpc('_companion_log', { p_owner: task.owner_id, p_task: task.id, p_level: level, p_event: event, p_message: message, p_details: details });
}

async function serverOf(admin: Admin, task: Task): Promise<string | null> {
  if (task.server_id) return task.server_id;
  if (!task.project_id) return null;
  const { data } = await admin.from('projects').select('server_id').eq('id', task.project_id).maybeSingle();
  return data?.server_id ?? null;
}

async function perm(admin: Admin, server: string | null, user: string, p: string): Promise<boolean> {
  if (!server) return false;
  return await rpc<boolean>(admin, '_has_server_perm', { p_server: server, p_user: user, p_perm: p });
}

/** Executa uma ferramenta com as checagens de permissão. */
async function runTool(admin: Admin, task: Task, name: string, input: Record<string, any>): Promise<{ content: string; is_error?: boolean }> {
  const scope = SCOPE[name];
  if (scope === undefined) return { content: `Ferramenta desconhecida: ${name}`, is_error: true };
  if (scope) {
    const ok = await rpc<boolean>(admin, '_companion_has_scope', { p_user: task.owner_id, p_scope: scope });
    if (!ok) {
      await log(admin, task, 'aviso', 'permission.denied', `Permissão negada: ${scope} (ferramenta ${name})`);
      return {
        content: `Permissão negada: a pessoa ainda não concedeu "${scope}" ao Claude Companion. Se precisar disso, use perguntar_usuario para pedir que ela conceda em Claude Companion → Permissões, ou continue sem.`,
        is_error: true,
      };
    }
  }
  const server = await serverOf(admin, task);

  switch (name) {
    case 'atualizar_progresso': {
      const pct = Math.max(0, Math.min(99, Math.round(Number(input.percentual) || 0)));
      await admin.from('companion_tasks').update({ progress: pct, progress_note: String(input.nota ?? '').slice(0, 200), heartbeat_at: new Date().toISOString() }).eq('id', task.id);
      return { content: 'Progresso atualizado.' };
    }
    case 'listar_tarefas_projeto': {
      if (!task.project_id) return { content: 'Esta tarefa não tem projeto vinculado.', is_error: true };
      if (!(await perm(admin, server, task.owner_id, 'view_projects'))) return { content: 'A pessoa não pode ver projetos deste servidor.', is_error: true };
      let q = admin.from('project_tasks').select('id, title, kind, status, priority, due_date, description').eq('project_id', task.project_id).limit(200);
      if (input.status && input.status !== 'todas') q = q.eq('status', input.status);
      const { data } = await q;
      return { content: clip(JSON.stringify(data ?? [], null, 1)) };
    }
    case 'criar_tarefa_projeto': {
      if (!task.project_id) return { content: 'Esta tarefa não tem projeto vinculado.', is_error: true };
      if (!(await perm(admin, server, task.owner_id, 'manage_projects'))) return { content: 'A pessoa não tem a permissão "gerenciar projetos" neste servidor.', is_error: true };
      const { data, error } = await admin
        .from('project_tasks')
        .insert({
          project_id: task.project_id,
          server_id: server,
          title: String(input.titulo).slice(0, 200),
          kind: ['tarefa', 'bug', 'melhoria'].includes(input.tipo) ? input.tipo : 'tarefa',
          priority: ['baixa', 'media', 'alta', 'critica'].includes(input.prioridade) ? input.prioridade : 'media',
          description: input.descricao ? String(input.descricao).slice(0, 5000) : null,
          created_by: task.owner_id,
          created_by_kind: 'claude',
        })
        .select('id')
        .single();
      if (error) return { content: `Não foi possível criar: ${error.message}`, is_error: true };
      await log(admin, task, 'info', 'tool.created_task', `Criou "${input.titulo}" no projeto`, { task_id: data.id });
      return { content: `Criado com id ${data.id}.` };
    }
    case 'listar_arquivos': {
      if (!server) return { content: 'Tarefa sem servidor/projeto: não há área de arquivos.', is_error: true };
      if (!(await perm(admin, server, task.owner_id, 'view_files'))) return { content: 'A pessoa não pode ver os arquivos deste servidor.', is_error: true };
      let q = admin
        .from('files')
        .select('id, name, folder, kind, size_bytes, mime_type, visibility, uploaded_by, updated_at')
        .eq('server_id', server)
        .order('updated_at', { ascending: false })
        .limit(200);
      if (input.pasta) q = q.ilike('folder', `${String(input.pasta)}%`);
      if (input.busca) q = q.ilike('name', `%${String(input.busca)}%`);
      const { data } = await q;
      const canManage = await perm(admin, server, task.owner_id, 'manage_files');
      const visible = (data ?? []).filter((f) => f.visibility === 'servidor' || f.uploaded_by === task.owner_id || canManage);
      return { content: clip(JSON.stringify(visible, null, 1)) };
    }
    case 'ler_arquivo': {
      const id = String(input.arquivo_id ?? '');
      const ok = await rpc<boolean>(admin, '_can_view_file', { p_file: id, p_user: task.owner_id });
      if (!ok) return { content: 'Arquivo não encontrado ou sem acesso.', is_error: true };
      const { data: f } = await admin.from('files').select('name, storage_path, size_bytes, mime_type, kind').eq('id', id).single();
      if (!f?.storage_path) return { content: 'Este item não tem arquivo (é um link ou ideia).', is_error: true };
      if ((f.size_bytes ?? 0) > 300_000) return { content: 'Arquivo grande demais para ler (máx. 300 KB).', is_error: true };
      if (!/^(text\/|application\/(json|xml|x-lua))/.test(f.mime_type ?? '') && !/\.(lua|luau|txt|md|json|csv|js|ts|py|xml|rbxlx|rbxmx|yaml|yml|toml)$/i.test(f.name)) {
        return { content: `"${f.name}" não é um arquivo de texto que eu consiga ler.`, is_error: true };
      }
      const { data: blob, error } = await admin.storage.from('project-files').download(f.storage_path);
      if (error || !blob) return { content: `Falha ao baixar: ${error?.message ?? 'desconhecida'}`, is_error: true };
      await log(admin, task, 'info', 'tool.read_file', `Leu o arquivo ${f.name}`, { file_id: id });
      return { content: clip(`Arquivo ${f.name}:\n${await blob.text()}`) };
    }
    case 'resumo_financeiro': {
      if (!server) return { content: 'Tarefa sem servidor/projeto.', is_error: true };
      if (!(await perm(admin, server, task.owner_id, 'view_finance'))) return { content: 'A pessoa não tem permissão para ver finanças deste servidor.', is_error: true };
      const de = /^\d{4}-\d{2}-\d{2}$/.test(input.de) ? input.de : null;
      const ate = /^\d{4}-\d{2}-\d{2}$/.test(input.ate) ? input.ate : null;
      if (!de || !ate) return { content: 'Datas inválidas (use AAAA-MM-DD).', is_error: true };
      let q = admin.from('finance_entries').select('kind, status, currency, amount, gross_amount, fee_amount').eq('server_id', server).gte('occurred_on', de).lte('occurred_on', ate);
      if (task.project_id) q = q.eq('project_id', task.project_id);
      const { data } = await q;
      const sums: Record<string, Record<string, number>> = {};
      for (const e of data ?? []) {
        const c = (sums[e.currency] ??= { recebido: 0, pendente: 0, estimado: 0, bruto: 0, taxas: 0, despesa_paga: 0, despesa_pendente: 0, lancamentos: 0 });
        c.lancamentos++;
        if (e.status === 'cancelado') continue;
        if (e.kind === 'receita') {
          if (e.status === 'recebido') c.recebido += Number(e.amount);
          if (e.status === 'pendente') c.pendente += Number(e.amount);
          if (e.status === 'estimado') c.estimado += Number(e.amount);
          c.bruto += Number(e.gross_amount ?? e.amount);
          c.taxas += Number(e.fee_amount ?? 0);
        } else {
          if (e.status === 'pago') c.despesa_paga += Number(e.amount);
          if (e.status === 'pendente') c.despesa_pendente += Number(e.amount);
        }
      }
      await log(admin, task, 'info', 'tool.finance', `Consultou finanças de ${de} a ${ate}`);
      return { content: JSON.stringify({ periodo: { de, ate }, fonte: 'lançamentos registrados no NEXUS', por_moeda: sums }) };
    }
    case 'ler_mensagens_canal': {
      if (!server) return { content: 'Tarefa sem servidor.', is_error: true };
      const nome = String(input.canal ?? '').replace(/^#/, '').toLowerCase();
      const { data: ch } = await admin.from('channels').select('id, name').eq('server_id', server).eq('kind', 'text');
      const target = (ch ?? []).find((c) => c.name.toLowerCase() === nome || c.id === input.canal);
      if (!target) return { content: `Canal "${input.canal}" não encontrado.`, is_error: true };
      if (!(await rpc<boolean>(admin, '_can_view_channel', { p_channel: target.id, p_user: task.owner_id }))) {
        return { content: 'A pessoa não tem acesso a este canal.', is_error: true };
      }
      const { data: msgs } = await admin
        .from('messages')
        .select('author_id, author_kind, content, created_at')
        .eq('channel_id', target.id)
        .order('created_at', { ascending: false })
        .limit(Math.min(100, Number(input.limite) || 40));
      const ids = Array.from(new Set((msgs ?? []).map((m) => m.author_id).filter(Boolean)));
      const { data: people } = ids.length ? await admin.from('profiles').select('id, display_name').in('id', ids) : { data: [] };
      const lines = (msgs ?? [])
        .reverse()
        .map((m) => `[${m.created_at}] ${m.author_kind === 'claude' ? 'Claude' : people?.find((p) => p.id === m.author_id)?.display_name ?? '?'}: ${m.content}`);
      await log(admin, task, 'info', 'tool.read_messages', `Leu mensagens de #${target.name}`);
      return { content: clip(lines.join('\n')) };
    }
    default:
      return { content: `Ferramenta ${name} não implementada.`, is_error: true };
  }
}

async function loadTask(admin: Admin, id: string): Promise<Task | null> {
  const { data } = await admin.from('companion_tasks').select('*').eq('id', id).maybeSingle();
  return (data as Task) ?? null;
}

async function save(admin: Admin, task: Task, patch: Record<string, unknown>) {
  await admin.from('companion_tasks').update({ ...patch, heartbeat_at: new Date().toISOString() }).eq('id', task.id);
}

async function finish(admin: Admin, task: Task, ok: boolean, text: string) {
  // Só finaliza se ninguém pausou/cancelou nesse meio-tempo.
  const { data: updated } = await admin
    .from('companion_tasks')
    .update(
      ok
        ? { status: 'concluida', result: text, progress: 100, progress_note: null, finished_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() }
        : { status: 'falhou', error: text, finished_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() },
    )
    .eq('id', task.id)
    .eq('status', 'executando')
    .select('id');
  if (!updated?.length) return;
  await log(admin, task, ok ? 'info' : 'erro', ok ? 'task.completed' : 'task.failed', ok ? 'Tarefa concluída' : `Tarefa falhou: ${text}`);
  await admin.rpc('_notify', {
    p_user: task.owner_id,
    p_kind: 'task',
    p_title: ok ? `Claude concluiu: ${task.title}` : `Tarefa do Claude falhou: ${task.title}`,
    p_body: text.slice(0, 300),
    p_link: { task_id: task.id },
  });
}

async function continueLater(task: Task, runId: string) {
  const url = env('SUPABASE_URL');
  const secret = env('NEXUS_INTERNAL_SECRET');
  if (!url || !secret) return false;
  await fetch(`${url}/functions/v1/companion-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nexus-internal': secret },
    body: JSON.stringify({ task_id: task.id, run_id: runId }),
  }).catch(() => undefined);
  return true;
}

async function execute(taskId: string, runId: string) {
  const admin = adminClient();
  const started = Date.now();
  let task = await loadTask(admin, taskId);
  if (!task) return;
  const { data: settings } = await admin.from('app_settings').select('claude_task_model').single();
  const model = settings?.claude_task_model ?? 'claude-opus-5-5';
  const { data: owner } = await admin.from('profiles').select('display_name, username').eq('id', task.owner_id).single();
  const { data: project } = task.project_id ? await admin.from('projects').select('name, description').eq('id', task.project_id).maybeSingle() : { data: null };
  const { data: companion } = await admin.from('companion_settings').select('mode').eq('user_id', task.owner_id).maybeSingle();

  const system = [
    `Você é o Claude Companion, trabalhando em SEGUNDO PLANO para ${owner?.display_name ?? 'a pessoa'} (@${owner?.username ?? ''}) no NEXUS.`,
    `Data e hora: ${nowBrasilia()}.`,
    `Tarefa: ${task.title}`,
    project ? `Projeto: ${project.name}${project.description ? ` — ${project.description}` : ''}` : 'Sem projeto vinculado.',
    modeInstruction(companion?.mode),
    'Como trabalhar:',
    '- Planeje em poucas etapas e use as ferramentas. Chame atualizar_progresso a cada etapa importante.',
    '- Se uma decisão bloquear o trabalho, use perguntar_usuario com bloqueante=true (a tarefa pausa só ela). Dúvidas que não bloqueiam: bloqueante=false e siga em frente nas partes independentes.',
    '- Nunca invente dados nem resultados. Se uma permissão for negada ou algo não estiver acessível, explique e siga com o que for possível.',
    '- Nesta versão você NÃO executa comandos no computador, NÃO altera o jogo no Roblox Studio e NÃO publica nada.',
    '- Ao terminar, responda (sem chamar ferramentas) com um resumo final em português: o que fez, o que encontrou, tarefas/arquivos criados ou alterados e próximos passos sugeridos.',
  ].join('\n');

  for (;;) {
    task = await loadTask(admin, taskId);
    if (!task || task.status !== 'executando' || task.state?.run_id !== runId) return; // pausada, cancelada ou outro executor
    const quota = (await rpc<Array<{ allowed: boolean; reason: string | null }>>(admin, '_claude_quota', { p_user: task.owner_id }))[0];
    if (!quota?.allowed) {
      await save(admin, task, { status: 'bloqueada', blocked_reason: quota?.reason ?? 'Sem cota do Claude' });
      await log(admin, task, 'aviso', 'task.blocked', `Pausada: ${quota?.reason ?? 'sem cota'}`);
      return;
    }
    if (task.steps >= task.max_steps) {
      await finish(admin, task, false, `Limite de ${task.max_steps} passos atingido antes de terminar. Você pode repetir com instruções mais específicas.`);
      return;
    }
    if (Date.now() - started > SLICE_MS) {
      await log(admin, task, 'info', 'task.continued', 'Continuando em uma nova execução (limite de tempo por chamada)');
      if (!(await continueLater(task, runId))) {
        await save(admin, task, { status: 'aguardando', progress_note: 'Continua quando o NEXUS estiver aberto (configure NEXUS_INTERNAL_SECRET para continuar sozinho).' });
      }
      return;
    }

    const state: TaskState = task.state ?? {};
    let messages: ChatMessage[] = state.messages ?? [];
    if (!messages.length) {
      messages = [{ role: 'user', content: `Instruções da tarefa:\n${task.instructions}` }];
    }
    // Retomando depois de uma pergunta respondida
    if (state.pending) {
      const { data: q } = await admin.from('companion_questions').select('status, answer').eq('id', state.pending.question_id).single();
      if (q?.status === 'pendente') {
        await save(admin, task, { status: 'aguardando_confirmacao', blocked_reason: 'Aguardando sua resposta' });
        return;
      }
      const answerText = q?.status === 'respondida' ? `Resposta da pessoa: ${q.answer}` : 'A pessoa descartou a pergunta. Decida o caminho mais seguro e explique.';
      messages.push({ role: 'user', content: [...(state.partial_results ?? []), { type: 'tool_result', tool_use_id: state.pending.tool_use_id, content: answerText }] });
      state.pending = null;
      state.partial_results = [];
    }

    let res;
    try {
      res = await createMessage({ model, max_tokens: 8000, system, tools: TOOLS, messages });
    } catch (err) {
      const msg = err instanceof HttpError ? err.message : 'Falha ao falar com o Claude.';
      await finish(admin, task, false, msg);
      return;
    }
    const cost = estimateCost(res.model, res.usage.input_tokens, res.usage.output_tokens);
    await admin.rpc('_record_ai_usage', { p_user: task.owner_id, p_input: res.usage.input_tokens, p_output: res.usage.output_tokens, p_cost: cost });
    messages.push({ role: 'assistant', content: res.content });
    const usage = { input_tokens: task.input_tokens + res.usage.input_tokens, output_tokens: task.output_tokens + res.usage.output_tokens, steps: task.steps + 1 };

    if (res.stop_reason === 'tool_use') {
      const calls = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      const results: ContentBlock[] = [];
      let pending: TaskState['pending'] = null;
      for (const call of calls) {
        if (call.name === 'perguntar_usuario' && call.input?.bloqueante !== false && !pending) {
          const qid = await rpc<string>(admin, '_companion_ask', {
            p_task: task.id,
            p_question: String(call.input.pergunta ?? '').slice(0, 2000),
            p_options: Array.isArray(call.input.opcoes) ? call.input.opcoes.slice(0, 6).map(String) : [],
            p_urgency: ['baixa', 'media', 'alta'].includes(call.input.urgencia as string) ? call.input.urgencia : 'media',
            p_blocking: true,
          });
          pending = { tool_use_id: call.id, question_id: qid };
          continue;
        }
        if (call.name === 'perguntar_usuario') {
          await rpc<string>(admin, '_companion_ask', {
            p_task: task.id,
            p_question: String(call.input.pergunta ?? '').slice(0, 2000),
            p_options: Array.isArray(call.input.opcoes) ? call.input.opcoes.slice(0, 6).map(String) : [],
            p_urgency: ['baixa', 'media', 'alta'].includes(call.input.urgencia as string) ? call.input.urgencia : 'baixa',
            p_blocking: false,
          });
          results.push({ type: 'tool_result', tool_use_id: call.id, content: 'Pergunta registrada nas pendências. Continue sem a resposta por enquanto.' });
          continue;
        }
        let out: { content: string; is_error?: boolean };
        try {
          out = await runTool(admin, task, call.name, (call.input ?? {}) as Record<string, any>);
        } catch (err) {
          out = { content: `Erro ao executar ${call.name}: ${(err as Error).message}`, is_error: true };
        }
        results.push({ type: 'tool_result', tool_use_id: call.id, content: out.content, ...(out.is_error ? { is_error: true } : {}) });
        await log(admin, task, out.is_error ? 'aviso' : 'info', 'tool.used', `Usou ${call.name}${out.is_error ? ' (erro)' : ''}`);
      }
      if (pending) {
        await save(admin, task, { ...usage, state: { run_id: runId, messages, pending, partial_results: results } });
        await log(admin, task, 'info', 'task.waiting', 'Pausada esperando sua decisão');
        return;
      }
      messages.push({ role: 'user', content: results });
      await save(admin, task, { ...usage, state: { run_id: runId, messages } });
      continue;
    }

    // Terminou (end_turn / max_tokens / outro)
    const final = textOf(res.content) || 'Tarefa encerrada sem resumo.';
    await save(admin, task, { ...usage, state: { run_id: runId, messages } });
    if (res.stop_reason === 'max_tokens') {
      messages.push({ role: 'user', content: 'Continue de onde parou e termine com o resumo final.' });
      await save(admin, task, { state: { run_id: runId, messages } });
      continue;
    }
    await finish(admin, (await loadTask(admin, taskId))!, true, final);
    return;
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const body = await readJson<{ task_id: string; run_id?: string }>(req);
    if (!body.task_id) throw new HttpError(400, 'Tarefa não informada.');
    const admin = adminClient();
    const task = await loadTask(admin, body.task_id);
    if (!task) throw new HttpError(404, 'Tarefa não encontrada.');

    if (isInternal(req)) {
      if (task.status !== 'executando' || task.state?.run_id !== body.run_id) return json({ status: task.status });
      runInBackground(execute(task.id, body.run_id!));
      return json({ status: 'continuing' }, 202);
    }

    const { user } = await requireUser(req);
    if (task.owner_id !== user.id) throw new HttpError(404, 'Tarefa não encontrada.');
    apiKey();

    const runId = crypto.randomUUID();
    if (task.status === 'aguardando') {
      const claimed = await rpc<boolean>(admin, '_companion_claim', { p_task: task.id });
      if (!claimed) return json({ status: 'queued' });
    } else if (task.status === 'executando') {
      const stale = !task.heartbeat_at || Date.now() - new Date(task.heartbeat_at).getTime() > STALE_MS;
      if (!stale) return json({ status: 'running' });
      await log(admin, task, 'aviso', 'task.recovered', 'Execução anterior parou de responder; retomando do último estado salvo');
    } else {
      return json({ status: task.status });
    }
    await admin.from('companion_tasks').update({ state: { ...(task.state ?? {}), run_id: runId }, heartbeat_at: new Date().toISOString() }).eq('id', task.id);
    runInBackground(execute(task.id, runId));
    return json({ status: 'started' }, 202);
  } catch (err) {
    return handleError(err);
  }
});
