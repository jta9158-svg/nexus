import { useEffect } from 'react';
import { Hash, Lock, MoreHorizontal, Settings, UserPlus } from 'lucide-react';
import { useApp } from '../../store/app';
import { useClaudeVisible, useSession } from '../../store/session';
import { hasPerm } from '../../lib/permissions';
import { Avatar, EmptyState, IconButton, StatusDot } from '../ui';
import { ViewHeader } from '../layout/ViewHeader';
import { MessageList } from './MessageList';
import { ClaudeAskBox, Composer } from './Composer';

export function ChannelView({ serverId, channelId }: { serverId: string; channelId: string }) {
  const channel = useApp((s) => s.channels[serverId]?.find((c) => c.id === channelId));
  const perms = useApp((s) => s.myPerms[serverId]);
  const setModal = useApp((s) => s.setModal);
  const markRead = useApp((s) => s.markRead);
  const claudeVisible = useClaudeVisible();

  useEffect(() => {
    markRead(channelId);
  }, [channelId, markRead]);

  if (!channel) {
    return <EmptyState title="Canal não encontrado" className="flex-1">Ele pode ter sido apagado ou você perdeu o acesso.</EmptyState>;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ViewHeader
        icon={channel.is_private ? <Lock className="size-5" /> : <Hash className="size-6" />}
        title={channel.name}
        subtitle={channel.topic}
        rightPanel
        actions={
          <>
            {hasPerm(perms, 'create_invites') ? (
              <IconButton label="Convidar pessoas" onClick={() => setModal({ kind: 'invite', serverId })} className="hidden sm:inline-flex">
                <UserPlus className="size-5" />
              </IconButton>
            ) : null}
            {hasPerm(perms, 'manage_channels') ? (
              <IconButton label="Editar canal" onClick={() => setModal({ kind: 'channel', serverId, channelId })}>
                <Settings className="size-5" />
              </IconButton>
            ) : (
              <IconButton label="Mais opções" onClick={() => setModal({ kind: 'invite', serverId })} className="hidden">
                <MoreHorizontal className="size-5" />
              </IconButton>
            )}
          </>
        }
      />
      <MessageList
        target={channelId}
        kind="channel"
        serverId={serverId}
        intro={
          <div className="pb-4 border-b border-line-soft">
            <div className="size-14 rounded-full bg-raised flex items-center justify-center mb-3">
              <Hash className="size-7 text-fg-2" />
            </div>
            <h2 className="text-2xl font-bold">Bem-vindo a #{channel.name}!</h2>
            <p className="text-fg-2 mt-1">Este é o começo do canal{channel.topic ? ` — ${channel.topic}` : '.'}</p>
          </div>
        }
      />
      {channel.claude_enabled && claudeVisible && hasPerm(perms, 'use_claude') ? <ClaudeAskBox target={channelId} serverId={serverId} /> : null}
      <Composer target={channelId} kind="channel" serverId={serverId} placeholder={`Conversar em #${channel.name}`} />
    </div>
  );
}

export function DmView({ threadId }: { threadId: string }) {
  const thread = useApp((s) => s.dms.find((d) => d.id === threadId));
  const profiles = useApp((s) => s.profiles);
  const presence = useApp((s) => s.presence);
  const markRead = useApp((s) => s.markRead);
  const setModal = useApp((s) => s.setModal);
  const me = useSession((s) => s.userId);

  useEffect(() => {
    markRead(threadId);
  }, [threadId, markRead]);

  if (!thread) return <EmptyState title="Conversa não encontrada" className="flex-1" />;
  const others = thread.participants.filter((p) => p !== me);
  const other = profiles[others[0]];
  const online = Object.values(presence).some((m) => !!m[others[0]]);
  const title = thread.is_group ? thread.name || others.map((o) => profiles[o]?.display_name ?? '…').join(', ') : other?.display_name ?? 'Conversa';

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ViewHeader
        icon={
          thread.is_group ? undefined : (
            <button onClick={() => other && setModal({ kind: 'profile', userId: other.id })} aria-label="Ver perfil">
              <Avatar name={other?.display_name ?? '?'} url={other?.avatar_url} size={28} />
            </button>
          )
        }
        title={title}
        subtitle={
          thread.is_group ? (
            `${thread.participants.length} pessoas`
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <StatusDot status={online ? 'online' : 'offline'} className="size-2" /> {online ? 'Online' : 'Offline'} · @{other?.username}
            </span>
          )
        }
      />
      <MessageList
        target={threadId}
        kind="dm"
        serverId={null}
        intro={
          <div className="pb-4 border-b border-line-soft">
            {!thread.is_group && other ? <Avatar name={other.display_name} url={other.avatar_url} size={72} /> : null}
            <h2 className="text-2xl font-bold mt-3">{title}</h2>
            <p className="text-fg-2 mt-1">
              Este é o começo da sua conversa privada{thread.is_group ? ' em grupo' : ` com ${other?.display_name ?? ''}`}. Só quem participa consegue ler.
            </p>
          </div>
        }
      />
      <Composer target={threadId} kind="dm" serverId={null} placeholder={`Mensagem para ${title}`} />
    </div>
  );
}
