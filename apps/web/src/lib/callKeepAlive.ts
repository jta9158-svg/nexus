// Mantém a call viva quando a pessoa sai do app no celular.
//  * Android (app instalado): liga um serviço em primeiro plano (notificação
//    "Em uma call") que impede o Android de suspender/fechar o app — assim o
//    áudio continua mesmo com outro app aberto.
//  * Todos: segura a tela ligada (Wake Lock) enquanto está na call.
// No iPhone/iPad (PWA) o sistema não deixa um site rodar som em segundo plano;
// aí o que vale é a tela acesa e a reconexão rápida ao voltar (ver store/call).
import { isAndroid, isCapacitor } from './platform';

interface KeepAlivePlugin {
  start(options: { mic: boolean; title: string; text: string }): Promise<void>;
  stop(): Promise<void>;
}

let plugin: KeepAlivePlugin | null | undefined;
let wakeLock: WakeLockSentinel | null = null;
let active = false;
let wantMic = true;

async function getPlugin(): Promise<KeepAlivePlugin | null> {
  if (plugin !== undefined) return plugin;
  plugin = null;
  if (isCapacitor && isAndroid) {
    try {
      const { registerPlugin } = await import('@capacitor/core');
      plugin = registerPlugin<KeepAlivePlugin>('CallKeepAlive');
    } catch {
      plugin = null;
    }
  }
  return plugin;
}

async function acquireWakeLock(): Promise<void> {
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> } }).wakeLock;
    if (!wl || wakeLock) return;
    wakeLock = await wl.request('screen');
    wakeLock.addEventListener?.('release', () => {
      wakeLock = null;
    });
  } catch {
    // negado ou sem suporte: segue sem segurar a tela
  }
}

async function releaseWakeLock(): Promise<void> {
  try {
    await wakeLock?.release();
  } catch {
    // nada a fazer
  }
  wakeLock = null;
}

// A tela só mantém o Wake Lock enquanto visível; ao voltar para o app, pega de novo.
function onVisible() {
  if (active && document.visibilityState === 'visible') void acquireWakeLock();
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', onVisible);
}

/** Começa a segurar a call em segundo plano (chamar ao entrar na call). */
export async function startCallKeepAlive(mic: boolean): Promise<void> {
  active = true;
  wantMic = mic;
  await acquireWakeLock();
  const p = await getPlugin();
  await p?.start({ mic, title: 'Em uma call no NEXUS', text: 'Toque para voltar à call' }).catch(() => undefined);
}

/** Atualiza se o microfone está em uso (muda o tipo do serviço no Android). */
export async function updateCallKeepAlive(mic: boolean): Promise<void> {
  if (!active || mic === wantMic) return;
  wantMic = mic;
  const p = await getPlugin();
  // Reinicia o serviço com o novo tipo (microfone x só ouvir).
  await p?.start({ mic, title: 'Em uma call no NEXUS', text: 'Toque para voltar à call' }).catch(() => undefined);
}

/** Para de segurar a call (chamar ao sair da call). */
export async function stopCallKeepAlive(): Promise<void> {
  active = false;
  await releaseWakeLock();
  const p = await getPlugin();
  await p?.stop().catch(() => undefined);
}
