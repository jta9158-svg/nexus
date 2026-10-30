import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  Copy,
  Gamepad2,
  Hammer,
  Hash,
  KeyRound,
  Lock,
  MessageSquare,
  Sparkles,
  Trash2,
  Users,
  Volume2,
} from 'lucide-react';
import { useApp, displayNameFor } from '../../store/app';
import { useClaudeVisible, useSession } from '../../store/session';
import { toast } from '../../store/toast';
import { sb } from '../../lib/supabase';
import { friendlyError } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { hasPerm } from '../../lib/permissions';
import { publicUrl, randomId, safeFileName } from '../../lib/storage';
import { nudgeCategory, nudgeChannel } from '../../lib/layout';
import {
  clearInviteFromLocation,
  clearPendingInvite,
  extractInviteCode,
  inviteFromLocation,
  inviteLink,
  isInviteCode,
  peekPendingInvite,
} from '../../lib/invite';
import type { Channel, ChannelCategory, InvitePreview, JoinResult, Member, Profile } from '../../types/db';
import { Avatar, Button, cx, Field, IconButton, Input, Modal, Notice, Select, Spinner, Textarea, Toggle } from '../ui';
import { ServerBanner, ServerIcon } from '../layout/ServerArt';

// ---------------------------------------------------------------------
// Criar servidor (modelos como no Discord)
// ---------------------------------------------------------------------
type TemplateKey = 'simples' | 'amigos' | 'jogos' | 'estudo' | 'estudio';

const TEMPLATES: Array<{ key: TemplateKey; title: string; desc: string; icon: ReactNode }> = [
  { key: 'simples', title: 'Criar do zero', desc: 'Só #geral e uma sala de voz. Você monta o resto.', icon: <Sparkles className="size-5" /> },
  { key: 'amigos', title: 'Amigos', desc: '#geral, #memes, #clipes-e-prints, Bate-papo e Jogando.', icon: <Users className="size-5" /> },
  { key: 'jogos', title: 'Jogos', desc: 'Regras, anúncios, procurando grupo, clipes, Lobby e partidas.', icon: <Gamepad2 className="size-5" /> },
  { key: 'estudo', title: 'Estudo', desc: 'Avisos, materiais, dúvidas, tarefas e salas de estudo.', icon: <BookOpen className="size-5" /> },
  {
    key: 'estudio',
    title: 'Estúdio de jogos (Roblox)',
    desc: 'Desenvolvimento, ideias, bugs, equipe, 4 salas de voz e cargos Desenvolvedor, Scripter, Modelador e Tester.',
    icon: <Hammer className="size-5" />,
  },
];

