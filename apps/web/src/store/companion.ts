// Claude Companion: modos, permissões, tarefas em segundo plano e dúvidas.
// As tarefas rodam no servidor (Edge Function "companion-run"), então
// continuam mesmo com o app minimizado, em outra tela ou fechado.
import { create } from 'zustand';
import { callFunction, sb } from '../lib/supabase';
import { onTable } from '../lib/bus';
import { toast } from './toast';
import type {
  CompanionLog,
  CompanionMode,
  CompanionQuestion,
  CompanionSettings,
  CompanionTask,
} from '../types/db';

export const COMPANION_SCOPES: Array<{ key: string; label: string; description: string; risk: 'baixo' | 'medio' | 'alto'; available: boolean }> = [
  { key: 'acessar_arquivos', label: 'Ler arquivos dos projetos', description: 'Ler scripts e documentos enviados na área de Arquivos.', risk: 'medio', available: true },
  { key: 'modificar_projetos', label: 'Criar e alterar tarefas', description: 'Registrar bugs, tarefas e melhorias encontradas.', risk: 'medio', available: true },
  { key: 'ver_financas', label: 'Consultar finanças', description: 'Ler lançamentos e resumos financeiros que você pode ver.', risk: 'alto', available: true },
  { key: 'ler_mensagens', label: 'Ler mensagens autorizadas', description: 'Ler o histórico recente de canais quando você pedir.', risk: 'medio', available: true },
  { key: 'ouvir_call', label: 'Ouvir calls', description: 'Receber o áudio da sala (requer o serviço de voz).', risk: 'alto', available: false },
  { key: 'falar_call', label: 'Falar nas calls', description: 'Responder por voz (requer o serviço de voz).', risk: 'medio', available: false },
  { key: 'executar_comandos', label: 'Executar comandos no PC', description: 'Rodar comandos no computador (requer o agente local).', risk: 'alto', available: false },
  { key: 'controlar_apps', label: 'Controlar aplicativos', description: 'Roblox Studio e Blender (requer o agente local).', risk: 'alto', available: false },
  { key: 'integracoes_externas', label: 'Integrações externas', description: 'Usar serviços como Roblox e Google Drive.', risk: 'medio', available: false },
  { key: 'publicar_alteracoes', label: 'Publicar alterações', description: 'Publicar mudanças no jogo. Sempre pede confirmação.', risk: 'alto', available: false },
];

export const MODES: Array<{ key: CompanionMode; label: string; description: string }> = [
  { key: 'quando_chamado', label: 'Só quando chamado', description: 'Fica em silêncio e responde quando alguém chama ou envia um comando.' },
  { key: 'participante_ativo', label: 'Participante ativo', description: 'Pode contribuir sozinho quando tiver algo útil, sem falar por cima.' },
  { key: 'segundo_plano', label: 'Trabalhador em segundo plano', description: 'Prioriza as tarefas e só chama atenção quando algo bloquear o trabalho.' },
  { key: 'hibrido', label: 'Híbrido (padrão)', description: 'Participa quando necessário e continua as tarefas em segundo plano.' },
];

interface CompanionState {
  loaded: boolean;
  settings: CompanionSettings | null;
  permissions: Record<string, boolean>;
  tasks: CompanionTask[];
  questions: CompanionQuestion[];
  logs: CompanionLog[];
  load: () => Promise<void>;
  setMode: (mode: CompanionMode) => Promise<void>;
  setMaxConcurrent: (n: number) => Promise<void>;
  setPermission: (scope: string, granted: boolean) => Promise<void>;
  createTask: (input: { title: string; instructions: string; projectId?: string | null; priority?: 'baixa' | 'media' | 'alta'; scopes?: string[]; resourceKey?: string | null }) => Promise<string | null>;
  run: (taskId: string) => Promise<void>;
  action: (taskId: string, action: 'cancelar' | 'pausar' | 'retomar' | 'repetir') => Promise<void>;
  answer: (questionId: string, answer: string) => Promise<void>;
  loadLogs: () => Promise<void>;
  deleteLogs: () => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
}

let wired = false;

