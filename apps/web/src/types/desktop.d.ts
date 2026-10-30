// Ponte com o app desktop (Electron). Exposta pelo preload em window.nexusDesktop.
export interface DesktopUpdateStatus {
  state: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'disabled';
  version?: string;
  percent?: number;
  message?: string;
}

export interface DesktopScreenSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
  appIcon?: string;
}

export interface NexusDesktop {
  isDesktop: true;
  platform: 'win32' | 'darwin' | 'linux';
  version: string;
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(cb: (maximized: boolean) => void): () => void;
  };
  updates: {
    check(): Promise<void>;
    install(): void;
    onStatus(cb: (s: DesktopUpdateStatus) => void): () => void;
  };
  screenShare: {
    onPickRequest(cb: (sources: DesktopScreenSource[]) => void): () => void;
    respondPick(sourceId: string | null, withAudio: boolean): void;
  };
  notify(opts: { title: string; body: string; silent?: boolean }): void;
  setBadgeCount(count: number): void;
  openExternal(url: string): void;
  getLaunchAtStartup(): Promise<boolean>;
  setLaunchAtStartup(enabled: boolean): Promise<void>;
  onDeepLink(cb: (url: string) => void): () => void;
}

declare global {
  interface Window {
    nexusDesktop?: NexusDesktop;
  }
}
