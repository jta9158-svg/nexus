// Barramento simples de eventos entre o tempo real e as telas abertas.
type Handler = (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Record<string, unknown>; old: Record<string, unknown> }) => void;

const handlers = new Map<string, Set<Handler>>();

export function onTable(table: string, fn: Handler): () => void {
  let set = handlers.get(table);
  if (!set) {
    set = new Set();
    handlers.set(table, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
}

export function emitTable(table: string, payload: Parameters<Handler>[0]): void {
  handlers.get(table)?.forEach((fn) => {
    try {
      fn(payload);
    } catch (err) {
      console.error('[nexus] erro em ouvinte de', table, err);
    }
  });
}
