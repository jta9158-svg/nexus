// Chamadas de voz/vídeo/tela com LiveKit (WebRTC).
// O token de acesso é emitido pela Edge Function "livekit-token", que confere
// se a pessoa pode entrar naquele canal de voz.
import { create } from 'zustand';
import {
  AudioPresets,
  ConnectionQuality,
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
} from 'livekit-client';
import { callFunction } from '../lib/supabase';
import { setVoicePresence } from '../lib/realtime';
import { playPing } from '../lib/notify';
import { friendlyError } from '../lib/errors';
import { hasPerm } from '../lib/permissions';
import { applyNoiseFilter, readNoisePref, saveNoisePref, type NoiseState } from '../lib/noise';
import { DEFAULT_SCREEN_QUALITY, isScreenQuality, pickScreenEncoder, screenShareSettings, type ScreenEncoder, type ScreenQuality } from '../lib/screenShare';
import { startCallKeepAlive, stopCallKeepAlive } from '../lib/callKeepAlive';
import { toast } from './toast';
import { useApp } from './app';

export type AgentState = 'initializing' | 'idle' | 'listening' | 'thinking' | 'speaking' | string;

export interface CallParticipant {
  identity: string;
  name: string;
  isLocal: boolean;
  isAgent: boolean;
  speaking: boolean;
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  quality: ConnectionQuality;
  agentState?: AgentState;
  agentPaused?: boolean;
  agentMuted?: boolean;
}

export { SCREEN_QUALITIES, type ScreenQuality } from '../lib/screenShare';

type Status = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface CallState {
  status: Status;
  error: string | null;
  serverId: string | null;
  channelId: string | null;
  room: Room | null;
  participants: CallParticipant[];
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  deafened: boolean;
  needsAudioUnlock: boolean;
  screenQuality: ScreenQuality;
  /** Codificador em uso no compartilhamento de tela (placa de vídeo ou processador). */
  screenEncoder: ScreenEncoder | null;
  volumes: Record<string, number>;
  claudeBusy: boolean;
  version: number;
  /** Anti-ruído (Krisp) escolhido pela pessoa e a situação real dele na call. */
  noiseOn: boolean;
  noiseState: NoiseState;
  join: (serverId: string, channelId: string) => Promise<void>;
  leave: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  setScreenQuality: (q: ScreenQuality) => Promise<void>;
  toggleDeafen: () => void;
  toggleNoise: () => Promise<void>;
  setVolume: (identity: string, volume: number) => void;
  unlockAudio: () => Promise<void>;
  inviteClaude: () => Promise<void>;
  removeClaude: () => Promise<void>;
  claudeCommand: (action: 'pausar_escuta' | 'retomar_escuta' | 'silenciar' | 'falar') => Promise<void>;
  /** Canal para reconectar sozinho ao voltar para o app, se a call caiu em segundo plano. */
  reconnect: { serverId: string; channelId: string } | null;
  tryReconnect: () => void;
}

const DEVICE_KEY = 'nexus.devices.v1';
const QUALITY_KEY = 'nexus.screenQuality.v1';

export function readDevicePrefs(): { audioinput?: string; audiooutput?: string; videoinput?: string } {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_KEY) || '{}');
  } catch {
    return {};
  }
}

function readQuality(): ScreenQuality {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    return isScreenQuality(q) ? q : DEFAULT_SCREEN_QUALITY;
  } catch {
    return DEFAULT_SCREEN_QUALITY;
  }
}

export function saveDevicePref(kind: 'audioinput' | 'audiooutput' | 'videoinput', deviceId: string): void {
  const cur = readDevicePrefs();
  cur[kind] = deviceId;
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(cur));
  } catch {
    // ignore
  }
  const room = useCall.getState().room;
  if (room) void room.switchActiveDevice(kind, deviceId).catch(() => undefined);
}

// Elementos <audio> das pessoas na call (fora do React).
const audioEls = new Map<string, HTMLMediaElement>();
let audioHost: HTMLDivElement | null = null;

