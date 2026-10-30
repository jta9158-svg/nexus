import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Download, Home, MessageCircle, RefreshCw, Share, Sparkles, UserRound, WifiOff, X } from 'lucide-react';
import { useApp } from '../../store/app';
import { useSession } from '../../store/session';
import { useToasts } from '../../store/toast';
import { onConnectionChange } from '../../lib/realtime';
import { usePwa } from '../../lib/pwa';
import { desktop, isCapacitor, isIOS, isMobileOS, isStandalone, openExternal } from '../../lib/platform';
import { currentConfig } from '../../lib/supabase';
import { APP_VERSION } from '../../config';
import { cx, IconButton } from '../ui';
import { TitleBar } from './TitleBar';
import { ServerRail } from './ServerRail';
import { HomeSidebar, ServerSidebar } from './Sidebars';
import { RightPanel } from './RightPanel';
import { ChannelView, DmView } from '../chat/ChannelView';
import { CallView, ScreenPicker } from '../calls/CallView';
import { ClaudeView } from '../claude/ClaudeView';
import { CompanionView } from '../companion/CompanionView';
import { ProjectsView } from '../projects/ProjectsView';
import { FinanceView } from '../finance/FinanceView';
import { FilesView } from '../files/FilesView';
import { RobloxView } from '../roblox/RobloxView';
import { OverviewView } from '../overview/OverviewView';
import { SearchModal } from '../overlays/SearchModal';
import { CategoryModal, ChannelModal, CreateServerModal, InviteModal, JoinServerModal, NewDmModal, NicknameModal, ProfileModal, useInviteFromUrl } from '../overlays/ServerModals';
import { ServerSettingsModal } from '../overlays/ServerSettingsModal';
import { SettingsModal } from '../overlays/SettingsModal';
import { NotificationsPopover } from '../overlays/NotificationsPopover';
import { useIsMobile } from '../../lib/useMedia';
import { useClaudeVisible } from '../../store/session';

function MainView() {
  const view = useApp((s) => s.view);
  const claudeVisible = useClaudeVisible();
  if ((view.kind === 'claude' || view.kind === 'companion') && !claudeVisible) return <OverviewView />;
  switch (view.kind) {
    case 'home':
      return <OverviewView />;
    case 'channel':
      return <ChannelView serverId={view.serverId} channelId={view.channelId} />;
    case 'dm':
      return <DmView threadId={view.threadId} />;
    case 'call':
      return <CallView serverId={view.serverId} channelId={view.channelId} />;
    case 'claude':
      return <ClaudeView conversationId={view.conversationId} />;
    case 'companion':
      return <CompanionView />;
    case 'projects':
      return <ProjectsView serverId={view.serverId} projectId={view.projectId} />;
    case 'finance':
      return <FinanceView serverId={view.serverId} />;
    case 'files':
      return <FilesView serverId={view.serverId} />;
    case 'roblox':
      return <RobloxView serverId={view.serverId} />;
    default:
      return <OverviewView />;
  }
}

function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return createPortal(
    <div className="fixed z-[60] bottom-20 md:bottom-5 right-3 left-3 md:left-auto md:w-[380px] flex flex-col gap-2 pointer-events-none" aria-live="assertive">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pointer-events-auto rounded-xl border px-4 py-3 shadow-2xl bg-[#171c27] animate-slide-up flex gap-3',
            t.tone === 'error' ? 'border-danger/40' : t.tone === 'success' ? 'border-success/40' : t.tone === 'warn' ? 'border-warn/40' : 'border-line',
          )}
          role="status"
        >
          <span className={cx('w-1 rounded-full shrink-0', t.tone === 'error' ? 'bg-danger' : t.tone === 'success' ? 'bg-success' : t.tone === 'warn' ? 'bg-warn' : 'bg-accent')} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">{t.title}</div>
            {t.body ? <div className="text-[13px] text-fg-2 mt-0.5">{t.body}</div> : null}
          </div>
          <button onClick={() => dismiss(t.id)} className="text-fg-3 hover:text-fg self-start" aria-label="Fechar aviso">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Versão nova: no Windows pede para reiniciar (já baixou sozinha); no Android
 *  (APK) avisa e leva para o download. */
