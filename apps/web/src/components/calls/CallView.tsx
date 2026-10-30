import { useEffect, useRef, useState } from 'react';
import { ConnectionQuality, Track } from 'livekit-client';
import {
  Bot,
  BotOff,
  ChevronUp,
  Ear,
  EarOff,
  Headphones,
  HeadphoneOff,
  Loader2,
  Maximize2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Video,
  VideoOff,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useApp, displayNameFor } from '../../store/app';
import { useClaudeVisible, useSession } from '../../store/session';
import { SCREEN_QUALITIES, useCall, type CallParticipant } from '../../store/call';
import { canShareScreen, desktop, isIOS } from '../../lib/platform';
import type { DesktopScreenSource } from '../../types/desktop';
import { Avatar, Button, ClaudeAvatar, cx, EmptyState, Modal, Notice } from '../ui';
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

const AGENT_STATE: Record<string, string> = {
  initializing: 'entrando…',
  idle: 'ouvindo',
  listening: 'ouvindo',
  thinking: 'pensando…',
  speaking: 'falando',
};

function agentLabel(p: CallParticipant): string {
  if (p.agentPaused) return 'escuta pausada';
  if (p.agentMuted && p.agentState !== 'thinking') return 'em silêncio (só ouvindo)';
  return AGENT_STATE[p.agentState ?? 'idle'] ?? 'na call';
}

function QualityIcon({ q }: { q: ConnectionQuality }) {
  if (q === ConnectionQuality.Excellent) return <SignalHigh className="size-3.5 text-success" aria-label="Conexão excelente" />;
  if (q === ConnectionQuality.Good) return <SignalMedium className="size-3.5 text-warn" aria-label="Conexão boa" />;
  if (q === ConnectionQuality.Poor || q === ConnectionQuality.Lost) return <SignalLow className="size-3.5 text-danger" aria-label="Conexão fraca" />;
  return null;
}

