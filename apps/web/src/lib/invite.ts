// Links de convite (como no Discord): .../app/#convite=CODIGO
// O código fica guardado neste aparelho enquanto a pessoa entra ou cria a
// conta, e o convite abre sozinho depois do login.
import { publicAppUrl } from '../config';
import { currentConfig } from './supabase';

const KEY = 'nexus.pendingInvite.v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CODE = /^[A-Za-z0-9]{4,32}$/;

/** Aceita o link inteiro, "#convite=..." ou só o código. */
export function extractInviteCode(value: string): string {
  const v = value.trim();
  const m = /(?:convite=|invite[/=])([A-Za-z0-9]{4,32})/.exec(v);
  if (m) return m[1];
  const last = v.split(/[/#?=]/).filter(Boolean).pop() ?? '';
  return CODE.test(last) ? last : v;
}

export function isInviteCode(value: string): boolean {
  return CODE.test(value);
}

/** Código de convite presente no endereço atual (#convite=... ou ?convite=...). */
export function inviteFromLocation(): string | null {
  const m = /[#&?]convite=([A-Za-z0-9]{4,32})/.exec(`${location.hash}${location.search}`);
  return m ? m[1] : null;
}

/** Tira o convite do endereço (para não reabrir ao recarregar). */
export function clearInviteFromLocation(): void {
  if (!inviteFromLocation()) return;
  const search = location.search.replace(/[?&]convite=[A-Za-z0-9]{4,32}/, '').replace(/^&/, '?');
  history.replaceState(null, '', location.pathname + (search === '?' ? '' : search));
}

export function savePendingInvite(code: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // sem armazenamento: o convite continua no endereço
  }
}

export function peekPendingInvite(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw) as { code: string; at: number };
    if (!isInviteCode(code) || Date.now() - at > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nada a fazer
  }
}

/** Link completo para mandar às pessoas: abre a página do convite no site, que
 *  leva para o app instalado (Windows/Android) ou para o navegador. */
export function inviteLink(code: string): string {
  const cfg = currentConfig();
  if (cfg?.publicSiteUrl) return `${cfg.publicSiteUrl.replace(/\/+$/, '')}/?convite=${code}`;
  const base = publicAppUrl(cfg);
  return base ? `${base}#convite=${code}` : code;
}

/** Código de convite dentro de um link qualquer (site, app web ou nexus://convite/CODIGO). */
export function inviteCodeFromUrl(url: string): string | null {
  const m = /(?:[?&#]convite=|nexus:\/*convite\/)([A-Za-z0-9]{4,32})/i.exec(url);
  return m ? m[1] : null;
}

/** Avisa o app que chegou um convite (link nexus://, link no chat etc.). */
export function deliverInvite(code: string): void {
  savePendingInvite(code);
  window.dispatchEvent(new CustomEvent('nexus:invite', { detail: code }));
}

/** PIN aleatório de 6 números (sem sequências óbvias como 123456 ou 000000). */
export function randomPin(): string {
  for (;;) {
    const n = new Uint32Array(1);
    crypto.getRandomValues(n);
    const pin = String(n[0] % 1_000_000).padStart(6, '0');
    if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) continue;
    return pin;
  }
}
