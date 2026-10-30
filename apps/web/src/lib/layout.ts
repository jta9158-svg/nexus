// Organização dos canais em categorias (como no Discord).
// Funções puras: agrupar, mover canal, mover categoria. O resultado é salvo
// com a função save_channel_layout do banco.
import type { Channel, ChannelCategory } from '../types/db';

export interface ChannelGroup {
  category: ChannelCategory | null;
  channels: Channel[];
}

/** Ordem de exibição dentro de um grupo: texto primeiro, depois voz (como no Discord). */
export function displayOrder(list: Channel[]): Channel[] {
  const byPos = (a: Channel, b: Channel) => a.position - b.position || a.created_at.localeCompare(b.created_at);
  return [...list.filter((c) => c.kind === 'text').sort(byPos), ...list.filter((c) => c.kind !== 'text').sort(byPos)];
}

/** Canais sem categoria primeiro (sem título), depois cada categoria na ordem. */
export function groupChannels(channels: Channel[], categories: ChannelCategory[]): ChannelGroup[] {
  const known = new Set(categories.map((c) => c.id));
  const loose = channels.filter((c) => !c.category_id || !known.has(c.category_id));
  const groups: ChannelGroup[] = [];
  if (loose.length) groups.push({ category: null, channels: displayOrder(loose) });
  for (const cat of [...categories].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))) {
    groups.push({ category: cat, channels: displayOrder(channels.filter((c) => c.category_id === cat.id)) });
  }
  return groups;
}

export interface LayoutChange {
  channels: Channel[];
  categories: ChannelCategory[];
  /** Só o que mudou, no formato de save_channel_layout. */
  channelPatch: Array<{ id: string; position: number; category_id: string | null }>;
  categoryPatch: Array<{ id: string; position: number }>;
}

function groupKey(c: Channel, known: Set<string>): string | null {
  return c.category_id && known.has(c.category_id) ? c.category_id : null;
}

/**
 * Move um canal para uma categoria (null = sem categoria), antes de outro canal
 * (beforeId) ou no fim do grupo. Texto fica sempre acima de voz no grupo.
 */
export function moveChannel(
  channels: Channel[],
  categories: ChannelCategory[],
  channelId: string,
  targetCategory: string | null,
  beforeId: string | null,
): LayoutChange | null {
  const moved = channels.find((c) => c.id === channelId);
  if (!moved || beforeId === channelId) return null;
  const known = new Set(categories.map((c) => c.id));
  const target = targetCategory && known.has(targetCategory) ? targetCategory : null;
  const others = displayOrder(channels.filter((c) => c.id !== channelId && groupKey(c, known) === target));
  const sameKind = others.filter((c) => (c.kind === 'text') === (moved.kind === 'text'));
  let idx = beforeId ? sameKind.findIndex((c) => c.id === beforeId) : -1;
  if (idx < 0) {
    // Soltou sobre um canal do outro tipo: texto vai para o fim dos textos; voz para o começo das vozes.
    const before = beforeId ? others.find((c) => c.id === beforeId) : undefined;
    idx = before && moved.kind !== 'text' && before.kind === 'text' ? 0 : sameKind.length;
  }
  sameKind.splice(idx, 0, { ...moved, category_id: target });
  const ordered =
    moved.kind === 'text'
      ? [...sameKind, ...others.filter((c) => c.kind !== 'text')]
      : [...others.filter((c) => c.kind === 'text'), ...sameKind];
  const updated = new Map<string, Channel>();
  ordered.forEach((c, i) => {
    if (c.position !== i || c.id === channelId) updated.set(c.id, { ...c, position: i, category_id: target });
  });
  const next = channels.map((c) => updated.get(c.id) ?? c);
  const channelPatch = Array.from(updated.values()).map((c) => ({ id: c.id, position: c.position, category_id: c.category_id ?? null }));
  return { channels: next, categories, channelPatch, categoryPatch: [] };
}

/** Move um canal uma posição para cima (-1) ou para baixo (+1) dentro do próprio grupo. */
export function nudgeChannel(channels: Channel[], categories: ChannelCategory[], channelId: string, dir: -1 | 1): LayoutChange | null {
  const moved = channels.find((c) => c.id === channelId);
  if (!moved) return null;
  const known = new Set(categories.map((c) => c.id));
  const key = groupKey(moved, known);
  const sameKind = displayOrder(channels.filter((c) => groupKey(c, known) === key)).filter((c) => (c.kind === 'text') === (moved.kind === 'text'));
  const i = sameKind.findIndex((c) => c.id === channelId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sameKind.length) return null;
  const before = dir === -1 ? sameKind[j].id : sameKind[j + 1]?.id ?? null;
  return moveChannel(channels, categories, channelId, key, before);
}

/** Reordena categorias: coloca categoryId antes de beforeId (ou no fim). */
export function moveCategory(
  channels: Channel[],
  categories: ChannelCategory[],
  categoryId: string,
  beforeId: string | null,
): LayoutChange | null {
  const sorted = [...categories].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  const moved = sorted.find((c) => c.id === categoryId);
  if (!moved || beforeId === categoryId) return null;
  const rest = sorted.filter((c) => c.id !== categoryId);
  const idx = beforeId ? rest.findIndex((c) => c.id === beforeId) : -1;
  rest.splice(idx < 0 ? rest.length : idx, 0, moved);
  const categoryPatch: Array<{ id: string; position: number }> = [];
  const next = rest.map((c, i) => {
    if (c.position !== i) categoryPatch.push({ id: c.id, position: i });
    return c.position === i ? c : { ...c, position: i };
  });
  if (!categoryPatch.length) return null;
  return { channels, categories: next, channelPatch: [], categoryPatch };
}

/** Move uma categoria uma posição para cima (-1) ou para baixo (+1). */
export function nudgeCategory(channels: Channel[], categories: ChannelCategory[], categoryId: string, dir: -1 | 1): LayoutChange | null {
  const sorted = [...categories].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  const i = sorted.findIndex((c) => c.id === categoryId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return null;
  const before = dir === -1 ? sorted[j].id : sorted[j + 1]?.id ?? null;
  return moveCategory(channels, categories, categoryId, before);
}
