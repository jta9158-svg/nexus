# Custos do NEXUS

Valores conferidos nas páginas oficiais em **29/10/2026** (dólar americano). Preços mudam — confira antes de contratar. **Nada foi contratado**: tudo abaixo depende da sua autorização.

## 1. Serviços necessários agora

### Supabase (banco, login, tempo real, arquivos, funções) — <https://supabase.com/pricing>

| | Free (US$ 0) | Pro (US$ 25/mês) |
|---|---|---|
| Banco | 500 MB | 8 GB (+US$ 0,125/GB) |
| Usuários ativos/mês | 50.000 | 100.000 |
| Tráfego de saída | 5 GB | 250 GB (+US$ 0,09/GB) |
| Arquivos | 1 GB | 100 GB |
| Tamanho máximo por arquivo | 50 MB | maior (configurável) |
| Conexões simultâneas de tempo real | 200 | 500 |
| Mensagens de tempo real/mês | 2 milhões | 5 milhões |
| Execuções de funções/mês | 500.000 | 2 milhões |
| Observação | **pausa após 1 semana sem uso** | sem pausa, com backups |

Para uma equipe de até ~20 pessoas usando todo dia, o **Free** costuma bastar (o uso diário evita a pausa). O limite que chega primeiro normalmente é **1 GB de arquivos** — se forem subir muitos modelos 3D, o Pro resolve.

### LiveKit Cloud (calls de voz, vídeo e tela) — <https://livekit.com/pricing>

| | Build (US$ 0, sem cartão) | Ship (a partir de US$ 50/mês) |
|---|---|---|
| Minutos de conexão WebRTC | 5.000/mês | 150.000/mês (+US$ 0,0005/min) |
| Tráfego | 50 GB | 250 GB (+US$ 0,12/GB) |
| Pessoas conectadas ao mesmo tempo | 100 | 1.000 |
| Minutos de agente de voz (Companion) | 1.000/mês | 5.000/mês (+US$ 0,01/min) |

**Compartilhamento de tela:** a internet de cada pessoa que assiste conta nos 50 GB do Build. Por hora, para cada pessoa assistindo: Econômica ≈ 0,7 GB · Texto nítido ≈ 1,4 GB · Fluida (padrão) ≈ 2,3 GB · Máxima (60 fps) ≈ 4 GB. Ex.: 1 h por dia de tela Fluida para 2 pessoas ≈ 4,6 GB/dia → os 50 GB acabam em ~11 dias. Para durar o mês, use a Econômica ou o Texto nítido no dia a dia e a Máxima só quando precisar.

**Anti-ruído (Krisp):** incluído em todos os planos, inclusive o Build gratuito, sem custo por minuto (“Background noise suppression … Krisp NC: Yes” na tabela de preços). Roda no aparelho de quem fala; o pacote (~6 MB, ~2 MB compactado) é baixado só na primeira call. O “isolamento de voz” (outro modelo, que também tira vozes de fundo) tem só 100 min/mês no Build — o NEXUS **não** usa esse.

Conta de minutos = pessoas × minutos. Ex.: 5 pessoas por 2 h/dia → 5 × 120 × 30 = **18.000 min/mês** → passa do Build; cabe no Ship. Com calls ocasionais (≈ 8 h/mês de call com 5 pessoas) o Build gratuito basta. Alternativa: hospedar o LiveKit (código aberto) num servidor próprio (~US$ 5–20/mês), com mais trabalho de manutenção.

### Claude (API da Anthropic) — <https://platform.claude.com/docs/en/about-claude/pricing>

Preço por **milhão de tokens** (entrada / saída):

| Modelo | Entrada | Saída | Uso no NEXUS |
|---|---|---|---|
| Claude Haiku 5.5 | US$ 0,10 | US$ 0,50 | opção econômica |
| **Claude Sonnet 5.5** | US$ 2 | US$ 10 | chat e @Claude (padrão) |
| Claude Opus 5.5 | US$ 4 | US$ 20 | tarefas do Companion (padrão) |

Estimativas (sem cache):
* Uma mensagem de chat típica (~3.000 tokens de contexto + ~600 de resposta) no Sonnet ≈ **US$ 0,012**. 1.000 mensagens/mês ≈ **US$ 12**.
* Uma tarefa longa do Companion no Opus (≈ 20 passos, lendo scripts) ≈ **US$ 1 a 3**.

