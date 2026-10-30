# Testes do NEXUS

Situação em **29/10/2026**, versão **0.1.0**. Tudo abaixo foi executado de verdade; o que ainda não pôde ser testado está marcado como **pendente**, com o motivo.

## 1. Testes automáticos

| Conjunto | Como rodar | Resultado |
|---|---|---|
| Banco e regras de acesso (PostgreSQL 18 via PGlite, imitando o Supabase: Auth, Storage, Realtime) | `cd supabase/tests && npm install && npm test` | **131 passaram, 0 falharam** |
| Funções do servidor (Deno): cliente da API do Claude contra um servidor falso no formato oficial (streaming, `tool_use`, erro de crédito, custo), token do LiveKit (HS256), modos do Companion, regras de voz (nome “Claude”, silêncio, histórico, token de servidor) | `deno test --allow-net --allow-env supabase/functions/tests/` | **14 passaram, 0 falharam** |
| Agente de voz (Python): regras (chamado pelo nome, modos, vozes, troca de quem fala, comandos) e o agente em modo texto contra um servidor falso (responde quando chamado, não interrompe conversa, pausado/silenciado, histórico) | `cd apps/voice-agent && pip install -r requirements.txt && python -m unittest discover -s tests` | **11 passaram, 0 falharam** |
| Agente publicado na LiveKit Cloud | logs da LiveKit + despacho de teste para uma sala | trabalhador `nexus-claude` registrado; entrou na sala de teste, estado “ouvindo”, sem erros |
| Checagem de tipos das 5 funções | `deno check supabase/functions/*/index.ts` | sem erros |
| Checagem de tipos e build do app | `cd apps/web && npm run build` | sem erros |
| Visual com servidor **simulado** (dados de exemplo só no teste): PC 1536 px, iPad, iPhone, Android; telas de login com a dica de instalação, inclusive iPad que se identifica como Mac | `node apps/web/tests/visual.mjs` | 8 telas, sem erros de JavaScript |
| App do Windows (Electron) abrindo e mostrando o app | `xvfb-run node apps/web/tests/desktop-visual.mjs saida.png` | abriu e renderizou (no Linux) |
| Instalador do Windows | 7-Zip lista e testa o conteúdo do `NEXUS-Setup.exe` | todos os arquivos íntegros |
| APK Android | `aapt2 dump badging` e `apksigner verify` | pacote `app.nexus.mobile`, versão 0.1.0, assinatura de depuração válida |

### O que os 114 testes do banco cobrem

| Área | Testes | Exemplos |
|---|---|---|
| Cadastro e perfis | 7 | primeiro usuário vira administrador; nome “claude” reservado; ninguém altera o perfil de outra pessoa |
| Servidores, canais e cargos | 11 | modelo “Estúdio de jogos” (6 canais de texto, 4 de voz, 6 cargos); quem não é membro não vê nada; convites |
| Mensagens e menções | 14 | ninguém se passa pelo Claude nem por outra pessoa; @menção gera notificação; busca não vaza mensagens |
| Não lidas | 3 | contador de não lidas e menções |
| Canais privados e cargos | 8 | canal privado só para cargos liberados; quem gerencia cargos **não** consegue se dar administrador |
| Mensagens privadas | 6 | só os participantes leem; só quem divide servidor abre conversa |
| Projetos e histórico | 5 | histórico gravado por gatilho e impossível de forjar |
| Arquivos e storage | 10 | arquivo privado escondido; anexos só para membros; ninguém troca o avatar de outra pessoa |
| Finanças | 5 | escondidas de quem não tem permissão; recebido × pendente × bruto × taxas; importação nunca duplica |
| Acesso ao Claude | 8 | só administrador, pessoas liberadas e cargos com “Usar o Claude”; uso registrado só pelo servidor |
| Claude Companion | 28 | ver tabela da seção 2 |
| Tempo real | 4 | presença/“em call” do servidor só para membros; canal da DM só para participantes |
| Moderação e posse | 5 | banido perde acesso e não volta pelo convite; só o dono transfere o servidor |

## 2. Testes obrigatórios do Claude Companion (seção 5.11 da especificação)

