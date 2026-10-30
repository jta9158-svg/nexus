# Configurar o NEXUS (passo a passo)

## Situação atual (29/10/2026)

| Parte | Situação |
|---|---|
| Supabase | ✅ projeto `nexus` (organização NEXUS, plano gratuito, região São Paulo — `qeugxkmoirqwbmdfwbrt`) |
| Banco | ✅ as 9 migrações aplicadas; 41 tabelas, todas com regras de acesso (RLS) |
| Servidores | ✅ estilo Discord: só entra quem tem link de convite; o servidor principal pede também o **PIN** (Configurações do servidor → Convites, só quem gerencia vê) |
| Claude | ✅ “Claude só para mim” ligado: só o administrador vê e usa o Claude (Configurações → Administração) |
| Login | ✅ cadastro por e-mail e senha (mínimo 8 caracteres). **Confirmação de e-mail desligada**: o e-mail padrão do Supabase só entrega para a equipe do projeto (2 por hora). Para a recuperação de senha funcionar para todos, configure um SMTP próprio (passo 1.2) |
| Funções | ✅ `claude-chat`, `claude-channel`, `livekit-token`, `roblox`, `companion-run` publicadas; segredo `NEXUS_INTERNAL_SECRET` configurado |
| Coleta do Roblox | ✅ agendada a cada 15 minutos (pg_cron) |
| Calls (LiveKit) | ✅ projeto `alpha` na LiveKit Cloud; segredos `LIVEKIT_*` configurados |
| Claude na call (voz) | ✅ agente `nexus-claude` publicado na LiveKit Cloud (`tools/deploy-voice-agent.mjs`); serviço de voz ativado |
| Claude (API) | 🟡 chave `ANTHROPIC_API_KEY` configurada e válida (a API responde); falta **crédito** na organização da API. Os créditos do Max só aparecem para vincular depois de **7 dias de plano** (passo 2) |
| Site e instaladores | repositório `jta9158-svg/nexus` no GitHub; site em `https://jta9158-svg.github.io/nexus/` |

Segredos do projeto (só para o dono): <https://supabase.com/dashboard/project/qeugxkmoirqwbmdfwbrt/functions/secrets>

Os passos abaixo explicam como montar tudo do zero (por exemplo, em outro projeto).

Tempo estimado: **30 a 60 minutos**. Tudo nos planos gratuitos, exceto o uso da API do Claude (coberto pelos créditos mensais do plano Max, se você tiver).

> Guarde em um lugar seguro (gerenciador de senhas) tudo que estiver marcado como **SECRETO**. Nunca coloque esses valores no app, no chat da equipe ou no GitHub.

## 1. Supabase (o servidor)

1. Crie uma conta em <https://supabase.com> e um projeto novo:
   * Nome: `nexus` · Região: **South America (São Paulo)** · Senha do banco: gere uma forte (**SECRETO**).
2. Em **Project Settings → API**, anote:
   * **Project URL** (ex.: `https://abcd1234.supabase.co`) — público.
   * **anon / publishable key** — público (vai no app).
   * **service_role / secret key** — **SECRETO** (só o servidor usa; você não vai precisar copiar para lugar nenhum).

### 1.1 Criar as tabelas

Opção A — pelo navegador (mais simples): abra **SQL Editor → New query**, cole o conteúdo de cada arquivo de `supabase/migrations/`, **na ordem**, e clique em **Run**:

1. `20261028000100_core.sql`
2. `20261028000200_messages.sql`
3. `20261028000300_projects_files.sql`
4. `20261028000400_claude.sql`
5. `20261028000500_finance_roblox.sql`
6. `20261028000600_companion.sql`
7. `20261028000700_storage_realtime.sql`

Opção B — pelo terminal (precisa do Node.js instalado):

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

### 1.2 Login e e-mails

Em **Authentication → URL Configuration**:
* **Site URL**: `https://SEU-USUARIO.github.io/nexus/app/` (depois do passo 4).
* **Redirect URLs**: adicione o mesmo endereço e `http://localhost:5173`.

O e-mail embutido do Supabase envia poucos e-mails por hora. Para a equipe toda se cadastrar no mesmo dia, configure um SMTP (ex.: Resend ou o SMTP do seu provedor) em **Authentication → SMTP Settings**.

### 1.3 Funções do servidor e segredos

Com o terminal (Node.js instalado), na pasta do projeto:

```bash
npx supabase functions deploy claude-chat claude-channel livekit-token roblox companion-run
npx supabase secrets set \
  ANTHROPIC_API_KEY=sk-ant-...            # passo 2 (SECRETO)
  LIVEKIT_URL=wss://SEU-PROJETO.livekit.cloud \
  LIVEKIT_API_KEY=API... \
  LIVEKIT_API_SECRET=...                  # passo 3 (SECRETO)
  NEXUS_INTERNAL_SECRET=$(openssl rand -hex 32)   # permite que tarefas longas continuem sozinhas
```