**Importante sobre o plano Claude Max:** o uso da API é cobrado à parte do plano do Claude ([fonte](https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan)). Porém, os planos **Max incluem créditos mensais de API**: **US$ 100/mês no Max 5x** e **US$ 200/mês no Max 20x**, depois de 7 dias no plano, vinculando uma organização do Console em *Settings → Billing → API credits* ([fonte](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)). Os créditos não acumulam de um mês para o outro. Com isso, o uso normal do NEXUS por uma equipe pequena pode ficar **sem custo extra**.

O NEXUS tem limites próprios: tokens por pessoa por dia e **orçamento mensal** (Configurações → Administração). Ao atingir, o Claude para até virar o mês.

### GitHub (código, builds automáticos, página de download)

* Repositório **público**: GitHub Actions e GitHub Pages grátis.
* Repositório **privado**: o plano grátis tem uma cota mensal de minutos de Actions (builds no Windows consomem minutos em dobro) e o GitHub Pages em repositório privado exige plano pago. *(confirme os números atuais em github.com/pricing)*
* GitHub Releases (onde ficam o `.exe` e o `.apk`): grátis.

## 2. Opcionais

| Item | Custo | Para quê |
|---|---|---|
| Certificado de assinatura de código (Windows) | estimativa: ~US$ 10/mês (assinatura em nuvem da Microsoft) ou ~US$ 200–400/ano (certificado OV) — *confirmar disponibilidade para pessoa física no Brasil* | remove o aviso "O Windows protegeu o computador" |
| Apple Developer Program | US$ 99/ano | publicar na App Store / TestFlight (iPhone/iPad hoje funcionam como PWA, sem custo) |
| Google Play Console | US$ 25 (uma vez) | publicar na Play Store |
| Verificação de desenvolvedor Android | conta de **distribuição limitada gratuita (até 20 aparelhos)** ou verificação completa | desde **30/09/2026** o Android no Brasil exige app registrado para instalar APK fora da Play Store sem o "fluxo avançado" com espera de 24 h ([fonte](https://www.androidauthority.com/android-sideloading-changes-timeline-3679204/)). A instalação pelo Chrome (PWA) não tem essa exigência |
| SMTP próprio (e-mails de confirmação/recuperação) | geralmente grátis para pouco volume | o e-mail embutido do Supabase tem limite baixo de envios por hora |

## 3. Claude Companion por voz (fase 5)

Preços por minuto via LiveKit Inference ([fonte](https://livekit.com/pricing)):

| Peça | Opção | US$/min |
|---|---|---|
| Transcrição (STT) | Deepgram Nova-3 | 0,0048 |
| Voz (TTS) | Inworld Realtime TTS 2.0 Flash | 0,0090 |
| Voz (TTS) | Deepgram Aura-2 | 0,0180 |
| Voz (TTS) | Cartesia Sonic 3 | 0,0300 |
| Sessão do agente | acima da franquia (1.000 min grátis no Build) | 0,0100 |

**Estimativa por hora de Claude ouvindo a call:** transcrição ~US$ 0,29 + sessão do agente ~US$ 0,60 (fora da franquia) + voz só quando ele fala (~5 min → ~US$ 0,05–0,15) + respostas do Claude (~30 → ~US$ 0,30) ≈ **US$ 1,00–1,40 por hora**. Com 1 h/dia ≈ **US$ 30–45/mês** (parte coberta pelas franquias gratuitas e pelos créditos do Max).

## 4. Cenários mensais (estimativa)

| Cenário | Supabase | LiveKit | Claude (API) | Voz do Companion | Total |
|---|---|---|---|---|---|
| **5 pessoas**, calls ocasionais, uso leve do Claude | US$ 0 | US$ 0 | ~US$ 5–20 (ou US$ 0 com créditos do Max) | — | **US$ 0–20** |
| **5 pessoas**, call 2 h/dia | US$ 0 | US$ 50 | ~US$ 10–30 | +US$ 30–45 se ativar | **US$ 50–125** |
| **20 pessoas** | US$ 0–25 | US$ 50 | ~US$ 30–100 | +US$ 30–45 | **US$ 80–220** |
| **100 pessoas** | US$ 25 + excedentes | ~US$ 65–100 | ~US$ 100–400 (depende dos limites) | +US$ 45–90 | **US$ 230–600** |

Hospedagem da página de download e do app web: **US$ 0** (GitHub Pages).
