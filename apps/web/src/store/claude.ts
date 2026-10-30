// Conversas com o Claude. O streaming fica no store para continuar mesmo
// quando a pessoa navega para outra parte do NEXUS.
import { create } from 'zustand';
import { sb, streamFunction } from '../lib/supabase';
import { blobToBase64, downscaleImage } from '../lib/storage';
import { friendlyError } from '../lib/errors';
import { toast } from './toast';
import { useApp } from './app';
import type { AiConversation, AiMessage } from '../types/db';

interface Streaming {
  text: string;
  controller: AbortController;
  startedAt: number;
  error?: string;
}

export interface ClaudeUpload {
  name: string;
  type: string;
  size: number;
  kind: 'image' | 'pdf' | 'text';
  data: string; // base64 (imagem/pdf) ou texto
}

interface ClaudeState {
  conversations: AiConversation[];
  loaded: boolean;
  messages: Record<string, AiMessage[]>;
  streaming: Record<string, Streaming | undefined>;
  loadConversations: () => Promise<void>;
  loadMessages: (id: string) => Promise<void>;
  createConversation: (opts?: { projectId?: string | null; serverId?: string | null; title?: string }) => Promise<AiConversation>;
  send: (conversationId: string, text: string, uploads: ClaudeUpload[]) => Promise<void>;
  cancel: (conversationId: string) => void;
  rename: (id: string, title: string) => Promise<void>;
  setProject: (id: string, projectId: string | null, serverId: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const TEXT_EXT = /\.(txt|md|lua|luau|json|csv|ts|tsx|js|jsx|py|html|css|xml|yaml|yml|toml|ini|log|rbxlx|rbxmx)$/i;
const MAX_TEXT = 300_000;

/** Prepara um arquivo para enviar ao Claude (imagem, PDF ou texto). */
export async function prepareUpload(file: File): Promise<ClaudeUpload> {
  if (/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    const blob = await downscaleImage(file);
    if (blob.size > 4_800_000) throw new Error(`"${file.name}" é grande demais (máx. ~5 MB).`);
    return { name: file.name, type: blob.type || file.type, size: blob.size, kind: 'image', data: await blobToBase64(blob) };
  }
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > 20_000_000) throw new Error(`"${file.name}" é grande demais (máx. 20 MB).`);
    return { name: file.name, type: 'application/pdf', size: file.size, kind: 'pdf', data: await blobToBase64(file) };
  }
  if (file.type.startsWith('text/') || TEXT_EXT.test(file.name)) {
    const text = await file.text();
    if (text.length > MAX_TEXT) throw new Error(`"${file.name}" tem texto demais (máx. ${MAX_TEXT.toLocaleString('pt-BR')} caracteres).`);
    return { name: file.name, type: file.type || 'text/plain', size: file.size, kind: 'text', data: text };
  }
  throw new Error(`A NEXUS IA ainda não lê arquivos do tipo de "${file.name}". Envie imagens, PDF ou arquivos de texto/código.`);
}

