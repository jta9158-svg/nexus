// Configuração do instalador do NEXUS para Windows (electron-builder).
// Variáveis opcionais:
//   NEXUS_VERSION        versão do app (ex.: 0.2.0) — o CI usa a tag
//   NEXUS_GH_OWNER/REPO  repositório no GitHub para publicar e atualizar
//   NEXUS_SKIP_EXE_EDIT  "1" para não editar o .exe (build no Linux sem wine)
'use strict';
const owner = process.env.NEXUS_GH_OWNER;
const repo = process.env.NEXUS_GH_REPO;

module.exports = {
  appId: 'app.nexus.desktop',
  productName: 'NEXUS',
  copyright: 'Copyright © 2026 NEXUS',
  extraMetadata: process.env.NEXUS_VERSION ? { version: process.env.NEXUS_VERSION } : undefined,
  directories: { output: 'release', buildResources: 'build' },
  files: ['main.cjs', 'preload.cjs', 'package.json', 'build/icon.ico', 'build/icon.png', 'build/tray.png', 'build/tray@2x.png'],
  extraResources: [{ from: 'web', to: 'web' }],
  asar: true,
  protocols: [{ name: 'NEXUS', schemes: ['nexus'] }],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    artifactName: 'NEXUS-Setup.${ext}',
    signAndEditExecutable: process.env.NEXUS_SKIP_EXE_EDIT !== '1',
    requestedExecutionLevel: 'asInvoker',
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: 'NEXUS',
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    uninstallDisplayName: 'NEXUS',
    deleteAppDataOnUninstall: false,
    language: '1046',
    installerLanguages: ['pt_BR'],
    runAfterFinish: true,
  },
  publish: owner && repo ? [{ provider: 'github', owner, repo, releaseType: 'release' }] : null,
};
