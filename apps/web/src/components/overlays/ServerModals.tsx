import { useEffect, useState } from 'react';
import { Check, Copy, Hash, Lock, MessageSquare, Search, Trash2, Users, Volume2 } from 'lucide-react';
import { useApp, displayNameFor } from '../../store/app';
import { useSession } from '../../store/session';
import { toast } from '../../store/toast';
import { sb, currentConfig } from '../../lib/supabase';
import { publicAppUrl } from '../../config';
import { formatDate } from '../../lib/format';
import type { Channel, Profile } from '../../types/db';
import { Avatar, Button, cx, Field, Input, Modal, Notice, Select, Spinner, Textarea, Toggle } from '../ui';
import { ServerIcon } from '../layout/ServerArt';

// ---------------------------------------------------------------------
// Criar servidor
// ---------------------------------------------------------------------
export function CreateServerModal() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  const me = useSession((s) => s.me);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<'estudio' | 'simples'>('estudio');
  const [busy, setBusy] = useState(false);
  const open = modal?.kind === 'createServer';

  useEffect(() => {
    if (open) setName(me ? `Servidor de ${me.display_name}` : '');
  }, [open, me]);

  const create = async () => {
    setBusy(true);
    const { data, error } = await sb().rpc('create_server', { p_name: name.trim(), p_template: template, p_is_public: false });
    setBusy(false);
    if (error) return toast.error(error);
    setModal(null);
    await useApp.getState().reloadServers();
    await useApp.getState().selectServer(data as string);
    toast.success('Servidor criado!', 'Convide sua equipe pelo menu do servidor.');
  };

  return (
    <Modal
      open={open}
      onClose={() => setModal(null)}
      title="Criar servidor"
      description="O servidor é o espaço da sua equipe: canais, calls, projetos, arquivos e finanças."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => setModal({ kind: 'joinServer' })}>
            Tenho um convite
          </Button>
          <Button onClick={() => void create()} loading={busy} disabled={name.trim().length < 2}>
            Criar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome do servidor">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="ALPHA - Templo da Magia" />
        </Field>
        <div className="grid sm:grid-cols-2 gap-2">
          {[
            { key: 'estudio' as const, title: 'Estúdio de jogos', desc: 'Canais geral, anúncios, desenvolvimento, ideias, bugs e equipe; 4 salas de voz; cargos Desenvolvedor, Scripter, Modelador e Tester.' },
            { key: 'simples' as const, title: 'Simples', desc: 'Só #geral e uma sala de voz. Você monta o resto.' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTemplate(t.key)}
              className={cx('text-left rounded-xl border p-3.5 transition-colors', template === t.key ? 'border-accent bg-accent/10' : 'border-line hover:border-[#33405a]')}
            >
              <div className="font-semibold text-sm">{t.title}</div>
              <div className="text-[12.5px] text-fg-2 mt-1">{t.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Entrar em servidor (convite ou públicos)
// ---------------------------------------------------------------------
interface PublicServer {
  id: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  member_count: number;
}

export function JoinServerModal() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  const servers = useApp((s) => s.servers);
  const open = modal?.kind === 'joinServer';
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<{ name: string; member_count: number; valid: boolean; reason: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [publicList, setPublicList] = useState<PublicServer[] | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setCode(modal?.kind === 'joinServer' ? modal.code ?? '' : '');
    setPreview(null);
    void sb()
      .rpc('public_servers', { p_search: null })
      .then(({ data }) => setPublicList((data ?? []) as PublicServer[]));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const extract = (v: string) => {
    const m = /(?:invite[/=]|#convite=|^)([A-Za-z0-9]{4,32})\s*$/.exec(v.trim());
    return m ? m[1] : v.trim();
  };

  useEffect(() => {
    const c = extract(code);
    if (c.length < 4) {
      setPreview(null);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await sb().rpc('preview_invite', { p_code: c });
      const row = (data as Array<{ name: string; member_count: number; valid: boolean; reason: string | null }> | null)?.[0];
      setPreview(row ?? { name: '', member_count: 0, valid: false, reason: 'Convite não encontrado' });
    }, 300);
    return () => clearTimeout(t);
  }, [code]);

  const join = async (fn: () => PromiseLike<{ data: unknown; error: unknown }>) => {
    setBusy(true);
    const { data, error } = await fn();
    setBusy(false);
    if (error) return toast.error(error);
    setModal(null);
    await useApp.getState().reloadServers();
    await useApp.getState().selectServer(data as string);
  };

  return (
    <Modal open={open} onClose={() => setModal(null)} title="Entrar em um servidor" size="lg">
      <div className="space-y-5">
        <div>
          <Field label="Convite" hint="Cole o link ou o código que você recebeu.">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ex.: aB3dE5fG7h ou https://…#convite=aB3dE5fG7h" />
          </Field>
          {preview ? (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-[#0d1118] p-3">
              <ServerIcon name={preview.name || '?'} size={40} className="rounded-xl" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{preview.name || 'Convite inválido'}</div>
                <div className="text-[12px] text-fg-3">{preview.valid ? `${preview.member_count} membros` : preview.reason}</div>
              </div>
              <Button disabled={!preview.valid} loading={busy} onClick={() => void join(() => sb().rpc('join_server_by_invite', { p_code: extract(code) }))}>
                Entrar
              </Button>
            </div>
          ) : null}
        </div>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-fg-2">Servidores públicos</span>
            <div className="relative ml-auto">
              <Search className="size-4 text-fg-3 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filtrar" className="!h-8 pl-8 w-40 text-[13px]" />
            </div>
          </div>
          {publicList === null ? (
            <Spinner />
          ) : publicList.length === 0 ? (
            <p className="text-sm text-fg-3">Nenhum servidor público ainda.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto nx-scroll">
              {publicList
                .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
                .map((s) => {
                  const joined = servers.some((x) => x.id === s.id);
                  return (
                    <div key={s.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                      <ServerIcon name={s.name} url={s.icon_url} size={40} className="rounded-xl" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{s.name}</div>
                        <div className="text-[12px] text-fg-3 truncate">
                          {s.member_count} membros{s.description ? ` · ${s.description}` : ''}
                        </div>
                      </div>
                      <Button size="sm" variant={joined ? 'secondary' : 'primary'} onClick={() => (joined ? (setModal(null), void useApp.getState().selectServer(s.id)) : void join(() => sb().rpc('join_public_server', { p_server: s.id })))}>
                        {joined ? 'Abrir' : 'Entrar'}
                      </Button>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Convidar
// ---------------------------------------------------------------------
export function InviteModal() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  const me = useSession((s) => s.userId);
  const open = modal?.kind === 'invite';
  const serverId = open ? modal.serverId : null;
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const [code, setCode] = useState<string | null>(null);
  const [expires, setExpires] = useState('7');
  const [maxUses, setMaxUses] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!serverId) return;
    setBusy(true);
    const expiresAt = expires === 'never' ? null : new Date(Date.now() + Number(expires) * 86400000).toISOString();
    const { data, error } = await sb()
      .from('invites')
      .insert({ server_id: serverId, created_by: me, expires_at: expiresAt, max_uses: maxUses ? Number(maxUses) : null })
      .select('code')
      .single();
    setBusy(false);
    if (error) return toast.error(error);
    setCode((data as { code: string }).code);
  };

  useEffect(() => {
    if (open) {
      setCode(null);
      setCopied(false);
      void generate();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = publicAppUrl(currentConfig());
  const link = code ? (base ? `${base}#convite=${code}` : code) : '';

  return (
    <Modal open={open} onClose={() => setModal(null)} title={`Convidar para ${server?.name ?? 'o servidor'}`} description="Quem receber o link cria a conta (se ainda não tiver) e entra no servidor.">
      <div className="space-y-4">
        <div className="flex gap-2">
          <Input readOnly value={busy ? 'Gerando…' : link} onFocus={(e) => e.target.select()} />
          <Button
            variant={copied ? 'success' : 'primary'}
            icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            disabled={!code}
            onClick={() => {
              void navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
        {code ? (
          <p className="text-[12.5px] text-fg-3">
            Código: <b className="text-fg-2 tracking-wide">{code}</b> — também pode ser digitado em “Entrar em um servidor”.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expira em">
            <Select value={expires} onChange={(e) => setExpires(e.target.value)}>
              <option value="1">1 dia</option>
              <option value="7">7 dias</option>
              <option value="30">30 dias</option>
              <option value="never">Nunca</option>
            </Select>
          </Field>
          <Field label="Máximo de usos">
            <Select value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
              <option value="">Sem limite</option>
              <option value="1">1</option>
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="25">25</option>
            </Select>
          </Field>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void generate()} loading={busy}>
          Gerar novo link com essas opções
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Criar / editar canal
// ---------------------------------------------------------------------
export function ChannelModal() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  const open = modal?.kind === 'channel';
  const serverId = open ? modal.serverId : '';
  const editing = useApp((s) => (open && modal.channelId ? s.channels[serverId]?.find((c) => c.id === modal.channelId) : undefined));
  const roles = useApp((s) => s.roles[serverId]) ?? [];
  const [kind, setKind] = useState<'text' | 'voice'>('text');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [claude, setClaude] = useState(true);
  const [limit, setLimit] = useState('');
  const [allowed, setAllowed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(editing?.kind ?? (modal.kind === 'channel' ? modal.channelKind ?? 'text' : 'text'));
    setName(editing?.name ?? '');
    setTopic(editing?.topic ?? '');
    setPrivate(editing?.is_private ?? false);
    setClaude(editing?.claude_enabled ?? true);
    setLimit(editing?.user_limit ? String(editing.user_limit) : '');
    setAllowed([]);
    if (editing?.is_private) {
      void sb()
        .from('channel_access')
        .select('role_id')
        .eq('channel_id', editing.id)
        .then(({ data }) => setAllowed((data ?? []).map((r) => (r as { role_id: string | null }).role_id).filter(Boolean) as string[]));
    }
  }, [open, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const normalized = kind === 'text' ? name.trim().toLowerCase().replace(/\s+/g, '-') : name.trim();

  const save = async () => {
    setBusy(true);
    const payload = {
      name: normalized,
      topic: topic.trim() || null,
      is_private: isPrivate,
      claude_enabled: claude,
      user_limit: kind === 'voice' && limit ? Number(limit) : null,
    };
    let channel: Channel | null = null;
    if (editing) {
      const { data, error } = await sb().from('channels').update(payload).eq('id', editing.id).select('*').single();
      if (error) {
        setBusy(false);
        return toast.error(error);
      }
      channel = data as Channel;
    } else {
      const maxPos = Math.max(0, ...(useApp.getState().channels[serverId] ?? []).map((c) => c.position));
      const { data, error } = await sb()
        .from('channels')
        .insert({ ...payload, server_id: serverId, kind, position: maxPos + 1 })
        .select('*')
        .single();
      if (error) {
        setBusy(false);
        return toast.error(error);
      }
      channel = data as Channel;
    }
    if (channel && isPrivate) {
      await sb().from('channel_access').delete().eq('channel_id', channel.id).not('role_id', 'is', null);
      if (allowed.length) await sb().from('channel_access').insert(allowed.map((role_id) => ({ channel_id: channel!.id, role_id })));
    }
    setBusy(false);
    useApp.getState().upsertChannel(channel!);
    setModal(null);
    if (!editing && channel!.kind === 'text') useApp.getState().openChannel(serverId, channel!.id);
  };

  const remove = async () => {
    if (!editing || !confirm(`Excluir o canal "${editing.name}" e todas as mensagens dele?`)) return;
    const { error } = await sb().from('channels').delete().eq('id', editing.id);
    if (error) return toast.error(error);
    useApp.getState().removeChannel(editing.id);
    setModal(null);
  };

  return (
    <Modal
      open={open}
      onClose={() => setModal(null)}
      title={editing ? 'Editar canal' : 'Criar canal'}
      footer={
        <>
          {editing ? (
            <Button variant="ghost" className="mr-auto !text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>
              Excluir
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => setModal(null)}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!normalized}>
            {editing ? 'Salvar' : 'Criar canal'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!editing ? (
          <div className="grid grid-cols-2 gap-2">
            {(['text', 'voice'] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)} className={cx('rounded-xl border p-3 text-left', kind === k ? 'border-accent bg-accent/10' : 'border-line')}>
                <div className="flex items-center gap-2 font-medium text-sm">
                  {k === 'text' ? <Hash className="size-4" /> : <Volume2 className="size-4" />} {k === 'text' ? 'Texto' : 'Voz'}
                </div>
                <div className="text-[12px] text-fg-3 mt-0.5">{k === 'text' ? 'Mensagens, imagens, arquivos' : 'Call com áudio, vídeo e tela'}</div>
              </button>
            ))}
          </div>
        ) : null}
        <Field label="Nome" hint={kind === 'text' && name !== normalized && name ? `Será salvo como #${normalized}` : undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={48} placeholder={kind === 'text' ? 'novo-canal' : 'Sala de voz'} />
        </Field>
        {kind === 'text' ? (
          <Field label="Descrição">
            <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} maxLength={300} />
          </Field>
        ) : (
          <Field label="Limite de pessoas">
            <Select value={limit} onChange={(e) => setLimit(e.target.value)}>
              <option value="">Sem limite</option>
              {[2, 4, 5, 8, 10, 15, 25].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Toggle checked={isPrivate} onChange={setPrivate} label={<span className="flex items-center gap-1.5"><Lock className="size-4" /> Canal privado</span>} description="Só cargos escolhidos (e quem gerencia canais) veem este canal." />
        {isPrivate ? (
          <div className="flex flex-wrap gap-2">
            {roles
              .filter((r) => !r.is_default)
              .map((r) => (
                <button
                  key={r.id}
                  onClick={() => setAllowed(allowed.includes(r.id) ? allowed.filter((x) => x !== r.id) : [...allowed, r.id])}
                  className={cx('h-8 px-3 rounded-full border text-[13px]', allowed.includes(r.id) ? 'border-accent bg-accent/15 text-fg' : 'border-line text-fg-2')}
                >
                  <span className="inline-block size-2 rounded-full mr-1.5" style={{ background: r.color ?? '#6c7486' }} />
                  {r.name}
                </button>
              ))}
          </div>
        ) : null}
        {kind === 'text' ? <Toggle checked={claude} onChange={setClaude} label="Permitir @Claude neste canal" description="Quem tem o cargo com “Usar o Claude” pode chamá-lo aqui." /> : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Nova mensagem privada
// ---------------------------------------------------------------------
export function NewDmModal() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  const members = useApp((s) => s.members);
  const profiles = useApp((s) => s.profiles);
  const servers = useApp((s) => s.servers);
  const me = useSession((s) => s.userId);
  const open = modal?.kind === 'newDm';
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setSelected([]);
    for (const s of servers) void useApp.getState().loadServer(s.id);
  }, [open, servers]);

  const people: Profile[] = Array.from(new Set(Object.values(members).flat().map((m) => m.user_id)))
    .filter((id) => id !== me)
    .map((id) => profiles[id])
    .filter((p): p is Profile => !!p)
    .filter((p) => !q || p.display_name.toLowerCase().includes(q.toLowerCase()) || p.username.includes(q.toLowerCase()))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const start = async () => {
    setBusy(true);
    try {
      if (selected.length === 1) {
        await useApp.getState().startDmWith(selected[0]);
      } else {
        const { data, error } = await sb().rpc('create_group_dm', { p_users: selected, p_name: null });
        if (error) throw error;
        await useApp.getState().reloadDms();
        useApp.getState().openDm(data as string);
      }
      setModal(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => setModal(null)}
      title="Nova mensagem privada"
      description="Você pode conversar com quem participa de algum servidor com você."
      footer={
        <Button onClick={() => void start()} disabled={!selected.length} loading={busy} icon={<MessageSquare className="size-4" />}>
          {selected.length > 1 ? `Criar grupo (${selected.length + 1})` : 'Abrir conversa'}
        </Button>
      }
    >
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pessoas" className="mb-3" />
      <div className="max-h-80 overflow-y-auto nx-scroll space-y-1">
        {people.length === 0 ? <p className="text-sm text-fg-3 py-4 text-center">Ninguém encontrado. Convide pessoas para um servidor primeiro.</p> : null}
        {people.map((p) => {
          const on = selected.includes(p.id);
          return (
            <button key={p.id} onClick={() => setSelected(on ? selected.filter((x) => x !== p.id) : [...selected, p.id].slice(0, 9))} className={cx('w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left', on ? 'bg-accent/12' : 'hover:bg-raised/60')}>
              <Avatar name={p.display_name} url={p.avatar_url} size={34} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate">{p.display_name}</span>
                <span className="block text-[12px] text-fg-3">@{p.username}</span>
              </span>
              <span className={cx('size-5 rounded-md border flex items-center justify-center', on ? 'bg-accent border-accent' : 'border-line')}>{on ? <Check className="size-3.5 text-white" /> : null}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Perfil de alguém
// ---------------------------------------------------------------------
export function ProfileModal() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  const open = modal?.kind === 'profile';
  const userId = open ? modal.userId : null;
  const serverId = open ? modal.serverId ?? null : null;
  const profile = useApp((s) => (userId ? s.profiles[userId] : undefined));
  const roles = useApp((s) => (serverId ? s.roles[serverId] : undefined)) ?? [];
  const memberRoles = useApp((s) => (serverId ? s.memberRoles[serverId] : undefined)) ?? [];
  const member = useApp((s) => (serverId ? s.members[serverId]?.find((m) => m.user_id === userId) : undefined));
  const me = useSession((s) => s.userId);

  useEffect(() => {
    if (userId) void useApp.getState().ensureProfiles([userId]);
  }, [userId]);

  const myRoles = roles.filter((r) => memberRoles.some((mr) => mr.user_id === userId && mr.role_id === r.id));

  return (
    <Modal open={open} onClose={() => setModal(null)} size="sm" bare>
      {profile ? (
        <div>
          <div className="h-24 rounded-t-2xl" style={{ background: `linear-gradient(135deg, ${profile.accent_color ?? '#5b7cff'}, #8b5cf6)` }} />
          <div className="px-5 pb-5 -mt-10">
            <Avatar name={profile.display_name} url={profile.avatar_url} size={80} className="ring-[6px] ring-[#131822] rounded-full" />
            <h2 className="text-xl font-bold mt-2">{member?.nickname ?? profile.display_name}</h2>
            <p className="text-sm text-fg-3">@{profile.username}</p>
            {profile.bio ? <p className="text-sm text-fg-2 mt-3 whitespace-pre-wrap">{profile.bio}</p> : null}
            {myRoles.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {myRoles.map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 h-7 text-[12.5px]">
                    <span className="size-2 rounded-full" style={{ background: r.color ?? '#6c7486' }} /> {r.name}
                  </span>
                ))}
              </div>
            ) : null}
            <p className="text-[12px] text-fg-3 mt-3">No NEXUS desde {formatDate(profile.created_at)}</p>
            {userId !== me ? (
              <Button
                className="w-full mt-4"
                icon={<MessageSquare className="size-4" />}
                onClick={async () => {
                  try {
                    await useApp.getState().startDmWith(userId!);
                    setModal(null);
                  } catch (err) {
                    toast.error(err);
                  }
                }}
              >
                Enviar mensagem
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="p-10 flex justify-center">
          <Spinner />
        </div>
      )}
    </Modal>
  );
}

export function useInviteFromUrl() {
  const setModal = useApp((s) => s.setModal);
  useEffect(() => {
    const m = /convite=([A-Za-z0-9]{4,32})/.exec(location.hash);
    if (m) {
      setModal({ kind: 'joinServer', code: m[1] });
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, [setModal]);
}

void Users;
void Notice;
void displayNameFor;
