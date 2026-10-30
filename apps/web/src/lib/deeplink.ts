// Links nexus://convite/CODIGO abrem o app instalado e mostram o convite.
// Windows: o app registra o protocolo nexus:// (instalador). Android: o APK
// tem o intent-filter do esquema nexus e o plugin @capacitor/app avisa o app.
import { deliverInvite, inviteCodeFromUrl } from './invite';
import { desktop, isCapacitor } from './platform';

function handle(url: string | null | undefined) {
  const code = url ? inviteCodeFromUrl(url) : null;
  if (code) deliverInvite(code);
}

export function initDeepLinks(): void {
  if (desktop?.onDeepLink) {
    desktop.onDeepLink((url) => {
      handle(url);
      void desktop?.takeDeepLink?.();
    });
    void desktop.takeDeepLink?.().then(handle).catch(() => undefined);
  }
  if (isCapacitor) {
    void import('@capacitor/app')
      .then(({ App }) => {
        void App.addListener('appUrlOpen', (e) => handle(e.url));
        void App.getLaunchUrl().then((r) => handle(r?.url));
      })
      .catch(() => undefined);
  }
}
