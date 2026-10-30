// Ponte segura entre o app web e o Windows (contextIsolation + sandbox).
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, cb) {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const version = (() => {
  const arg = process.argv.find((a) => a.startsWith('--nexus-version='));
  return arg ? arg.split('=')[1] : '0.0.0';
})();

contextBridge.exposeInMainWorld('nexusDesktop', {
  isDesktop: true,
  platform: process.platform,
  version,
  window: {
    minimize: () => ipcRenderer.send('nexus:window', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('nexus:window', 'toggle-maximize'),
    close: () => ipcRenderer.send('nexus:window', 'close'),
    isMaximized: () => ipcRenderer.invoke('nexus:is-maximized'),
    onMaximizedChange: (cb) => listen('nexus:maximized', cb),
  },
  updates: {
    check: () => ipcRenderer.invoke('nexus:update-check'),
    install: () => ipcRenderer.send('nexus:update-install'),
    onStatus: (cb) => {
      ipcRenderer.invoke('nexus:update-status').then(cb).catch(() => undefined);
      return listen('nexus:update-status', cb);
    },
  },
  screenShare: {
    onPickRequest: (cb) => listen('nexus:screen-pick', cb),
    respondPick: (sourceId, withAudio) => ipcRenderer.send('nexus:screen-pick-response', sourceId ? { sourceId, withAudio: !!withAudio } : null),
  },
  notify: (opts) => ipcRenderer.send('nexus:notify', opts),
  setBadgeCount: (count) => ipcRenderer.send('nexus:badge', count),
  openExternal: (url) => ipcRenderer.send('nexus:open-external', url),
  getLaunchAtStartup: () => ipcRenderer.invoke('nexus:get-startup'),
  setLaunchAtStartup: (enabled) => ipcRenderer.invoke('nexus:set-startup', enabled),
  onDeepLink: (cb) => listen('nexus:deep-link', cb),
  takeDeepLink: () => ipcRenderer.invoke('nexus:take-deep-link'),
});
