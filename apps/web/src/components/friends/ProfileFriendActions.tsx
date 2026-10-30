// Botões do perfil de alguém (como no Discord): mensagem, adicionar amigo,
// aceitar pedido, desfazer amizade, bloquear e desbloquear.
import { useEffect, useState } from 'react';
import { Ban, Check, MessageSquare, UserCheck, UserMinus, UserPlus, X } from 'lucide-react';
import { useApp } from '../../store/app';
import { useSession } from '../../store/session';
import { relationWith, useFriends } from '../../store/friends';
import { toast } from '../../store/toast';
import type { Profile } from '../../types/db';
import { Button } from '../ui';

export function ProfileFriendActions({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const me = useSession((s) => s.userId);
  const loaded = useFriends((s) => s.loaded);
  const rows = useFriends((s) => s.rows);
  const blocked = useFriends((s) => s.blocked);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) void useFriends.getState().load().catch(() => undefined);
  }, [loaded]);

  const rel = relationWith(rows, blocked, me, profile.id);
  const friends = useFriends.getState();
  const name = profile.display_name;

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const add = () =>
    run('add', async () => {
      const r = await friends.send(profile.username);
      if (!r.ok) throw new Error(r.reason ?? 'Não foi possível mandar o pedido.');
      if (r.status === 'aceito') toast.success(`Agora você e ${name} são amigos!`);
      else if (r.status === 'ja_amigos') toast.info('Vocês já são amigos.');
      else toast.success('Pedido de amizade enviado', `Quando ${name} aceitar, vocês aparecem como amigos.`);
    });

  const message = () =>
    run('dm', async () => {
      await useApp.getState().startDmWith(profile.id);
      onDone();
    });

  if (rel.kind === 'bloqueado') {
    return (
      <div className="mt-4 space-y-2">
        <p className="text-[13px] text-fg-3">Você bloqueou esta pessoa. Ela não consegue te mandar pedidos de amizade nem mensagens privadas.</p>
        <Button variant="secondary" className="w-full" loading={busy === 'unblock'} onClick={() => void run('unblock', () => friends.unblock(profile.id), 'Desbloqueado')}>
          Desbloquear
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      {rel.kind === 'recebido' ? (
        <div className="rounded-xl border border-accent/40 bg-accent/10 p-3">
          <p className="text-[13px] text-fg-2 mb-2">{name} te mandou um pedido de amizade.</p>
          <div className="flex gap-2">
            <Button variant="success" size="sm" className="flex-1" icon={<Check className="size-4" />} loading={busy === 'accept'} onClick={() => void run('accept', () => friends.respond(rel.f.id, true), `Agora você e ${name} são amigos!`)}>
              Aceitar
            </Button>
            <Button variant="secondary" size="sm" className="flex-1" icon={<X className="size-4" />} loading={busy === 'decline'} onClick={() => void run('decline', () => friends.respond(rel.f.id, false))}>
              Recusar
            </Button>
          </div>
        </div>
      ) : null}
      <Button className="w-full" icon={<MessageSquare className="size-4" />} loading={busy === 'dm'} onClick={() => void message()}>
        Enviar mensagem
      </Button>
      <div className="flex gap-2">
        {rel.kind === 'nada' ? (
          <Button variant="success" className="flex-1" icon={<UserPlus className="size-4" />} loading={busy === 'add'} onClick={() => void add()}>
            Adicionar amigo
          </Button>
        ) : rel.kind === 'enviado' ? (
          <Button variant="secondary" className="flex-1" icon={<X className="size-4" />} loading={busy === 'cancel'} onClick={() => void run('cancel', () => friends.remove(profile.id), 'Pedido cancelado')}>
            Cancelar pedido
          </Button>
        ) : rel.kind === 'amigos' ? (
          <Button
            variant="secondary"
            className="flex-1"
            icon={<UserMinus className="size-4" />}
            loading={busy === 'remove'}
            onClick={() => confirm(`Desfazer a amizade com ${name}?`) && void run('remove', () => friends.remove(profile.id), 'Amizade desfeita')}
          >
            Desfazer amizade
          </Button>
        ) : null}
        <Button
          variant="ghost"
          className={rel.kind === 'recebido' ? 'flex-1' : ''}
          icon={<Ban className="size-4" />}
          loading={busy === 'block'}
          onClick={() => confirm(`Bloquear ${name}? A amizade é desfeita e vocês não trocam mensagens privadas.`) && void run('block', () => friends.block(profile.id), 'Pessoa bloqueada')}
        >
          Bloquear
        </Button>
      </div>
      {rel.kind === 'enviado' ? <p className="text-[12px] text-fg-3">Pedido de amizade enviado. Aguardando {name} aceitar.</p> : null}
    </div>
  );
}

/** Selo "Amigos" ao lado do nome no perfil. */
export function FriendBadge({ userId }: { userId: string }) {
  const me = useSession((s) => s.userId);
  const rows = useFriends((s) => s.rows);
  const blocked = useFriends((s) => s.blocked);
  if (relationWith(rows, blocked, me, userId).kind !== 'amigos') return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success/15 text-success px-2 h-6 text-[12px] font-semibold align-middle">
      <UserCheck className="size-3.5" /> Amigos
    </span>
  );
}
