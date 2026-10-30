import { useEffect, useRef, useState } from 'react';
import { Download, ImagePlus, LogOut, RefreshCw, Shield, Trash2 } from 'lucide-react';
import { useApp } from '../../store/app';
import { NEXUS_IA_ATIVA, useSession } from '../../store/session';
import { readDevicePrefs, saveDevicePref, useCall } from '../../store/call';
import { toast } from '../../store/toast';
import { sb, currentConfig } from '../../lib/supabase';
import { publicUrl, randomId } from '../../lib/storage';
import { desktop, isAndroid, isDesktop, isIOS, isStandalone } from '../../lib/platform';
import { ensureNotificationPermission } from '../../lib/notify';
import { formatMoney, formatNumber } from '../../lib/format';
import { clearLocalConfig, APP_VERSION } from '../../config';
import { usePwa } from '../../lib/pwa';
import type { DesktopUpdateStatus } from '../../types/desktop';
import type { AppSettings, Profile } from '../../types/db';
import { Avatar, Badge, Button, Field, Input, Modal, Notice, Select, Tabs, Textarea, Toggle } from '../ui';

type Tab = 'perfil' | 'conta' | 'voz' | 'notificacoes' | 'app' | 'admin';

function ProfileTab() {
  const me = useSession((s) => s.me)!;
  const setMe = useSession((s) => s.setMe);
  const [displayName, setDisplayName] = useState(me.display_name);
  const [username, setUsername] = useState(me.username);
  const [bio, setBio] = useState(me.bio ?? '');
  const [busy, setBusy] = useState(false);

  const save = async (patch: Partial<Profile>) => {
    setBusy(true);
    const { data, error } = await sb().from('profiles').update(patch).eq('id', me.id).select('*').single();
    setBusy(false);
    if (error) return toast.error(error);
    setMe(data as Profile);
    useApp.getState().upsertProfile(data as Profile);
    toast.success('Perfil atualizado');
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.warn('Escolha uma imagem');
    if (file.size > 5 * 1024 * 1024) return toast.warn('Imagem acima de 5 MB');
    const path = `${me.id}/avatar-${randomId()}.${file.type.split('/')[1] || 'png'}`;
    const { error } = await sb().storage.from('avatars').upload(path, file, { contentType: file.type, upsert: true });
    if (error) return toast.error(error);
    await save({ avatar_url: publicUrl('avatars', path) });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <Avatar name={me.display_name} url={me.avatar_url} size={72} />
        <div className="flex gap-2">
          <label className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-line text-sm cursor-pointer hover:bg-raised">
            <ImagePlus className="size-4" /> Trocar foto
            <input type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
          </label>
          {me.avatar_url ? (
            <Button variant="ghost" size="md" onClick={() => void save({ avatar_url: null })}>
              Remover
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Nome de exibição">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={48} />
        </Field>
        <Field label="Usuário" hint="Usado nas menções: @usuario">
          <Input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} maxLength={32} />
        </Field>
      </div>
      <Field label="Sobre mim">
        <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={300} />
      </Field>
      <div className="flex justify-end">
        <Button loading={busy} onClick={() => void save({ display_name: displayName.trim(), username: username.trim(), bio: bio.trim() || null })}>
          Salvar perfil
        </Button>
      </div>
    </div>
  );
}

function AccountTab() {
  const email = useSession((s) => s.email);
  const signOut = useSession((s) => s.signOut);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const change = async () => {
    if (pw.length < 8) return toast.warn('A senha precisa ter pelo menos 8 caracteres');
    setBusy(true);
    const { error } = await sb().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error);
    setPw('');
    toast.success('Senha alterada');
  };
  return (
    <div className="space-y-5">
      <Field label="E-mail">
        <Input value={email ?? ''} readOnly />
      </Field>
      <Field label="Nova senha">
        <div className="flex gap-2">
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          <Button onClick={() => void change()} loading={busy} disabled={!pw}>
            Alterar
          </Button>
        </div>
      </Field>
      <Button variant="secondary" icon={<LogOut className="size-4" />} onClick={() => void signOut()}>
        Sair desta conta
      </Button>
    </div>
  );
}