function host(): HTMLDivElement {
  if (!audioHost) {
    audioHost = document.createElement('div');
    audioHost.style.display = 'none';
    audioHost.setAttribute('data-nexus-audio', '');
    document.body.appendChild(audioHost);
  }
  return audioHost;
}

function attachAudio(track: RemoteTrack, sid: string) {
  if (track.kind !== Track.Kind.Audio) return;
  const el = track.attach();
  el.muted = useCall.getState().deafened;
  audioEls.set(sid, el);
  host().appendChild(el);
}

function detachAudio(track: RemoteTrack, sid: string) {
  const el = audioEls.get(sid);
  if (el) {
    track.detach(el);
    el.remove();
    audioEls.delete(sid);
  }
}

function clearAudio() {
  for (const el of audioEls.values()) el.remove();
  audioEls.clear();
}

function describe(p: Participant, isLocal: boolean): CallParticipant {
  const attrs = p.attributes ?? {};
  return {
    identity: p.identity,
    name: p.isAgent ? 'NEXUS IA' : p.name || p.identity,
    isLocal,
    isAgent: p.isAgent,
    speaking: p.isSpeaking,
    micOn: p.isMicrophoneEnabled,
    camOn: p.isCameraEnabled,
    screenOn: p.isScreenShareEnabled,
    quality: p.connectionQuality,
    agentState: p.isAgent ? attrs['lk.agent.state'] : undefined,
    agentPaused: p.isAgent ? attrs['nexus.escuta'] === 'pausada' : undefined,
    agentMuted: p.isAgent ? attrs['nexus.voz'] === 'silenciada' : undefined,
  };
}

function permsFor(serverId: string): string[] {
  return useApp.getState().myPerms[serverId] ?? [];
}

function agentOf(room: Room | null): RemoteParticipant | undefined {
  if (!room) return undefined;
  for (const p of room.remoteParticipants.values()) if (p.isAgent) return p;
  return undefined;
}

