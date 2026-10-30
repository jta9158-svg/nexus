// Amigos (como no Discord): adicionar pelo nick, pedidos pendentes, bloqueados.
import { useEffect, useState, type FormEvent } from 'react';
import { Ban, Check, Copy, MessageSquare, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { useApp } from '../../store/app';
import { useSession } from '../../store/session';
import { useFriends, otherOf } from '../../store/friends';
import { toast } from '../../store/toast';
import type { Friendship } from '../../types/db';
import { Avatar, Button, cx, EmptyState, IconButton, Input, Spinner, Tabs } from '../ui';
import { ViewHeader } from '../layout/ViewHeader';

type Tab = 'todos' | 'pendentes' | 'bloqueados' | 'adicionar';

function Person({ userId, children }: { userId: string; children?: React.ReactNode }) {
  const p = useApp((s) => s.profiles[userId]);
  const setModal = useApp((s) => s.setModal);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-line hover:bg-raised/40">
      <button className="flex items-center gap-3 min-w-0 flex-1 text-left" onClick={() => setModal({ kind: 'profile', userId })}>
        <Avatar name={p?.display_name ?? '?'} url={p?.avatar_url} size={38} />
        <span className="min-w-0">
          <span className="block text-sm font-semibold truncate">{p?.display_name ?? 'Carregando…'}</span>
          <span className="block text-[12px] text-fg-3 truncate">@{p?.username ?? '…'}</span>
        </span>
      </button>
      <span className="flex items-center gap-1.5 shrink-0">{children}</span>
    </div>
  );
}

