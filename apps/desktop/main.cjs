// NEXUS — app para Windows (Electron).
// A interface é o app web (apps/web) empacotado e servido por app://nexus/.
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  desktopCapturer,
  ipcMain,
  nativeImage,
  net,
  protocol,
  session,
  shell,
} = require('electron');

const DEV_URL = process.env.NEXUS_DEV_URL || '';
const APP_ORIGIN = 'app://nexus';
const WEB_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, 'web');
const ICON = path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const TRAY_ICON = path.join(__dirname, 'build', 'tray.png');

let win = null;
let tray = null;
let quitting = false;
let pendingDeepLink = null;
let pendingPick = null; // { callback, sources }
let updateStatus = { state: 'disabled' };

// ---------------------------------------------------------------- instância única
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setAppUserModelId('app.nexus.desktop');
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient('nexus', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('nexus');
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
  },
]);

function findDeepLink(argv) {
  return argv.find((a) => typeof a === 'string' && a.startsWith('nexus://')) || null;
}

function sendDeepLink(url) {
  if (!url) return;
  if (win && !win.webContents.isLoading()) win.webContents.send('nexus:deep-link', url);
  else pendingDeepLink = url;
}

app.on('second-instance', (_event, argv) => {
  showWindow();
  sendDeepLink(findDeepLink(argv));
});

// ---------------------------------------------------------------- janela
function showWindow() {
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function isAppUrl(url) {
  return url.startsWith(`${APP_ORIGIN}/`) || (DEV_URL && url.startsWith(DEV_URL));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#0B0E14',
    title: 'NEXUS',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      backgroundThrottling: false, // calls e tarefas continuam com a janela escondida
      additionalArguments: [`--nexus-version=${app.getVersion()}`],
    },
  });

  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
  });

  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
      if (process.platform === 'win32' && !app.__trayHintShown) {
        app.__trayHintShown = true;
        notify({ title: 'O NEXUS continua aberto', body: 'Ele fica na bandeja do sistema. Para sair de vez, use o menu do ícone.' });
      }
    }
  });
  win.on('closed', () => {
    win = null;
  });
  win.on('maximize', () => win && win.webContents.send('nexus:maximized', true));
  win.on('unmaximize', () => win && win.webContents.send('nexus:maximized', false));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.on('did-finish-load', () => {
    if (pendingDeepLink) {
      win.webContents.send('nexus:deep-link', pendingDeepLink);
      pendingDeepLink = null;
    }
  });

  win.loadURL(DEV_URL || `${APP_ORIGIN}/index.html`);
}

// ---------------------------------------------------------------- bandeja
function buildTrayMenu() {
  const startup = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: 'Abrir NEXUS', click: showWindow },
    { type: 'separator' },
    { label: 'Verificar atualizações', click: () => checkForUpdates(true) },
    {
      label: 'Iniciar com o Windows',
      type: 'checkbox',
      checked: startup,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
      },
    },
    { type: 'separator' },
    {
      label: 'Sair do NEXUS',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  const image = nativeImage.createFromPath(fs.existsSync(TRAY_ICON) ? TRAY_ICON : ICON);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('NEXUS');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showWindow);
}

// ---------------------------------------------------------------- notificações
function notify({ title, body, silent }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: String(title || 'NEXUS').slice(0, 120), body: String(body || '').slice(0, 300), silent: !!silent, icon: ICON });
  n.on('click', showWindow);
  n.show();
}

