// NEXUS — Dados públicos do Roblox (jogadores online, visitas, favoritos).
// POST { action: 'resolve', place_id }           → { universe_id, root_place_id, name }
// POST { action: 'refresh', universe_ids: [...] } → coleta e grava em roblox_stats
// POST { action: 'collect' } + cabeçalho x-nexus-internal → coleta de todos os jogos vinculados (agendamento)
// Fontes oficiais e públicas: apis.roblox.com/universes/v1/places/{id}/universe e games.roblox.com/v1/games
import { handleError, HttpError, json, preflight, readJson } from '../_shared/http.ts';
import { adminClient, isInternal, requireUser, rpc } from '../_shared/supabase.ts';

const SOURCE = 'games.roblox.com/v1/games';

interface GameInfo {
  id: number;
  rootPlaceId: number;
  name: string;
  playing: number;
  visits: number;
  favoritedCount: number;
  maxPlayers: number;
}

async function robloxJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'NEXUS-app/0.1' } });
  if (res.status === 429) throw new HttpError(429, 'O Roblox limitou as consultas agora. Tente de novo em um minuto.');
  if (!res.ok) throw new HttpError(502, `O Roblox respondeu ${res.status} em ${new URL(url).host}.`);
  return (await res.json()) as T;
}

async function fetchGames(ids: number[]): Promise<GameInfo[]> {
  if (!ids.length) return [];
  const out: GameInfo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const data = await robloxJson<{ data: GameInfo[] }>(`https://games.roblox.com/v1/games?universeIds=${chunk.join(',')}`);
    out.push(...(data.data ?? []));
  }
  return out;
}

async function store(admin: ReturnType<typeof adminClient>, games: GameInfo[]) {
  if (!games.length) return [];
  const rows = games.map((g) => ({
    universe_id: g.id,
    name: g.name,
    playing: g.playing,
    visits: g.visits,
    favorites: g.favoritedCount,
    max_players: g.maxPlayers,
    source: SOURCE,
  }));
  const { data, error } = await admin.from('roblox_stats').insert(rows).select('*');
  if (error) throw new HttpError(500, `Falha ao salvar a coleta: ${error.message}`);
  // Atualiza o nome das experiências vinculadas
  for (const g of games) await admin.from('roblox_experiences').update({ name: g.name, root_place_id: g.rootPlaceId }).eq('universe_id', g.id);
  return data;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const body = await readJson<{ action: string; place_id?: number; universe_ids?: number[] }>(req);
    const admin = adminClient();

    if (body.action === 'collect') {
      if (!isInternal(req)) throw new HttpError(401, 'Somente para o agendamento interno.');
      const { data: exps } = await admin.from('roblox_experiences').select('universe_id');
      const ids = Array.from(new Set((exps ?? []).map((e) => Number(e.universe_id))));
      const stored = await store(admin, await fetchGames(ids));
      return json({ collected: stored?.length ?? 0 });
    }

    const { user } = await requireUser(req);

    if (body.action === 'resolve') {
      const placeId = Number(body.place_id);
      if (!Number.isSafeInteger(placeId) || placeId <= 0) throw new HttpError(400, 'Place ID inválido.');
      let universeId: number;
      try {
        const r = await robloxJson<{ universeId: number | null }>(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
        if (!r.universeId) throw new HttpError(404, 'Não encontrei esse jogo. Confira o Place ID.');
        universeId = r.universeId;
      } catch (err) {
        if (err instanceof HttpError && err.status === 502) throw new HttpError(404, 'Não encontrei esse jogo. Confira o Place ID.');
        throw err;
      }
      const [g] = await fetchGames([universeId]);
      return json({ universe_id: universeId, root_place_id: g?.rootPlaceId ?? placeId, name: g?.name ?? null });
    }

    if (body.action === 'refresh') {
      const ids = Array.from(new Set((body.universe_ids ?? []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))).slice(0, 20);
      if (!ids.length) throw new HttpError(400, 'Nenhum jogo informado.');
      const allowed: number[] = [];
      for (const id of ids) {
        if (await rpc<boolean>(admin, '_can_view_roblox_universe', { p_universe: id, p_user: user.id })) allowed.push(id);
      }
      if (!allowed.length) throw new HttpError(403, 'Você não tem acesso às métricas desses jogos.');
      // Evita coletas repetidas em menos de 60 segundos.
      const fresh: number[] = [];
      for (const id of allowed) {
        const { data } = await admin.from('roblox_stats').select('fetched_at').eq('universe_id', id).order('fetched_at', { ascending: false }).limit(1).maybeSingle();
        if (!data || Date.now() - new Date(data.fetched_at).getTime() > 60_000) fresh.push(id);
      }
      const stored = await store(admin, await fetchGames(fresh));
      return json({ refreshed: stored?.length ?? 0, skipped: allowed.length - fresh.length });
    }

    throw new HttpError(400, 'Ação desconhecida.');
  } catch (err) {
    return handleError(err);
  }
});
