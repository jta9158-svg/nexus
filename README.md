# NEXUS

Central da equipe do **ALPHA — Templo da Magia** (e de outros jogos): chat e calls no estilo Discord, Claude AI integrado, Claude Companion trabalhando em segundo plano, projetos, arquivos, finanças e métricas do Roblox.

Funciona no **Windows** (app instalável), no **navegador** e como app no **iPhone, iPad e Android**.

## O que já está pronto (versão 0.1.0)

| Área | Situação |
|---|---|
| Interface (PC, tablet e celular) | ✅ pronta, igual ao layout de referência; testada em 1536 px, iPad, iPhone e Android |
| Login, cadastro, recuperação de senha | ✅ implementado (Supabase Auth) — falta testar no servidor real |
| Servidores, canais, cargos e permissões, convites, banimento | ✅ implementado; **114 testes de acesso passando** (`docs/TESTES.md`) |
| Chat em tempo real, menções, anexos, busca, não lidas, DMs e grupos | ✅ implementado — falta testar no servidor real |
| Calls de voz, vídeo e compartilhamento de tela | ✅ implementado (LiveKit) — falta configurar o LiveKit e testar entre computadores |
| Claude AI (chat com histórico, imagens, PDF, scripts, contexto do projeto) | ✅ implementado; cliente da API testado — falta a chave da API |
| @Claude nos canais | ✅ implementado — falta a chave da API |
| Claude Companion: modos, tarefas em segundo plano, dúvidas, permissões, histórico | ✅ implementado (executor no servidor); regras testadas no banco — falta a chave da API |
| Claude Companion **por voz nas calls** | ⏳ fase 5 (arquitetura definida em `docs/ARQUITETURA.md`) |
| Projetos, tarefas, bugs, versões, histórico | ✅ implementado |
| Arquivos (pastas, busca, privados, links, ideias) | ✅ implementado |
| Finanças (receitas, despesas, recebido × pendente × estimado, taxas, CSV) | ✅ implementado |
| Roblox: jogadores online, visitas, favoritos (API pública oficial) | ✅ implementado |
| Roblox: receita/Robux pela API oficial (Analytics Query API) | ⏳ fase 6 — precisa de uma chave da Open Cloud sua |
| Instalador Windows (.exe) | ✅ gerado e verificado (`apps/desktop`) |
| App Android (.apk) | ✅ gerado e verificado (`apps/mobile`) |
| iPhone/iPad | ✅ instalável pela Tela de Início (PWA) |
| Página de download que reconhece o aparelho | ✅ pronta (`apps/site`) |
| Publicação automática (GitHub Actions) | ✅ pronta — falta criar o repositório |

Nada aparece como "funcionando" sem estar: integrações sem configuração mostram a limitação na tela (ex.: "Robux recebidos: indisponível sem integração oficial").

## Estrutura

```
apps/web       App (React + TypeScript + Tailwind) — usado no navegador, no PWA, no Windows e no Android
apps/desktop   App do Windows (Electron): bandeja, notificações, tela, atualização automática, instalador NSIS
apps/mobile    App Android (Capacitor)
apps/site      Página de download (detecta Windows / Android / iPhone / iPad)
supabase       Banco (migrations com regras de acesso), Edge Functions (Claude, calls, Roblox, Companion) e testes
docs           Arquitetura, custos, configuração, distribuição, Roblox, testes e roteiro
brand, tools   Logo e geração de ícones
```

## Começar

1. Leia **`docs/CUSTOS.md`** (o que é grátis e o que custa).
2. Siga **`docs/CONFIGURACAO.md`** (Supabase, LiveKit, chave do Claude, GitHub).
3. Para publicar e instalar: **`docs/DISTRIBUICAO.md`**.
4. Roblox (o que é coletado e como ligar a receita oficial): **`docs/ROBLOX.md`**.
5. O que foi testado e o que falta testar: **`docs/TESTES.md`** · próximos passos: **`docs/ROTEIRO.md`** · como tudo se conecta: **`docs/ARQUITETURA.md`**.

Desenvolvimento local:

```bash
cd apps/web && npm install && npm run dev        # app em http://localhost:5173
cd supabase/tests && npm install && npm test     # testes do banco
cd apps/desktop && npm install && npm start      # app do Windows (precisa do apps/web/dist)
```
