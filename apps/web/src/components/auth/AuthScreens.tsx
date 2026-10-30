import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, KeyRound, Mail, Server, ShieldCheck } from 'lucide-react';
import { sb, currentConfig } from '../../lib/supabase';
import { friendlyError } from '../../lib/errors';
import { clearLocalConfig, publicAppUrl, saveLocalConfig, validateServerConfig } from '../../config';
import { useSession } from '../../store/session';
import { usePwa } from '../../lib/pwa';
import { isCapacitor, isIOS, isMobileOS, isStandalone } from '../../lib/platform';
import { inviteFromLocation, peekPendingInvite, savePendingInvite } from '../../lib/invite';
import type { InvitePreview } from '../../types/db';
import { Button, Field, Input, Notice } from '../ui';
import { Wordmark } from '../Logo';
import { ServerIcon } from '../layout/ServerArt';

function Shell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4 py-10 nx-safe-top nx-safe-bottom relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(60rem 30rem at 10% -10%, rgb(91 124 255 / 0.18), transparent 60%), radial-gradient(40rem 30rem at 110% 110%, rgb(139 92 246 / 0.16), transparent 60%)',
        }}
      />
      <div className="relative w-full max-w-[420px]">
        <div className="flex justify-center mb-7">
          <Wordmark size={26} />
        </div>
        <div className="rounded-2xl border border-line bg-[#121722]/95 shadow-2xl p-6 sm:p-7 backdrop-blur">{children}</div>
        {footer ? <div className="mt-5 text-center text-xs text-fg-3">{footer}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Configuração do servidor (quando o build não traz as variáveis)
// ---------------------------------------------------------------------
export function SetupScreen() {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = validateServerConfig(url, key);
    if (problem) {
      setError(problem);
      return;
    }
    saveLocalConfig(url, key);
    location.reload();
  };

  return (
    <Shell footer="Os dados ficam salvos só neste aparelho. Nas versões publicadas isso já vem configurado.">
      <div className="flex items-center gap-3 mb-1">
        <div className="size-10 rounded-xl bg-accent/15 text-mention flex items-center justify-center">
          <Server className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Conectar ao servidor do NEXUS</h1>
          <p className="text-sm text-fg-2">Esta cópia ainda não sabe qual backend usar.</p>
        </div>
      </div>
      <Notice tone="info" className="mt-4">
        Informe o endereço do projeto Supabase e a <b>chave pública</b> (anon/publishable). O passo a passo está em
        <code className="mx-1 text-fg">docs/CONFIGURACAO.md</code>.
      </Notice>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <Field label="Endereço do projeto">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxxxxxx.supabase.co" autoComplete="off" />
        </Field>
        <Field label="Chave pública (anon / publishable)" error={error}>
          <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="sb_publishable_… ou eyJhbGci…" autoComplete="off" />
        </Field>
        <Button type="submit" className="w-full" size="lg">
          Conectar
        </Button>
      </form>
    </Shell>
  );
}

// ---------------------------------------------------------------------
// Entrar / Criar conta / Esqueci a senha
// ---------------------------------------------------------------------
type Mode = 'login' | 'signup' | 'forgot';

/** Convite aberto antes do login: mostra o servidor e guarda o código para depois. */
function pendingInviteCode(): string | null {
  const code = inviteFromLocation() ?? peekPendingInvite();
  if (code) savePendingInvite(code);
  return code;
}

function InviteBanner({ code }: { code: string }) {
  const [info, setInfo] = useState<InvitePreview | null | 'erro'>(null);
  useEffect(() => {
    void sb()
      .rpc('preview_invite', { p_code: code })
      .then(({ data }) => setInfo((data as InvitePreview[] | null)?.[0] ?? 'erro'));
  }, [code]);
  if (info === null) return null;
  if (info === 'erro') {
    return (
      <Notice tone="warn" className="mb-5">
        Esse convite não existe mais. Entre na sua conta e peça um link novo.
      </Notice>
    );
  }
  return (
    <div className="mb-5 rounded-xl border border-accent/30 bg-accent/[0.08] p-3 flex items-center gap-3">
      <ServerIcon name={info.name} url={info.icon_url} size={46} className="rounded-xl shrink-0" />
      <div className="min-w-0">
        <div className="text-[12px] text-fg-2">Você foi convidado para entrar em</div>
        <div className="font-semibold truncate">{info.name}</div>
        <div className="text-[12px] text-fg-3">
          {info.valid ? `${info.member_count} ${info.member_count === 1 ? 'membro' : 'membros'}` : info.reason}
          {info.valid && info.requires_pin ? ' · pede PIN (peça a quem te convidou)' : ''}
        </div>
      </div>
    </div>
  );
}

