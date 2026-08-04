// Créneau — application monopage (vanilla JS, aucune dépendance).
// Routage par hash : "#/admin..." => console organisateur (auth) ;
// tout le reste => page publique de réservation.

import { renderPublic } from './public-page.js';
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
  if (!res.ok) {
    const e = new Error(data?.error || `Erreur ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

export function detectTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris'; }
  catch { return 'Europe/Paris'; }
}

export function spinner() {
  root.innerHTML = '<div class="spinner"></div>';
}

function route() {
  const hash = location.hash || '';
  if (hash.startsWith('#/admin')) renderAdmin(root, hash);
  else renderPublic(root, hash);
}

window.addEventListener('hashchange', route);
route();
