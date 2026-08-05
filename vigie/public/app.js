// Vigie — application monopage (vanilla). Routage par hash :
//   "#/admin..." => console d'administration (auth) ; sinon page de statut publique.

import { renderStatus } from './status-page.js';
import { renderAdmin } from './admin.js';

const root = document.getElementById('root');

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer = null;
export function toast(msg, isError = false) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 4000);
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) { const e = new Error(data?.error || `Erreur ${res.status}`); e.status = res.status; throw e; }
  return data;
}

export const STATE_LABEL = { up: 'Opérationnel', down: 'Hors service', degraded: 'Dégradé', paused: 'En pause', pending: 'En attente' };

export function fmtDuration(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`;
  return `${Math.floor(sec / 86400)} j ${Math.round((sec % 86400) / 3600)} h`;
}

export function fmtWhen(ms) {
  return new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function route() {
  const hash = location.hash || '';
  if (hash.startsWith('#/admin')) renderAdmin(root, hash);
  else renderStatus(root, hash);
}
window.addEventListener('hashchange', route);
route();