export const useCall = create<CallState>((set, get) => {
  const sync = () => {
    const room = get().room;
    if (!room) return;
    const list: CallParticipant[] = [describe(room.localParticipant, true)];
    for (const p of room.remoteParticipants.values()) list.push(describe(p, false));
    const lp = room.localParticipant;
    set({
      participants: list,
      micOn: lp.isMicrophoneEnabled,
      camOn: lp.isCameraEnabled,
      screenOn: lp.isScreenShareEnabled,
      version: get().version + 1,
    });
    publishPresence();
  };

  // Liga/desliga o anti-ruído no microfone atual (também depois de reconectar ou trocar de microfone).
  const applyNoise = async () => {
    const room = get().room;
    if (!room) return;
    const state = await applyNoiseFilter(room, get().noiseOn).catch(() => 'basico' as NoiseState);
    if (get().room === room) set({ noiseState: state });
  };

  const publishPresence = () => {
    const { serverId, channelId, status } = get();
    if (!serverId || !channelId || (status !== 'connected' && status !== 'reconnecting')) return;
    const room = get().room;
    setVoicePresence(serverId, {
      channel_id: channelId,
      muted: !(room?.localParticipant.isMicrophoneEnabled ?? false),
      deafened: get().deafened,
      video: room?.localParticipant.isCameraEnabled ?? false,
      screen: room?.localParticipant.isScreenShareEnabled ?? false,
    });
  };

  return {
    status: 'idle',
    error: null,
    serverId: null,
    channelId: null,
    room: null,
    participants: [],
    micOn: false,
    camOn: false,
    screenOn: false,
    deafened: false,
    needsAudioUnlock: false,
    screenQuality: readQuality(),
    screenEncoder: null,
    volumes: {},
    claudeBusy: false,
    version: 0,
    noiseOn: readNoisePref(),
    noiseState: 'desligado',
    reconnect: null,

    join: async (serverId, channelId) => {
      const cur = get();
      if (cur.channelId === channelId && (cur.status === 'connected' || cur.status === 'connecting')) return;
      if (cur.room) await get().leave();
      set({ status: 'connecting', error: null, serverId, channelId, participants: [], deafened: false, volumes: {}, noiseState: get().noiseOn ? 'carregando' : 'desligado', reconnect: null });
      try {
        const { token, url } = await callFunction<{ token: string; url: string; room: string }>('livekit-token', { channel_id: channelId });
        const prefs = readDevicePrefs();
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
          audioCaptureDefaults: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            deviceId: prefs.audioinput,
          },
          videoCaptureDefaults: { deviceId: prefs.videoinput, resolution: { width: 1280, height: 720, frameRate: 30 } },
          audioOutput: prefs.audiooutput ? { deviceId: prefs.audiooutput } : undefined,
          publishDefaults: {
            // Voz limpa (48 kbps Opus), com proteção contra perda de pacotes
            audioPreset: AudioPresets.music,
            dtx: true,
            red: true,
            videoCodec: 'vp8',
            simulcast: true,
          },
        });
        set({ room });

        room
          .on(RoomEvent.ParticipantConnected, (p) => {
            playPing('join');
            if (p.isAgent) toast.info('NEXUS IA entrou na call', 'Fale "NEXUS IA" e faça a pergunta. Ela não grava a conversa.');
            sync();
          })
          .on(RoomEvent.ParticipantDisconnected, (p) => {
            playPing('leave');
            if (p.isAgent) toast.info('NEXUS IA saiu da call');
            sync();
          })
          .on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
            attachAudio(track, pub.trackSid);
            const v = get().volumes[participant.identity];
            if (v !== undefined) participant.setVolume(v);
            sync();
          })
          .on(RoomEvent.TrackUnsubscribed, (track, pub) => {
            detachAudio(track, pub.trackSid);
            sync();
          })
          .on(RoomEvent.TrackMuted, sync)
          .on(RoomEvent.TrackUnmuted, sync)
          .on(RoomEvent.LocalTrackPublished, (pub) => {
            sync();
            if (pub.source === Track.Source.Microphone) void applyNoise();
          })
          .on(RoomEvent.LocalTrackUnpublished, sync)
          .on(RoomEvent.ActiveSpeakersChanged, sync)
          .on(RoomEvent.ConnectionQualityChanged, sync)
          .on(RoomEvent.ParticipantAttributesChanged, sync)
          .on(RoomEvent.AudioPlaybackStatusChanged, () => set({ needsAudioUnlock: !room.canPlaybackAudio }))
          .on(RoomEvent.Reconnecting, () => set({ status: 'reconnecting' }))
          .on(RoomEvent.Reconnected, () => {
            set({ status: 'connected' });
            sync();
            void applyNoise();
          })
          .on(RoomEvent.MediaDevicesError, (e: Error) => toast.warn('Problema com microfone ou câmera', friendlyError(e)))
          .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
            const wasActive = get().room === room;
            clearAudio();
            if (!wasActive) return;
            setVoicePresence(null, null);
            void stopCallKeepAlive();
            const msg =
              reason === DisconnectReason.DUPLICATE_IDENTITY
                ? 'Você entrou nesta call em outro aparelho.'
                : reason === DisconnectReason.PARTICIPANT_REMOVED
                  ? 'Você foi removido da call.'
                  : reason === DisconnectReason.CLIENT_INITIATED
                    ? null
                    : 'A conexão com a call caiu.';
            // Queda "de verdade" (não foi você que saiu, nem foi removido): guarda o
            // canal para reconectar sozinho quando o app voltar para a frente.
            const dropped =
              reason !== undefined &&
              reason !== DisconnectReason.CLIENT_INITIATED &&
              reason !== DisconnectReason.DUPLICATE_IDENTITY &&
              reason !== DisconnectReason.PARTICIPANT_REMOVED;
            set({
              status: msg ? 'error' : 'idle',
              error: msg,
              room: null,
              participants: [],
              noiseState: 'desligado',
              serverId: msg ? serverId : null,
              channelId: msg ? channelId : null,
              reconnect: dropped ? { serverId, channelId } : null,
            });
          });

        await room.connect(url, token);
        set({ status: 'connected' });
        await room.startAudio().catch(() => set({ needsAudioUnlock: true }));

        if (hasPerm(permsFor(serverId), 'speak')) {
          try {
            await room.localParticipant.setMicrophoneEnabled(true);
            void applyNoise();
          } catch (err) {
            toast.warn('Microfone indisponível', 'Permita o acesso ao microfone para falar. ' + friendlyError(err));
          }
        }
        playPing('join');
        sync();
        void startCallKeepAlive(hasPerm(permsFor(serverId), 'speak'));
      } catch (err) {
        const r = get().room;
        if (r) await r.disconnect().catch(() => undefined);
        clearAudio();
        setVoicePresence(null, null);
        set({ status: 'error', error: friendlyError(err), room: null, participants: [] });
      }
    },

    leave: async () => {
      const room = get().room;
      set({ room: null, reconnect: null });
      clearAudio();
      setVoicePresence(null, null);
      void stopCallKeepAlive();
      if (room && room.state !== ConnectionState.Disconnected) await room.disconnect(true).catch(() => undefined);
      if (room) playPing('leave');
      set({ status: 'idle', error: null, serverId: null, channelId: null, participants: [], micOn: false, camOn: false, screenOn: false, deafened: false, noiseState: 'desligado' });
    },

    tryReconnect: () => {
      const { reconnect, status } = get();
      if (!reconnect || status === 'connecting' || status === 'connected' || status === 'reconnecting') return;
      const { serverId, channelId } = reconnect;
      set({ reconnect: null });
      void get().join(serverId, channelId);
    },

    toggleMic: async () => {
      const { room, serverId } = get();
      if (!room || !serverId) return;
      if (!hasPerm(permsFor(serverId), 'speak')) {
        toast.warn('Sem permissão para falar neste servidor');
        return;
      }
      try {
        await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
        if (get().deafened && room.localParticipant.isMicrophoneEnabled) get().toggleDeafen();
      } catch (err) {
        toast.error(err, 'Não foi possível usar o microfone');
      }
      sync();
    },

    toggleCam: async () => {
      const { room, serverId } = get();
      if (!room || !serverId) return;
      if (!hasPerm(permsFor(serverId), 'video')) {
        toast.warn('Sem permissão para vídeo neste servidor');
        return;
      }
      try {
        await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled);
      } catch (err) {
        toast.error(err, 'Não foi possível usar a câmera');
      }
      sync();
    },

    toggleScreen: async () => {
      const { room, serverId } = get();
      if (!room || !serverId) return;
      if (!hasPerm(permsFor(serverId), 'share_screen')) {
        toast.warn('Sem permissão para compartilhar a tela neste servidor');
        return;
      }
      const enabling = !room.localParticipant.isScreenShareEnabled;
      const q = get().screenQuality;
      const enc = await pickScreenEncoder(q);
      const { capture, publish } = screenShareSettings(q, enc);
      try {
        await room.localParticipant.setScreenShareEnabled(enabling, capture, publish);
        set({ screenEncoder: enabling ? enc : null });
        if (enabling && q === 'maxima' && !enc.hardware) {
          toast.info('Compartilhando a 60 fps pelo processador', 'Este computador não acelera pela placa de vídeo. Se travar, use “Fluida (30 fps)”.');
        }
      } catch (err) {
        const name = (err as Error).name;
        if (name !== 'NotAllowedError' && name !== 'AbortError') toast.error(err, 'Não foi possível compartilhar a tela');
      }
      sync();
    },

    setScreenQuality: async (q) => {
      set({ screenQuality: q });
      try {
        localStorage.setItem(QUALITY_KEY, q);
      } catch {
        // ignore
      }
      // Se já estiver compartilhando, troca a qualidade na hora
      const room = get().room;
      if (room?.localParticipant.isScreenShareEnabled) {
        await room.localParticipant.setScreenShareEnabled(false).catch(() => undefined);
        const enc = await pickScreenEncoder(q);
        const { capture, publish } = screenShareSettings(q, enc);
        set({ screenEncoder: enc });
        await room.localParticipant.setScreenShareEnabled(true, capture, publish).catch((err) => {
          const name = (err as Error).name;
          if (name !== 'NotAllowedError' && name !== 'AbortError') toast.error(err, 'Não foi possível trocar a qualidade da tela');
        });
        sync();
      }
    },

    toggleDeafen: () => {
      const deafened = !get().deafened;
      for (const el of audioEls.values()) el.muted = deafened;
      set({ deafened });
      const room = get().room;
      if (deafened && room?.localParticipant.isMicrophoneEnabled) {
        void room.localParticipant.setMicrophoneEnabled(false).then(sync);
      } else {
        publishPresence();
      }
    },

    toggleNoise: async () => {
      const on = !get().noiseOn;
      saveNoisePref(on);
      set({ noiseOn: on, noiseState: on && get().room ? 'carregando' : 'desligado' });
      await applyNoise();
      const st = get().noiseState;
      if (!get().room) toast.info(on ? 'Anti-ruído ligado' : 'Anti-ruído desligado', 'Vale para as próximas calls.');
      else if (st === 'ligado') toast.success('Anti-ruído ligado', 'Barulho de fundo removido da sua voz.');
      else if (st === 'basico') toast.warn('Anti-ruído avançado indisponível neste aparelho', 'Ficou o anti-ruído básico do navegador.');
      else if (st === 'desligado') toast.info('Anti-ruído desligado');
    },

    setVolume: (identity, volume) => {
      const v = Math.max(0, Math.min(1, volume));
      const p = get().room?.remoteParticipants.get(identity);
      p?.setVolume(v);
      set({ volumes: { ...get().volumes, [identity]: v } });
    },

    unlockAudio: async () => {
      const room = get().room;
      if (!room) return;
      await room.startAudio().catch(() => undefined);
      set({ needsAudioUnlock: !room.canPlaybackAudio });
    },

    inviteClaude: async () => {
      const { channelId } = get();
      if (!channelId || get().claudeBusy) return;
      set({ claudeBusy: true });
      try {
        const r = await callFunction<{ status: string }>('claude-voice', { action: 'invite', channel_id: channelId });
        if (r.status === 'ja_na_call') toast.info('A NEXUS IA já está nesta call');
        else toast.success('Chamando a NEXUS IA…', 'Ela entra em alguns segundos.');
      } catch (err) {
        toast.error(err, 'Não foi possível chamar a NEXUS IA');
      } finally {
        set({ claudeBusy: false });
      }
    },

    removeClaude: async () => {
      const { channelId } = get();
      if (!channelId || get().claudeBusy) return;
      set({ claudeBusy: true });
      try {
        await callFunction('claude-voice', { action: 'remove', channel_id: channelId });
      } catch (err) {
        toast.error(err, 'Não foi possível tirar a NEXUS IA da call');
      } finally {
        set({ claudeBusy: false });
      }
    },

    claudeCommand: async (action) => {
      const room = get().room;
      const agent = agentOf(room);
      if (!room || !agent) return;
      const payload = new TextEncoder().encode(JSON.stringify({ action }));
      await room.localParticipant
        .publishData(payload, { reliable: true, topic: 'nexus-claude', destinationIdentities: [agent.identity] })
        .catch((err) => toast.error(err, 'Não foi possível falar com a NEXUS IA'));
    },
  };
});

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const room = useCall.getState().room;
    if (room) void room.disconnect();
  });
  // Ao voltar para o app (ou a internet voltar), reentra na call que caiu sozinha.
  const resume = () => {
    if (document.visibilityState === 'visible') useCall.getState().tryReconnect();
  };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('focus', resume);
  window.addEventListener('online', () => useCall.getState().tryReconnect());
}
