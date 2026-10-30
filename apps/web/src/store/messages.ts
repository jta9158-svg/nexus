import { create } from 'zustand';
import { sb } from '../lib/supabase';
import { imageSize, randomId, safeFileName } from '../lib/storage';
import { friendlyError } from '../lib/errors';
import { toast } from './toast';
import { useApp } from './app';
import { useSession } from './session';
import type { Attachment, Message } from '../types/db';

export type TargetKind = 'channel' | 'dm';

interface Bucket {
  items: Message[];
  loading: boolean;
  loaded: boolean;
  hasMore: boolean;
  error: string | null;
}

interface MessagesState {
  buckets: Record<string, Bucket>;
  load: (target: string, kind: TargetKind) => Promise<void>;
  loadOlder: (target: string, kind: TargetKind) => Promise<void>;
  send: (target: string, kind: TargetKind, content: string, files: File[], replyTo?: string | null) => Promise<Message | null>;
  edit: (id: string, content: string) => Promise<void>;
  remove: (msg: Message) => Promise<void>;
  discardFailed: (target: string, tempId: string) => void;
  applyInsert: (m: Message) => void;
  applyUpdate: (m: Message) => void;
  applyDelete: (id: string) => void;
}

const PAGE = 50;
const empty: Bucket = { items: [], loading: false, loaded: false, hasMore: true, error: null };

function targetOf(m: Message): string | null {
  return m.channel_id ?? m.dm_thread_id ?? null;
}

function normalize(m: Message): Message {
  return { ...m, attachments: Array.isArray(m.attachments) ? m.attachments : [], mentions: m.mentions ?? [], meta: m.meta ?? {} };
}

function insertSorted(items: Message[], m: Message): Message[] {
  if (items.some((x) => x.id === m.id)) return items.map((x) => (x.id === m.id ? m : x));
  const next = [...items, m];
  next.sort((a, b) => {
    if (a._pending && !b._pending) return 1;
    if (!a._pending && b._pending) return -1;
    return a.created_at.localeCompare(b.created_at);
  });
  return next;
}

