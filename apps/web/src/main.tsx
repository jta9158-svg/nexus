import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './index.css';
import { getConfig } from './config';
import { initSupabase } from './lib/supabase';
import { initPwa } from './lib/pwa';
import { SetupScreen } from './components/auth/AuthScreens';
import App from './App';

const root = createRoot(document.getElementById('root')!);
const cfg = getConfig();

initPwa();

if (!cfg) {
  root.render(
    <StrictMode>
      <SetupScreen />
    </StrictMode>,
  );
} else {
  initSupabase(cfg);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
