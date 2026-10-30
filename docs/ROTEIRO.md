# Roteiro do NEXUS

Fases da especificação (seção 11) e onde cada uma está. ✅ pronto e testado · 🟡 parte pronta · ⏳ a fazer.

| Fase | Situação | O que falta |
|---|---|---|
| 1 — Análise técnica | ✅ | — (arquitetura, permissões e custos em `ARQUITETURA.md` e `CUSTOS.md`) |
| 2 — Base do NEXUS (interface, navegação, login, backend, banco) | 🟡 | backend no ar; cadastro e login testados no servidor real. Falta: SMTP próprio para a recuperação de senha e o teste com duas contas |
| 3 — Comunicação (DMs, servidores, canais, calls, tela) | 🟡 | calls no ar (LiveKit Cloud), com qualidade de tela ajustável. Falta: testar entre dois computadores e no celular |
| 4 — Claude AI (conversas, contexto por projeto, ferramentas) | 🟡 | chave configurada e válida. Falta: crédito na conta da API (créditos do Max, liberados após 7 dias de plano) e o teste real |
| 5 — Claude Companion | 🟡 | texto, tarefas e **voz nas calls** prontos (agente na LiveKit Cloud: transcrição Deepgram, voz Cartesia/Inworld, interrupção, modos, pausar/silenciar/tirar). Falta: testes A–K com o Claude real (créditos da API) e com a equipe |
| 6 — Roblox e finanças | 🟡 | métricas públicas com gráfico, lançamentos financeiros e exportação CSV prontos. Falta: **receita oficial** (Analytics Query API, `ROBLOX.md`) e relatório financeiro mensal |
| 7 — Desenvolvimento e organização | 🟡 | projetos, tarefas, bugs, versões do projeto, histórico e arquivos prontos. Falta: **versões de arquivos na tela** (o banco já guarda), comparar versões, **ponto de restauração** e **backups** testados |
| 8 — Distribuição | 🟡 | repositório no GitHub, página de download no ar e versão 0.1.1 publicada (instalador e APK). Falta: instalar num Windows limpo, testar a atualização automática e a assinatura digital |

## Próximas entregas (em ordem)

1. **Ativar o Claude**: vincular os créditos de API do Max (`CONFIGURACAO.md`, passo 2) e rodar a seção 4 de `TESTES.md` com a equipe (chat, @Claude, Companion A–K, Claude na call).
2. **Receita do Roblox** pela API oficial: chave guardada só no servidor, coleta diária, confirmado × estimado, sem duplicar.
3. **Versões de arquivos e restauração**: enviar nova versão, ver histórico, comparar, restaurar; ponto de restauração antes de mudanças grandes; rotina de backup (no plano gratuito do Supabase não há backup automático — exportação agendada para o GitHub ou outro armazenamento, ou plano Pro com backup diário).
4. **Agente local no Windows** (opcional): permitir que o Companion, com permissão, leia projetos do computador e controle Roblox Studio/Blender pelas integrações oficiais — sempre com confirmação antes de alterar ou publicar.
5. **Assinatura digital** do instalador e do APK, e registro do app no programa de verificação do Android.

Nenhuma dessas etapas cria contas, contrata serviços ou gera gastos sem a sua autorização.
