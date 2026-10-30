// PWA: instalação no celular/tablet e atualização do app web.
import { useSyncExternalStore } from 'react';
import { isCapacitor, isDesktop, isStandalone } from './platform';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  canPrompt: boolean;
  installed: boolean;
  updateReady: boolean;
}

let deferred: BeforeInstallPromptEvent | null = null;
let state: PwaState = { canPrompt: false, installed: isStandalone(), updateReady: false };
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function initPwa(): void {
  if (typeof window === 'undefined' || isDesktop || isCapacitor) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    set({ canPrompt: true });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    set({ canPrompt: false, installed: true });
  });
  if (!/^https?:$/.test(location.protocol) || import.meta.env.DEV) return;
  void import('virtual:pwa-register')
    .then(({ registerSW }) => {
      updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          set({ updateReady: true });
        },
      });
    })
    .catch(() => undefined);
}

export function usePwa() {
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
  return {
    ...snap,
    prompt: async () => {
      if (!deferred) return false;
      await deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      set({ canPrompt: false, installed: choice.outcome === 'accepted' });
      return choice.outcome === 'accepted';
    },
    applyUpdate: () => {
      void updateSW?.(true);
    },
  };
}
