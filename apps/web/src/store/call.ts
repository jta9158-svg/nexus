// Chamadas de voz/vídeo/tela com LiveKit (WebRTC).
// O token de acesso é emitido pela Edge Function "livekit-token", que confere
// se a pessoa pode entrar naquele canal de voz.
import { create } from 'zustand';
import {
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
} from 'livekit-client';
import { callFunction } from '../lib/supabase';
import { setVoicePresence } from '../lib/realtime';
import { playPing } from '../lib/notify';
import { friendlyError } from '../lib/errors';
import { hasPerm } from '../lib/permissions';
import { toast } from './toast';
import { useApp } from './app';

export interface CallParticipant {
  identity: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
}

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
  version: number;
  join: (serverId: string, channelId: string) => Promise<void>;
  leave: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  toggleDeafen: () => void;
  unlockAudio: () => Promise<void>;
}

const DEVICE_KEY = 'nexus.devices.v1';

export function readDevicePrefs(): { audioinput?: string; audiooutput?: string; videoinput?: string } {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_KEY) || '{}');
  } catch {
    return {};
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
  return {
    identity: p.identity,
    name: p.name || p.identity,
    isLocal,
    speaking: p.isSpeaking,
    micOn: p.isMicrophoneEnabled,
    camOn: p.isCameraEnabled,
    screenOn: p.isScreenShareEnabled,
  };
}

function permsFor(serverId: string): string[] {
  return useApp.getState().myPerms[serverId] ?? [];
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
    version: 0,

    join: async (serverId, channelId) => {
      const cur = get();
      if (cur.channelId === channelId && (cur.status === 'connected' || cur.status === 'connecting')) return;
      if (cur.room) await get().leave();
      set({ status: 'connecting', error: null, serverId, channelId, participants: [], deafened: false });
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
        });
        set({ room });

        room
          .on(RoomEvent.ParticipantConnected, () => {
            playPing('join');
            sync();
          })
          .on(RoomEvent.ParticipantDisconnected, () => {
            playPing('leave');
            sync();
          })
          .on(RoomEvent.TrackSubscribed, (track, pub) => {
            attachAudio(track, pub.trackSid);
            sync();
          })
          .on(RoomEvent.TrackUnsubscribed, (track, pub) => {
            detachAudio(track, pub.trackSid);
            sync();
          })
          .on(RoomEvent.TrackMuted, sync)
          .on(RoomEvent.TrackUnmuted, sync)
          .on(RoomEvent.LocalTrackPublished, sync)
          .on(RoomEvent.LocalTrackUnpublished, sync)
          .on(RoomEvent.ActiveSpeakersChanged, sync)
          .on(RoomEvent.AudioPlaybackStatusChanged, () => set({ needsAudioUnlock: !room.canPlaybackAudio }))
          .on(RoomEvent.Reconnecting, () => set({ status: 'reconnecting' }))
          .on(RoomEvent.Reconnected, () => {
            set({ status: 'connected' });
            sync();
          })
          .on(RoomEvent.MediaDevicesError, (e: Error) => toast.warn('Problema com microfone ou câmera', friendlyError(e)))
          .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
            const wasActive = get().room === room;
            clearAudio();
            if (!wasActive) return;
            setVoicePresence(null, null);
            const msg =
              reason === DisconnectReason.DUPLICATE_IDENTITY
                ? 'Você entrou nesta call em outro aparelho.'
                : reason === DisconnectReason.PARTICIPANT_REMOVED
                  ? 'Você foi removido da call.'
                  : reason === DisconnectReason.CLIENT_INITIATED
                    ? null
                    : 'A conexão com a call caiu.';
            set({ status: msg ? 'error' : 'idle', error: msg, room: null, participants: [], serverId: msg ? serverId : null, channelId: msg ? channelId : null });
          });

        await room.connect(url, token);
        set({ status: 'connected' });
        await room.startAudio().catch(() => set({ needsAudioUnlock: true }));

        if (hasPerm(permsFor(serverId), 'speak')) {
          try {
            await room.localParticipant.setMicrophoneEnabled(true);
          } catch (err) {
            toast.warn('Microfone indisponível', 'Permita o acesso ao microfone para falar. ' + friendlyError(err));
          }
        }
        playPing('join');
        sync();
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
      set({ room: null });
      clearAudio();
      setVoicePresence(null, null);
      if (room && room.state !== ConnectionState.Disconnected) await room.disconnect(true).catch(() => undefined);
      if (room) playPing('leave');
      set({ status: 'idle', error: null, serverId: null, channelId: null, participants: [], micOn: false, camOn: false, screenOn: false, deafened: false });
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
      try {
        await room.localParticipant.setScreenShareEnabled(enabling, {
          audio: true,
          systemAudio: 'include',
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          contentHint: 'detail',
          resolution: { width: 1920, height: 1080, frameRate: 30 },
        });
      } catch (err) {
        const name = (err as Error).name;
        if (name !== 'NotAllowedError' && name !== 'AbortError') toast.error(err, 'Não foi possível compartilhar a tela');
      }
      sync();
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

    unlockAudio: async () => {
      const room = get().room;
      if (!room) return;
      await room.startAudio().catch(() => undefined);
      set({ needsAudioUnlock: !room.canPlaybackAudio });
    },
  };
});

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const room = useCall.getState().room;
    if (room) void room.disconnect();
  });
}
