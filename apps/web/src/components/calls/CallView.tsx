import { useEffect, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import {
  Headphones,
  HeadphoneOff,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Bot,
} from 'lucide-react';
import { useApp, displayNameFor } from '../../store/app';
import { useCall, type CallParticipant } from '../../store/call';
import { canShareScreen, desktop, isIOS } from '../../lib/platform';
import type { DesktopScreenSource } from '../../types/desktop';
import { Avatar, Button, cx, EmptyState, Modal, Notice } from '../ui';
import { ViewHeader } from '../layout/ViewHeader';

function VideoTrack({ identity, source, mirror }: { identity: string; source: Track.Source; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const room = useCall((s) => s.room);
  const version = useCall((s) => s.version);
  useEffect(() => {
    const el = ref.current;
    if (!room || !el) return;
    const p = room.localParticipant.identity === identity ? room.localParticipant : room.remoteParticipants.get(identity);
    const track = p?.getTrackPublication(source)?.track;
    if (!track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [room, identity, source, version]);
  return <video ref={ref} className={cx('size-full object-contain bg-black', mirror && '-scale-x-100')} autoPlay playsInline muted />;
}

function Tile({ p, serverId, screen }: { p: CallParticipant; serverId: string; screen?: boolean }) {
  const profile = useApp((s) => s.profiles[p.identity]);
  const name = displayNameFor(p.identity, serverId) === 'Carregando…' ? p.name : displayNameFor(p.identity, serverId);
  return (
    <div
      className={cx(
        'relative rounded-2xl overflow-hidden bg-[#0d1118] border min-h-[150px] flex items-center justify-center',
        p.speaking && !screen ? 'border-success shadow-[0_0_0_2px_rgb(34_197_94/0.5)]' : 'border-line',
        screen && 'col-span-full aspect-video max-h-[62vh]',
      )}
    >
      {screen ? (
        <VideoTrack identity={p.identity} source={Track.Source.ScreenShare} />
      ) : p.camOn ? (
        <VideoTrack identity={p.identity} source={Track.Source.Camera} mirror={p.isLocal} />
      ) : (
        <Avatar name={name} url={profile?.avatar_url} size={84} speaking={p.speaking} />
      )}
      <div className="absolute left-3 bottom-3 flex items-center gap-1.5 rounded-lg bg-black/60 backdrop-blur px-2 py-1 text-[13px] text-white">
        {!screen && !p.micOn ? <MicOff className="size-3.5 text-danger" /> : null}
        {screen ? <MonitorUp className="size-3.5" /> : null}
        <span className="truncate max-w-[180px]">
          {screen ? `Tela de ${name}` : name}
          {p.isLocal ? ' (você)' : ''}
        </span>
      </div>
    </div>
  );
}

export function ScreenPicker() {
  const [sources, setSources] = useState<DesktopScreenSource[] | null>(null);
  const [audio, setAudio] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    return desktop.screenShare.onPickRequest((list) => setSources(list));
  }, []);
  if (!desktop || !sources) return null;
  const respond = (id: string | null) => {
    desktop!.screenShare.respondPick(id, audio);
    setSources(null);
  };
  const screens = sources.filter((s) => s.kind === 'screen');
  const windows = sources.filter((s) => s.kind === 'window');
  return (
    <Modal open onClose={() => respond(null)} title="Compartilhar tela" description="Escolha a tela inteira ou uma janela." size="xl">
      {[{ title: 'Telas', list: screens }, { title: 'Janelas', list: windows }].map((g) =>
        g.list.length ? (
          <div key={g.title} className="mb-4">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-fg-3 mb-2">{g.title}</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {g.list.map((s) => (
                <button key={s.id} onClick={() => respond(s.id)} className="text-left rounded-xl border border-line hover:border-accent bg-[#0d1118] p-2 transition-colors">
                  <img src={s.thumbnail} alt="" className="w-full aspect-video object-cover rounded-lg bg-black" />
                  <span className="mt-1.5 flex items-center gap-1.5 text-[13px] truncate">
                    {s.appIcon ? <img src={s.appIcon} alt="" className="size-4" /> : null}
                    <span className="truncate">{s.name}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null,
      )}
      <label className="flex items-center gap-2 text-sm text-fg-2 mt-2">
        <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} className="accent-[#22c55e] size-4" />
        Incluir o áudio do computador (quem está na call pode ouvir eco)
      </label>
    </Modal>
  );
}

export function CallView({ serverId, channelId }: { serverId: string; channelId: string }) {
  const channel = useApp((s) => s.channels[serverId]?.find((c) => c.id === channelId));
  const presence = useApp((s) => s.presence[serverId]);
  const profiles = useApp((s) => s.profiles);
  const call = useCall();
  const inThis = call.channelId === channelId && (call.status === 'connected' || call.status === 'reconnecting');
  const connecting = call.channelId === channelId && call.status === 'connecting';

  if (!channel) return <EmptyState title="Canal de voz não encontrado" className="flex-1" />;

  const waiting = Object.values(presence ?? {}).filter((p) => p.voice?.channel_id === channelId);
  const screens = inThis ? call.participants.filter((p) => p.screenOn) : [];
  const people = inThis ? call.participants : [];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ViewHeader
        icon={<Volume2 className="size-5" />}
        title={channel.name}
        subtitle={
          inThis
            ? call.status === 'reconnecting'
              ? 'Reconectando…'
              : `${people.length} na chamada`
            : waiting.length
              ? `${waiting.length} na chamada`
              : 'Ninguém na chamada'
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto nx-scroll p-3 sm:p-5">
        {call.error && call.channelId === channelId ? (
          <Notice tone="danger" title="Não foi possível entrar na call" className="mb-4">
            {call.error}
          </Notice>
        ) : null}

        {inThis ? (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {screens.map((p) => (
              <Tile key={`s-${p.identity}`} p={p} serverId={serverId} screen />
            ))}
            {people.map((p) => (
              <Tile key={p.identity} p={p} serverId={serverId} />
            ))}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center gap-5 py-10">
            <div className="flex -space-x-3">
              {waiting.length ? (
                waiting.slice(0, 6).map((p) => (
                  <Avatar key={p.user_id} name={profiles[p.user_id]?.display_name ?? '?'} url={profiles[p.user_id]?.avatar_url} size={64} className="ring-4 ring-surface rounded-full" />
                ))
              ) : (
                <span className="size-16 rounded-full bg-raised flex items-center justify-center">
                  <Volume2 className="size-7 text-fg-2" />
                </span>
              )}
            </div>
            <div>
              <h2 className="text-xl font-semibold">{waiting.length ? `${waiting.map((p) => displayNameFor(p.user_id, serverId)).slice(0, 3).join(', ')} ${waiting.length > 1 ? 'estão' : 'está'} na call` : 'A call está vazia'}</h2>
              <p className="text-fg-2 text-sm mt-1">Áudio, vídeo e tela em tempo real com a sua equipe.</p>
            </div>
            <Button variant="success" size="lg" className="!rounded-full px-8" loading={connecting} onClick={() => void call.join(serverId, channelId)}>
              {connecting ? 'Conectando…' : 'Entrar na chamada'}
            </Button>
            {isIOS ? <p className="text-xs text-fg-3 max-w-sm">No iPhone/iPad dá para falar e ver vídeo, mas o iOS não permite compartilhar a tela pelo navegador.</p> : null}
          </div>
        )}
      </div>

      {inThis ? (
        <div className="shrink-0 border-t border-line-soft px-3 py-3 nx-safe-bottom">
          {call.needsAudioUnlock ? (
            <div className="flex justify-center mb-2">
              <Button size="sm" variant="secondary" icon={<VolumeX className="size-4" />} onClick={() => void call.unlockAudio()}>
                Toque para ativar o som da call
              </Button>
            </div>
          ) : null}
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            <ControlButton label={call.micOn ? 'Silenciar' : 'Ativar microfone'} active={call.micOn} danger={!call.micOn} onClick={() => void call.toggleMic()}>
              {call.micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
            </ControlButton>
            <ControlButton label={call.deafened ? 'Ativar áudio' : 'Desativar áudio'} active={!call.deafened} danger={call.deafened} onClick={() => call.toggleDeafen()}>
              {call.deafened ? <HeadphoneOff className="size-5" /> : <Headphones className="size-5" />}
            </ControlButton>
            <ControlButton label={call.camOn ? 'Desligar câmera' : 'Ligar câmera'} active={call.camOn} onClick={() => void call.toggleCam()}>
              {call.camOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}
            </ControlButton>
            {canShareScreen ? (
              <ControlButton label={call.screenOn ? 'Parar de compartilhar' : 'Compartilhar tela'} active={call.screenOn} onClick={() => void call.toggleScreen()}>
                <MonitorUp className="size-5" />
              </ControlButton>
            ) : null}
            <ControlButton label="Claude na call (requer o serviço de voz — próxima fase)" disabled onClick={() => undefined}>
              <Bot className="size-5" />
            </ControlButton>
            <button
              onClick={() => void call.leave()}
              className="h-12 px-5 rounded-full bg-danger text-white flex items-center gap-2 hover:bg-red-500 font-medium"
              aria-label="Sair da chamada"
            >
              <PhoneOff className="size-5" /> <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      ) : connecting ? (
        <div className="shrink-0 flex items-center justify-center gap-2 py-3 text-sm text-fg-2">
          <Loader2 className="size-4 animate-spin" /> Conectando à call…
        </div>
      ) : null}
    </div>
  );
}

function ControlButton({
  label,
  active,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        'size-12 rounded-full flex items-center justify-center transition-colors disabled:opacity-35',
        danger ? 'bg-danger/15 text-danger hover:bg-danger/25' : active ? 'bg-fg text-ink hover:bg-white' : 'bg-raised text-fg hover:bg-[#262e40]',
      )}
    >
      {children}
    </button>
  );
}
