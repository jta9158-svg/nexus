// Compartilhamento de tela liso e com qualidade (como no Discord):
//  * usa o codificador que a placa de vídeo acelera (AV1, VP9 ou H.264), para
//    não pesar no processador (principalmente jogando ao mesmo tempo);
//  * nos modos de movimento, quando a internet ou o computador apertam, mantém
//    os quadros por segundo (fica liso) e baixa um pouco a resolução;
//  * AV1/VP9 mandam uma resolução só e ajustam os quadros por camadas; com
//    H.264 há uma camada menor com os MESMOS quadros por segundo, para quem vê
//    em janela pequena continuar vendo liso.
import { AudioPresets, VideoPreset, type ScreenShareCaptureOptions, type TrackPublishOptions } from 'livekit-client';

export type ScreenQuality = 'maxima' | 'fluida' | 'nitida' | 'economica';
export const DEFAULT_SCREEN_QUALITY: ScreenQuality = 'fluida';

export const SCREEN_QUALITIES: Array<{ key: ScreenQuality; label: string; description: string }> = [
  { key: 'maxima', label: 'Máxima (60 fps)', description: '1080p a 60 fps — o mais liso, para jogos. Precisa de internet boa (~8 Mb/s de envio).' },
  { key: 'fluida', label: 'Fluida (30 fps)', description: '1080p a 30 fps — liso e bonito (~5 Mb/s). Recomendado.' },
  { key: 'nitida', label: 'Texto nítido', description: 'Até 1440p a 15 fps — letras afiadas para código, textos e o Roblox Studio (~3 Mb/s).' },
  { key: 'economica', label: 'Econômica', description: '720p a 30 fps — para internet fraca ou 4G (~1,5 Mb/s).' },
];

export function isScreenQuality(v: unknown): v is ScreenQuality {
  return v === 'maxima' || v === 'fluida' || v === 'nitida' || v === 'economica';
}

export type ScreenCodec = 'av1' | 'vp9' | 'h264' | 'vp8';
export interface ScreenEncoder {
  codec: ScreenCodec;
  /** true = a placa de vídeo codifica (leve para o processador). */
  hardware: boolean;
}

interface Spec {
  width: number;
  height: number;
  fps: number;
  hint: 'motion' | 'detail';
  degradation: RTCDegradationPreference;
  bitrate: Record<ScreenCodec, number>;
  /** Camada menor (só H.264/VP8): mesma taxa de quadros, parte da internet. */
  layer?: { width: number; height: number; share: number };
}

const SPEC: Record<ScreenQuality, Spec> = {
  maxima: { width: 1920, height: 1080, fps: 60, hint: 'motion', degradation: 'maintain-framerate', bitrate: { av1: 6_000_000, vp9: 7_000_000, h264: 9_000_000, vp8: 8_000_000 }, layer: { width: 1280, height: 720, share: 0.45 } },
  fluida: { width: 1920, height: 1080, fps: 30, hint: 'motion', degradation: 'maintain-framerate', bitrate: { av1: 4_000_000, vp9: 5_000_000, h264: 6_000_000, vp8: 5_500_000 }, layer: { width: 1280, height: 720, share: 0.45 } },
  nitida: { width: 2560, height: 1440, fps: 15, hint: 'detail', degradation: 'maintain-resolution', bitrate: { av1: 2_500_000, vp9: 3_000_000, h264: 4_000_000, vp8: 3_500_000 }, layer: { width: 1280, height: 720, share: 0.4 } },
  economica: { width: 1280, height: 720, fps: 30, hint: 'motion', degradation: 'balanced', bitrate: { av1: 1_200_000, vp9: 1_500_000, h264: 2_000_000, vp8: 1_800_000 } },
};

