// Console d'administration — connexion, tableau de bord, monitors (liste +
// détail avec graphique de latence et incidents), réglages.

import { api, esc, toast, fmtDuration, fmtWhen, STATE_LABEL } from './app.js';

const modal = (html) => {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal">${html}</div>`;
  back.addEventListener('mousedown', (e) => { if (e.target === back) back.remove(); });
  document.body.appendChild(back);
  return back;
};
const pct = (r) => (r == null ? '—' : `${(r * 100).toFixed(2)} %`);

export async function renderAdmin(root, hash) {
  document.documentElement.style.removeProperty('--brand');
  document.title = 'Vigie — Console';
  root.innerHTML = '<div class="spinner"></div>';
  try { await api('/api/me'); } catch { return renderAuth(root); }
  const parts = hash.split('/'); // #/admin/monitor/3
  const view = parts[2] || 'dashboard';
  shell(root, view === 'monitor' ? 'monitors' : view);
  const main = root.querySelector('#admin-main');
  try {
    if (view === 'dashboard') await viewDashboard(main);
    else if (view === 'monitors') await viewMonitors(main);
    else if (view === 'monitor') await viewMonitorDetail(main, parts[3]);
    else if (view === 'incidents') await viewIncidents(main);
    else if (view === 'settings') await viewSettings(main);
    else location.hash = '#/admin/dashboard';
  } catch (e) {
    if (e.status === 401) return renderAuth(root);
    main.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

const NAV = [['dashboard', 'Tableau de bord', '📊'], ['monitors', 'Moniteurs', '📡'], ['incidents', 'Incidents', '🚨'], ['settings', 'Réglages', '⚙️']];
function shell(root, active) {
  root.innerHTML = `<div id="admin">
    <nav class="admin-side">
      <div class="brand">📡 Vigie</div>
      ${NAV.map(([v, l, i]) => `<a href="#/admin/${v}" class="${v === active ? 'active' : ''}"><span>${i}</span>${l}</a>`).join('')}
      <div class="spacer"></div>
      <a href="#/" target="_blank">🔗 Page de statut</a>
      <a href="#" id="logout">🚪 Déconnexion</a>
      <div class="foot">Vigie v1.0<br>Supervision · uptime</div>
    </nav>
    <main class="admin-main" id="admin-main"><div class="spinner"></div></main>
  </div>`;
  root.querySelector('#logout').onclick = async (e) => { e.preventDefault(); await api('/api/logout', { method: 'POST' }); renderAuth(root); };
}

async function renderAuth(root) {
  const { configured } = await api('/api/setup-status');
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <h1>📡 Vigie</h1><div class="tag">Console de supervision</div>
    ${configured ? '' : `<p class="muted" style="font-size:.88rem">Première utilisation : créez votre accès.</p>
      <div class="field"><label>Organisation (facultatif)</label><input id="a-org" placeholder="Mon entreprise"></div>`}
    <div class="field"><label>Mot de passe${configured ? '' : ' (8 caractères min.)'}</label><input id="a-pw" type="password" autofocus></div>
    <button class="btn primary" id="a-go" style="width:100%">${configured ? 'Se connecter' : 'Créer mon espace'}</button>
  </div></div>`;
  const go = async () => {
    try {
      const password = root.querySelector('#a-pw').value;
      if (configured) await api('/api/login', { method: 'POST', body: { password } });
      else await api('/api/setup', { method: 'POST', body: { password, organization: root.querySelector('#a-org').value } });
      location.hash = '#/admin/dashboard'; renderAdmin(root, '#/admin/dashboard');
    } catch (e) { toast(e.message, true); }
  };
  root.querySelector('#a-go').onclick = go;
  root.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
}

async function viewDashboard(main) {
  const [stats, monitors] = await Promise.all([api('/api/stats'), api('/api/monitors')]);
  const sys = stats.system;
  const rows = monitors.length ? monitors.map((m) => `
    <tr class="clickable" data-id="${m.id}">
      <td><span class="dot ${m.state}"></span> <strong>${esc(m.name)}</strong><div class="muted" style="font-size:.8rem">${esc(m.url)}</div></td>
      <td><span class="state-badge ${m.state}">${STATE_LABEL[m.state] || m.state}</span></td>
      <td class="mono">${m.last_latency_ms != null ? m.last_latency_ms + ' ms' : '—'}</td>
      <td class="mono">${pct(m.uptime_24h)}</td>
      <td class="mono">${pct(m.uptime_7d)}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty">Aucun moniteur. Ajoutez-en un.</td></tr>';
  main.innerHTML = `
    <div class="page-head"><h1>Tableau de bord</h1><div class="grow"></div>
      <a class="btn" href="#/" target="_blank">Page de statut ↗</a>
      <a class="btn primary" href="#/admin/monitors">+ Moniteur</a></div>
    <div class="card mb" style="display:flex;align-items:center;gap:12px;border-left:5px solid var(--${sys.level === 'up' ? 'up' : sys.level === 'down' ? 'down' : sys.level === 'degraded' ? 'degraded' : 'paused'})">
      <span class="dot ${sys.level}" style="width:14px;height:14px"></span><strong style="font-size:1.05rem">${esc(sys.label)}</strong>
    </div>
    <div class="grid4">
      <div class="card stat"><div class="label">Opérationnels</div><div class="value up">${stats.up}</div></div>
      <div class="card stat"><div class="label">Hors service</div><div class="value ${stats.down ? 'down' : ''}">${stats.down}</div></div>
      <div class="card stat"><div class="label">Dégradés</div><div class="value">${stats.degraded}</div></div>
      <div class="card stat"><div class="label">Incidents en cours</div><div class="value ${stats.ongoing_incidents ? 'down' : ''}">${stats.ongoing_incidents}</div></div>
    </div>
    <div class="card mt" style="padding:6px 10px">
      <table class="list"><thead><tr><th>Service</th><th>État</th><th>Latence</th><th>24 h</th><th>7 j</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
  main.querySelectorAll('tr.clickable').forEach((tr) => tr.onclick = () => { location.hash = `#/admin/monitor/${tr.dataset.id}`; });
}

async function viewMonitors(main) {
  const monitors = await api('/api/monitors');
  main.innerHTML = `
    <div class="page-head"><h1>Moniteurs</h1><div class="grow"></div><button class="btn primary" id="new">+ Nouveau moniteur</button></div>
    <div class="card" style="padding:6px 10px">
      ${monitors.length ? `<table class="list"><thead><tr><th>Service</th><th>État</th><th>Intervalle</th><th>Latence</th><th>Uptime 7 j</th><th></th></tr></thead>
        <tbody>${monitors.map((m) => `<tr class="clickable" data-id="${m.id}">
          <td><span class="dot ${m.state}"></span> <strong>${esc(m.name)}</strong><div class="muted" style="font-size:.8rem">${esc(m.method)} ${esc(m.url)}</div></td>
          <td><span class="state-badge ${m.state}">${STATE_LABEL[m.state] || m.state}</span></td>
          <td class="mono">${m.interval_sec}s</td>
          <td class="mono">${m.last_latency_ms != null ? m.last_latency_ms + ' ms' : '—'}</td>
          <td class="mono">${pct(m.uptime_7d)}</td>
          <td class="right"><button class="btn small" data-edit="${m.id}">Modifier</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Ajoutez votre premier moniteur (une URL à surveiller).</div>'}
    </div>`;
  main.querySelector('#new').onclick = () => editMonitor();
  main.querySelectorAll('[data-edit]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); editMonitor(monitors.find((m) => m.id === +b.dataset.edit)); });
  main.querySelectorAll('tr.clickable').forEach((tr) => tr.onclick = () => { location.hash = `#/admin/monitor/${tr.dataset.id}`; });
}

function editMonitor(m = null) {
  const v = m || { method: 'GET', expected_status: '2xx', interval_sec: 60, timeout_ms: 10000, degraded_ms: 0, failure_threshold: 2, follow_redirects: 1, public: 1, keyword: '', keyword_absent: '' };
  const mo = modal(`<h2>${m ? 'Modifier le moniteur' : 'Nouveau moniteur'}</h2>
    <div class="field"><label>Nom</label><input id="m-name" value="${esc(v.name || '')}" placeholder="Site web"></div>
    <div class="field"><label>URL *</label><input id="m-url" value="${esc(v.url || '')}" placeholder="https://exemple.fr/health"></div>
    <div class="row3">
      <div class="field"><label>Méthode</label><select id="m-method">${['GET', 'HEAD', 'POST'].map((x) => `<option ${v.method === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="field"><label>Statut attendu</label><input id="m-exp" value="${esc(v.expected_status)}" placeholder="2xx"></div>
      <div class="field"><label>Intervalle (s)</label><input id="m-int" type="number" min="10" value="${v.interval_sec}"></div>
    </div>
    <div class="row3">
      <div class="field"><label>Timeout (ms)</label><input id="m-to" type="number" min="500" value="${v.timeout_ms}"></div>
      <div class="field"><label>Seuil dégradé (ms, 0=off)</label><input id="m-deg" type="number" min="0" value="${v.degraded_ms}"></div>
      <div class="field"><label>Échecs avant incident</label><input id="m-ft" type="number" min="1" value="${v.failure_threshold}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Mot-clé requis (corps)</label><input id="m-kw" value="${esc(v.keyword)}" placeholder="ex. \"status\":\"ok\""></div>
      <div class="field"><label>Mot-clé interdit</label><input id="m-kwa" value="${esc(v.keyword_absent)}" placeholder="ex. Erreur"></div>
    </div>
    <label style="font-size:.9rem;display:block;margin-bottom:8px"><input type="checkbox" id="m-red" ${v.follow_redirects ? 'checked' : ''}> Suivre les redirections</label>
    <label style="font-size:.9rem;display:block"><input type="checkbox" id="m-pub" ${v.public ? 'checked' : ''}> Afficher sur la page de statut publique</label>
    <div class="actions">${m ? '<button class="btn danger" id="del" style="margin-right:auto">Supprimer</button>' : ''}
      <button class="btn" id="cancel">Annuler</button><button class="btn primary" id="save">Enregistrer</button></div>`);
  mo.querySelector('#cancel').onclick = () => mo.remove();
  mo.querySelector('#del')?.addEventListener('click', async () => {
    if (!confirm('Supprimer ce moniteur et tout son historique ?')) return;
    await api(`/api/monitors/${m.id}`, { method: 'DELETE' }); mo.remove(); viewMonitors(document.querySelector('#admin-main'));
  });
  mo.querySelector('#save').onclick = async () => {
    const body = {
      name: mo.querySelector('#m-name').value, url: mo.querySelector('#m-url').value,
      method: mo.querySelector('#m-method').value, expected_status: mo.querySelector('#m-exp').value,
      interval_sec: +mo.querySelector('#m-int').value, timeout_ms: +mo.querySelector('#m-to').value,
      degraded_ms: +mo.querySelector('#m-deg').value, failure_threshold: +mo.querySelector('#m-ft').value,
      keyword: mo.querySelector('#m-kw').value, keyword_absent: mo.querySelector('#m-kwa').value,
      follow_redirects: mo.querySelector('#m-red').checked, public: mo.querySelector('#m-pub').checked,
    };
    try {
      if (m) await api(`/api/monitors/${m.id}`, { method: 'PUT', body });
      else await api('/api/monitors', { method: 'POST', body });
      mo.remove(); toast('Enregistré'); viewMonitors(document.querySelector('#admin-main'));
    } catch (e) { toast(e.message, true); }
  };
}

async function viewMonitorDetail(main, id) {
  const d = await api(`/api/monitors/${id}`);
  const m = d.monitor;
  let hours = 24;
  const render = () => {
    main.innerHTML = `
      <div class="page-head"><a href="#/admin/monitors" class="btn ghost">←</a>
        <h1><span class="dot ${m.state}"></span> ${esc(m.name)}</h1>
        <span class="state-badge ${m.state}">${STATE_LABEL[m.state] || m.state}</span>
        <div class="grow"></div>
        <button class="btn" id="check">Sonder maintenant</button>
        <button class="btn" id="pause">${m.state === 'paused' ? 'Reprendre' : 'Mettre en pause'}</button>
        <button class="btn" id="edit">Modifier</button></div>
      <div class="muted mb">${esc(m.method)} <a href="${esc(m.url)}" target="_blank">${esc(m.url)}</a> · sonde toutes les ${m.interval_sec}s · statut attendu ${esc(m.expected_status)}${m.keyword ? ` · mot-clé « ${esc(m.keyword)} »` : ''}</div>
      <div class="card mb"><div class="kpi-row">
        <div class="kpi"><div class="k">Latence actuelle</div><div class="v">${m.last_latency_ms != null ? m.last_latency_ms + ' ms' : '—'}</div></div>
        <div class="kpi"><div class="k">Uptime 24 h</div><div class="v">${pct(d.stats_24h.uptime)}</div></div>
        <div class="kpi"><div class="k">Uptime 7 j</div><div class="v">${pct(d.uptime_7d)}</div></div>
        <div class="kpi"><div class="k">Uptime 30 j</div><div class="v">${pct(d.uptime_30d)}</div></div>
        <div class="kpi"><div class="k">p95 (24 h)</div><div class="v">${d.stats_24h.p95 != null ? d.stats_24h.p95 + ' ms' : '—'}</div></div>
        <div class="kpi"><div class="k">p99 (24 h)</div><div class="v">${d.stats_24h.p99 != null ? d.stats_24h.p99 + ' ms' : '—'}</div></div>
      </div></div>
      <div class="chart-box mb">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong>Latence</strong>
          <span>${[6, 24, 72, 168].map((h) => `<button class="btn small ${hours === h ? 'primary' : ''}" data-h="${h}">${h < 24 ? h + ' h' : h / 24 + ' j'}</button>`).join(' ')}</span>
        </div>
        <img id="lat" src="/api/monitors/${id}/latency.svg?hours=${hours}&_=${Date.now()}" alt="Latence" style="width:100%">
      </div>
      <div class="row2">
        <div class="card"><strong>Incidents récents</strong>
          ${d.incidents.length ? `<table class="list mt">${d.incidents.map((i) => `<tr>
            <td>${fmtWhen(i.started_at)}</td><td>${i.resolved_at ? '<span class="pill up">résolu</span>' : '<span class="pill down">en cours</span>'}</td>
            <td class="mono">${fmtDuration(i.duration_sec)}</td><td class="muted" style="font-size:.82rem">${esc(i.cause)}</td></tr>`).join('')}</table>`
            : '<p class="muted mt">Aucun incident enregistré. 🎉</p>'}
        </div>
        <div class="card"><strong>Dernières sondes</strong>
          <table class="list mt">${d.recent.slice(0, 12).map((c) => `<tr>
            <td><span class="dot ${c.up ? (c.degraded ? 'degraded' : 'up') : 'down'}"></span> ${fmtWhen(c.ts)}</td>
            <td class="mono">${c.status_code ?? '—'}</td><td class="mono">${c.latency_ms != null ? c.latency_ms + ' ms' : '—'}</td>
            <td class="muted" style="font-size:.8rem">${esc(c.error || '')}</td></tr>`).join('')}</table>
        </div>
      </div>`;
    main.querySelector('#edit').onclick = () => editMonitor(m);
    main.querySelector('#pause').onclick = async () => {
      await api(`/api/monitors/${id}/pause`, { method: 'POST', body: { paused: m.state !== 'paused' } });
      viewMonitorDetail(main, id);
    };
    main.querySelector('#check').onclick = async () => {
      const btn = main.querySelector('#check'); btn.disabled = true; btn.textContent = 'Sonde…';
      try { await api(`/api/monitors/${id}/check`, { method: 'POST' }); toast('Sonde effectuée'); viewMonitorDetail(main, id); }
      catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Sonder maintenant'; }
    };
    main.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => { hours = +b.dataset.h; render(); });
  };
  render();
}

async function viewIncidents(main) {
  const incidents = await api('/api/incidents');
  main.innerHTML = `
    <div class="page-head"><h1>Incidents</h1></div>
    <div class="card" style="padding:6px 10px">
      ${incidents.length ? `<table class="list"><thead><tr><th>Service</th><th>Début</th><th>Fin</th><th>Durée</th><th>Cause</th></tr></thead>
        <tbody>${incidents.map((i) => `<tr>
          <td><strong>${esc(i.monitor_name)}</strong></td><td>${fmtWhen(i.started_at)}</td>
          <td>${i.resolved_at ? fmtWhen(i.resolved_at) : '<span class="pill down">en cours</span>'}</td>
          <td class="mono">${fmtDuration(i.duration_sec)}</td><td class="muted">${esc(i.cause)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Aucun incident. Tout roule. 🎉</div>'}
    </div>`;
}

async function viewSettings(main) {
  const st = await api('/api/settings');
  main.innerHTML = `
    <div class="page-head"><h1>Réglages</h1><div class="grow"></div><button class="btn primary" id="save">Enregistrer</button></div>
    <div class="card">
      <div class="field"><label>Organisation</label><input id="s-org" value="${esc(st.organization)}"></div>
      <div class="field"><label>Titre de la page de statut</label><input id="s-title" value="${esc(st.page_title)}"></div>
      <div class="field"><label>Texte d'introduction</label><textarea id="s-intro" rows="2">${esc(st.page_intro)}</textarea></div>
      <div class="row2">
        <div class="field"><label>Couleur d'accent</label><input id="s-color" type="color" value="${esc(st.brand_color)}" style="height:42px;padding:3px"></div>
        <div class="field"><label>&nbsp;</label><a class="btn" href="#/" target="_blank">Voir la page de statut ↗</a></div>
      </div>
      <div class="row2">
        <div class="field"><label>Rétention des sondes (jours)</label><input id="s-cr" type="number" min="1" value="${st.check_retention_days}"></div>
        <div class="field"><label>Rétention des stats (jours)</label><input id="s-sr" type="number" min="7" value="${st.stats_retention_days}"></div>
      </div>
    </div>
    <div class="card mt"><strong>Sécurité</strong>
      <div class="row3 mt">
        <div class="field"><label>Mot de passe actuel</label><input id="p-cur" type="password"></div>
        <div class="field"><label>Nouveau mot de passe</label><input id="p-new" type="password"></div>
        <div class="field"><label>&nbsp;</label><button class="btn" id="p-go">Changer</button></div>
      </div>
    </div>`;
  main.querySelector('#save').onclick = async () => {
    try {
      await api('/api/settings', { method: 'PUT', body: {
        organization: main.querySelector('#s-org').value, page_title: main.querySelector('#s-title').value,
        page_intro: main.querySelector('#s-intro').value, brand_color: main.querySelector('#s-color').value,
        check_retention_days: +main.querySelector('#s-cr').value, stats_retention_days: +main.querySelector('#s-sr').value,
      } });
      toast('Réglages enregistrés');
    } catch (e) { toast(e.message, true); }
  };
  main.querySelector('#p-go').onclick = async () => {
    try {
      await api('/api/password', { method: 'POST', body: { current: main.querySelector('#p-cur').value, next: main.querySelector('#p-new').value } });
      toast('Mot de passe modifié'); main.querySelector('#p-cur').value = ''; main.querySelector('#p-new').value = '';
    } catch (e) { toast(e.message, true); }
  };
}