export function AuthScreen() {
  const [inviteCode] = useState(pendingInviteCode);
  const [mode, setMode] = useState<Mode>(inviteCode ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const cfg = currentConfig();

  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const client = sb();
      if (mode === 'login') {
        const { error: err } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
      } else if (mode === 'signup') {
        const u = username.trim().toLowerCase();
        if (!/^[a-z0-9_](?:[a-z0-9_.]{1,30}[a-z0-9_])$/.test(u)) {
          throw new Error('Nome de usuário: 3 a 32 caracteres, só letras minúsculas, números, "_" ou ".".');
        }
        if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
        const avail = await client.rpc('username_available', { p_username: u });
        if (avail.data === false) throw new Error('Esse nome de usuário já está em uso ou é reservado.');
        const { data, error: err } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { username: u, display_name: displayName.trim() || u },
            emailRedirectTo: publicAppUrl(cfg) || undefined,
          },
        });
        if (err) throw err;
        if (!data.session) {
          setInfo('Conta criada! Enviamos um link de confirmação para o seu e-mail. Depois de confirmar, é só entrar.');
          setMode('login');
        }
      } else {
        const { error: err } = await client.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: publicAppUrl(cfg) || undefined,
        });
        if (err) throw err;
        setInfo('Se existir uma conta com esse e-mail, você vai receber um link para criar uma nova senha.');
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      footer={
        cfg?.source === 'local' ? (
          <button
            className="underline underline-offset-2 hover:text-fg-2"
            onClick={() => {
              clearLocalConfig();
              location.reload();
            }}
          >
            Trocar servidor ({new URL(cfg.supabaseUrl).host})
          </button>
        ) : (
          'Ao continuar você concorda em usar o NEXUS com responsabilidade com a sua equipe.'
        )
      }
    >
      {mode === 'forgot' ? (
        <button onClick={() => go('login')} className="inline-flex items-center gap-1.5 text-sm text-fg-2 hover:text-fg mb-3">
          <ArrowLeft className="size-4" /> Voltar
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#0d1118] border border-line mb-5" role="tablist">
          {(['login', 'signup'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => go(m)}
              className={`h-9 rounded-lg text-sm font-medium transition-colors ${mode === m ? 'bg-raised text-fg' : 'text-fg-2 hover:text-fg'}`}
            >
              {m === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          ))}
        </div>
      )}

      {inviteCode && mode !== 'forgot' ? <InviteBanner code={inviteCode} /> : null}

      <h1 className="text-xl font-semibold">
        {mode === 'login' ? 'Bem-vindo de volta' : mode === 'signup' ? 'Crie sua conta' : 'Recuperar senha'}
      </h1>
      <p className="text-sm text-fg-2 mt-1 mb-5">
        {inviteCode && mode !== 'forgot'
          ? 'Entre ou crie sua conta: o convite abre logo em seguida.'
          : mode === 'login'
            ? 'Entre para falar com seus amigos e sua equipe.'
            : mode === 'signup'
              ? 'Leva menos de um minuto.'
              : 'Vamos enviar um link seguro para o seu e-mail.'}
      </p>

      {info ? (
        <Notice tone="success" className="mb-4">
          {info}
        </Notice>
      ) : null}

      <form onSubmit={submit} className="space-y-4">
        {mode === 'signup' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nome de exibição">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="JoseAdriano" maxLength={48} />
            </Field>
            <Field label="Usuário">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
                placeholder="jose_adriano"
                maxLength={32}
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
            </Field>
          </div>
        ) : null}
        <Field label="E-mail">
          <div className="relative">
            <Mail className="size-4 text-fg-3 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@email.com"
              autoComplete="email"
              className="pl-9"
              required
            />
          </div>
        </Field>
        {mode !== 'forgot' ? (
          <Field label="Senha" hint={mode === 'signup' ? 'Mínimo de 8 caracteres.' : undefined}>
            <div className="relative">
              <KeyRound className="size-4 text-fg-3 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="pl-9"
                minLength={mode === 'signup' ? 8 : undefined}
                required
              />
            </div>
          </Field>
        ) : null}

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Criar conta' : 'Enviar link'}
        </Button>

        {mode === 'login' ? (
          <button type="button" onClick={() => go('forgot')} className="w-full text-center text-sm text-mention hover:underline">
            Esqueci minha senha
          </button>
        ) : null}
      </form>
      <InstallHint />
    </Shell>
  );
}

/** No celular: convite para instalar o NEXUS como app. */
function InstallHint() {
  const pwa = usePwa();
  if (!isMobileOS || isCapacitor || isStandalone() || pwa.installed) return null;
  if (isIOS) {
    return (
      <p className="mt-5 rounded-xl border border-line bg-[#0d1118] px-3 py-2.5 text-[13px] text-fg-2">
        Dica: instale o NEXUS no seu aparelho. No Safari, toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.
      </p>
    );
  }
  if (pwa.canPrompt) {
    return (
      <Button variant="secondary" className="w-full mt-4" onClick={() => void pwa.prompt()}>
        Instalar o NEXUS neste celular
      </Button>
    );
  }
  // O Chrome nem sempre oferece o botão automático: explica o caminho pelo menu.
  return (
    <p className="mt-5 rounded-xl border border-line bg-[#0d1118] px-3 py-2.5 text-[13px] text-fg-2">
      Dica: instale o NEXUS no seu celular. No Chrome, toque em <b>⋮</b> e depois em <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).
    </p>
  );
}

// ---------------------------------------------------------------------
// Nova senha (link de recuperação)
// ---------------------------------------------------------------------
export function RecoveryScreen() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finish = useSession((s) => s.finishRecovery);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.');
    if (password !== confirm) return setError('As senhas não conferem.');
    setBusy(true);
    const { error: err } = await sb().auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    finish();
  };

  return (
    <Shell>
      <div className="flex items-center gap-3 mb-5">
        <div className="size-10 rounded-xl bg-success/15 text-success flex items-center justify-center">
          <ShieldCheck className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Criar nova senha</h1>
          <p className="text-sm text-fg-2">Escolha uma senha que você não usa em outros lugares.</p>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nova senha">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
        </Field>
        <Field label="Repita a senha" error={error}>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Salvar e entrar
        </Button>
      </form>
    </Shell>
  );
}
