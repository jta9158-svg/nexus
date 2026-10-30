# Roblox no NEXUS

## Regra principal

O NEXUS **nunca** pede a sua senha do Roblox e **nunca** usa o cookie `.ROBLOSECURITY`. Só usamos APIs oficiais: as públicas (sem login) e, para receita, a **Open Cloud** com uma chave criada por você, com permissão mínima e que você pode revogar a qualquer momento.

Quem vê os dados: só quem tem um cargo com **“Ver métricas do Roblox”** (jogadores, visitas) e **“Ver finanças”** (valores) no servidor onde o jogo foi vinculado. Nada da sua conta é compartilhado automaticamente com quem instala o NEXUS.

## O que funciona hoje (versão 0.1.0)

| Dado | Fonte oficial | Como chega |
|---|---|---|
| Nome do jogo e ID do universo | `apis.roblox.com/universes/v1/places/{placeId}/universe` | ao vincular pelo **Place ID** |
| Jogadores online agora | `games.roblox.com/v1/games?universeIds=...` (`playing`) | botão **Atualizar** ou coleta automática |
| Visitas totais | mesma API (`visits`) | idem |
| Favoritos e máximo por servidor | mesma API (`favoritedCount`, `maxPlayers`) | idem |
| Histórico (gráfico) | as próprias coletas do NEXUS | a cada coleta |

Cada número aparece com a **origem** e o **horário da coleta** (ex.: “Fonte: games.roblox.com/v1/games · há 4 min”). O histórico só existe a partir do momento em que o NEXUS começa a coletar — a API pública não devolve o passado. Para coletar sozinho a cada 15 minutos, siga a seção 6 do `CONFIGURACAO.md`.

O que aparece como **indisponível** (e não é inventado): Robux recebidos, vendas de passes/itens, DevEx. Até a integração de receita, esses valores podem ser lançados à mão em **Finanças** (com status recebido / pendente / estimado).

## Receita pela API oficial (fase 6 — próximo passo)

A Roblox oferece a **Analytics Query API** (Open Cloud) com a métrica **`DailyRevenue`** ([documentação](https://create.roblox.com/docs/cloud/guides/analytics)):

* `POST https://apis.roblox.com/analytics-query-api/v1/universes/{universeId}/metrics`, chave no cabeçalho `x-api-key`.
* Permissão necessária: **`universe.analytics:read`** (sistema `universe-analytics`).
* Granularidade diária (`OneDay`), períodos com `startTime`/`endTime` em UTC; consultas grandes respondem `202` e são acompanhadas pelo `path` até `done: true`.
* Cada ponto vem com um `status`: `Valid`, `Projected` (estimativa que ainda pode mudar) ou `NotStatisticallySignificant`. O NEXUS vai guardar valores `Projected` como **estimado** e só os `Valid` como confirmados.
* Excesso de dados na consulta devolve `429` (código 3000): o NEXUS vai consultar em blocos menores.

Como o NEXUS vai usar:

1. Você (ou quem tiver “Gerenciar finanças”) cola a chave **uma vez**. Ela fica **só no servidor**, em uma área que o app não consegue ler; nunca aparece de novo na tela nem nos registros. Dá para trocar ou apagar a qualquer momento.
2. Uma coleta diária grava a receita por dia em **Finanças**, com origem `roblox_analytics` e um identificador por jogo e dia — reimportar **nunca duplica**.
3. O painel mostra receita por dia/semana/mês, separando confirmado × estimado, sempre com a origem.

### Criar a chave (quando formos ativar)

1. Entre no **Creator Dashboard** → **Credentials** → **API Keys** → **Create API Key**.
2. Nome: `NEXUS - receita`.
3. **Access Permissions** → **Select API System**: escolha o de **analytics** da experiência → selecione o **ALPHA - Templo da Magia** → em **Select Operations** marque só **`universe.analytics:read`**.
4. **Restrict IP addresses**: deixe desligado (as funções do Supabase não têm IP fixo). Por isso a chave deve ter **só** essa permissão de leitura.
5. Opcional: data de expiração. Observação da Roblox: chave **sem uso por 60 dias expira sozinha** — com a coleta diária isso não acontece.
6. **Save & Generate key** → copie a chave e cole no NEXUS (não mande por chat nem e-mail).

Fonte dos passos: [API keys — Roblox Creator Docs](https://create.roblox.com/docs/cloud/auth/api-keys).

## Conta Roblox (opcional, futuro)

O banco já tem a estrutura para conectar a conta Roblox por **OAuth 2.0** (login na página da própria Roblox, tokens guardados só no servidor e apagados ao desconectar). Isso serve para identificar a conta e listar os jogos automaticamente; não é necessário para a receita, que usa a chave acima.
