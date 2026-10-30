import { useEffect, useState } from 'react';
import { AlertTriangle, LogOut, RefreshCw } from 'lucide-react';
import { useSession } from './store/session';
import { useFriends } from './store/friends';
import { useVoiceRooms } from './store/voiceRooms';
import { useApp } from './store/app';
import { useMessages } from './store/messages';
import { useClaude } from './store/claude';
import { useCompanion } from './store/companion';
import { useCall } from './store/call';
import { startRealtime, stopRealtime } from './lib/realtime';
import { AuthScreen, RecoveryScreen } from './components/auth/AuthScreens';
import { AppShell } from './components/layout/AppShell';
import { LogoMark } from './components/Logo';
import { Button } from './components/ui';

function Splash({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="h-dvh flex flex-col items-center justify-center gap-4 bg-ink">
      <LogoMark size={56} className="animate-pulse" />
      <span className="text-sm text-fg-3">{label}</span>
    </div>
  );
}

function Problem({ message }: { message: string }) {
  const signOut = useSession((s) => s.signOut);
  return (
    <div className="h-dvh flex items-center justify-center p-6 bg-ink">
      <div className="max-w-md text-center">
        <AlertTriangle className="size-10 text-warn mx-auto" />
        <h1 className="text-lg font-semibold mt-3">Não foi possível abrir o NEXUS</h1>
        <p className="text-sm text-fg-2 mt-2">{message}</p>
        <div className="flex justify-center gap-2 mt-5">
          <Button icon={<RefreshCw className="size-4" />} onClick={() => location.reload()}>
            Tentar de novo
          </Button>
          <Button variant="secondary" icon={<LogOut className="size-4" />} onClick={() => void signOut()}>
            Sair
          </Button>
        </div>
      </div>
    </div>
  );
}

function SignedIn({ userId }: { userId: string }) {
  const ready = useApp((s) => s.ready);
  const bootError = useApp((s) => s.bootError);
  const bootstrap = useApp((s) => s.bootstrap);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (started) return;
    setStarted(true);
    void bootstrap(userId).then(() => startRealtime(userId));
    return () => {
      // troca de conta / saída
    };
  }, [userId, bootstrap, started]);

  if (!ready) return <Splash label="Conectando ao seu espaço…" />;
  if (bootError) return <Problem message={bootError} />;
  return <AppShell />;
}

function resetStores() {
  stopRealtime();
  void useCall.getState().leave();
  useApp.getState().reset();
  useMessages.setState({ buckets: {} });
  useClaude.setState({ conversations: [], loaded: false, messages: {}, streaming: {} });
  useCompanion.setState({ loaded: false, settings: null, permissions: {}, tasks: [], questions: [], logs: [] });
  useFriends.setState({ loaded: false, rows: [], blocked: [] });
  useVoiceRooms.getState().reset();
}

export default function App() {
  const status = useSession((s) => s.status);
  const userId = useSession((s) => s.userId);
  const me = useSession((s) => s.me);
  const profileError = useSession((s) => s.profileError);
  const init = useSession((s) => s.init);
  const [lastUser, setLastUser] = useState<string | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (userId !== lastUser) {
      if (lastUser) resetStores();
      setLastUser(userId);
    }
  }, [userId, lastUser]);

  if (status === 'loading') return <Splash />;
  if (status === 'recovery') return <RecoveryScreen />;
  if (status === 'signedOut' || !userId) return <AuthScreen />;
  if (profileError) return <Problem message={profileError} />;
  if (!me) return <Splash label="Carregando seu perfil…" />;
  return <SignedIn key={userId} userId={userId} />;
}