export function CreateServerModal() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  const me = useSession((s) => s.me);
  const [step, setStep] = useState<'modelo' | 'nome'>('modelo');
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<TemplateKey>('simples');
  const [icon, setIcon] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = modal?.kind === 'createServer';

  useEffect(() => {
    if (!open) return;
    setStep('modelo');
    setName(me ? `Servidor de ${me.display_name}` : '');
    setIcon(null);
    setIconPreview(null);
  }, [open, me]);

  useEffect(() => {
    if (!icon) return;
    const url = URL.createObjectURL(icon);
    setIconPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [icon]);

  const create = async () => {
    setBusy(true);
    const { data, error } = await sb().rpc('create_server', { p_name: name.trim(), p_template: template, p_is_public: false });
    if (error) {
      setBusy(false);
      return toast.error(error);
    }
    const serverId = data as string;
    if (icon) {
      const path = `${serverId}/icone-${randomId()}-${safeFileName(icon.name)}`;
      const up = await sb().storage.from('server-assets').upload(path, icon, { contentType: icon.type, upsert: true });
      if (up.error) toast.warn('O servidor foi criado, mas o ícone não subiu. Troque depois nas configurações.');
      else await sb().from('servers').update({ icon_url: publicUrl('server-assets', path) }).eq('id', serverId);
    }
    setBusy(false);
    await useApp.getState().reloadServers();
    await useApp.getState().selectServer(serverId);
    toast.success('Servidor criado!', 'Mande o link de convite para as pessoas entrarem.');
    setModal({ kind: 'invite', serverId });
  };

  const chosen = TEMPLATES.find((t) => t.key === template)!;

  return (
    <Modal
      open={open}
      onClose={() => setModal(null)}
      title={step === 'modelo' ? 'Crie o seu servidor' : 'Personalize o seu servidor'}
      description={
        step === 'modelo'
          ? 'O servidor é onde você e seus amigos conversam e fazem calls. Só entra quem receber o seu link de convite.'
          : 'Dê um nome e um ícone. Dá para mudar tudo depois.'
      }
      footer={
        step === 'modelo' ? (
          <Button variant="ghost" className="mr-auto" onClick={() => setModal({ kind: 'joinServer' })}>
            Já tem um convite? Entrar em um servidor
          </Button>
        ) : (
          <>
            <Button variant="ghost" className="mr-auto" onClick={() => setStep('modelo')}>
              Voltar
            </Button>
            <Button onClick={() => void create()} loading={busy} disabled={name.trim().length < 2}>
              Criar
            </Button>
          </>
        )
      }
    >
      {step === 'modelo' ? (
        <div className="space-y-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTemplate(t.key);
                setStep('nome');
              }}
              className="w-full flex items-center gap-3 text-left rounded-xl border border-line p-3 hover:border-[#33405a] hover:bg-raised/40 transition-colors"
            >
              <span className="size-10 shrink-0 rounded-xl bg-accent/15 text-mention flex items-center justify-center">{t.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-sm">{t.title}</span>
                <span className="block text-[12.5px] text-fg-2 mt-0.5">{t.desc}</span>
              </span>
              <ChevronRight className="size-4 text-fg-3 shrink-0" />
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-2">
            <label className="relative size-20 rounded-full border-2 border-dashed border-line hover:border-accent cursor-pointer flex items-center justify-center overflow-hidden" title="Escolher ícone">
              {iconPreview ? <img src={iconPreview} alt="" className="size-full object-cover" /> : <Camera className="size-7 text-fg-3" />}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && !f.type.startsWith('image/')) return toast.warn('Escolha uma imagem');
                  if (f && f.size > 5 * 1024 * 1024) return toast.warn('Imagem grande demais (máx. 5 MB)');
                  setIcon(f ?? null);
                }}
              />
            </label>
            <span className="text-[12px] text-fg-3">Ícone (opcional)</span>
          </div>
          <Field label="Nome do servidor">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="ALPHA - Templo da Magia" autoFocus />
          </Field>
          <p className="text-[12.5px] text-fg-3">
            Modelo: <b className="text-fg-2">{chosen.title}</b>
          </p>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Entrar em um servidor (só com o link de convite, + PIN quando pedir)
