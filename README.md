# NEXUS

Central da equipe do **ALPHA — Templo da Magia** (e de outros jogos): chat e calls no estilo Discord, Claude AI integrado, Claude Companion trabalhando em segundo plano, projetos, arquivos, finanças e métricas do Roblox.

Funciona no **Windows** (app instalável), no **navegador** e como app no **iPhone, iPad e Android**.

## O que já está pronto (versão 0.1.2)

| Área | Situação |
|---|---|
| Interface (PC, tablet e celular) | ✅ pronta, igual ao layout de referência; testada em 1536 px, iPad, iPhone e Android |
| Login, cadastro, recuperação de senha | ✅ no ar — cadastro e login testados no servidor real; a recuperação de senha precisa de um SMTP próprio |
| Servidores no estilo Discord | ✅ cada pessoa cria o próprio servidor (modelos Amigos, Jogos, Estudo, Estúdio ou do zero); **só entra com link de convite** (PIN opcional, com limite de tentativas); categorias de canais com arrastar e soltar; cargos com ordem e cor livre; apelido no servidor; banimentos; transferir dono; aviso de “entrou no servidor” |
| Regras de acesso | ✅ **188 testes passando** (`docs/TESTES.md`) |
| Claude só para o administrador | ✅ padrão: ninguém além do administrador vê ou usa o Claude (o servidor também bloqueia); dá para liberar em Configurações → Administração |
| Chat em tempo real, menções, anexos, busca, não lidas, DMs e grupos | ✅ implementado — falta testar no servidor real |
| Calls de voz, vídeo e compartilhamento de tela | ✅ no ar (LiveKit Cloud), com qualidade de tela ajustável, volume por pessoa e tela cheia |
| Claude AI (chat com histórico, imagens, PDF, scripts, contexto do projeto) | ✅ implementado; chave da API configurada — falta **crédito** na conta da API (créditos do Max, `docs/CONFIGURACAO.md` passo 2) |
| @Claude nos canais | ✅ implementado — falta crédito na conta da API |
| Claude Companion: modos, tarefas em segundo plano, dúvidas, permissões, histórico | ✅ implementado (executor no servidor); regras testadas no banco — falta crédito na conta da API |
| Claude Companion **por voz nas calls** | ✅ agente publicado na LiveKit Cloud (`apps/voice-agent`): chamar, pausar escuta, silenciar, tirar; responde quando chamam “Claude” — falta a conversa real (créditos da API) |
| Projetos, tarefas, bugs, versões, histórico | ✅ implementado |
| Arquivos (pastas, busca, privados, links, ideias) | ✅ implementado |
| Finanças (receitas, despesas, recebido × pendente × estimado, taxas, CSV) | ✅ implementado |
| Roblox: jogadores online, visitas, favoritos (API pública oficial) | ✅ implementado |
| Roblox: receita/Robux pela API oficial (Analytics Query API) | ⏳ fase 6 — precisa de uma chave da Open Cloud sua |
| Instalador Windows (.exe) | ✅ gerado e verificado (`apps/desktop`) |
| App Android (.apk) | ✅ gerado e verificado (`apps/mobile`) |
| iPhone/iPad | ✅ instalável pela Tela de Início (PWA) |
| Página de download que reconhece o aparelho | ✅ pronta (`apps/site`) |
| Publicação automática (GitHub Actions) | ✅ no ar: https://jta9158-svg.github.io/nexus/ |

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
