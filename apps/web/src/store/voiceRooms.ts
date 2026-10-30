// Quem está em cada canal de voz, direto da LiveKit (a fonte da verdade das calls).
// Complementa a presença em tempo real: se a presença de alguém falhar (internet
// ruim, app em segundo plano), a pessoa continua aparecendo embaixo do canal.
import { useEffect } from 'react';
import { create } from 'zustand';
import { callFunction } from '../lib/supabase';
import { useApp } from './app';
import { useCall } from './call';

export interface VoicePeer {
  identity: string;
  name: string;
  agent: boolean;
}

interface VoiceRoomsState {
  byServer: Record<string, Record<string, VoicePeer[]>>;
  refresh: (serverId: string) => Promise<void>;
  reset: () => void;
}

const inflight = new Map<string, Promise<void>>();
const lastAt = new Map<string, number>();
const MIN_GAP_MS = 2500;

export const useVoiceRooms = create<VoiceRoomsState>((set, get) => ({
  byServer: {},
  refresh: (serverId) => {
    const running = inflight.get(serverId);
    if (running) return running;
    if (Date.now() - (lastAt.get(serverId) ?? 0) < MIN_GAP_MS) return Promise.resolve();
    const p = (async () => {
      try {
        const r = await callFunction<{ channels?: Record<string, VoicePeer[]> }>('livekit-token', { action: 'participants', server_id: serverId });
        set({ byServer: { ...get().byServer, [serverId]: r.channels ?? {} } });
      } catch {
        // Sem a lista da LiveKit (calls desligadas, sem internet): fica só a presença.
      } finally {
        lastAt.set(serverId, Date.now());
        inflight.delete(serverId);
      }
    })();
    inflight.set(serverId, p);
    return p;
  },
  reset: () => {
    inflight.clear();
    lastAt.clear();
    set({ byServer: {} });
  },
}));

// Um relógio só por servidor, mesmo que a barra lateral e a tela da call peçam juntas.
const watchers = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | null = null;

function tickAll() {
  if (document.visibilityState !== 'visible') return;
  for (const id of watchers.keys()) void useVoiceRooms.getState().refresh(id);
}

function watch(serverId: string) {
  watchers.set(serverId, (watchers.get(serverId) ?? 0) + 1);
  if (!timer) {
    timer = setInterval(tickAll, 30_000);
    document.addEventListener('visibilitychange', tickAll);
  }
}

function unwatch(serverId: string) {
  const n = (watchers.get(serverId) ?? 1) - 1;
  if (n > 0) watchers.set(serverId, n);
  else watchers.delete(serverId);
  if (!watchers.size && timer) {
    clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', tickAll);
  }
}

/**
 * Mantém a lista de quem está nas calls do servidor atualizada enquanto ela
 * aparece na tela: ao abrir, quando alguém entra/sai (presença ou a sua própria
 * call) e a cada 30 s com o app visível.
 */
export function useVoiceRoomsSync(serverId: string, enabled: boolean): void {
  const presenceKey = useApp((s) =>
    Object.values(s.presence[serverId] ?? {})
      .map((p) => `${p.user_id}:${p.voice?.channel_id ?? ''}`)
      .sort()
      .join('|'),
  );
  const callKey = useCall((s) => `${s.status}:${s.channelId ?? ''}:${s.participants.length}`);

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      if (document.visibilityState === 'visible') void useVoiceRooms.getState().refresh(serverId);
    }, 700);
    return () => clearTimeout(t);
  }, [serverId, enabled, presenceKey, callKey]);

  useEffect(() => {
    if (!enabled) return;
    watch(serverId);
    return () => unwatch(serverId);
  }, [serverId, enabled]);
}