function AddFriend() {
  const me = useSession((s) => s.me);
  const send = useFriends((s) => s.send);
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = nick.trim();
    if (!value) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await send(value);
      if (!r.ok) setResult({ ok: false, text: r.reason ?? 'Não foi possível mandar o pedido.' });
      else if (r.status === 'aceito') setResult({ ok: true, text: 'Vocês agora são amigos! (a pessoa já tinha te mandado um pedido)' });
      else if (r.status === 'ja_amigos') setResult({ ok: true, text: 'Vocês já são amigos.' });
      else if (r.status === 'ja_enviado') setResult({ ok: true, text: 'Você já mandou um pedido para essa pessoa. Agora é só ela aceitar.' });
      else {
        setResult({ ok: true, text: `Pedido enviado para @${value.replace(/^@/, '').toLowerCase()}! Quando aceitar, a pessoa aparece em “Todos”.` });
        setNick('');
      }
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message || 'Não foi possível mandar o pedido.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-bold">Adicionar amigo</h2>
      <p className="text-sm text-fg-2 mt-1">Digite o nome de usuário (o nick) da pessoa. Ela recebe o pedido e, quando aceitar, vocês podem conversar no privado.</p>
      <form onSubmit={submit} className="mt-4 flex flex-col sm:flex-row gap-2">
        <Input
          value={nick}
          onChange={(e) => setNick(e.target.value.replace(/\s/g, ''))}
          placeholder="nome de usuário, ex.: mari_maricota"
          autoCapitalize="none"
          autoCorrect="off"
          autoFocus
          maxLength={33}
          aria-label="Nome de usuário"
          className={cx(result && (result.ok ? '!border-success' : '!border-danger'))}
        />
        <Button type="submit" loading={busy} disabled={!nick.trim()} variant="success" icon={<UserPlus className="size-4" />}>
          Enviar pedido de amizade
        </Button>
      </form>
      {result ? <p className={cx('text-sm mt-2', result.ok ? 'text-success' : 'text-danger')}>{result.text}</p> : null}
      {me ? (
        <div className="mt-6 rounded-xl border border-line p-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[12px] uppercase tracking-wide font-semibold text-fg-3">Seu nick</div>
            <div className="text-[15px] font-semibold truncate">@{me.username}</div>
            <div className="text-[12px] text-fg-3">Mande para os seus amigos te adicionarem.</div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<Copy className="size-4" />}
            onClick={() => void navigator.clipboard.writeText(me.username).then(() => toast.success('Nick copiado'), () => toast.warn('Não deu para copiar'))}
          >
            Copiar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function FriendsView() {
  const me = useSession((s) => s.userId);
  const { loaded, rows, blocked, load, respond, remove, block, unblock } = useFriends();
  const startDmWith = useApp((s) => s.startDmWith);
  const [tab, setTab] = useState<Tab>('todos');

  useEffect(() => {
    void load();
  }, [load]);

  const friends = rows.filter((r) => r.status === 'aceita');
  const incoming = rows.filter((r) => r.status === 'pendente' && r.addressee === me);
  const outgoing = rows.filter((r) => r.status === 'pendente' && r.requester === me);

  useEffect(() => {
    if (loaded && friends.length === 0 && incoming.length === 0 && tab === 'todos') setTab('adicionar');
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<void>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(err);
    }
  };

  const message = (userId: string) =>
    run(async () => {
      await startDmWith(userId);
    });

  const name = (f: Friendship | string) => {
    const id = typeof f === 'string' ? f : otherOf(f);
    return useApp.getState().profiles[id]?.display_name ?? 'esta pessoa';
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ViewHeader
        icon={<Users className="size-5" />}
        title="Amigos"
        actions={
          <Button size="sm" variant={tab === 'adicionar' ? 'secondary' : 'success'} icon={<UserPlus className="size-4" />} onClick={() => setTab('adicionar')}>
            Adicionar amigo
          </Button>
        }
      />
      <div className="px-4 sm:px-6 pt-4">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'todos', label: 'Todos', count: friends.length },
            { value: 'pendentes', label: 'Pendentes', count: incoming.length + outgoing.length },
            { value: 'bloqueados', label: 'Bloqueados', count: blocked.length },
          ]}
        />
      </div>
      <div className="flex-1 overflow-y-auto nx-scroll px-4 sm:px-6 py-4">
        {!loaded ? (
          <Spinner />
        ) : tab === 'adicionar' ? (
          <AddFriend />
        ) : tab === 'todos' ? (
          friends.length === 0 ? (
            <EmptyState icon={<Users className="size-10" />} title="Nenhum amigo ainda" action={<Button onClick={() => setTab('adicionar')}>Adicionar amigo</Button>}>
              Adicione seus amigos pelo nick para conversar no privado.
            </EmptyState>
          ) : (
            <div className="space-y-2 max-w-3xl">
              <div className="text-[12px] uppercase tracking-wide font-semibold text-fg-3">Todos os amigos — {friends.length}</div>
              {friends.map((f) => (
                <Person key={f.id} userId={otherOf(f)}>
                  <IconButton label="Mandar mensagem" size="sm" onClick={() => void message(otherOf(f))}>
                    <MessageSquare className="size-4" />
                  </IconButton>
                  <IconButton
                    label="Desfazer amizade"
                    size="sm"
                    onClick={() => confirm(`Desfazer a amizade com ${name(f)}?`) && void run(() => remove(otherOf(f)), 'Amizade desfeita')}
                  >
                    <UserMinus className="size-4" />
                  </IconButton>
                  <IconButton
                    label="Bloquear"
                    size="sm"
                    tone="danger"
                    onClick={() => confirm(`Bloquear ${name(f)}? A amizade é desfeita e vocês não trocam mensagens privadas.`) && void run(() => block(otherOf(f)), 'Pessoa bloqueada')}
                  >
                    <Ban className="size-4" />
                  </IconButton>
                </Person>
              ))}
            </div>
          )
        ) : tab === 'pendentes' ? (
          incoming.length + outgoing.length === 0 ? (
            <EmptyState icon={<UserPlus className="size-10" />} title="Nenhum pedido pendente">
              Quando alguém te adicionar, o pedido aparece aqui.
            </EmptyState>
          ) : (
            <div className="space-y-5 max-w-3xl">
              {incoming.length ? (
                <div className="space-y-2">
                  <div className="text-[12px] uppercase tracking-wide font-semibold text-fg-3">Recebidos — {incoming.length}</div>
                  {incoming.map((f) => (
                    <Person key={f.id} userId={f.requester}>
                      <IconButton label="Aceitar" size="sm" onClick={() => void run(() => respond(f.id, true), `Agora você e ${name(f)} são amigos!`)}>
                        <Check className="size-4 text-success" />
                      </IconButton>
                      <IconButton label="Recusar" size="sm" onClick={() => void run(() => respond(f.id, false))}>
                        <X className="size-4" />
                      </IconButton>
                    </Person>
                  ))}
                </div>
              ) : null}
              {outgoing.length ? (
                <div className="space-y-2">
                  <div className="text-[12px] uppercase tracking-wide font-semibold text-fg-3">Enviados — {outgoing.length}</div>
                  {outgoing.map((f) => (
                    <Person key={f.id} userId={f.addressee}>
                      <span className="text-[12px] text-fg-3 hidden sm:inline">Aguardando</span>
                      <IconButton label="Cancelar pedido" size="sm" onClick={() => void run(() => remove(f.addressee), 'Pedido cancelado')}>
                        <X className="size-4" />
                      </IconButton>
                    </Person>
                  ))}
                </div>
              ) : null}
            </div>
          )
        ) : blocked.length === 0 ? (
          <EmptyState icon={<Ban className="size-10" />} title="Ninguém bloqueado">
            Bloquear impede pedidos de amizade e mensagens privadas da pessoa.
          </EmptyState>
        ) : (
          <div className="space-y-2 max-w-3xl">
            {blocked.map((id) => (
              <Person key={id} userId={id}>
                <Button size="sm" variant="secondary" onClick={() => void run(() => unblock(id), 'Desbloqueado')}>
                  Desbloquear
                </Button>
              </Person>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