| Teste | O que já foi verificado | Situação |
|---|---|---|
| **A — Resposta direcionada** (“Claude, qual é o status do ALPHA?”) | @Claude é detectado no banco; a função `claude-channel` monta o contexto (30 últimas mensagens, tarefas do projeto, métricas com origem) consultando com a identidade de quem perguntou e instrui a nunca inventar; o cliente da API foi testado contra o servidor falso | **pendente** o teste com a chave real da API |
| **B — Conversa sem participação** | Texto: só responde a @Claude. Voz: só responde quando ouve “Claude” (exceto “Participante ativo”, que decide e pode ficar em silêncio) — testado no agente em modo texto e nas regras | ✅ |
| **C — Trabalho em segundo plano** | Tarefas rodam no servidor, salvam o estado a cada passo e continuam com o app fechado; estados e transições testados no banco | **pendente** a execução real (chave da API) |
| **D — Voz durante tarefa** | Voz (agente na LiveKit) e tarefas (servidor) são processos separados; o Claude na call lê o andamento das tarefas de quem o chamou | implementado · **pendente** o teste real |
| **E — Dúvida bloqueante** | Testado no banco: a pergunta pausa só a tarefa afetada, vira notificação, só a dona responde, e a tarefa volta para a fila e é retomada | ✅ no banco · **pendente** com o Claude real |
| **F — Interrupção da fala** | Interrupção ligada (a fala do Claude para quando alguém fala); “Silenciar” e “Pausar escuta” na call; tarefas nunca são canceladas pela voz | implementado · **pendente** o teste real |
| **G — Permissões** | Testado no banco: permissão não concedida continua negada, só muda pela função registrada, ninguém vê as permissões de outra pessoa; o executor registra “Permissão negada” no histórico e avisa o Claude | ✅ |
| **H — Concorrência** | Testado no banco: duas tarefas no mesmo arquivo nunca rodam juntas (a segunda espera e informa o motivo), limite de tarefas simultâneas por pessoa, e a da fila começa quando o recurso é liberado | ✅ |
| **I — Falhas de conexão** | O cliente da API tenta de novo (3 vezes) em sobrecarga/limite; se falhar, a tarefa fica como **falhou** com a mensagem — nunca como concluída — e pode ser repetida; execução que parou de responder é retomada do último estado salvo | ✅ no código e no teste do cliente · **pendente** a simulação com o serviço real |
| **J — Privacidade** | Testado no banco: tarefas, dúvidas, permissões e registros são privados; finanças e arquivos privados escondidos; presença das calls só para membros; o Claude só entra numa call quando alguém com cargo e permissões “Ouvir/Falar” chama; quem não é membro não chama nem vê; finanças nunca são faladas na call; contexto só com o que **todos** na call podem ver; nada é gravado | ✅ |
| **K — Teste com equipe** | — | **pendente**: precisa do servidor publicado e de computadores diferentes |

Modos (seção 5.2) — testado no banco: em “Trabalhador em segundo plano” a dúvida que não bloqueia vai para as pendências sem notificar e não pausa a tarefa; a bloqueante notifica; em “Híbrido” a dúvida média notifica. Modo inválido é recusado.

## 3. Servidor real (Supabase, 29/10/2026)

| Verificação | Resultado |
|---|---|
| As 7 migrações aplicadas no projeto real | ✅ sem erros |
| Tabelas sem RLS no esquema público | ✅ nenhuma (37 tabelas protegidas, 101 políticas) |
| Gatilho de novo usuário, 4 buckets de arquivos, 15 tabelas no tempo real | ✅ |
| 5 funções publicadas e respondendo (sem login → 401 “Faça login para continuar.”) | ✅ |
| App compilado com o servidor real: abre na tela de login e o servidor de login responde (senha errada → “E-mail ou senha incorretos.”) | ✅ |

## 4. Testes que dependem das contas (a fazer juntos)

Depois de configurar Supabase, LiveKit e a chave do Claude (`CONFIGURACAO.md`):

1. Cadastro, confirmação de e-mail, login e recuperação de senha.
2. Duas contas em aparelhos diferentes: servidor, convite, mensagens em tempo real, anexos, DMs, notificações.
3. Call entre dois computadores: voz, câmera, compartilhamento de tela (com áudio no Windows), e voz/vídeo no celular.
4. Claude: chat com imagem/PDF/script, @Claude no canal, limites e orçamento.
5. Companion: testes A, C, E, G, H e I com o Claude real.
6. Instalação do `NEXUS-Setup.exe` em um Windows 10/11 limpo, atualização automática de uma versão para a próxima.
7. Instalação no iPhone/iPad (Tela de Início) e no Android (Chrome e APK).
8. Teste K com a equipe.

Os resultados serão registrados aqui.
