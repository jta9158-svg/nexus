# Distribuição: como cada pessoa instala o NEXUS

A página de download (`apps/site`, publicada no GitHub Pages) **reconhece o aparelho** e mostra o caminho certo. Também tem um QR code para abrir no celular.

## Windows 10/11

* Baixar **NEXUS-Setup.exe** (≈ 116 MB) e abrir. Instala em segundos, **sem pedir administrador**, com atalhos na área de trabalho e no menu Iniciar.
* Enquanto o instalador não for assinado digitalmente, o Windows mostra **“O Windows protegeu o computador”**: clique em **Mais informações → Executar assim mesmo**. Para eliminar o aviso, é preciso um certificado de assinatura (ver `CUSTOS.md`) e configurar os secrets `WINDOWS_CERT_*`.
* O app se **atualiza sozinho** a partir das Releases do GitHub (verifica ao abrir e a cada 6 h; instala ao reiniciar).
* Fechar a janela deixa o NEXUS na **bandeja** (perto do relógio), para calls e tarefas continuarem. Para sair de vez: clique com o botão direito no ícone → **Sair do NEXUS**.

## Android

1. **Recomendado — instalar pelo Chrome (PWA)**: abrir a página → **Abrir e instalar** → menu **⋮ → Instalar app**. Fica na gaveta de apps, recebe notificações e se atualiza sozinho. Não depende da Play Store nem de verificação de desenvolvedor.
2. **APK (NEXUS.apk)**: também disponível. Atenção: desde **30/09/2026** o Android no Brasil exige que apps instalados fora da Play Store venham de desenvolvedores registrados; para apps não registrados existe um “fluxo avançado” com espera de 24 h ([fonte](https://www.androidauthority.com/android-sideloading-changes-timeline-3679204/)). Para a equipe instalar o APK normalmente, registre o app na **conta gratuita de distribuição limitada (até 20 aparelhos)** ou faça a verificação completa / publique na Play Store.

## iPhone e iPad

* Abrir o NEXUS **no Safari** → **Compartilhar** → **Adicionar à Tela de Início** → **Adicionar**. Abre em tela cheia, com ícone próprio.
* Notificações funcionam com o app instalado na Tela de Início (iOS/iPadOS 16.4 ou mais novo).
* Calls de voz e vídeo funcionam; **compartilhar a tela não é permitido** pelo iOS no navegador.
* Versão na App Store: exige Apple Developer Program (US$ 99/ano) e um build nativo (fica para uma fase futura, se quiser).

## Mac e Linux

Pelo navegador (Chrome, Edge, Safari ou Firefox atualizados), em `/app/`. Funciona tudo, inclusive calls e compartilhar tela.

## Publicar uma versão nova

```bash
# 1. ajuste a versão em apps/desktop/package.json (ex.: 0.2.0) e faça commit
git tag v0.2.0
git push origin v0.2.0
```

O workflow **Lançar versão** gera e anexa à Release: `NEXUS-Setup.exe`, `latest.yml` e `.blockmap` (atualização automática do Windows) e `NEXUS.apk`. O workflow **Site e app web** publica a página e o app web a cada push na `main` — celulares e navegadores recebem a atualização na hora (aparece “Nova versão disponível → Atualizar”).

## Gerar localmente

```bash
cd apps/web && npm ci && npm run build                  # app web → apps/web/dist
cd ../desktop && npm ci && npm run dist:win             # instalador → apps/desktop/release/NEXUS-Setup.exe
cd ../mobile && npm ci && npm run apk:debug             # APK → android/app/build/outputs/apk/debug/
```

(No Linux, o instalador do Windows precisa do Wine; no Windows funciona direto. O APK precisa do JDK 21 e do Android SDK.)