// ---------------------------------------------------------------------
export function JoinServerModal() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  const open = modal?.kind === 'joinServer';
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState<InvitePreview | null | 'nao-encontrado'>(null);
  const [checking, setChecking] = useState(false);
  const [pin, setPin] = useState('');
  const [needsPin, setNeedsPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const code = extractInviteCode(value);

  useEffect(() => {
    if (!open) return;
    setValue(modal?.kind === 'joinServer' ? modal.code ?? '' : '');
    setPreview(null);
    setPin('');
    setNeedsPin(false);
    setError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!isInviteCode(code)) {
      setPreview(null);
      return;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      const { data } = await sb().rpc('preview_invite', { p_code: code });
      const row = (data as InvitePreview[] | null)?.[0];
      setPreview(row ?? 'nao-encontrado');
      setNeedsPin(!!row?.requires_pin);
      setChecking(false);
    }, 250);
    return () => clearTimeout(t);
  }, [code, open]);

  const enter = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await sb().rpc('join_server', { p_code: code, p_pin: pin.trim() || null });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    const r = data as JoinResult;
    if (!r.ok || !r.server_id) {
      if (r.needs_pin) setNeedsPin(true);
      return setError(r.reason ?? 'Não foi possível entrar agora.');
    }
    clearPendingInvite();
    setModal(null);
    await useApp.getState().reloadServers();
    await useApp.getState().selectServer(r.server_id);
    if (!r.already_member && preview && preview !== 'nao-encontrado') toast.success(`Você entrou em ${preview.name}!`);
  };

  const info = preview && preview !== 'nao-encontrado' ? preview : null;
  const canEnter = !!info && info.valid && (!needsPin || /^[0-9]{4,8}$/.test(pin.trim()));

  return (
    <Modal
      open={open}
      onClose={() => setModal(null)}
      title="Entrar em um servidor"
      description="Cole o link de convite que você recebeu. Só dá para entrar com convite."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => setModal({ kind: 'createServer' })}>
            Criar o meu servidor
          </Button>
          {info?.already_member ? (
            <Button onClick={() => void enter()} loading={busy}>
              Abrir servidor
            </Button>
          ) : (
            <Button onClick={() => void enter()} loading={busy} disabled={!canEnter}>
              Entrar no servidor
            </Button>
          )}
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canEnter || info?.already_member) void enter();
        }}
      >
        <Field label="Link de convite">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://…/app/#convite=aB3dE5fG7h"
            autoFocus={!value}
            autoCapitalize="none"
            autoCorrect="off"
          />
        </Field>
        {checking && !info ? <Spinner /> : null}
        {preview === 'nao-encontrado' ? <Notice tone="warn">Convite não encontrado. Confira o link ou peça um novo.</Notice> : null}
        {info ? (
          <div className="rounded-xl border border-line bg-[#0d1118] overflow-hidden">
            <div className="h-14 relative">
              {info.banner_url ? <img src={info.banner_url} alt="" className="absolute inset-0 size-full object-cover" /> : <ServerBanner seed={info.server_id} className="absolute inset-0 size-full" />}
            </div>
            <div className="px-3.5 pb-3.5 flex gap-3">
              <div className="-mt-6 shrink-0 relative">
                <ServerIcon name={info.name} url={info.icon_url} size={52} className="rounded-2xl ring-4 ring-[#0d1118]" />
              </div>
              <div className="flex-1 min-w-0 pt-2">
                <div className="font-semibold truncate">{info.name}</div>
                <div className="text-[12px] text-fg-3">
                  {info.valid ? `${info.member_count} ${info.member_count === 1 ? 'membro' : 'membros'}` : info.reason}
                  {info.already_member ? ' · você já está aqui' : ''}
                </div>
              </div>
            </div>
            {info.description ? <p className="px-3.5 pb-3.5 text-[13px] text-fg-2 -mt-1">{info.description}</p> : null}
          </div>
        ) : null}
        {info && !info.already_member && needsPin ? (
          <Field label="PIN do servidor" hint="Este servidor pede um PIN. Peça para quem te convidou.">
            <div className="relative">
              <KeyRound className="size-4 text-fg-3 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="pl-9 tracking-[0.3em] font-semibold"
                autoFocus
              />
            </div>
          </Field>
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Convidar (link + PIN quando o servidor tiver)
// ---------------------------------------------------------------------
const EXPIRES: Array<{ value: string; label: string; minutes: number | null }> = [
  { value: '30m', label: '30 minutos', minutes: 30 },
  { value: '1h', label: '1 hora', minutes: 60 },
  { value: '6h', label: '6 horas', minutes: 360 },
  { value: '12h', label: '12 horas', minutes: 720 },
  { value: '1d', label: '1 dia', minutes: 1440 },
  { value: '7d', label: '7 dias', minutes: 10080 },
  { value: 'never', label: 'Nunca', minutes: null },
];

export function InviteModal() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  const me = useSession((s) => s.userId);
  const open = modal?.kind === 'invite';
  const serverId = open ? modal.serverId : null;
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const perms = useApp((s) => (serverId ? s.myPerms[serverId] : undefined));
  const [code, setCode] = useState<string | null>(null);
  const [expires, setExpires] = useState('7d');
  const [maxUses, setMaxUses] = useState('');
  const [copied, setCopied] = useState<'link' | 'tudo' | null>(null);
  const [busy, setBusy] = useState(false);
  const [requiresPin, setRequiresPin] = useState(false);
  const [pin, setPin] = useState<string | null>(null);
  const manager = hasPerm(perms, 'manage_server');

  const checkPin = async (c: string) => {
    const { data } = await sb().rpc('preview_invite', { p_code: c });
    setRequiresPin(!!(data as InvitePreview[] | null)?.[0]?.requires_pin);
    if (manager && serverId) {
      const res = await sb().from('server_join_pins').select('pin').eq('server_id', serverId).maybeSingle();
      setPin((res.data as { pin: string } | null)?.pin ?? null);
    }
  };

  const generate = async (reuse: boolean) => {
    if (!serverId) return;
    setBusy(true);
    setCopied(null);
    if (reuse) {
      // Reaproveita um link seu ainda válido (como o Discord faz).
      const soon = new Date(Date.now() + 86400000).toISOString();
      const { data } = await sb()
        .from('invites')
        .select('code, expires_at, max_uses')
        .eq('server_id', serverId)
        .eq('created_by', me ?? '')
        .is('max_uses', null)
        .or(`expires_at.is.null,expires_at.gt.${soon}`)
        .order('created_at', { ascending: false })
        .limit(1);
      const found = (data as Array<{ code: string; expires_at: string | null }> | null)?.[0];
      if (found) {
        setCode(found.code);
        setExpires(found.expires_at ? '7d' : 'never');
        setMaxUses('');
        setBusy(false);
        void checkPin(found.code);
        return;
      }
    }
    const opt = EXPIRES.find((x) => x.value === expires) ?? EXPIRES[5];
    const expiresAt = opt.minutes === null ? null : new Date(Date.now() + opt.minutes * 60000).toISOString();
    const { data, error } = await sb()
      .from('invites')
      .insert({ server_id: serverId, created_by: me, expires_at: expiresAt, max_uses: maxUses ? Number(maxUses) : null })
      .select('code')
      .single();
    setBusy(false);
    if (error) return toast.error(error);
    const c = (data as { code: string }).code;
    setCode(c);
    void checkPin(c);
  };

  useEffect(() => {
    if (open) {
      setCode(null);
      setCopied(null);
      setExpires('7d');
      setMaxUses('');
      setPin(null);
      setRequiresPin(false);
      void generate(true);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = code ? inviteLink(code) : '';
  const copy = (text: string, what: 'link' | 'tudo') => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(what);
        setTimeout(() => setCopied(null), 2000);
      },
      () => toast.warn('Não deu para copiar. Selecione o texto e copie manualmente.'),
    );
  };
  const fullText = `Entre no servidor ${server?.name ?? ''} no NEXUS: ${link}${pin ? `\nPIN: ${pin}` : ''}`;

  return (
    <Modal
      open={open}
      onClose={() => setModal(null)}
      title={`Convidar para ${server?.name ?? 'o servidor'}`}
      description="Mande este link. Quem abrir cria a conta (se ainda não tiver) e entra no servidor."
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <Input readOnly value={busy ? 'Gerando…' : link} onFocus={(e) => e.target.select()} aria-label="Link de convite" />
          <Button
            variant={copied === 'link' ? 'success' : 'primary'}
            icon={copied === 'link' ? <Check className="size-4" /> : <Copy className="size-4" />}
            disabled={!code}
            onClick={() => copy(link, 'link')}
          >
            {copied === 'link' ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
        {requiresPin ? (
          manager && pin ? (
            <div className="rounded-xl border border-warn/30 bg-warn/[0.07] p-3 flex items-center gap-3">
              <KeyRound className="size-5 text-warn shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-fg-2">Este servidor pede PIN. Mande junto com o link:</div>
                <div className="text-lg font-bold tracking-[0.3em]">{pin}</div>
              </div>
              <Button size="sm" variant={copied === 'tudo' ? 'success' : 'secondary'} onClick={() => copy(fullText, 'tudo')}>
                {copied === 'tudo' ? 'Copiado' : 'Copiar link + PIN'}
              </Button>
            </div>
          ) : (
            <Notice tone="warn">Este servidor pede um PIN para entrar. Quem você convidar vai precisar dele — peça a um administrador do servidor.</Notice>
          )
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expira depois de">
            <Select value={expires} onChange={(e) => setExpires(e.target.value)}>
              {EXPIRES.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Máximo de usos">
            <Select value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
              <option value="">Sem limite</option>
              {[1, 5, 10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'uso' : 'usos'}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void generate(false)} loading={busy}>
          Gerar novo link com essas opções
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Criar / editar canal
// ---------------------------------------------------------------------
function defaultCategory(categories: ChannelCategory[], channels: Channel[], kind: 'text' | 'voice'): string {
  const withKind = categories.find((cat) => channels.some((c) => c.category_id === cat.id && c.kind === kind));
  return withKind?.id ?? '';
}

export function ChannelModal() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  const open = modal?.kind === 'channel';
  const serverId = open ? modal.serverId : '';
  const editing = useApp((s) => (open && modal.channelId ? s.channels[serverId]?.find((c) => c.id === modal.channelId) : undefined));
  const roles = useApp((s) => s.roles[serverId]) ?? [];
  const categories = useApp((s) => s.categories[serverId]) ?? [];
  const channels = useApp((s) => s.channels[serverId]) ?? [];
  const claudeVisible = useClaudeVisible();
  const [kind, setKind] = useState<'text' | 'voice'>('text');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [category, setCategory] = useState('');
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [isPrivate, setPrivate] = useState(false);
  const [claude, setClaude] = useState(true);
  const [limit, setLimit] = useState('');
  const [allowed, setAllowed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const k = editing?.kind ?? (modal.kind === 'channel' ? modal.channelKind ?? 'text' : 'text');
    setKind(k);
    setName(editing?.name ?? '');
    setTopic(editing?.topic ?? '');
    const fromModal = modal.kind === 'channel' ? modal.categoryId : undefined;
    setCategory(editing ? editing.category_id ?? '' : fromModal ?? defaultCategory(categories, channels, k));
    setCategoryTouched(!!editing || fromModal !== undefined);
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
  }, [open, editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const normalized = kind === 'text' ? name.trim().toLowerCase().replace(/\s+/g, '-') : name.trim();

  const nextPosition = (catId: string | null) =>
    Math.max(-1, ...channels.filter((c) => (c.category_id ?? null) === catId && c.id !== editing?.id).map((c) => c.position)) + 1;

  const save = async () => {
    setBusy(true);
    const catId = category || null;
    const payload: Record<string, unknown> = {
      name: normalized,
      topic: topic.trim() || null,
      is_private: isPrivate,
      claude_enabled: claude,
      user_limit: kind === 'voice' && limit ? Number(limit) : null,
      category_id: catId,
    };
    if (editing && (editing.category_id ?? null) !== catId) payload.position = nextPosition(catId);
    let channel: Channel | null = null;
    if (editing) {
      const { data, error } = await sb().from('channels').update(payload).eq('id', editing.id).select('*').single();
      if (error) {
        setBusy(false);
        return toast.error(error);
      }
      channel = data as Channel;
    } else {
      const { data, error } = await sb()
        .from('channels')
        .insert({ ...payload, server_id: serverId, kind, position: nextPosition(catId) })
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

  const nudge = async (dir: -1 | 1) => {
    if (!editing) return;
    const change = nudgeChannel(channels, categories, editing.id, dir);
    if (!change) return;
    useApp.getState().applyLayout(serverId, change.categories, change.channels);
    const { error } = await sb().rpc('save_channel_layout', { p_server: serverId, p_categories: [], p_channels: change.channelPatch });
    if (error) {
      toast.error(error);
      void useApp.getState().loadServer(serverId, true);
    }
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
              <button
                key={k}
                onClick={() => {
                  setKind(k);
                  if (!categoryTouched) setCategory(defaultCategory(categories, channels, k));
                }}
                className={cx('rounded-xl border p-3 text-left', kind === k ? 'border-accent bg-accent/10' : 'border-line')}
              >
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
        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
          <Field label="Categoria">
            <Select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setCategoryTouched(true);
              }}
            >
              <option value="">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {editing ? (
            <div className="flex gap-1 pb-0.5">
              <IconButton label="Mover para cima" size="sm" onClick={() => void nudge(-1)}>
                <ArrowUp className="size-4" />
              </IconButton>
              <IconButton label="Mover para baixo" size="sm" onClick={() => void nudge(1)}>
                <ArrowDown className="size-4" />
              </IconButton>
            </div>
          ) : null}
        </div>
        {kind === 'text' ? (
          <Field label="Descrição">
            <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} maxLength={300} />
          </Field>
        ) : (
          <Field label="Limite de pessoas">
            <Select value={limit} onChange={(e) => setLimit(e.target.value)}>
              <option value="">Sem limite</option>
              {[2, 4, 5, 8, 10, 15, 25, 50, 99].map((n) => (
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
        {kind === 'text' && claudeVisible ? (
          <Toggle checked={claude} onChange={setClaude} label="Permitir @NEXUS neste canal" description="Você pode chamar a IA com @NEXUS aqui. A resposta aparece no canal para quem está nele." />
        ) : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Criar / editar categoria
// ---------------------------------------------------------------------
export function CategoryModal() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  const open = modal?.kind === 'category';
  const serverId = open ? modal.serverId : '';
  const categories = useApp((s) => s.categories[serverId]) ?? [];
  const channels = useApp((s) => s.channels[serverId]) ?? [];
  const editing = open && modal.categoryId ? categories.find((c) => c.id === modal.categoryId) : undefined;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setName(editing?.name ?? '');
  }, [open, editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    const res = editing
      ? await sb().from('channel_categories').update({ name: name.trim() }).eq('id', editing.id).select('*').single()
      : await sb()
          .from('channel_categories')
          .insert({ server_id: serverId, name: name.trim(), position: Math.max(-1, ...categories.map((c) => c.position)) + 1 })
          .select('*')
          .single();
    setBusy(false);
    if (res.error) return toast.error(res.error);
    useApp.getState().upsertCategory(res.data as ChannelCategory);
    setModal(null);
  };

  const nudge = async (dir: -1 | 1) => {
    if (!editing) return;
    const change = nudgeCategory(channels, categories, editing.id, dir);
    if (!change) return;
    useApp.getState().applyLayout(serverId, change.categories, change.channels);
    const { error } = await sb().rpc('save_channel_layout', { p_server: serverId, p_categories: change.categoryPatch, p_channels: [] });
    if (error) {
      toast.error(error);
      void useApp.getState().loadServer(serverId, true);
    }
  };

  const remove = async () => {
    if (!editing) return;
    const n = channels.filter((c) => c.category_id === editing.id).length;
    if (!confirm(`Excluir a categoria "${editing.name}"?${n ? ` Os ${n} canais dela continuam no servidor, sem categoria.` : ''}`)) return;
    const { error } = await sb().from('channel_categories').delete().eq('id', editing.id);
    if (error) return toast.error(error);
    useApp.getState().removeCategory(editing.id);
    setModal(null);
  };

  return (
    <Modal
      open={open}
      onClose={() => setModal(null)}
      title={editing ? 'Editar categoria' : 'Criar categoria'}
      description={editing ? undefined : 'Categorias agrupam os canais na barra lateral (como “Canais de texto”).'}
      size="sm"
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
          <Button onClick={() => void save()} loading={busy} disabled={!name.trim()}>
            {editing ? 'Salvar' : 'Criar categoria'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome da categoria">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Ex.: Eventos" autoFocus />
        </Field>
        {editing ? (
          <div className="flex items-center gap-2 text-sm text-fg-2">
            Posição:
            <IconButton label="Mover para cima" size="sm" onClick={() => void nudge(-1)}>
              <ArrowUp className="size-4" />
            </IconButton>
            <IconButton label="Mover para baixo" size="sm" onClick={() => void nudge(1)}>
              <ArrowDown className="size-4" />
            </IconButton>
            <span className="text-[12px] text-fg-3">No computador, dá para arrastar na barra lateral.</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Editar perfil do servidor (apelido)
// ---------------------------------------------------------------------
export function NicknameModal() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  const open = modal?.kind === 'nickname';
  const serverId = open ? modal.serverId : '';
  const me = useSession((s) => s.me);
  const member = useApp((s) => s.members[serverId]?.find((m) => m.user_id === me?.id));
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setNick(member?.nickname ?? '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (value: string | null) => {
    if (!me) return;
    setBusy(true);
    const { data, error } = await sb()
      .from('server_members')
      .update({ nickname: value })
      .match({ server_id: serverId, user_id: me.id })
      .select('*')
      .single();
    setBusy(false);
    if (error) return toast.error(error);
    useApp.getState().upsertMember(data as Member);
    toast.success(value ? 'Apelido salvo' : 'Apelido removido');
    setModal(null);
  };

  return (
    <Modal
      open={open}
      onClose={() => setModal(null)}
      title="Editar perfil do servidor"
      description={`Seu apelido aparece só em ${server?.name ?? 'este servidor'}.`}
      size="sm"
      footer={
        <>
          {member?.nickname ? (
            <Button variant="ghost" className="mr-auto" onClick={() => void save(null)} disabled={busy}>
              Usar meu nome
            </Button>
          ) : null}
          <Button onClick={() => void save(nick.trim() || null)} loading={busy}>
            Salvar
          </Button>
        </>
      }
    >
      <Field label="Apelido no servidor">
        <Input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={32} placeholder={me?.display_name ?? ''} autoFocus />
      </Field>
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
  const ready = useApp((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    const check = () => {
      const code = inviteFromLocation() ?? peekPendingInvite();
      if (!code) return;
      clearInviteFromLocation();
      clearPendingInvite();
      setModal({ kind: 'joinServer', code });
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [ready, setModal]);
}

void displayNameFor;
