// Page de statut publique — bannière globale, liste des services avec barres
// d'uptime 90 jours (SVG servi par l'API), incidents en cours et passés.
// Rafraîchissement automatique toutes les 30 s.

import { api, esc, fmtDuration, fmtWhen, STATE_LABEL } from './app.js';

let refreshTimer = null;

export async function renderStatus(root, hash) {
  clearInterval(refreshTimer);
  root.innerHTML = '<div class="spinner"></div>';
  let data;
  try { data = await api('/api/public/status'); }
  catch { root.innerHTML = '<div class="status-wrap"><p class="empty">Page de statut indisponible.</p></div>'; return; }
  if (data.brand_color) document.documentElement.style.setProperty('--brand', data.brand_color);
  document.title = `${data.page_title} — ${data.status.label}`;
  paint(root, data);
  refreshTimer = setInterval(async () => {
    try { const d = await api('/api/public/status'); paint(root, d); } catch { /* réessai au prochain tick */ }
  }, 30000);
}

function monitorCard(m) {
  const pct = m.uptime_90d == null ? '—' : `${(m.uptime_90d * 100).toFixed(2)} %`;
  return `<div class="mon-card">
    <div class="top">
      <span class="dot ${m.state}"></span>
      <span class="name">${esc(m.name)}</span>
      <span class="state-badge ${m.state}">${STATE_LABEL[m.state] || m.state}</span>
      <span class="up-pct">${pct} sur 90 j</span>
    </div>
    <div class="bars"><img src="/api/public/monitors/${m.id}/uptime.svg" alt="Disponibilité 90 jours" style="width:100%;height:42px;display:block"></div>
    <div class="bars-legend"><span>il y a 90 jours</span><span>aujourd'hui</span></div>
  </div>`;
}

function incidentItem(inc, ongoing) {
  const cls = ongoing ? '' : 'resolved';
  const when = ongoing
    ? `Depuis le ${fmtWhen(inc.started_at)} · ${fmtDuration(inc.duration_sec)}`
    : `${fmtWhen(inc.started_at)} → ${fmtWhen(inc.resolved_at)} · ${fmtDuration(inc.duration_sec)}`;
  return `<div class="incident-item ${cls}">
    <div><strong>${esc(inc.monitor_name)}</strong> — ${esc(inc.cause || 'Indisponible')}</div>
    <div class="when">${when}</div>
  </div>`;
}

function paint(root, data) {
  const s = data.status;
  const icon = { up: '✓', down: '!', degraded: '~', pending: '…', unknown: '?' }[s.level] || '·';
  root.innerHTML = `<div class="status-wrap">
    <div class="status-head">
      ${data.organization ? `<div class="org">${esc(data.organization)}</div>` : ''}
      <h1>${esc(data.page_title)}</h1>
      ${data.page_intro ? `<p class="muted">${esc(data.page_intro)}</p>` : ''}
    </div>
    <div class="status-banner ${s.level}"><span class="big-dot"></span>${esc(s.label)}</div>

    ${data.ongoing_incidents.length ? `<div class="section-title">Incidents en cours</div>
      ${data.ongoing_incidents.map((i) => incidentItem(i, true)).join('')}` : ''}

    <div class="section-title">Services</div>
    ${data.monitors.length ? data.monitors.map(monitorCard).join('') : '<p class="empty">Aucun service public.</p>'}

    ${data.recent_incidents.length ? `<div class="section-title">Incidents passés (90 jours)</div>
      ${data.recent_incidents.map((i) => incidentItem(i, false)).join('')}` : ''}

    <div style="text-align:center;margin-top:34px;color:var(--muted);font-size:.78rem">
      Mis à jour le ${fmtWhen(data.generated_at)} · <a style="color:inherit" href="#/admin">Console</a>
    </div>
  </div>`;
}