## 2. Claude (API da Anthropic)

1. Entre em <https://platform.claude.com> (Console) com a sua conta.
2. **Se você tem o plano Max** (US$ 100/mês no Max 5x, US$ 200/mês no Max 20x, sem cartão):
   * A opção só aparece depois de **7 dias no plano** — antes disso ela fica escondida.
   * Em claude.ai → **Configurações → Cobrança**, na parte de **créditos da API** (“API credits”), clique em **Vincular organização** (“Link organization”).
   * Escolha a organização do Console **onde está a chave**. Não crie uma nova: depois só dá para trocar falando com o suporte da Anthropic.
   * Os créditos aparecem no Console em **Billing → Promotional credits**. Não acumulam de um mês para o outro; quando acabam, a API para até o mês seguinte (nada é cobrado no plano).
   * Os “Créditos de uso” do claude.ai são outra coisa e **não** servem para a API.
   * Fonte: [API credits for Max and Team plans](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers).
3. Sem o Max: no Console, **Billing → Buy credits** (pré-pago).
4. No Console, em **API Keys**, crie uma chave chamada `nexus` (**SECRETO**) e configure um **limite de gastos** em *Limits*.
5. Coloque a chave no `supabase secrets set ANTHROPIC_API_KEY=...` (passo 1.3).
6. Para conferir, abra o Claude no NEXUS e mande “oi”. Se faltar crédito, o app avisa isso com estas instruções.

No app, em **Configurações → Administração**, ajuste: modelo do chat, modelo das tarefas, limite diário por pessoa e orçamento mensal.

## 3. LiveKit (calls)

1. Crie uma conta em <https://cloud.livekit.io> (plano Build, sem cartão) e um projeto `nexus`.
2. Em **Settings → Keys**, crie uma chave e anote **URL** (`wss://...`), **API Key** e **API Secret** (**SECRETO**).
3. Coloque no `supabase secrets set` (passo 1.3).

## 4. GitHub (código, página de download e instaladores)

1. Crie um repositório `nexus` (público recomendado — Actions e Pages grátis) e envie este código.
2. **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables** (valores públicos):
   * `SUPABASE_URL` = Project URL
   * `SUPABASE_ANON_KEY` = chave anon/publishable
   * `PUBLIC_SITE_URL` = `https://SEU-USUARIO.github.io/nexus`
4. Rode o workflow **“Site e app web”** (aba Actions). A página de download fica em `https://SEU-USUARIO.github.io/nexus/` e o app em `.../nexus/app/`.
5. Lance a primeira versão criando a tag `v0.1.0` (ou rode **“Lançar versão”** em Actions). O GitHub gera o `NEXUS-Setup.exe` e o `NEXUS.apk` na página **Releases**, e a página de download passa a apontar para eles.

Opcional (Secrets, **SECRETOS**): `WINDOWS_CERT_P12_BASE64` e `WINDOWS_CERT_PASSWORD` (assinatura do Windows); `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (assinatura do Android).

## 5. Primeiro acesso

1. Abra o app e **crie sua conta primeiro** — a primeira conta vira **administrador do NEXUS** (quem controla o uso do Claude).
2. Crie o servidor **“ALPHA - Templo da Magia”** com o modelo **Estúdio de jogos** (já vem com #geral, #anúncios, #desenvolvimento, #ideias, #bugs, #equipe, 4 salas de voz e os cargos Desenvolvedor, Scripter, Modelador e Tester).
3. Menu do servidor → **Convidar pessoas** → mande o link para a equipe.
4. Dê os cargos certos em **Configurações do servidor → Membros**. Quem tiver “Usar o Claude” pode chamar @Claude.
5. Em **Projetos**, crie o projeto do ALPHA e, em **Faturamento Roblox**, vincule o jogo pelo **Place ID**.

## 6. Coleta automática das métricas do Roblox (opcional)

No Supabase: **Database → Extensions**, ative `pg_cron` e `pg_net`. Depois, no SQL Editor:

```sql
select cron.schedule('nexus-roblox-coleta', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://SEU-PROJETO.supabase.co/functions/v1/roblox',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-nexus-internal', 'MESMO_VALOR_DO_NEXUS_INTERNAL_SECRET'),
    body := '{"action":"collect"}'::jsonb
  );
$$);
```

Isso guarda jogadores online e visitas a cada 15 minutos, formando o histórico do gráfico.
