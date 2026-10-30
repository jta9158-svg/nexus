import { create } from 'zustand';
import { friendlyError } from '../lib/errors';

export interface Toast {
  id: number;
  tone: 'info' | 'success' | 'error' | 'warn';
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>, ms?: number) => number;
  dismiss: (id: number) => void;
}

let seq = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t, ms = 5000) => {
    const id = seq++;
    set({ toasts: [...get().toasts.slice(-4), { ...t, id }] });
    if (ms > 0) setTimeout(() => get().dismiss(id), ms);
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  info: (title: string, body?: string) => useToasts.getState().push({ tone: 'info', title, body }),
  success: (title: string, body?: string) => useToasts.getState().push({ tone: 'success', title, body }),
  warn: (title: string, body?: string) => useToasts.getState().push({ tone: 'warn', title, body }, 7000),
  error: (err: unknown, title = 'Não foi possível concluir') =>
    useToasts.getState().push({ tone: 'error', title, body: friendlyError(err) }, 8000),
};