function VoiceTab() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [prefs, setPrefs] = useState(readDevicePrefs());
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);
  const stop = useRef<(() => void) | null>(null);

  const load = async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list);
    } catch {
      setDevices([]);
    }
  };
  useEffect(() => {
    void load();
    return () => stop.current?.();
  }, []);

  const test = async () => {
    if (testing) {
      stop.current?.();
      setTesting(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: prefs.audioinput ? { deviceId: { exact: prefs.audioinput } } : true });
      void load();
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      let raf = 0;
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(100, (peak / 128) * 160));
        raf = requestAnimationFrame(tick);
      };
      tick();
      setTesting(true);
      stop.current = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        setLevel(0);
      };
    } catch (err) {
      toast.error(err, 'Não foi possível acessar o microfone');
    }
  };

  const pick = (kind: 'audioinput' | 'audiooutput' | 'videoinput', id: string) => {
    saveDevicePref(kind, id);
    setPrefs(readDevicePrefs());
  };

  const list = (kind: MediaDeviceKind) => devices.filter((d) => d.kind === kind);

  return (
    <div className="space-y-5">
      {devices.every((d) => !d.label) ? <Notice tone="info">Toque em “Testar microfone” para o navegador liberar os nomes dos dispositivos.</Notice> : null}
      <Field label="Microfone">
        <Select value={prefs.audioinput ?? ''} onChange={(e) => pick('audioinput', e.target.value)}>
          <option value="">Padrão do sistema</option>
          {list('audioinput').map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || 'Microfone'}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <div className="h-2 rounded-full bg-[#0d1118] overflow-hidden">
          <div className="h-full bg-success transition-[width] duration-75" style={{ width: `${level}%` }} />
        </div>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => void test()}>
          {testing ? 'Parar teste' : 'Testar microfone'}
        </Button>
      </div>
      {list('audiooutput').length ? (
        <Field label="Saída de áudio">
          <Select value={prefs.audiooutput ?? ''} onChange={(e) => pick('audiooutput', e.target.value)}>
            <option value="">Padrão do sistema</option>
            {list('audiooutput').map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Saída'}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Câmera">
        <Select value={prefs.videoinput ?? ''} onChange={(e) => pick('videoinput', e.target.value)}>
          <option value="">Padrão do sistema</option>
          {list('videoinput').map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || 'Câmera'}
            </option>
          ))}
        </Select>
      </Field>
      <NoiseToggle />
      <p className="text-[12px] text-fg-3">Cancelamento de eco e controle automático de volume ficam sempre ativos nas calls.</p>
    </div>
  );
}

function NoiseToggle() {
  const noiseOn = useCall((s) => s.noiseOn);
  const noiseState = useCall((s) => s.noiseState);
  const inCall = useCall((s) => s.status === 'connected' || s.status === 'reconnecting');
  const toggleNoise = useCall((s) => s.toggleNoise);
  const status = !inCall
    ? null
    : noiseState === 'ligado'
      ? 'Agora: ligado nesta call.'
      : noiseState === 'carregando'
        ? 'Agora: ligando…'
        : noiseState === 'basico'
          ? 'Agora: só o anti-ruído básico (o avançado não funciona neste aparelho).'
          : 'Agora: desligado nesta call.';
  return (
    <Toggle
      checked={noiseOn}
      onChange={() => void toggleNoise()}
      label="Anti-ruído"
      description={
        <>
          Tira o barulho de fundo da sua voz nas calls (ventilador, teclado, rua, cachorro), como no Discord. Funciona no próprio aparelho e não grava nada.
          {status ? <span className="block mt-1 text-fg-2">{status}</span> : null}
        </>
      }
    />
  );
}