function AppUpdateBanner() {
  const [ready, setReady] = useState<string | null>(null);
  const [apk, setApk] = useState<string | null>(null);
  useEffect(() => {
    if (!desktop?.updates) return;
    return desktop.updates.onStatus((s) => setReady(s.state === 'downloaded' ? s.version ?? 'nova' : null));
  }, []);
  useEffect(() => {
    const repo = currentConfig()?.githubRepo;
    if (!isCapacitor || !repo) return;
    fetch(`https://api.github.com/repos/${repo}/releases/latest`)
      .then((r) => (r.ok ? r.json() : null))
      .then((rel: { tag_name?: string } | null) => {
        const latest = (rel?.tag_name ?? '').replace(/^v/, '');
        const newer = (a: string, b: string) => {
          const x = a.split('.').map(Number);
          const y = b.split('.').map(Number);
          for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
          return false;
        };
        if (latest && newer(latest, APP_VERSION)) setApk(latest);
      })
      .catch(() => undefined);
  }, []);
  if (ready && desktop?.updates) {
    return (
      <div className="shrink-0 bg-accent/15 text-mention text-[13px] px-4 py-1.5 flex items-center justify-center gap-3" role="status">
        <Download className="size-4" /> A versão {ready} do NEXUS já foi baixada.
        <button className="underline font-semibold" onClick={() => desktop?.updates.install()}>
          Reiniciar e atualizar
        </button>
      </div>
    );
  }
  if (apk) {
    const repo = currentConfig()?.githubRepo;
    return (
      <div className="shrink-0 bg-accent/15 text-mention text-[13px] px-4 py-1.5 flex items-center justify-center gap-3" role="status">
        <Download className="size-4" /> Saiu a versão {apk} do app.
        <button className="underline font-semibold" onClick={() => openExternal(`https://github.com/${repo}/releases/latest/download/NEXUS.apk`)}>
          Baixar e instalar
        </button>
      </div>
    );
  }
  return null;
}

function ConnectionBanner() {
  const [ok, setOk] = useState(true);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [settled, setSettled] = useState(false);
  useEffect(() => onConnectionChange(setOk), []);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 6000);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      clearTimeout(t);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online && (ok || !settled)) return null;
  return (
    <div className="shrink-0 bg-warn/15 text-warn text-[13px] px-4 py-1.5 flex items-center justify-center gap-2" role="alert">
      <WifiOff className="size-4" /> {online ? 'Reconectando ao tempo real… as mensagens novas aparecem assim que voltar.' : 'Sem internet. Você verá as novidades quando a conexão voltar.'}
    </div>
  );
}

function InstallBanner() {
  const pwa = usePwa();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('nexus.installDismissed') === '1';
    } catch {
      return false;
    }
  });
  if (!isMobileOS || isStandalone() || pwa.installed || dismissed) return null;
  if (!pwa.canPrompt && !isIOS) return null;
  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem('nexus.installDismissed', '1');
    } catch {
      // ignore
    }
  };
  return (
    <div className="shrink-0 mx-3 mt-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2.5 flex items-center gap-3 text-[13px]">
      <Download className="size-5 text-mention shrink-0" />
      <div className="flex-1">
        {isIOS ? (
          <>
            Instale o NEXUS: toque em <Share className="inline size-3.5 -mt-0.5" /> <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.
          </>
        ) : (
          'Instale o NEXUS no seu celular para abrir como app e receber notificações.'
        )}
      </div>
      {!isIOS ? (
        <button className="h-8 px-3 rounded-lg bg-accent text-white font-medium" onClick={() => void pwa.prompt()}>
          Instalar
        </button>
      ) : null}
      <button onClick={close} aria-label="Dispensar" className="text-fg-3">
        <X className="size-4" />
      </button>
    </div>
  );
}

function UpdateBanner() {
  const pwa = usePwa();
  if (!pwa.updateReady) return null;
  return (
    <div className="shrink-0 bg-success/12 text-success text-[13px] px-4 py-1.5 flex items-center justify-center gap-2">
      Nova versão do NEXUS disponível.
      <button className="underline font-medium inline-flex items-center gap-1" onClick={() => pwa.applyUpdate()}>
        <RefreshCw className="size-3.5" /> Atualizar
      </button>
    </div>
  );
}

function MobileTabBar() {
  const view = useApp((s) => s.view);
  const setMobileNav = useApp((s) => s.setMobileNav);
  const selectHome = useApp((s) => s.selectHome);
  const openView = useApp((s) => s.openView);
  const setNotif = useApp((s) => s.setNotificationsOpen);
  const setModal = useApp((s) => s.setModal);
  const unread = useApp((s) => s.notifications.filter((n) => !n.read_at).length);
  const claudeVisible = useClaudeVisible();
  const me = useSession((s) => s.me);
  const item = (active: boolean, label: string, icon: React.ReactNode, onClick: () => void, badge?: number) => (
    <button onClick={onClick} className={cx('flex-1 flex flex-col items-center justify-center gap-0.5 text-[10.5px] h-full relative', active ? 'text-fg' : 'text-fg-3')} aria-label={label}>
      {icon}
      {label}
      {badge ? <span className="absolute top-1.5 left-1/2 ml-2 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center">{badge > 9 ? '9+' : badge}</span> : null}
    </button>
  );
  return (
    <nav className="md:hidden shrink-0 border-t border-line-soft bg-panel nx-safe-bottom" aria-label="Navegação principal">
      <div className="h-[58px] flex">
        {item(false, 'Servidores', <Home className="size-5" />, () => setMobileNav(true))}
        {item(view.kind === 'dm' || view.kind === 'home', 'Início', <MessageCircle className="size-5" />, () => selectHome())}
        {claudeVisible ? item(view.kind === 'claude' || view.kind === 'companion', 'NEXUS IA', <Sparkles className="size-5" />, () => openView({ kind: 'claude' })) : null}
        {item(false, 'Avisos', <Bell className="size-5" />, () => setNotif(true), unread)}
        {item(false, 'Você', me ? <UserRound className="size-5" /> : <UserRound className="size-5" />, () => setModal({ kind: 'settings' }))}
      </div>
    </nav>
  );
}

