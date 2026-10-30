# Roteiro do NEXUS

Fases da especificação (seção 11) e onde cada uma está. ✅ pronto e testado · 🟡 parte pronta · ⏳ a fazer.

| Fase | Situação | O que falta |
|---|---|---|
| 1 — Análise técnica | ✅ | — (arquitetura, permissões e custos em `ARQUITETURA.md` e `CUSTOS.md`) |
| 2 — Base do NEXUS (interface, navegação, login, backend, banco) | 🟡 | publicar o backend (Supabase) e testar login/recuperação no servidor real |
| 3 — Comunicação (DMs, servidores, canais, calls, tela) | 🟡 | criar o projeto no LiveKit e testar calls entre computadores |
| 4 — Claude AI (conversas, contexto por projeto, ferramentas) | 🟡 | chave da API e teste real |
| 5 — Claude Companion | 🟡 | texto, tarefas e **voz nas calls** prontos (agente na LiveKit Cloud: transcrição Deepgram, voz Cartesia/Inworld, interrupção, modos, pausar/silenciar/tirar). Falta: testes A–K com o Claude real (créditos da API) e com a equipe |
| 6 — Roblox e finanças | 🟡 | métricas públicas com gráfico, lançamentos financeiros e exportação CSV prontos. Falta: **receita oficial** (Analytics Query API, `ROBLOX.md`) e relatório financeiro mensal |
| 7 — Desenvolvimento e organização | 🟡 | projetos, tarefas, bugs, versões do projeto, histórico e arquivos prontos. Falta: **versões de arquivos na tela** (o banco já guarda), comparar versões, **ponto de restauração** e **backups** testados |
| 8 — Distribuição | 🟡 | instalador, APK, PWA e página de download prontos. Falta: repositório no GitHub, publicar a página, instalar em um Windows limpo, validar o download |

## Próximas entregas (em ordem)

1. **Colocar no ar** (com você, ~30–60 min): Supabase, LiveKit, chave do Claude, GitHub. Depois disso, rodar a seção 4 de `TESTES.md`.
2. **Receita do Roblox** pela API oficial: chave guardada só no servidor, coleta diária, confirmado × estimado, sem duplicar.
3. **Versões de arquivos e restauração**: enviar nova versão, ver histórico, comparar, restaurar; ponto de restauração antes de mudanças grandes; rotina de backup (no plano gratuito do Supabase não há backup automático — exportação agendada para o GitHub ou outro armazenamento, ou plano Pro com backup diário).
4. **Voz do Claude nas calls** (fase 5): agente no LiveKit Agents, com indicador de escuta, silenciar/pausar/remover, interrupção (barge-in), política de turnos por modo. Só com a sua autorização de custos (≈ US$ 1–1,40 por hora de escuta, ver `CUSTOS.md`).
5. **Agente local no Windows** (opcional): permitir que o Companion, com permissão, leia projetos do computador e controle Roblox Studio/Blender pelas integrações oficiais — sempre com confirmação antes de alterar ou publicar.
6. **Assinatura digital** do instalador e do APK, e registro do app no programa de verificação do Android.

Nenhuma dessas etapas cria contas, contrata serviços ou gera gastos sem a sua autorização.