function NotificationsTab() {
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  return (
    <div className="space-y-4">
      {isDesktop ? (
        <Notice tone="success">No app do Windows as notificações aparecem na Central de Notificações e o ícone da barra de tarefas mostra quantas menções você tem.</Notice>
      ) : (
        <>
          <p className="text-sm text-fg-2">
            Situação das notificações neste aparelho: <b>{perm === 'granted' ? 'permitidas' : perm === 'denied' ? 'bloqueadas' : 'ainda não decidido'}</b>
          </p>
          {perm !== 'granted' ? (
            <Button onClick={async () => setPerm((await ensureNotificationPermission()) ? 'granted' : 'denied')}>Permitir notificações</Button>
          ) : null}
          {isIOS && !isStandalone() ? <Notice tone="warn">No iPhone/iPad, as notificações só funcionam com o NEXUS instalado na Tela de Início.</Notice> : null}
          {perm === 'denied' ? <p className="text-[12px] text-fg-3">Para liberar depois, use as configurações do navegador para este site.</p> : null}
        </>
      )}
      <p className="text-[12px] text-fg-3">
        Você é notificado quando alguém te menciona{NEXUS_IA_ATIVA ? ', quando recebe mensagem privada e quando a NEXUS IA precisa de uma decisão sua.' : ' e quando recebe mensagem privada.'}
      </p>
    </div>
  );
}

function AppTab() {
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  const [startup, setStartup] = useState(false);
  const pwa = usePwa();
  const cfg = currentConfig();
  useEffect(() => {
    if (!desktop) return;
    void desktop.getLaunchAtStartup().then(setStartup);
    return desktop.updates.onStatus(setStatus);
  }, []);
  return (
    <div className="space-y-5">
      <div className="text-sm">
        Versão: <b>{desktop?.version ?? APP_VERSION}</b> <Badge className="ml-2">{isDesktop ? 'Windows' : isIOS ? 'iPhone/iPad' : isAndroid ? 'Android' : 'Navegador'}</Badge>
      </div>
      {desktop ? (
        <>
          <div className="rounded-xl border border-line p-4">
            <div className="font-medium">Atualizações</div>
            <p className="text-sm text-fg-2 mt-1">
              {status?.state === 'downloading'
                ? `Baixando versão ${status.version ?? ''}… ${Math.round(status.percent ?? 0)}%`
                : status?.state === 'downloaded'
                  ? `Versão ${status.version} pronta para instalar.`
                  : status?.state === 'not-available'
                    ? 'Você está na versão mais recente.'
                    : status?.state === 'disabled'
                      ? 'Atualização automática ainda não configurada nesta versão.'
                      : status?.state === 'error'
                        ? `Erro ao verificar: ${status.message ?? ''}`
                        : 'O NEXUS verifica atualizações automaticamente.'}
            </p>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => void desktop!.updates.check()}>
                Verificar agora
              </Button>
              {status?.state === 'downloaded' ? (
                <Button size="sm" variant="success" icon={<Download className="size-4" />} onClick={() => desktop!.updates.install()}>
                  Reiniciar e atualizar
                </Button>
              ) : null}
            </div>
          </div>
          <Toggle
            checked={startup}
            onChange={async (v) => {
              await desktop!.setLaunchAtStartup(v);
              setStartup(v);
            }}
            label="Abrir o NEXUS quando o Windows iniciar"
            description="Fechar a janela deixa o NEXUS na bandeja do sistema; para sair de vez use o menu da bandeja."
          />
        </>
      ) : pwa.installed ? (
        <Notice tone="success">O NEXUS está instalado neste aparelho.</Notice>
      ) : pwa.canPrompt ? (
        <Button icon={<Download className="size-4" />} onClick={() => void pwa.prompt()}>
          Instalar o NEXUS neste aparelho
        </Button>
      ) : isIOS ? (
        <Notice tone="info" title="Instalar no iPhone/iPad">
          No Safari, toque em Compartilhar → “Adicionar à Tela de Início”.
        </Notice>
      ) : null}
      {pwa.updateReady ? (
        <Button variant="success" onClick={() => pwa.applyUpdate()}>
          Atualizar o app agora
        </Button>
      ) : null}
      {cfg?.source === 'local' ? (
        <div className="rounded-xl border border-line p-4">
          <div className="font-medium">Servidor</div>
          <p className="text-sm text-fg-2 mt-1">{cfg.supabaseUrl}</p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => {
              if (!confirm('Desconectar deste servidor?')) return;
              clearLocalConfig();
              location.reload();
            }}
          >
            Trocar servidor
          </Button>
        </div>
      ) : null}
    </div>
  );
}

interface AccessRow {
  user_id: string;
  daily_token_limit: number | null;
}