export function AppShell() {
  const activeServerId = useApp((s) => s.activeServerId);
  const view = useApp((s) => s.view);
  const mobileNavOpen = useApp((s) => s.mobileNavOpen);
  const setMobileNav = useApp((s) => s.setMobileNav);
  const rightOpen = useApp((s) => s.rightPanelOpen);
  const setRight = useApp((s) => s.setRightPanel);
  const notificationsOpen = useApp((s) => s.notificationsOpen);
  const isMobile = useIsMobile();
  useInviteFromUrl();

  const sidebar = activeServerId ? <ServerSidebar serverId={activeServerId} /> : <HomeSidebar />;
  const hasRight = view.kind === 'channel';

  return (
    <div className="h-dvh flex flex-col bg-ink text-fg overflow-hidden">
      <div className="hidden md:block nx-safe-top">
        <TitleBar />
      </div>
      <div className="md:hidden nx-safe-top" />
      <AppUpdateBanner />
      <ConnectionBanner />
      <UpdateBanner />
      <InstallBanner />
      <div className="flex-1 min-h-0 flex">
        <ServerRail className="hidden md:flex" />
        <div className="flex-1 min-w-0 flex gap-2 md:pr-2 md:pb-2">
          <div className="hidden md:flex w-[280px] lg:w-[300px] shrink-0 flex-col rounded-2xl bg-panel border border-line-soft overflow-hidden">{sidebar}</div>
          <main className="flex-1 min-w-0 flex flex-col md:rounded-2xl bg-surface md:border border-line-soft overflow-hidden relative">
            <MainView />
          </main>
          {hasRight ? (
            <div className="hidden xl:block w-[360px] 2xl:w-[380px] shrink-0">
              <RightPanel />
            </div>
          ) : null}
        </div>
      </div>
      <MobileTabBar />

      {/* Gaveta (celular): servidores + canais */}
      {mobileNavOpen ? (
        <div className="md:hidden fixed inset-0 z-40 flex animate-fade-in" role="dialog" aria-label="Menu">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileNav(false)} />
          <div className="relative flex h-full max-w-[92vw] bg-ink nx-safe-top nx-safe-bottom shadow-2xl">
            <ServerRail className="flex" />
            <div className="w-[min(300px,calc(92vw-72px))] flex flex-col bg-panel rounded-tl-2xl overflow-hidden">{sidebar}</div>
          </div>
        </div>
      ) : null}

      {/* Painel direito em telas menores */}
      {hasRight && rightOpen ? (
        <div className="xl:hidden fixed inset-0 z-40 flex justify-end animate-fade-in">
          <div className="absolute inset-0 bg-black/50" onClick={() => setRight(false)} />
          <div className="relative w-[min(380px,94vw)] h-full bg-ink p-3 nx-safe-top nx-safe-bottom overflow-hidden flex flex-col">
            <div className="flex justify-end mb-2">
              <IconButton label="Fechar painel" onClick={() => setRight(false)}>
                <X className="size-5" />
              </IconButton>
            </div>
            <div className="flex-1 min-h-0">
              <RightPanel />
            </div>
          </div>
        </div>
      ) : null}

      {notificationsOpen && isMobile ? <MobileNotifications /> : null}

      <SearchModal />
      <CreateServerModal />
      <JoinServerModal />
      <InviteModal />
      <ChannelModal />
      <CategoryModal />
      <NicknameModal />
      <NewDmModal />
      <ProfileModal />
      <ServerSettingsModal />
      <SettingsModal />
      <ScreenPicker />
      <Toaster />
    </div>
  );
}

function MobileNotifications() {
  const setOpen = useApp((s) => s.setNotificationsOpen);
  return (
    <div className="md:hidden fixed inset-x-0 top-0 z-50 nx-safe-top">
      <div className="relative">
        <NotificationsPopover onClose={() => setOpen(false)} />
      </div>
    </div>
  );
}