export const useClaude = create<ClaudeState>((set, get) => ({
  conversations: [],
  loaded: false,
  messages: {},
  streaming: {},

  loadConversations: async () => {
    const { data, error } = await sb()
      .from('ai_conversations')
      .select('*')
      .eq('archived', false)
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) {
      toast.error(error, 'Não foi possível carregar as conversas');
      return;
    }
    set({ conversations: (data ?? []) as AiConversation[], loaded: true });
  },

  loadMessages: async (id) => {
    const { data, error } = await sb()
      .from('ai_messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) {
      toast.error(error);
      return;
    }
    set({ messages: { ...get().messages, [id]: (data ?? []) as AiMessage[] } });
  },

  createConversation: async (opts) => {
    const { data, error } = await sb()
      .from('ai_conversations')
      .insert({
        title: opts?.title?.slice(0, 120) || 'Nova conversa',
        project_id: opts?.projectId ?? null,
        server_id: opts?.serverId ?? null,
      })
      .select('*')
      .single();
    if (error) throw error;
    const conv = data as AiConversation;
    set({ conversations: [conv, ...get().conversations], messages: { ...get().messages, [conv.id]: [] } });
    return conv;
  },

  send: async (conversationId, text, uploads) => {
    if (get().streaming[conversationId]) return;
    const content = text.trim();
    if (!content && uploads.length === 0) return;
    const controller = new AbortController();
    const now = new Date().toISOString();
    const optimistic: AiMessage = {
      id: `tmp-user-${Date.now()}`,
      conversation_id: conversationId,
      role: 'user',
      content,
      attachments: uploads.map((u) => ({ name: u.name, type: u.type, size: u.size })),
      status: 'done',
      error: null,
      model: null,
      input_tokens: null,
      output_tokens: null,
      created_at: now,
    };
    set({
      messages: { ...get().messages, [conversationId]: [...(get().messages[conversationId] ?? []), optimistic] },
      streaming: { ...get().streaming, [conversationId]: { text: '', controller, startedAt: Date.now() } },
    });

    const update = (fn: (s: Streaming) => Streaming) => {
      const cur = get().streaming[conversationId];
      if (cur) set({ streaming: { ...get().streaming, [conversationId]: fn(cur) } });
    };

    try {
      await streamFunction(
        'claude-chat',
        {
          conversation_id: conversationId,
          message: content,
          attachments: uploads.map((u) => ({ name: u.name, type: u.type, kind: u.kind, data: u.data })),
        },
        (ev) => {
          if (ev.type === 'delta' && typeof ev.text === 'string') {
            update((s) => ({ ...s, text: s.text + (ev.text as string) }));
          } else if (ev.type === 'error') {
            update((s) => ({ ...s, error: String(ev.message || 'Erro na NEXUS IA') }));
          } else if (ev.type === 'title' && typeof ev.title === 'string') {
            set({
              conversations: get().conversations.map((c) => (c.id === conversationId ? { ...c, title: ev.title as string } : c)),
            });
          }
        },
        controller.signal,
      );
      const err = get().streaming[conversationId]?.error;
      if (err) toast.warn('A NEXUS IA não conseguiu responder', err);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        toast.error(err, 'A NEXUS IA não respondeu');
        update((s) => ({ ...s, error: friendlyError(err) }));
      }
    } finally {
      const next = { ...get().streaming };
      delete next[conversationId];
      set({ streaming: next });
      await get().loadMessages(conversationId);
      // Leva a conversa para o topo.
      const list = get().conversations;
      const conv = list.find((c) => c.id === conversationId);
      if (conv) {
        set({ conversations: [{ ...conv, updated_at: new Date().toISOString() }, ...list.filter((c) => c.id !== conversationId)] });
      }
      void useApp.getState().refreshQuota();
    }
  },

  cancel: (conversationId) => {
    get().streaming[conversationId]?.controller.abort();
  },

  rename: async (id, title) => {
    const t = title.trim().slice(0, 120);
    if (!t) return;
    const { error } = await sb().from('ai_conversations').update({ title: t }).eq('id', id);
    if (error) return void toast.error(error);
    set({ conversations: get().conversations.map((c) => (c.id === id ? { ...c, title: t } : c)) });
  },

  setProject: async (id, projectId, serverId) => {
    const { error } = await sb().from('ai_conversations').update({ project_id: projectId, server_id: serverId }).eq('id', id);
    if (error) return void toast.error(error);
    set({ conversations: get().conversations.map((c) => (c.id === id ? { ...c, project_id: projectId, server_id: serverId } : c)) });
  },

  remove: async (id) => {
    const { error } = await sb().from('ai_conversations').delete().eq('id', id);
    if (error) return void toast.error(error);
    const msgs = { ...get().messages };
    delete msgs[id];
    set({ conversations: get().conversations.filter((c) => c.id !== id), messages: msgs });
  },
}));