function AdminTab() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [username, setUsername] = useState('');
  const [usage, setUsage] = useState<{ tokens: number; cost: number } | null>(null);
  const profiles = useApp((s) => s.profiles);

  const load = async () => {
    const [s, a, u] = await Promise.all([
      sb().from('app_settings').select('*').single(),
      sb().from('ai_access').select('user_id, daily_token_limit'),
      sb()
        .from('ai_usage')
        .select('input_tokens, output_tokens, cost_usd')
        .gte('day', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)),
    ]);
    setSettings(s.data as AppSettings);
    setAccess((a.data ?? []) as AccessRow[]);
    void useApp.getState().ensureProfiles((a.data ?? []).map((x) => (x as AccessRow).user_id));
    const rows = (u.data ?? []) as Array<{ input_tokens: number; output_tokens: number; cost_usd: number }>;
    setUsage({ tokens: rows.reduce((s2, r) => s2 + Number(r.input_tokens) + Number(r.output_tokens), 0), cost: rows.reduce((s2, r) => s2 + Number(r.cost_usd), 0) });
  };
  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (!settings) return;
    const { error } = await sb()
      .from('app_settings')
      .update({
        signup_open: settings.signup_open,
        claude_model: settings.claude_model,
        claude_task_model: settings.claude_task_model,
        claude_daily_tokens_per_user: settings.claude_daily_tokens_per_user,
        claude_monthly_budget_usd: settings.claude_monthly_budget_usd,
        companion_max_concurrent_tasks: settings.companion_max_concurrent_tasks,
        calls_everyone: settings.calls_everyone ?? true,
        claude_admin_only: settings.claude_admin_only ?? true,
      })
      .eq('id', true);
    if (error) return toast.error(error);
    toast.success('Configurações salvas');
  };

  const grant = async () => {
    const { data } = await sb().from('profiles').select('id').eq('username', username.trim().toLowerCase()).maybeSingle();
    if (!data) return toast.warn('Usuário não encontrado');
    const { error } = await sb().from('ai_access').insert({ user_id: (data as { id: string }).id });
    if (error) return toast.error(error);
    setUsername('');
    void load();
  };

  const revoke = async (uid: string) => {
    const { error } = await sb().from('ai_access').delete().eq('user_id', uid);
    if (error) return toast.error(error);
    void load();
  };

  if (!settings) return null;
  const models = [
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — mais barato e rápido' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — equilíbrio (recomendado)' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — mais capaz' },
  ];

  return (
    <div className="space-y-5">
      {NEXUS_IA_ATIVA ? (
        <Notice tone="info" title="Você é administrador do NEXUS">
          A chave da API da Anthropic fica só no servidor (segredo da Edge Function). Aqui você controla quem usa e quanto.
        </Notice>
      ) : (
        <Notice tone="info" title="NEXUS IA desligada">
          A NEXUS IA está escondida em todos os aparelhos, para todo mundo (inclusive você), até ser ligada de novo numa próxima versão.
        </Notice>
      )}
      {NEXUS_IA_ATIVA && usage ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-line p-3">
            <div className="text-[12px] text-fg-3">Tokens neste mês</div>
            <div className="text-xl font-bold">{formatNumber(usage.tokens)}</div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <div className="text-[12px] text-fg-3">Custo estimado neste mês</div>
            <div className="text-xl font-bold">
              {formatMoney(usage.cost, 'USD')} <span className="text-[12px] text-fg-3 font-normal">de {formatMoney(settings.claude_monthly_budget_usd, 'USD')}</span>
            </div>
          </div>
        </div>
      ) : null}
      {NEXUS_IA_ATIVA ? (
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Modelo do chat">
          <Select value={settings.claude_model} onChange={(e) => setSettings({ ...settings, claude_model: e.target.value })}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Modelo das tarefas em segundo plano">
          <Select value={settings.claude_task_model} onChange={(e) => setSettings({ ...settings, claude_task_model: e.target.value })}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Limite diário por pessoa (tokens)">
          <Input type="number" min={0} value={settings.claude_daily_tokens_per_user} onChange={(e) => setSettings({ ...settings, claude_daily_tokens_per_user: Number(e.target.value) })} />
        </Field>
        <Field label="Orçamento mensal (US$)" hint="Ao atingir, a NEXUS IA para para todos até o mês virar.">
          <Input type="number" min={0} step="1" value={settings.claude_monthly_budget_usd} onChange={(e) => setSettings({ ...settings, claude_monthly_budget_usd: Number(e.target.value) })} />
        </Field>
      </div>
      ) : null}
      <Toggle checked={settings.signup_open} onChange={(v) => setSettings({ ...settings, signup_open: v })} label="Cadastro aberto" description="Informativo: para bloquear cadastros de fato, desative “Allow new users to sign up” no painel do Supabase (Auth → Providers)." />
      {NEXUS_IA_ATIVA ? (
      <Toggle
        checked={settings.claude_admin_only ?? true}
        onChange={(v) => setSettings({ ...settings, claude_admin_only: v })}
        label="NEXUS IA só para mim"
        description="Ligado: só você vê e usa a NEXUS IA (chat, Companion, @NEXUS e a IA na call). Para as outras pessoas a NEXUS IA nem aparece, e o servidor bloqueia. Se você chamar a IA (@NEXUS) num canal ou numa call, quem estiver ali vê ou ouve a resposta."
      />
      ) : null}
      <Toggle
        checked={settings.calls_everyone ?? true}
        onChange={(v) => setSettings({ ...settings, calls_everyone: v })}
        label="Calls nos servidores de outras pessoas"
        description="Ligado: qualquer servidor faz calls, como no Discord. Todas as calls do NEXUS usam a mesma franquia gratuita da LiveKit (5.000 minutos-pessoa por mês; quando acaba, as calls param até o mês virar). Desligado: calls só nos servidores do administrador."
      />
      <div className="flex justify-end">
        <Button onClick={() => void save()}>Salvar</Button>
      </div>
      {!NEXUS_IA_ATIVA || (settings.claude_admin_only ?? true) ? null : (
      <div>
        <div className="text-[12px] font-semibold uppercase tracking-wide text-fg-3 mb-2 flex items-center gap-1.5">
          <Shield className="size-3.5" /> Liberação individual da NEXUS IA
        </div>
        <div className="flex gap-2 mb-2">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="nome de usuário" />
          <Button onClick={() => void grant()} disabled={!username.trim()}>
            Liberar
          </Button>
        </div>
        {access.map((a) => (
          <div key={a.user_id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm mb-1.5">
            <span className="flex-1">{profiles[a.user_id]?.display_name ?? a.user_id}</span>
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => void revoke(a.user_id)} aria-label="Revogar" />
          </div>
        ))}
        <p className="text-[12px] text-fg-3">Membros com o cargo “Usar a NEXUS IA” nos seus servidores já têm acesso automaticamente.</p>
      </div>
      )}
    </div>
  );
}