export const useMessages = create<MessagesState>((set, get) => {
  const patch = (target: string, fn: (b: Bucket) => Bucket) => {
    const cur = get().buckets[target] ?? empty;
    set({ buckets: { ...get().buckets, [target]: fn(cur) } });
  };

  return {
    buckets: {},

    load: async (target, kind) => {
      const cur = get().buckets[target];
      if (cur?.loaded || cur?.loading) return;
      patch(target, (b) => ({ ...b, loading: true, error: null }));
      const { data, error } = await sb()
        .from('messages')
        .select('*')
        .eq(kind === 'channel' ? 'channel_id' : 'dm_thread_id', target)
        .order('created_at', { ascending: false })
        .limit(PAGE);
      if (error) {
        patch(target, (b) => ({ ...b, loading: false, error: friendlyError(error) }));
        return;
      }
      const items = ((data ?? []) as Message[]).map(normalize).reverse();
      await useApp.getState().ensureProfiles(items.map((m) => m.author_id));
      patch(target, (b) => {
        // Mantém mensagens que chegaram em tempo real durante o carregamento.
        let merged = items;
        for (const m of b.items) merged = insertSorted(merged, m);
        return { items: merged, loading: false, loaded: true, hasMore: items.length === PAGE, error: null };
      });
    },

    loadOlder: async (target, kind) => {
      const cur = get().buckets[target];
      if (!cur || cur.loading || !cur.hasMore) return;
      const oldest = cur.items.find((m) => !m._pending);
      if (!oldest) return;
      patch(target, (b) => ({ ...b, loading: true }));
      const { data, error } = await sb()
        .from('messages')
        .select('*')
        .eq(kind === 'channel' ? 'channel_id' : 'dm_thread_id', target)
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .limit(PAGE);
      if (error) {
        patch(target, (b) => ({ ...b, loading: false }));
        toast.error(error);
        return;
      }
      const older = ((data ?? []) as Message[]).map(normalize).reverse();
      await useApp.getState().ensureProfiles(older.map((m) => m.author_id));
      patch(target, (b) => ({
        ...b,
        loading: false,
        hasMore: older.length === PAGE,
        items: [...older.filter((o) => !b.items.some((x) => x.id === o.id)), ...b.items],
      }));
    },

    send: async (target, kind, content, files, replyTo) => {
      const me = useSession.getState().userId;
      if (!me) return null;
      const text = content.trim();
      if (!text && files.length === 0) return null;
      const tempId = `tmp-${randomId()}`;
      const temp: Message = {
        id: tempId,
        channel_id: kind === 'channel' ? target : null,
        dm_thread_id: kind === 'dm' ? target : null,
        server_id: null,
        author_id: me,
        author_kind: 'user',
        content: text,
        attachments: files.map((f) => ({ path: '', name: f.name, size: f.size, type: f.type || 'application/octet-stream' })),
        mentions: [],
        mentions_claude: false,
        mentions_everyone: false,
        reply_to: replyTo ?? null,
        meta: {},
        edited_at: null,
        created_at: new Date().toISOString(),
        _pending: true,
      };
      patch(target, (b) => ({ ...b, items: insertSorted(b.items, temp) }));

      try {
        const attachments: Attachment[] = [];
        for (const f of files) {
          const path = `${kind === 'channel' ? 'c' : 'd'}/${target}/${randomId()}/${safeFileName(f.name)}`;
          const up = await sb().storage.from('attachments').upload(path, f, {
            contentType: f.type || 'application/octet-stream',
            upsert: false,
          });
          if (up.error) throw up.error;
          const dims = await imageSize(f);
          attachments.push({ path, name: f.name, size: f.size, type: f.type || 'application/octet-stream', ...(dims ?? {}) });
        }
        const { data, error } = await sb()
          .from('messages')
          .insert({
            channel_id: kind === 'channel' ? target : null,
            dm_thread_id: kind === 'dm' ? target : null,
            author_id: me,
            content: text,
            attachments,
            reply_to: replyTo ?? null,
          })
          .select('*')
          .single();
        if (error) throw error;
        const real = normalize(data as Message);
        patch(target, (b) => ({
          ...b,
          items: insertSorted(
            b.items.filter((m) => m.id !== tempId),
            real,
          ),
        }));
        useApp.getState().markRead(target);
        return real;
      } catch (err) {
        patch(target, (b) => ({
          ...b,
          items: b.items.map((m) => (m.id === tempId ? { ...m, _pending: false, _failed: true } : m)),
        }));
        toast.error(err, 'Mensagem não enviada');
        return null;
      }
    },

    edit: async (id, content) => {
      const text = content.trim();
      if (!text) return;
      const { data, error } = await sb().from('messages').update({ content: text }).eq('id', id).select('*').single();
      if (error) {
        toast.error(error, 'Não foi possível editar');
        return;
      }
      get().applyUpdate(normalize(data as Message));
    },

    remove: async (msg) => {
      const { error } = await sb().from('messages').delete().eq('id', msg.id);
      if (error) {
        toast.error(error, 'Não foi possível apagar');
        return;
      }
      if (msg.attachments?.length && msg.author_id === useSession.getState().userId) {
        void sb()
          .storage.from('attachments')
          .remove(msg.attachments.map((a) => a.path).filter(Boolean));
      }
      get().applyDelete(msg.id);
    },

    discardFailed: (target, tempId) => {
      patch(target, (b) => ({ ...b, items: b.items.filter((m) => m.id !== tempId) }));
    },

    applyInsert: (raw) => {
      const m = normalize(raw);
      const target = targetOf(m);
      if (!target) return;
      const b = get().buckets[target];
      if (!b) return;
      // Remove a versão temporária equivalente (mesmo autor e texto).
      const items = b.items.filter(
        (x) => !(x._pending && x.author_id === m.author_id && x.content === m.content && x.attachments.length === m.attachments.length),
      );
      patch(target, (cur) => ({ ...cur, items: insertSorted(items, m) }));
    },

    applyUpdate: (raw) => {
      const m = normalize(raw);
      const target = targetOf(m);
      if (!target) return;
      const b = get().buckets[target];
      if (!b) return;
      if (b.items.some((x) => x.id === m.id)) {
        patch(target, (cur) => ({ ...cur, items: cur.items.map((x) => (x.id === m.id ? m : x)) }));
      } else {
        patch(target, (cur) => ({ ...cur, items: insertSorted(cur.items, m) }));
      }
    },

    applyDelete: (id) => {
      const buckets = get().buckets;
      for (const [target, b] of Object.entries(buckets)) {
        if (b.items.some((m) => m.id === id)) {
          patch(target, (cur) => ({ ...cur, items: cur.items.filter((m) => m.id !== id) }));
        }
      }
    },
  };
});
