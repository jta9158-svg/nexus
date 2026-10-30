import { desktop } from './platform';

let audioCtx: AudioContext | null = null;

/** Som curto de notificação gerado na hora (sem arquivos externos). */
export function playPing(kind: 'message' | 'mention' | 'join' | 'leave' = 'message'): void {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    const now = ctx.currentTime;
    const notes =
      kind === 'mention' ? [880, 1320] : kind === 'join' ? [660, 990] : kind === 'leave' ? [740, 520] : [1046];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.09;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  } catch {
    // áudio indisponível
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (desktop) return true;
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

export function showSystemNotification(title: string, body: string, onClick?: () => void): void {
  if (desktop) {
    desktop.notify({ title, body });
    return;
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: './icons/icon-192.png', tag: title });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    // Alguns navegadores móveis só permitem notificações via service worker.
    void navigator.serviceWorker?.ready.then((reg) => reg.showNotification(title, { body, icon: './icons/icon-192.png' })).catch(() => undefined);
  }
}

export function setAppBadge(count: number): void {
  if (desktop) {
    desktop.setBadgeCount(count);
    return;
  }
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (count > 0) void nav.setAppBadge?.(count);
    else void nav.clearAppBadge?.();
  } catch {
    // sem suporte
  }
}