export function SettingsModal() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  const isAdmin = useSession((s) => s.isAdmin);
  const me = useSession((s) => s.me);
  const open = modal?.kind === 'settings';
  const [tab, setTab] = useState<Tab>('perfil');
  useEffect(() => {
    if (open) setTab(modal.tab ?? 'perfil');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || !me) return null;
  const items: Array<{ value: Tab; label: string }> = [
    { value: 'perfil', label: 'Perfil' },
    { value: 'conta', label: 'Conta' },
    { value: 'voz', label: 'Voz e vídeo' },
    { value: 'notificacoes', label: 'Notificações' },
    { value: 'app', label: 'Aplicativo' },
  ];
  if (isAdmin) items.push({ value: 'admin', label: 'Administração' });
  return (
    <Modal open onClose={() => setModal(null)} title="Configurações" size="lg">
      <Tabs value={tab} onChange={setTab} items={items} className="mb-5" />
      {tab === 'perfil' ? <ProfileTab /> : null}
      {tab === 'conta' ? <AccountTab /> : null}
      {tab === 'voz' ? <VoiceTab /> : null}
      {tab === 'notificacoes' ? <NotificationsTab /> : null}
      {tab === 'app' ? <AppTab /> : null}
      {tab === 'admin' && isAdmin ? <AdminTab /> : null}
    </Modal>
  );
}