export const useCompanion = create<CompanionState>((set, get) => ({
  loaded: false,
  settings: null,
  permissions: {},
  tasks: [],
  questions: [],
  logs: [],

  load: async () => {
    const c = sb();
    const [settings, perms, tasks, questions] = await Promise.all([
      c.from('companion_settings').select('*').maybeSingle(),
      c.from('companion_permissions').select('*'),
      c.from('companion_tasks').select('*').order('created_at', { ascending: false }).limit(100),
      c.from('companion_questions').select('*').order('created_at', { ascending: false }).limit(100),
    ]);
    let s = settings.data as CompanionSettings | null;
    if (!s && !settings.error) {
      const ins = await c.from('companion_settings').insert({}).select('*').single();
      s = (ins.data as CompanionSettings) ?? null;
    }
    const map: Record<string, boolean> = {};
    for (const p of (perms.data ?? []) as Array<{ scope: string; granted: boolean }>) map[p.scope] = p.granted;
    set({
      loaded: true,
      settings: s,
      permissions: map,
      tasks: (tasks.data ?? []) as CompanionTask[],
      questions: ((questions.data ?? []) as CompanionQuestion[]).map((q) => ({ ...q, options: Array.isArray(q.options) ? q.options : [] })),
    });

    // Tarefas na fila voltam a rodar (se a continuação automática não estiver configurada).
    for (const t of get().tasks.filter((x) => x.status === 'aguardando').slice(0, 3)) void get().run(t.id);

    if (!wired) {
      wired = true;
      onTable('companion_tasks', (p) => {
        if (p.eventType === 'DELETE') {
          set({ tasks: get().tasks.filter((t) => t.id !== (p.old as { id?: string }).id) });
          return;
        }
        const t = p.new as unknown as CompanionTask;
        const prev = get().tasks.find((x) => x.id === t.id);
        set({ tasks: prev ? get().tasks.map((x) => (x.id === t.id ? t : x)) : [t, ...get().tasks] });
        if (prev && prev.status !== t.status) {
          if (t.status === 'concluida') toast.success('Claude concluiu uma tarefa', t.title);
          if (t.status === 'falhou') toast.warn('Uma tarefa do Claude falhou', t.error ?? t.title);
        }
      });
      onTable('companion_questions', (p) => {
        if (p.eventType === 'DELETE') return;
        const q = { ...(p.new as unknown as CompanionQuestion) };
        q.options = Array.isArray(q.options) ? q.options : [];
        const exists = get().questions.some((x) => x.id === q.id);
        set({ questions: exists ? get().questions.map((x) => (x.id === q.id ? q : x)) : [q, ...get().questions] });
      });
    }
  },

  setMode: async (mode) => {
    const { data, error } = await sb().from('companion_settings').update({ mode }).eq('user_id', get().settings?.user_id ?? '').select('*').single();
    if (error) return void toast.error(error);
    set({ settings: data as CompanionSettings });
  },

  setMaxConcurrent: async (n) => {
    const { data, error } = await sb()
      .from('companion_settings')
      .update({ max_concurrent_tasks: n })
      .eq('user_id', get().settings?.user_id ?? '')
      .select('*')
      .single();
    if (error) return void toast.error(error);
    set({ settings: data as CompanionSettings });
  },

  setPermission: async (scope, granted) => {
    const prev = get().permissions[scope];
    set({ permissions: { ...get().permissions, [scope]: granted } });
    const { error } = await sb().rpc('companion_set_permission', { p_scope: scope, p_granted: granted });
    if (error) {
      set({ permissions: { ...get().permissions, [scope]: prev ?? false } });
      toast.error(error);
    }
  },

  createTask: async (input) => {
    const { data, error } = await sb().rpc('companion_create_task', {
      p_title: input.title,
      p_instructions: input.instructions,
      p_project: input.projectId ?? null,
      p_priority: input.priority ?? 'media',
      p_required_scopes: input.scopes ?? [],
      p_resource_key: input.resourceKey ?? null,
      p_max_steps: 30,
    });
    if (error) {
      toast.error(error, 'Não foi possível criar a tarefa');
      return null;
    }
    const id = data as string;
    const { data: row } = await sb().from('companion_tasks').select('*').eq('id', id).single();
    if (row && !get().tasks.some((t) => t.id === id)) set({ tasks: [row as CompanionTask, ...get().tasks] });
    await get().run(id);
    return id;
  },

  run: async (taskId) => {
    try {
      await callFunction('companion-run', { task_id: taskId });
    } catch (err) {
      toast.warn('O executor de tarefas não respondeu', (err as Error).message);
    }
  },

  action: async (taskId, action) => {
    const { error } = await sb().rpc('companion_task_action', { p_task: taskId, p_action: action });
    if (error) return void toast.error(error);
    const { data } = await sb().from('companion_tasks').select('*').eq('id', taskId).single();
    if (data) set({ tasks: get().tasks.map((t) => (t.id === taskId ? (data as CompanionTask) : t)) });
    if (action === 'retomar' || action === 'repetir') await get().run(taskId);
  },

  answer: async (questionId, answer) => {
    const q = get().questions.find((x) => x.id === questionId);
    const { error } = await sb().rpc('companion_answer_question', { p_question: questionId, p_answer: answer });
    if (error) return void toast.error(error);
    set({
      questions: get().questions.map((x) =>
        x.id === questionId ? { ...x, status: 'respondida', answer, answered_at: new Date().toISOString() } : x,
      ),
    });
    if (q?.task_id) await get().run(q.task_id);
  },

  loadLogs: async () => {
    const { data, error } = await sb().from('companion_logs').select('*').order('created_at', { ascending: false }).limit(300);
    if (error) return void toast.error(error);
    set({ logs: (data ?? []) as CompanionLog[] });
  },

  deleteLogs: async () => {
    const ids = get().logs.map((l) => l.id);
    if (!ids.length) return;
    const { error } = await sb().from('companion_logs').delete().in('id', ids);
    if (error) return void toast.error(error);
    set({ logs: [] });
    toast.success('Registros excluídos');
  },

  deleteTask: async (taskId) => {
    const { error } = await sb().from('companion_tasks').delete().eq('id', taskId);
    if (error) return void toast.error(error);
    set({ tasks: get().tasks.filter((t) => t.id !== taskId) });
  },
}));