function setBadge(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (process.platform === 'win32' && win) {
    if (n > 0) {
      const size = 32;
      const text = n > 9 ? '9+' : String(n);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="16" cy="16" r="15" fill="#EF4444"/><text x="16" y="21.5" font-family="Segoe UI, Arial" font-size="${text.length > 1 ? 15 : 18}" font-weight="700" fill="#fff" text-anchor="middle">${text}</text></svg>`;
      const img = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
      win.setOverlayIcon(img, `${n} notificações`);
      if (!win.isFocused()) win.flashFrame(true);
    } else {
      win.setOverlayIcon(null, '');
      win.flashFrame(false);
    }
  } else {
    app.setBadgeCount(n);
  }
  if (tray) tray.setToolTip(n > 0 ? `NEXUS — ${n} não lidas` : 'NEXUS');
}

// ---------------------------------------------------------------- atualizações
let autoUpdater = null;
function sendUpdate(status) {
  updateStatus = status;
  if (win) win.webContents.send('nexus:update-status', status);
}

function setupUpdater() {
  if (!app.isPackaged) {
    sendUpdate({ state: 'disabled', message: 'Atualização automática só funciona no app instalado.' });
    return;
  }
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch {
    sendUpdate({ state: 'disabled' });
    return;
  }
  const owner = process.env.NEXUS_GH_OWNER;
  const repo = process.env.NEXUS_GH_REPO;
  if (owner && repo) autoUpdater.setFeedURL({ provider: 'github', owner, repo });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdate({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'not-available' }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: p.percent, version: updateStatus.version }));
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdate({ state: 'downloaded', version: info.version });
    notify({ title: 'Atualização do NEXUS pronta', body: `A versão ${info.version} será instalada ao reiniciar o app.` });
  });
  autoUpdater.on('error', (err) => {
    const msg = String((err && err.message) || err);
    // Sem publicação configurada no GitHub: não é um erro para a pessoa.
    if (/no published versions|404|Cannot find channel|ENOENT.*app-update\.yml/i.test(msg)) sendUpdate({ state: 'disabled', message: 'Nenhuma versão publicada ainda.' });
    else sendUpdate({ state: 'error', message: msg.slice(0, 200) });
  });
  checkForUpdates(false);
  setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000);
}

function checkForUpdates(manual) {
  if (!autoUpdater) {
    sendUpdate(updateStatus.state === 'disabled' ? updateStatus : { state: 'disabled' });
    if (manual) notify({ title: 'NEXUS', body: 'A atualização automática ainda não está disponível nesta cópia.' });
    return Promise.resolve();
  }
  return autoUpdater.checkForUpdates().catch(() => undefined);
}

// ---------------------------------------------------------------- permissões e tela
function setupSession() {
  const ses = session.defaultSession;
  const allowed = new Set(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection']);
  const fromApp = (origin) => typeof origin === 'string' && (origin.startsWith(APP_ORIGIN) || (DEV_URL && origin.startsWith(new URL(DEV_URL).origin)));

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(allowed.has(permission) && fromApp(details.requestingUrl || wc.getURL()));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => allowed.has(permission) && fromApp(requestingOrigin));

  // Compartilhar tela: o app web mostra o seletor de telas/janelas.
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
      if (!win) return callback(null);
      if (pendingPick) pendingPick.callback(null);
      pendingPick = { callback, sources };
      win.webContents.send(
        'nexus:screen-pick',
        sources.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.id.startsWith('screen:') ? 'screen' : 'window',
          thumbnail: s.thumbnail.toDataURL(),
          appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined,
        })),
      );
    } catch {
      callback(null);
    }
  });

  ipcMain.on('nexus:screen-pick-response', (_e, payload) => {
    const pick = pendingPick;
    pendingPick = null;
    if (!pick) return;
    const source = payload && pick.sources.find((s) => s.id === payload.sourceId);
    if (!source) return pick.callback(null);
    pick.callback(payload.withAudio && process.platform === 'win32' ? { video: source, audio: 'loopback' } : { video: source });
  });
}

// ---------------------------------------------------------------- protocolo app://
function setupProtocol() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(WEB_ROOT, rel));
    if (!file.startsWith(WEB_ROOT)) return new Response('Proibido', { status: 403 });
    const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(WEB_ROOT, 'index.html');
    return net.fetch(pathToFileURL(target).toString());
  });
}

// ---------------------------------------------------------------- IPC
function setupIpc() {
  ipcMain.on('nexus:window', (_e, action) => {
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'toggle-maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (action === 'close') win.close();
  });
  ipcMain.handle('nexus:is-maximized', () => !!(win && win.isMaximized()));
  ipcMain.handle('nexus:update-check', () => checkForUpdates(true));
  ipcMain.handle('nexus:update-status', () => updateStatus);
  ipcMain.on('nexus:update-install', () => {
    if (autoUpdater && updateStatus.state === 'downloaded') {
      quitting = true;
      autoUpdater.quitAndInstall();
    }
  });
  ipcMain.on('nexus:notify', (_e, opts) => notify(opts || {}));
  ipcMain.on('nexus:badge', (_e, count) => setBadge(count));
  ipcMain.on('nexus:open-external', (_e, url) => {
    if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('nexus:get-startup', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('nexus:set-startup', (_e, enabled) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled, args: ['--hidden'] });
    if (tray) tray.setContextMenu(buildTrayMenu());
  });
}

// ---------------------------------------------------------------- ciclo de vida
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  setupProtocol();
  setupSession();
  setupIpc();
  createWindow();
  createTray();
  setupUpdater();
  sendDeepLink(findDeepLink(process.argv));
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  sendDeepLink(url);
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  // Continua na bandeja (tarefas e calls em segundo plano).
});

app.on('activate', showWindow);