function Tile({ p, serverId, compact }: { p: CallParticipant; serverId: string; compact?: boolean }) {
  const profile = useApp((s) => s.profiles[p.identity]);
  const volume = useCall((s) => s.volumes[p.identity] ?? 1);
  const setVolume = useCall((s) => s.setVolume);
  const [showVolume, setShowVolume] = useState(false);
  const name = p.isAgent ? 'Claude' : displayNameFor(p.identity, serverId) === 'Carregando…' ? p.name : displayNameFor(p.identity, serverId);
  return (
    <div
      className={cx(
        'group relative rounded-2xl overflow-hidden bg-[#0d1118] border flex items-center justify-center',
        compact ? 'h-[120px] w-[180px] shrink-0' : 'min-h-[150px]',
        p.speaking ? 'border-success shadow-[0_0_0_2px_rgb(34_197_94/0.5)]' : p.isAgent ? 'border-accent/50' : 'border-line',
      )}
    >
      {p.isAgent ? (
        <div className="flex flex-col items-center gap-2">
          <ClaudeAvatar size={compact ? 52 : 76} className={cx(p.agentState === 'speaking' && 'animate-pulse')} />
          <span className="text-[12px] text-fg-2">{agentLabel(p)}</span>
        </div>
      ) : p.camOn ? (
        <VideoTrack identity={p.identity} source={Track.Source.Camera} mirror={p.isLocal} />
      ) : (
        <Avatar name={name} url={profile?.avatar_url} size={compact ? 56 : 84} speaking={p.speaking} />
      )}
      <div className="absolute left-2.5 bottom-2.5 flex items-center gap-1.5 rounded-lg bg-black/60 backdrop-blur px-2 py-1 text-[13px] text-white max-w-[calc(100%-20px)]">
        {!p.isAgent && !p.micOn ? <MicOff className="size-3.5 text-danger shrink-0" /> : null}
        {p.isAgent ? <Bot className="size-3.5 shrink-0" /> : null}
        <span className="truncate">
          {name}
          {p.isLocal ? ' (você)' : ''}
        </span>
        {!p.isAgent ? <QualityIcon q={p.quality} /> : null}
      </div>
      {!p.isLocal ? (
        <div className="absolute right-2 top-2 flex items-center gap-1">
          {showVolume ? (
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(e) => setVolume(p.identity, Number(e.target.value) / 100)}
              className="w-24 accent-[#5b7cff]"
              aria-label={`Volume de ${name}`}
            />
          ) : null}
          <button
            onClick={() => setShowVolume((v) => !v)}
            className={cx(
              'size-8 rounded-full bg-black/55 text-white flex items-center justify-center transition-opacity',
              showVolume || volume < 1 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
            )}
            aria-label={`Volume de ${name}`}
            title={`Volume de ${name}: ${Math.round(volume * 100)}%`}
          >
            {volume === 0 ? <VolumeX className="size-4" /> : volume < 0.6 ? <Volume1 className="size-4" /> : <Volume2 className="size-4" />}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Tela compartilhada em destaque, com tela cheia. */
function ScreenStage({ screens, serverId }: { screens: CallParticipant[]; serverId: string }) {
  const [focus, setFocus] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const current = screens.find((s) => s.identity === focus) ?? screens[0];
  const name = (p: CallParticipant) => (displayNameFor(p.identity, serverId) === 'Carregando…' ? p.name : displayNameFor(p.identity, serverId));
  const fullscreen = () => {
    const el = ref.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => undefined);
  };
  return (
    <div className="flex flex-col gap-2 min-h-0">
      {screens.length > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto nx-scroll">
          {screens.map((s) => (
            <button
              key={s.identity}
              onClick={() => setFocus(s.identity)}
              className={cx('px-3 h-8 rounded-full text-[13px] shrink-0', s.identity === current.identity ? 'bg-fg text-ink' : 'bg-raised text-fg-2 hover:text-fg')}
            >
              Tela de {name(s)}
              {s.isLocal ? ' (você)' : ''}
            </button>
          ))}
        </div>
      ) : null}
      <div ref={ref} onDoubleClick={fullscreen} className="relative rounded-2xl overflow-hidden bg-black border border-line aspect-video max-h-[68vh] w-full">
        <VideoTrack identity={current.identity} source={Track.Source.ScreenShare} />
        <div className="absolute left-3 bottom-3 flex items-center gap-1.5 rounded-lg bg-black/60 backdrop-blur px-2 py-1 text-[13px] text-white">
          <MonitorUp className="size-3.5" />
          <span>
            Tela de {name(current)}
            {current.isLocal ? ' (você)' : ''}
          </span>
        </div>
        <button
          onClick={fullscreen}
          className="absolute right-3 top-3 size-9 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
          aria-label="Tela cheia"
          title="Tela cheia (ou dois cliques na tela)"
        >
          <Maximize2 className="size-4" />
        </button>
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
        Incluir o áudio do computador (som do jogo ou do vídeo)
      </label>
    </Modal>
  );
}

function ScreenQualityMenu({ onClose }: { onClose: () => void }) {
  const quality = useCall((s) => s.screenQuality);
  const setQuality = useCall((s) => s.setScreenQuality);
  return (
    <div className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 w-[290px] rounded-2xl border border-line bg-[#11161f] shadow-2xl p-1.5 z-20">
      <div className="px-2.5 pt-1.5 pb-1 text-[12px] font-semibold uppercase tracking-wide text-fg-3">Qualidade da tela</div>
      {SCREEN_QUALITIES.map((q) => (
        <button
          key={q.key}
          onClick={() => {
            void setQuality(q.key);
            onClose();
          }}
          className={cx('w-full text-left rounded-xl px-2.5 py-2 hover:bg-raised', quality === q.key && 'bg-raised')}
        >
          <div className="text-[14px] font-medium flex items-center gap-2">
            {q.label}
            {quality === q.key ? <span className="text-[11px] text-success">em uso</span> : null}
          </div>
          <div className="text-[12px] text-fg-2">{q.description}</div>
        </button>
      ))}
    </div>
  );
}

function ClaudeBar({ agent }: { agent: CallParticipant }) {
  const call = useCall();
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/40 bg-accent/10 px-3 py-2">
      <ClaudeAvatar size={28} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">Claude está na call — {agentLabel(agent)}</div>
        <div className="text-[12px] text-fg-2">Diga “Claude” antes da pergunta. Ele não grava a conversa e não fala de finanças na call.</div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        icon={agent.agentPaused ? <Ear className="size-4" /> : <EarOff className="size-4" />}
        onClick={() => void call.claudeCommand(agent.agentPaused ? 'retomar_escuta' : 'pausar_escuta')}
      >
        {agent.agentPaused ? 'Voltar a ouvir' : 'Pausar escuta'}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        icon={agent.agentMuted ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        onClick={() => void call.claudeCommand(agent.agentMuted ? 'falar' : 'silenciar')}
      >
        {agent.agentMuted ? 'Deixar falar' : 'Silenciar'}
      </Button>
      <Button size="sm" variant="danger" icon={<BotOff className="size-4" />} loading={call.claudeBusy} onClick={() => void call.removeClaude()}>
        Tirar da call
      </Button>
    </div>
  );
}

export function CallView({ serverId, channelId }: { serverId: string; channelId: string }) {
  const channel = useApp((s) => s.channels[serverId]?.find((c) => c.id === channelId));
  const presence = useApp((s) => s.presence[serverId]);
  const profiles = useApp((s) => s.profiles);
  const voiceReady = useSession((s) => !!s.appSettings?.voice_agent_ready);
  const claudeVisible = useClaudeVisible();
  const call = useCall();
  const [qualityMenu, setQualityMenu] = useState(false);
  const inThis = call.channelId === channelId && (call.status === 'connected' || call.status === 'reconnecting');
  const connecting = call.channelId === channelId && call.status === 'connecting';

  if (!channel) return <EmptyState title="Canal de voz não encontrado" className="flex-1" />;

  const waiting = Object.values(presence ?? {}).filter((p) => p.voice?.channel_id === channelId);
  const people = inThis ? call.participants : [];
  const screens = people.filter((p) => p.screenOn);
  const agent = people.find((p) => p.isAgent);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ViewHeader
        icon={<Volume2 className="size-5" />}
        title={channel.name}
        subtitle={
          inThis
            ? call.status === 'reconnecting'
              ? 'Reconectando…'
              : `${people.filter((p) => !p.isAgent).length} na chamada${agent ? ' + Claude' : ''}`
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
          <>
            {agent ? <ClaudeBar agent={agent} /> : null}
            {screens.length ? (
              <div className="flex flex-col gap-3">
                <ScreenStage screens={screens} serverId={serverId} />
                <div className="flex gap-3 overflow-x-auto nx-scroll pb-1">
                  {people.map((p) => (
                    <Tile key={p.identity} p={p} serverId={serverId} compact />
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                {people.map((p) => (
                  <Tile key={p.identity} p={p} serverId={serverId} />
                ))}
              </div>
            )}
          </>
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
              <div className="relative flex items-center">
                <ControlButton label={call.screenOn ? 'Parar de compartilhar' : 'Compartilhar tela'} active={call.screenOn} onClick={() => void call.toggleScreen()}>
                  <MonitorUp className="size-5" />
                </ControlButton>
                <button
                  onClick={() => setQualityMenu((v) => !v)}
                  className="ml-0.5 h-8 w-6 rounded-full flex items-center justify-center text-fg-2 hover:text-fg hover:bg-raised"
                  aria-label="Qualidade da tela"
                  title="Qualidade da tela"
                >
                  <ChevronUp className="size-4" />
                </button>
                {qualityMenu ? <ScreenQualityMenu onClose={() => setQualityMenu(false)} /> : null}
              </div>
            ) : null}
            {agent ? (
              <ControlButton label="Tirar o Claude da call" active onClick={() => void call.removeClaude()} disabled={call.claudeBusy}>
                <BotOff className="size-5" />
              </ControlButton>
            ) : !claudeVisible ? null : (
              <ControlButton
                label={voiceReady ? 'Chamar o Claude para a call' : 'Claude na call: o administrador ainda não ativou o serviço de voz'}
                disabled={!voiceReady || call.claudeBusy}
                onClick={() => void call.inviteClaude()}
              >
                {call.claudeBusy ? <Loader2 className="size-5 animate-spin" /> : <Bot className="size-5" />}
              </ControlButton>
            )}
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
