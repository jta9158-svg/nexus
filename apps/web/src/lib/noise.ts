// Anti-ruído do microfone nas calls: tira barulho de fundo (ventilador, teclado,
// rua, cachorro) da sua voz antes de ir para os outros. Roda no próprio aparelho
// com o modelo Krisp da LiveKit Cloud (incluído no plano gratuito, sem custo por
// minuto). Se o aparelho não aguentar, fica o anti-ruído básico do navegador.
import { Track, type LocalAudioTrack, type Room } from 'livekit-client';

const KEY = 'nexus.noiseFilter.v1';

/** ligado = Krisp ativo · basico = só o do navegador · desligado = escolhido pela pessoa */
export type NoiseState = 'ligado' | 'basico' | 'desligado' | 'carregando';

export function readNoisePref(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveNoisePref(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // sem armazenamento: vale só nesta sessão
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Liga ou desliga o anti-ruído no microfone da call (um pedido de cada vez). */
export function applyNoiseFilter(room: Room, on: boolean): Promise<NoiseState> {
  const run = queue.catch(() => undefined).then(() => apply(room, on));
  queue = run;
  return run;
}

async function apply(room: Room, on: boolean): Promise<NoiseState> {
  const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined;
  if (!track) return on ? 'carregando' : 'desligado';
  const current = track.getProcessor();
  if (!on) {
    if (current) await track.stopProcessor();
    return 'desligado';
  }
  let krisp: typeof import('./krisp');
  try {
    krisp = await import('./krisp');
  } catch {
    return 'basico';
  }
  if (!krisp.isKrispNoiseFilterSupported()) return 'basico';
  type Krisp = ReturnType<typeof krisp.KrispNoiseFilter>;
  let proc = current && current.name === 'livekit-noise-filter' ? (current as unknown as Krisp) : null;
  if (!proc) {
    proc = krisp.KrispNoiseFilter();
    await track.setProcessor(proc);
  }
  // A LiveKit confere se o projeto tem o anti-ruído liberado e então liga o filtro.
  for (let i = 0; i < 40 && !proc.isEnabled(); i++) await new Promise((r) => setTimeout(r, 250));
  if (proc.isEnabled()) return 'ligado';
  // Não ligou: tira o filtro para voltar o anti-ruído do navegador (o Krisp o desativa).
  await track.stopProcessor().catch(() => undefined);
  return 'basico';
}
