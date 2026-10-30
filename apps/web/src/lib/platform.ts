import type { NexusDesktop } from '../types/desktop';

export const desktop: NexusDesktop | undefined = typeof window !== 'undefined' ? window.nexusDesktop : undefined;
export const isDesktop = !!desktop;

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const touch = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;

/** iPhone, iPod e iPad (inclusive iPad que se identifica como Mac). */
const macTouch = /Macintosh/.test(ua) && (touch > 0 || (typeof document !== 'undefined' && 'ontouchend' in document));
export const isIOS = /iPad|iPhone|iPod/.test(ua) || macTouch;
export const isIPad = /iPad/.test(ua) || macTouch;
export const isAndroid = /Android/i.test(ua);
export const isMobileOS = isIOS || isAndroid;

export const isCapacitor = typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** Compartilhar tela: desktop (Electron/Chrome/Edge). iPhone/iPad não permitem. */
export const canShareScreen =
  !isIOS && !isAndroid && typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;

export const canUseMicrophone = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export function openExternal(url: string): void {
  if (desktop) desktop.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export function platformLabel(): string {
  if (isDesktop) return 'Windows (app)';
  if (isIPad) return 'iPad';
  if (isIOS) return 'iPhone';
  if (isAndroid) return 'Android';
  return 'Navegador';
}
