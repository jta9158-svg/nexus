import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Ban, Copy, Crown, ImagePlus, KeyRound, Plus, Trash2, UserMinus } from 'lucide-react';
import { useApp, displayNameFor } from '../../store/app';
import { useClaudeVisible, useSession } from '../../store/session';
import { toast } from '../../store/toast';
import { sb } from '../../lib/supabase';
import { publicUrl, randomId, safeFileName } from '../../lib/storage';
import { formatDate } from '../../lib/format';
import { hasPerm, PERMISSIONS, type PermissionInfo } from '../../lib/permissions';
import { inviteLink, randomPin } from '../../lib/invite';
import type { Invite, Role, Server, ServerBan } from '../../types/db';
import { Avatar, Badge, Button, cx, Field, Input, Modal, Notice, Select, Spinner, Tabs, Textarea, Toggle } from '../ui';
import { ServerBanner, ServerIcon } from '../layout/ServerArt';

type Tab = 'geral' | 'cargos' | 'membros' | 'convites' | 'banimentos' | 'claude';

const COLORS = ['#22C55E', '#38BDF8', '#5B7CFF', '#8B5CF6', '#F472B6', '#F59E0B', '#EF4444', '#14B8A6', '#A3ABBA'];

function GeneralTab({ server }: { server: Server }) {
  const me = useSession((s) => s.userId);
  const channels = useApp((s) => s.channels[server.id]) ?? [];
  const members = useApp((s) => s.members[server.id]) ?? [];
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description ?? '');
  const [systemChannel, setSystemChannel] = useState(server.system_channel_id ?? '');
  const [welcome, setWelcome] = useState(server.welcome_messages ?? true);
  const [newOwner, setNewOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const textChannels = channels.filter((c) => c.kind === 'text');

  const save = async (patch: Partial<Server>) => {
    setBusy(true);
    const { data, error } = await sb().from('servers').update(patch).eq('id', server.id).select('*').single();
    setBusy(false);
    if (error) return toast.error(error);
    useApp.getState().upsertServer(data as Server);
    toast.success('Servidor atualizado');
  };

  const upload = async (file: File | undefined, field: 'icon_url' | 'banner_url') => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.warn('Escolha uma imagem');
    if (file.size > 8 * 1024 * 1024) return toast.warn('Imagem grande demais (máx. 8 MB)');
    const path = `${server.id}/${field === 'icon_url' ? 'icone' : 'banner'}-${randomId()}-${safeFileName(file.name)}`;
    const { error } = await sb().storage.from('server-assets').upload(path, file, { contentType: file.type, upsert: true });
    if (error) return toast.error(error);
    await save({ [field]: publicUrl('server-assets', path) } as Partial<Server>);
  };

  const transfer = async () => {
    const target = members.find((m) => m.user_id === newOwner);
    if (!target) return;
    const who = displayNameFor(target.user_id, server.id);
    const typed = prompt(`Transferir o servidor para ${who}? Você deixa de ser o dono (continua como membro).\nDigite o nome do servidor para confirmar:\n${server.name}`);
    if (typed !== server.name) return;
    const { error } = await sb().rpc('transfer_server_ownership', { p_server: server.id, p_new_owner: target.user_id });
    if (error) return toast.error(error);
    useApp.getState().upsertServer({ ...server, owner_id: target.user_id });
    void useApp.getState().refreshMyPerms(server.id);
    toast.success(`${who} agora é o dono do servidor`);
  };

  const remove = async () => {
    const typed = prompt(`Isso apaga o servidor, canais, mensagens, projetos, arquivos e finanças dele. Digite o nome do servidor para confirmar:\n${server.name}`);
    if (typed !== server.name) return;
    const { error } = await sb().from('servers').delete().eq('id', server.id);
    if (error) return toast.error(error);
    useApp.getState().removeServer(server.id);
    useApp.getState().setModal(null);
    toast.success('Servidor excluído');
  };

  return (
    <div className="space-y-5">
      <div className="relative h-28 rounded-2xl overflow-hidden border border-line">
        {server.banner_url ? <img src={server.banner_url} alt="" className="size-full object-cover" /> : <ServerBanner seed={server.id} className="size-full" />}
        <label className="absolute right-2 bottom-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-black/60 text-white text-[13px] cursor-pointer hover:bg-black/75">
          <ImagePlus className="size-4" /> Trocar banner
          <input type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0], 'banner_url')} />
        </label>
      </div>
      <div className="flex items-center gap-4">
        <ServerIcon name={server.name} url={server.icon_url} size={64} className="rounded-2xl" />
        <label className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-line text-sm cursor-pointer hover:bg-raised">
          <ImagePlus className="size-4" /> Trocar ícone
          <input type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0], 'icon_url')} />
        </label>
        {server.icon_url ? (
          <Button size="sm" variant="ghost" onClick={() => void save({ icon_url: null })}>
            Remover ícone
          </Button>
        ) : null}
      </div>
      <Field label="Nome">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
      </Field>
      <Field label="Descrição" hint="Aparece no convite, antes de a pessoa entrar.">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={500} />
      </Field>
      <div className="rounded-xl border border-line p-4 space-y-3">
        <div className="font-semibold text-sm">Mensagens do sistema</div>
        <Field label="Canal" hint="Onde aparece quando alguém entra no servidor.">
          <Select value={systemChannel} onChange={(e) => setSystemChannel(e.target.value)}>
            <option value="">Nenhum (sem avisos)</option>
            {textChannels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Toggle checked={welcome} onChange={setWelcome} label="Avisar quando alguém entrar" description="Mostra “Fulano entrou no servidor” no canal escolhido." />
      </div>
      <Notice tone="info">Só entra no servidor quem recebe um link de convite. O PIN de entrada fica em “Convites”.</Notice>
      <div className="flex justify-end">
        <Button
          loading={busy}
          onClick={() =>
            void save({
              name: name.trim(),
              description: description.trim() || null,
              system_channel_id: systemChannel || null,
              welcome_messages: welcome,
            })
          }
          disabled={name.trim().length < 2}
        >
          Salvar alterações
        </Button>
      </div>
      {server.owner_id === me ? (
        <div className="rounded-xl border border-danger/30 p-4 space-y-4">
          <div className="font-semibold text-danger">Zona de perigo</div>
          <div>
            <div className="text-sm font-medium">Transferir o servidor</div>
            <p className="text-[13px] text-fg-2 mt-0.5">O novo dono passa a controlar tudo, inclusive excluir o servidor.</p>
            <div className="flex gap-2 mt-2">
              <Select value={newOwner} onChange={(e) => setNewOwner(e.target.value)}>
                <option value="">Escolha um membro</option>
                {members
                  .filter((m) => m.user_id !== me)
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {displayNameFor(m.user_id, server.id)}
                    </option>
                  ))}
              </Select>
              <Button variant="secondary" disabled={!newOwner} onClick={() => void transfer()}>
                Transferir
              </Button>
            </div>
          </div>
          <div>
            <div className="text-sm font-medium">Excluir o servidor</div>
            <p className="text-[13px] text-fg-2 mt-0.5">Apaga tudo dele para todos os membros. Não dá para desfazer.</p>
            <Button variant="danger" size="sm" className="mt-2" onClick={() => void remove()}>
              Excluir servidor
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RolesTab({ serverId }: { serverId: string }) {
  const roles = useApp((s) => s.roles[serverId]) ?? [];
  const myPerms = useApp((s) => s.myPerms[serverId]);
  const [selected, setSelected] = useState<string | null>(null);
  const role = roles.find((r) => r.id === selected) ?? roles[0];
  const [draft, setDraft] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(role ? { ...role } : null);
  }, [role?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const claudeOnlyAdmin = useSession((s) => s.appSettings?.claude_admin_only ?? true);
  const groups = useMemo(() => {
    const g = new Map<string, PermissionInfo[]>();
    // Com "Claude só para o administrador", a permissão "Usar o Claude" não vale para ninguém: some da lista.
    for (const p of PERMISSIONS) if (p.key !== 'use_claude' || !claudeOnlyAdmin) g.set(p.group, [...(g.get(p.group) ?? []), p]);
    return Array.from(g.entries());
  }, [claudeOnlyAdmin]);

  const create = async () => {
    const { data, error } = await sb()
      .from('roles')
      .insert({ server_id: serverId, name: 'Novo cargo', color: '#5B7CFF', position: Math.max(1, ...roles.filter((r) => !r.is_default).map((r) => r.position)) - 1, permissions: [] })
      .select('*')
      .single();
    if (error) return toast.error(error);
    useApp.getState().upsertRole(data as Role);
    setSelected((data as Role).id);
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const { data, error } = await sb()
      .from('roles')
      .update({ name: draft.name.trim(), color: draft.color, permissions: draft.permissions, hoist: draft.hoist })
      .eq('id', draft.id)
      .select('*')
      .single();
    setBusy(false);
    if (error) return toast.error(error);
    useApp.getState().upsertRole(data as Role);
    toast.success('Cargo salvo');
  };

  // Ordem dos cargos (o de cima aparece primeiro na lista de membros).
  const moveRole = async (roleId: string, dir: -1 | 1) => {
    const list = roles.filter((r) => !r.is_default);
    const i = list.findIndex((r) => r.id === roleId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const a = list[i];
    const b = list[j];
    let pa = b.position;
    let pb = a.position;
    if (pa === pb) {
      pa = a.position - dir;
      pb = a.position;
    }
    const [ra, rb] = await Promise.all([
      sb().from('roles').update({ position: pa }).eq('id', a.id).select('*').single(),
      sb().from('roles').update({ position: pb }).eq('id', b.id).select('*').single(),
    ]);
    if (ra.error || rb.error) return toast.error(ra.error ?? rb.error);
    useApp.getState().upsertRole(ra.data as Role);
    useApp.getState().upsertRole(rb.data as Role);
  };

  const remove = async () => {
    if (!draft || draft.is_default || !confirm(`Excluir o cargo "${draft.name}"?`)) return;
    const { error } = await sb().from('roles').delete().eq('id', draft.id);
    if (error) return toast.error(error);
    useApp.getState().removeRole(draft.id);
    setSelected(null);
  };

  return (
    <div className="grid sm:grid-cols-[200px_1fr] gap-4">
      <div className="space-y-1">
        {roles.map((r, i) => (
          <div key={r.id} className={cx('group flex items-center rounded-lg', role?.id === r.id ? 'bg-raised' : 'hover:bg-raised/60')}>
            <button
              onClick={() => setSelected(r.id)}
              className={cx('flex-1 min-w-0 h-9 px-2.5 flex items-center gap-2 text-sm text-left', role?.id === r.id ? 'text-fg' : 'text-fg-2')}
            >
              <span className="size-2.5 rounded-full shrink-0" style={{ background: r.color ?? '#6c7486' }} />
              <span className="truncate">{r.name}</span>
            </button>
            {!r.is_default ? (
              <span className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100 pr-1">
                <button className="p-1 text-fg-3 hover:text-fg disabled:opacity-30" disabled={i === 0} onClick={() => void moveRole(r.id, -1)} aria-label={`Subir ${r.name}`} title="Subir">
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  className="p-1 text-fg-3 hover:text-fg disabled:opacity-30"
                  disabled={i >= roles.filter((x) => !x.is_default).length - 1}
                  onClick={() => void moveRole(r.id, 1)}
                  aria-label={`Descer ${r.name}`}
                  title="Descer"
                >
                  <ArrowDown className="size-3.5" />
                </button>
              </span>
            ) : null}
          </div>
        ))}
        <Button size="sm" variant="secondary" className="w-full mt-2" icon={<Plus className="size-4" />} onClick={() => void create()}>
          Novo cargo
        </Button>
      </div>
      {draft ? (
        <div className="space-y-4 min-w-0">
          {draft.is_default ? <Notice tone="info">“@todos” vale para todo mundo do servidor. As permissões dele são a base de cada membro.</Notice> : null}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Nome">
              <Input value={draft.name} disabled={draft.is_default} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={32} />
            </Field>
            {!draft.is_default ? (
              <Field label="Cor">
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {COLORS.map((c) => (
                    <button key={c} onClick={() => setDraft({ ...draft, color: c })} className={cx('size-7 rounded-full border-2', draft.color === c ? 'border-white' : 'border-transparent')} style={{ background: c }} aria-label={`Cor ${c}`} />
                  ))}
                  <label className="relative size-7 rounded-full border-2 border-dashed border-line cursor-pointer overflow-hidden" title="Escolher outra cor" style={{ background: draft.color && !COLORS.includes(draft.color) ? draft.color : undefined }}>
                    <input
                      type="color"
                      value={draft.color ?? '#5b7cff'}
                      onChange={(e) => setDraft({ ...draft, color: e.target.value.toUpperCase() })}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      aria-label="Escolher outra cor"
                    />
                  </label>
                </div>
              </Field>
            ) : null}
          </div>
          {!draft.is_default ? <Toggle checked={draft.hoist} onChange={(v) => setDraft({ ...draft, hoist: v })} label="Mostrar separado na lista de membros" /> : null}
          {groups.map(([group, perms]) => (
            <div key={group}>
              <div className="text-[12px] font-semibold uppercase tracking-wide text-fg-3 mb-1">{group}</div>
              <div className="divide-y divide-line-soft">
                {perms.map((p) => (
                  <Toggle
                    key={p.key}
                    checked={draft.permissions.includes(p.key)}
                    disabled={p.key === 'admin' && !hasPerm(myPerms, 'admin')}
                    onChange={(v) => setDraft({ ...draft, permissions: v ? [...draft.permissions, p.key] : draft.permissions.filter((x) => x !== p.key) })}
                    label={
                      <span className="flex items-center gap-1.5">
                        {p.label}
                        {p.sensitive ? <Badge tone="warn">sensível</Badge> : null}
                      </span>
                    }
                    description={p.description}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="flex justify-between gap-2 sticky bottom-0 bg-[#131822] py-2">
            {!draft.is_default ? (
              <Button variant="ghost" className="!text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>
                Excluir cargo
              </Button>
            ) : (
              <span />
            )}
            <Button loading={busy} onClick={() => void save()}>
              Salvar cargo
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MembersTab({ server }: { server: Server }) {
  const members = useApp((s) => s.members[server.id]) ?? [];
  const roles = useApp((s) => s.roles[server.id]) ?? [];
  const memberRoles = useApp((s) => s.memberRoles[server.id]) ?? [];
  const profiles = useApp((s) => s.profiles);
  const perms = useApp((s) => s.myPerms[server.id]);
  const me = useSession((s) => s.userId);
  const [q, setQ] = useState('');
  const assignable = roles.filter((r) => !r.is_default);

  const toggleRole = async (userId: string, roleId: string, on: boolean) => {
    const res = on
      ? await sb().from('member_roles').insert({ server_id: server.id, user_id: userId, role_id: roleId })
      : await sb().from('member_roles').delete().match({ server_id: server.id, user_id: userId, role_id: roleId });
    if (res.error) return toast.error(res.error);
    if (on) useApp.getState().addMemberRole({ server_id: server.id, user_id: userId, role_id: roleId });
    else useApp.getState().removeMemberRole({ server_id: server.id, user_id: userId, role_id: roleId });
  };

  const kick = async (userId: string) => {
    if (!confirm(`Remover ${displayNameFor(userId, server.id)} do servidor?`)) return;
    const { error } = await sb().from('server_members').delete().match({ server_id: server.id, user_id: userId });
    if (error) return toast.error(error);
    useApp.getState().removeMember(server.id, userId);
  };

  const ban = async (userId: string) => {
    const reason = prompt(`Banir ${displayNameFor(userId, server.id)}? Motivo (opcional):`);
    if (reason === null) return;
    const { error } = await sb().rpc('ban_member', { p_server: server.id, p_user: userId, p_reason: reason || null });
    if (error) return toast.error(error);
    useApp.getState().removeMember(server.id, userId);
  };

  return (
    <div className="space-y-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar membro" />
      <div className="space-y-2">
        {members
          .filter((m) => {
            const p = profiles[m.user_id];
            return !q || p?.display_name.toLowerCase().includes(q.toLowerCase()) || p?.username.includes(q.toLowerCase());
          })
          .map((m) => {
            const p = profiles[m.user_id];
            const isOwner = server.owner_id === m.user_id;
            return (
              <div key={m.user_id} className="rounded-xl border border-line p-3">
                <div className="flex items-center gap-3">
                  <Avatar name={p?.display_name ?? '?'} url={p?.avatar_url} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      {displayNameFor(m.user_id, server.id)}
                      {isOwner ? <Crown className="size-3.5 text-warn" /> : null}
                    </div>
                    <div className="text-[12px] text-fg-3">
                      @{p?.username} · entrou em {formatDate(m.joined_at)}
                    </div>
                  </div>
                  {!isOwner && m.user_id !== me && hasPerm(perms, 'kick_members') ? (
                    <Button size="sm" variant="ghost" icon={<UserMinus className="size-4" />} onClick={() => void kick(m.user_id)} aria-label="Remover" />
                  ) : null}
                  {!isOwner && m.user_id !== me && hasPerm(perms, 'ban_members') ? (
                    <Button size="sm" variant="ghost" className="!text-danger" icon={<Ban className="size-4" />} onClick={() => void ban(m.user_id)} aria-label="Banir" />
                  ) : null}
                </div>
                {!isOwner && hasPerm(perms, 'manage_roles') ? (
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {assignable.map((r) => {
                      const on = memberRoles.some((mr) => mr.user_id === m.user_id && mr.role_id === r.id);
                      return (
                        <button
                          key={r.id}
                          onClick={() => void toggleRole(m.user_id, r.id, !on)}
                          className={cx('h-7 px-2.5 rounded-full border text-[12.5px]', on ? 'border-transparent text-white' : 'border-line text-fg-3 hover:text-fg-2')}
                          style={on ? { background: (r.color ?? '#5b7cff') + 'cc' } : undefined}
                        >
                          {r.name}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function PinCard({ serverId }: { serverId: string }) {
  const [pin, setPin] = useState<string | null | undefined>(undefined);
  const [show, setShow] = useState(false);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await sb().from('server_join_pins').select('pin').eq('server_id', serverId).maybeSingle();
    setPin((data as { pin: string } | null)?.pin ?? null);
  };
  useEffect(() => {
    void load();
  }, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTo = async (value: string) => {
    if (!/^[0-9]{4,8}$/.test(value)) return toast.warn('O PIN precisa ter de 4 a 8 números.');
    setBusy(true);
    const res = pin ? await sb().from('server_join_pins').update({ pin: value }).eq('server_id', serverId) : await sb().from('server_join_pins').insert({ server_id: serverId, pin: value });
    setBusy(false);
    if (res.error) return toast.error(res.error);
    setPin(value);
    setShow(true);
    setCustom('');
    toast.success('PIN salvo', 'Quem entrar pelo link vai precisar dele.');
  };

  const removePin = async () => {
    if (!confirm('Remover o PIN? Qualquer pessoa com o link vai poder entrar.')) return;
    setBusy(true);
    const { error } = await sb().from('server_join_pins').delete().eq('server_id', serverId);
    setBusy(false);
    if (error) return toast.error(error);
    setPin(null);
  };

  if (pin === undefined) return <Spinner />;
  return (
    <div className="rounded-xl border border-line p-4 space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-warn" />
        <span className="font-semibold text-sm flex-1">PIN de entrada</span>
        <Badge tone={pin ? 'warn' : undefined}>{pin ? 'Ligado' : 'Desligado'}</Badge>
      </div>
      <p className="text-[13px] text-fg-2">
        {pin
          ? 'Para entrar, a pessoa precisa do link de convite E do PIN. Depois de 5 erros, ela espera 15 minutos. Só quem gerencia o servidor vê o PIN.'
          : 'Hoje basta o link de convite. Ligue o PIN para exigir também um código de números.'}
      </p>
      {pin ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="text-lg font-bold tracking-[0.3em] px-3 py-1 rounded-lg bg-[#0d1118] border border-line">{show ? pin : '••••••'}</code>
          <Button size="sm" variant="ghost" onClick={() => setShow(!show)}>
            {show ? 'Esconder' : 'Mostrar'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(pin).then(() => toast.success('PIN copiado'))}>
            Copiar
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={pin ? 'secondary' : 'primary'} loading={busy} onClick={() => void setTo(randomPin())}>
          {pin ? 'Gerar outro PIN' : 'Ligar PIN (gerar um)'}
        </Button>
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 8))}
          inputMode="numeric"
          placeholder="ou digite (4 a 8 números)"
          className="!h-8 !w-52 text-[13px]"
        />
        <Button size="sm" variant="secondary" disabled={custom.length < 4} loading={busy} onClick={() => void setTo(custom)}>
          Usar este
        </Button>
        {pin ? (
          <Button size="sm" variant="ghost" className="!text-danger" onClick={() => void removePin()}>
            Remover PIN
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function InvitesTab({ serverId }: { serverId: string }) {
  const perms = useApp((s) => s.myPerms[serverId]);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const load = async () => {
    const { data } = await sb().from('invites').select('*').eq('server_id', serverId).order('created_at', { ascending: false });
    setInvites((data ?? []) as Invite[]);
  };
  useEffect(() => {
    void load();
  }, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async (code: string) => {
    const { error } = await sb().from('invites').delete().eq('code', code);
    if (error) return toast.error(error);
    void load();
  };
  const isOver = (i: Invite) => (i.expires_at && new Date(i.expires_at).getTime() <= Date.now()) || (i.max_uses !== null && i.uses >= i.max_uses);
  return (
    <div className="space-y-4">
      {hasPerm(perms, 'manage_server') ? <PinCard serverId={serverId} /> : null}
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-fg-3 flex-1">Links de convite</span>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => useApp.getState().setModal({ kind: 'invite', serverId })}>
          Novo convite
        </Button>
      </div>
      {invites?.length === 0 ? <p className="text-sm text-fg-3">Nenhum convite. Sem convite, ninguém novo consegue entrar.</p> : null}
      <div className="space-y-2">
        {invites?.map((i) => (
          <div key={i.code} className={cx('flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-sm', isOver(i) && 'opacity-60')}>
            <code className="font-semibold tracking-wide">{i.code}</code>
            <span className="text-fg-3 text-[12.5px] flex-1 min-w-0 truncate">
              {i.uses}
              {i.max_uses ? `/${i.max_uses}` : ''} usos · {isOver(i) ? 'vencido' : i.expires_at ? `expira ${formatDate(i.expires_at)}` : 'não expira'} · por {displayNameFor(i.created_by, serverId)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy className="size-4" />}
              onClick={() => void navigator.clipboard.writeText(inviteLink(i.code)).then(() => toast.success('Link copiado'))}
              aria-label="Copiar link"
            />
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => void remove(i.code)} aria-label="Apagar convite" />
          </div>
        ))}
      </div>
    </div>
  );
}

function BansTab({ serverId }: { serverId: string }) {
  const profiles = useApp((s) => s.profiles);
  const [bans, setBans] = useState<ServerBan[] | null>(null);
  const load = async () => {
    const { data, error } = await sb().from('server_bans').select('*').eq('server_id', serverId).order('created_at', { ascending: false });
    if (error) return toast.error(error);
    const list = (data ?? []) as ServerBan[];
    await useApp.getState().ensureProfiles(list.flatMap((b) => [b.user_id, b.banned_by]));
    setBans(list);
  };
  useEffect(() => {
    void load();
  }, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps
  const unban = async (b: ServerBan) => {
    const who = profiles[b.user_id]?.display_name ?? 'esta pessoa';
    if (!confirm(`Desbanir ${who}? Ela poderá voltar se receber um convite.`)) return;
    const { error } = await sb().from('server_bans').delete().match({ server_id: serverId, user_id: b.user_id });
    if (error) return toast.error(error);
    void load();
  };
  if (!bans) return <Spinner />;
  return (
    <div className="space-y-2">
      {bans.length === 0 ? <p className="text-sm text-fg-3">Ninguém banido.</p> : null}
      {bans.map((b) => {
        const p = profiles[b.user_id];
        return (
          <div key={b.user_id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
            <Avatar name={p?.display_name ?? '?'} url={p?.avatar_url} size={34} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{p?.display_name ?? 'Pessoa'} <span className="text-fg-3 font-normal">@{p?.username}</span></div>
              <div className="text-[12px] text-fg-3 truncate">
                {formatDate(b.created_at)}
                {b.banned_by ? ` · por ${profiles[b.banned_by]?.display_name ?? '…'}` : ''}
                {b.reason ? ` · ${b.reason}` : ''}
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => void unban(b)}>
              Desbanir
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function ClaudeTab({ serverId }: { serverId: string }) {
  const roles = useApp((s) => s.roles[serverId]) ?? [];
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const [ownerIsAdmin, setOwnerIsAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    if (!server) return;
    void sb()
      .from('app_admins')
      .select('user_id')
      .eq('user_id', server.owner_id)
      .then(({ data }) => setOwnerIsAdmin(!!data?.length));
  }, [server]);
  const withClaude = roles.filter((r) => r.permissions.includes('use_claude') || r.permissions.includes('admin'));
  const onlyAdmin = useSession((s) => s.appSettings?.claude_admin_only ?? true);
  if (onlyAdmin) {
    return (
      <div className="space-y-4">
        <Notice tone="info" title="O Claude é só seu">
          Ninguém mais vê o Claude no NEXUS: para as outras pessoas somem o Claude AI, o Companion, o @Claude e o botão de chamar o Claude na call — e o
          servidor também bloqueia. Se você chamar o @Claude num canal ou numa call, quem estiver ali vê ou ouve a resposta.
        </Notice>
        <p className="text-[13px] text-fg-3">Para liberar o Claude para outras pessoas, desligue “Claude só para mim” em Configurações → Administração.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Notice tone="info" title="Quem paga o Claude">
        O uso do Claude é cobrado na chave da API do administrador do NEXUS. Por isso ele só funciona para cargos com “Usar o Claude” em servidores criados pelo administrador (ou pessoas liberadas individualmente nas configurações de administração).
      </Notice>
      {ownerIsAdmin === false ? <Notice tone="warn">O dono deste servidor não é administrador do NEXUS, então o @Claude não responde aqui (exceto para pessoas liberadas individualmente).</Notice> : null}
      <div>
        <div className="text-[12px] font-semibold uppercase tracking-wide text-fg-3 mb-2">Cargos que podem usar o Claude</div>
        {withClaude.length === 0 ? (
          <p className="text-sm text-fg-3">Nenhum. Edite um cargo em “Cargos” e ative “Usar o Claude”.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {withClaude.map((r) => (
              <span key={r.id} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 h-8 text-sm">
                <span className="size-2 rounded-full" style={{ background: r.color ?? '#6c7486' }} /> {r.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ServerSettingsModal() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  const open = modal?.kind === 'serverSettings';
  const serverId = open ? modal.serverId : '';
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const perms = useApp((s) => s.myPerms[serverId]);
  const claudeVisible = useClaudeVisible();
  const [tab, setTab] = useState<Tab>('geral');

  useEffect(() => {
    if (open) setTab(modal.tab ?? (hasPerm(perms, 'manage_server') ? 'geral' : hasPerm(perms, 'manage_roles') ? 'cargos' : 'membros'));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !server) return null;
  const items: Array<{ value: Tab; label: string }> = [];
  if (hasPerm(perms, 'manage_server')) items.push({ value: 'geral', label: 'Geral' });
  if (hasPerm(perms, 'manage_roles')) items.push({ value: 'cargos', label: 'Cargos' });
  items.push({ value: 'membros', label: 'Membros' });
  if (hasPerm(perms, 'create_invites')) items.push({ value: 'convites', label: 'Convites' });
  if (hasPerm(perms, 'ban_members')) items.push({ value: 'banimentos', label: 'Banimentos' });
  if (claudeVisible) items.push({ value: 'claude', label: 'Claude' });

  return (
    <Modal open onClose={() => setModal(null)} title={`Configurações — ${server.name}`} size="xl">
      <Tabs value={tab} onChange={setTab} items={items} className="mb-5" />
      {tab === 'geral' ? <GeneralTab server={server} /> : null}
      {tab === 'cargos' ? <RolesTab serverId={server.id} /> : null}
      {tab === 'membros' ? <MembersTab server={server} /> : null}
      {tab === 'convites' ? <InvitesTab serverId={server.id} /> : null}
      {tab === 'banimentos' ? <BansTab serverId={server.id} /> : null}
      {tab === 'claude' && claudeVisible ? <ClaudeTab serverId={server.id} /> : null}
    </Modal>
  );
}