/** Escolhe o codificador: primeiro os que a placa de vídeo acelera (AV1 > VP9 > H.264). */
export function chooseScreenEncoder(q: ScreenQuality, hardware: Partial<Record<ScreenCodec, boolean>>, canEncode: Set<string>): ScreenEncoder {
  for (const codec of ['av1', 'vp9', 'h264'] as const) {
    if (hardware[codec] && canEncode.has(codec)) return { codec, hardware: true };
  }
  // Sem ajuda da placa de vídeo: 60 fps fica mais leve com H.264; nos outros, VP9 tem mais qualidade por megabit.
  if (q === 'maxima' && canEncode.has('h264')) return { codec: 'h264', hardware: false };
  if (canEncode.has('vp9') || canEncode.size === 0) return { codec: 'vp9', hardware: false };
  return { codec: canEncode.has('h264') ? 'h264' : 'vp8', hardware: false };
}

/** Configuração de captura e envio para a qualidade e o codificador escolhidos. */
export function screenShareSettings(q: ScreenQuality, enc: ScreenEncoder): { capture: ScreenShareCaptureOptions; publish: TrackPublishOptions } {
  const s = SPEC[q];
  const bitrate = s.bitrate[enc.codec];
  const svc = enc.codec === 'av1' || enc.codec === 'vp9';
  return {
    capture: {
      audio: true,
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      contentHint: s.hint,
      resolution: { width: s.width, height: s.height, frameRate: s.fps },
    },
    publish: {
      videoCodec: enc.codec,
      // VP8 de reserva só para quem não consegue ver AV1/VP9 (é ligado só se alguém precisar)
      backupCodec: svc,
      screenShareEncoding: { maxBitrate: bitrate, maxFramerate: s.fps, priority: 'high' },
      screenShareSimulcastLayers: !svc && s.layer ? [new VideoPreset(s.layer.width, s.layer.height, Math.round(bitrate * s.layer.share), s.fps, 'high')] : [],
      degradationPreference: s.degradation,
      // Áudio do computador (jogo, vídeo) com qualidade de música e sem cortes
      audioPreset: AudioPresets.musicHighQualityStereo,
      dtx: false,
      red: false,
    },
  };
}

let probe: Promise<{ hardware: Partial<Record<ScreenCodec, boolean>>; canEncode: Set<string> }> | null = null;

/** Pergunta ao navegador (uma vez) quais codificadores existem e quais a placa de vídeo acelera. */
export function probeScreenEncoders(): Promise<{ hardware: Partial<Record<ScreenCodec, boolean>>; canEncode: Set<string> }> {
  probe ??= (async () => {
    const codecs = typeof RTCRtpSender !== 'undefined' ? (RTCRtpSender.getCapabilities?.('video')?.codecs ?? []) : [];
    const canEncode = new Set(codecs.map((c) => c.mimeType.toLowerCase().replace('video/', '')));
    const hardware: Partial<Record<ScreenCodec, boolean>> = {};
    const mc = typeof navigator !== 'undefined' ? navigator.mediaCapabilities : undefined;
    if (mc?.encodingInfo) {
      await Promise.all(
        (['av1', 'vp9', 'h264'] as const).map(async (c) => {
          try {
            const r = await mc.encodingInfo({ type: 'webrtc', video: { contentType: `video/${c.toUpperCase()}`, width: 1920, height: 1080, bitrate: 8_000_000, framerate: 60 } });
            hardware[c] = r.supported && r.powerEfficient;
          } catch {
            hardware[c] = false;
          }
        }),
      );
    }
    return { hardware, canEncode };
  })();
  return probe;
}

export async function pickScreenEncoder(q: ScreenQuality): Promise<ScreenEncoder> {
  const { hardware, canEncode } = await probeScreenEncoders();
  return chooseScreenEncoder(q, hardware, canEncode);
}

export function encoderLabel(enc: ScreenEncoder): string {
  const name = enc.codec === 'h264' ? 'H.264' : enc.codec.toUpperCase();
  return enc.hardware ? `pela placa de vídeo (${name})` : `pelo processador (${name})`;
}
