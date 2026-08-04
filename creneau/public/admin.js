// Console organisateur — authentification, tableau de bord, types de RDV,
// disponibilités (grille hebdo + exceptions), rendez-vous, réglages.

import { api, esc, toast } from './app.js';

const DOW_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // lundi → dimanche
const LOC_LABEL = { video: 'Visioconférence', phone: 'Téléphone', in_person: 'Sur place', custom: 'Lien personnalisé' };

const pad = (n) => String(n).padStart(2, '0');
const minToHHMM = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const hhmmToMin = (s) => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const durLabel = (m) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m / 60} h`);

function modal(html) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal">${html}</div>`;
  back.addEventListener('mousedown', (e) => { if (e.target === back) back.remove(); });
  document.body.appendChild(back);
  return back;
}

export async function renderAdmin(root, hash) {
  document.documentElement.style.removeProperty('--brand');
  document.title = 'Créneau — Console';
  root.innerHTML = '<div class="spinner"></div>';
  // Authentifié ?
  try {
    await api('/api/me');
  } catch {
    return renderAuth(root);
  }
  const view = (hash.split('/')[2] || 'dashboard');
  shell(root, view);
  const main = root.querySelector('#admin-main');
  try {
    if (view === 'dashboard') await viewDashboard(main);
    else if (view === 'types') await viewTypes(main);
    else if (view === 'availability') await viewAvailability(main);
    else if (view === 'bookings') await viewBookings(main);
    else if (view === 'settings') await viewSettings(main);
    else location.hash = '#/admin/dashboard';
  } catch (e) {
    if (e.status === 401) return renderAuth(root);
    main.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

const NAV = [
  ['dashboard', 'Tableau de bord', '📊'],
  ['types', 'Types de RDV', '🗂️'],
  ['availability', 'Disponibilités', '🗓️'],
  ['bookings', 'Rendez-vous', '📅'],
  ['settings', 'Réglages', '⚙️'],
];

function shell(root, active) {
  root.innerHTML = `<div id="admin">
    <nav class="admin-side">
      <div class="brand">📅 Créneau</div>
      ${NAV.map(([v, label, icon]) => `<a href="#/admin/${v}" class="${v === active ? 'active' : ''}"><span>${icon}</span>${label}</a>`).join('')}
      <div class="spacer"></div>
      <a href="#/" target="_blank">🔗 Voir la page publique</a>
      <a href="#" id="logout">🚪 Déconnexion</a>
      <div class="foot">Créneau v1.0<br>iCalendar · RFC 5545</div>
    </nav>
    <main class="admin-main" id="admin-main"><div class="spinner"></div></main>
  </div>`;
  root.querySelector('#logout').onclick = async (e) => {
    e.preventDefault();
    await api('/api/logout', { method: 'POST' });
    renderAuth(root);
  };
}

// ------------------------------------------------------------ connexion
async function renderAuth(root) {
  const { configured } = await api('/api/setup-status');
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <h1>📅 Créneau</h1>
    <div class="tag">Console organisateur</div>
    ${configured ? '' : `
      <p class="muted" style="font-size:0.88rem">Première utilisation : créez votre accès.</p>
      <div class="field"><label>Votre nom</label><input id="a-name" placeholder="Ex. Dr. Camille Martin"></div>
      <div class="field"><label>E-mail (organisateur)</label><input id="a-email" type="email"></div>`}
    <div class="field"><label>Mot de passe${configured ? '' : ' (8 caractères min.)'}</label><input id="a-pw" type="password" autofocus></div>
    <button class="btn primary" id="a-go" style="width:100%">${configured ? 'Se connecter' : 'Créer mon espace'}</button>
  </div></div>`;
  const go = async () => {
    try {
      const password = root.querySelector('#a-pw').value;
      if (configured) await api('/api/login', { method: 'POST', body: { password } });
      else await api('/api/setup', {
        method: 'POST',
        body: {
          password,
          organizer_name: root.querySelector('#a-name').value,
          organizer_email: root.querySelector('#a-email').value,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
      location.hash = '#/admin/dashboard';
      renderAdmin(root, '#/admin/dashboard');
    } catch (e) { toast(e.message, true); }
  };
  root.querySelector('#a-go').onclick = go;
  root.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
}

// ------------------------------------------------------------ dashboard
async function viewDashboard(main) {
  const s = await api('/api/stats');
  const settings = await api('/api/settings');
  const nextRows = s.next.length ? s.next.map((b) => `
    <tr><td><strong style="text-transform:capitalize">${esc(b.start_organizer)}</strong></td>
    <td>${esc(b.event_name)}</td><td>${esc(b.invitee_name)}<div class="muted" style="font-size:0.82rem">${esc(b.invitee_email)}</div></td>
    <td class="right"><a class="btn small" href="#/admin/bookings">Voir</a></td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">Aucun rendez-vous à venir.</td></tr>';
  main.innerHTML = `
    <div class="page-head"><h1>Tableau de bord</h1><div class="grow"></div>
      <a class="btn" href="#/" target="_blank">Page publique ↗</a></div>
    <div class="grid4">
      <div class="card stat"><div class="label">Rendez-vous à venir</div><div class="value">${s.upcoming}</div></div>
      <div class="card stat"><div class="label">Réservés (30 j)</div><div class="value">${s.booked_last_30d}</div></div>
      <div class="card stat"><div class="label">Annulés (total)</div><div class="value">${s.cancelled_total}</div></div>
      <div class="card stat"><div class="label">Fuseau</div><div class="value" style="font-size:1rem;margin-top:10px">${esc(settings.timezone.replace(/_/g, ' '))}</div></div>
    </div>
    <div class="card mt">
      <strong>Prochains rendez-vous</strong>
      <table class="list mt"><tbody>${nextRows}</tbody></table>
    </div>
    ${s.by_type.length ? `<div class="card mt"><strong>Rendez-vous à venir par type</strong>
      <table class="list mt">${s.by_type.map((t) => `<tr><td>${esc(t.name)}</td><td class="right">${t.n}</td></tr>`).join('')}</table></div>` : ''}`;
}

// ------------------------------------------------------------ types
async function viewTypes(main) {
  const types = await api('/api/event-types');
  main.innerHTML = `
    <div class="page-head"><h1>Types de rendez-vous</h1><div class="grow"></div>
      <button class="btn primary" id="new">+ Nouveau type</button></div>
    <div class="card" style="padding:6px 10px">
      ${types.length ? `<table class="list"><thead><tr><th>Nom</th><th>Durée</th><th>Lieu</th><th>Lien public</th><th></th></tr></thead>
        <tbody>${types.map((t) => `<tr>
          <td><strong>${esc(t.name)}</strong> ${t.active ? '' : '<span class="badge cancelled">inactif</span>'}
            ${t.description ? `<div class="muted" style="font-size:0.82rem">${esc(t.description)}</div>` : ''}</td>
          <td>${durLabel(t.duration_min)}</td>
          <td>${esc(LOC_LABEL[t.location_type])}</td>
          <td><a class="chip" href="#/" title="Ouvrir">/${esc(t.slug)}</a></td>
          <td class="right"><button class="btn small" data-edit="${t.id}">Modifier</button>
          <button class="btn small danger" data-del="${t.id}">✕</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Créez votre premier type de rendez-vous (ex. « Consultation 30 min »).</div>'}
    </div>`;
  main.querySelector('#new').onclick = () => editType();
  main.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editType(types.find((t) => t.id === +b.dataset.edit)));
  main.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Supprimer ce type de rendez-vous ?')) return;
    const r = await api(`/api/event-types/${b.dataset.del}`, { method: 'DELETE' });
    toast(r.deactivated ? `Désactivé (${r.upcoming} RDV à venir conservés)` : 'Supprimé');
    viewTypes(main);
  });
}

function editType(t = null) {
  const v = t || { duration_min: 30, buffer_after_min: 0, buffer_before_min: 0, min_notice_min: 120, max_days_ahead: 60, slot_step_min: 0, daily_max: 0, location_type: 'video', location_detail: '', color: '#2563eb', active: 1 };
  const m = modal(`<h2>${t ? 'Modifier le type' : 'Nouveau type de rendez-vous'}</h2>
    <div class="field"><label>Nom *</label><input id="t-name" value="${esc(v.name || '')}" placeholder="Consultation 30 min"></div>
    <div class="field"><label>Description</label><textarea id="t-desc" rows="2">${esc(v.description || '')}</textarea></div>
    <div class="row3">
      <div class="field"><label>Durée (min)</label><input id="t-dur" type="number" min="5" value="${v.duration_min}"></div>
      <div class="field"><label>Battement avant (min)</label><input id="t-bb" type="number" min="0" value="${v.buffer_before_min}"></div>
      <div class="field"><label>Battement après (min)</label><input id="t-ba" type="number" min="0" value="${v.buffer_after_min}"></div>
    </div>
    <div class="row3">
      <div class="field"><label>Préavis min. (min)</label><input id="t-notice" type="number" min="0" value="${v.min_notice_min}"></div>
      <div class="field"><label>Horizon (jours)</label><input id="t-horizon" type="number" min="1" value="${v.max_days_ahead}"></div>
      <div class="field"><label>Max / jour (0 = illimité)</label><input id="t-daily" type="number" min="0" value="${v.daily_max}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Lieu</label><select id="t-loc">${Object.entries(LOC_LABEL).map(([k, l]) => `<option value="${k}" ${v.location_type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Détail du lieu / lien</label><input id="t-locd" value="${esc(v.location_detail || '')}" placeholder="https://…, adresse, n° de tél."></div>
    </div>
    <div class="row2">
      <div class="field"><label>Couleur</label><input id="t-color" type="color" value="${v.color}" style="height:42px;padding:3px"></div>
      <div class="field"><label>Pas des créneaux (0 = durée)</label><input id="t-step" type="number" min="0" value="${v.slot_step_min}"></div>
    </div>
    ${t ? `<label style="font-size:0.85rem"><input type="checkbox" id="t-active" ${v.active ? 'checked' : ''}> Actif (visible publiquement)</label>` : ''}
    <div class="actions"><button class="btn" id="cancel">Annuler</button><button class="btn primary" id="save">Enregistrer</button></div>`);
  m.querySelector('#cancel').onclick = () => m.remove();
  m.querySelector('#save').onclick = async () => {
    const body = {
      name: m.querySelector('#t-name').value,
      description: m.querySelector('#t-desc').value,
      duration_min: +m.querySelector('#t-dur').value,
      buffer_before_min: +m.querySelector('#t-bb').value,
      buffer_after_min: +m.querySelector('#t-ba').value,
      min_notice_min: +m.querySelector('#t-notice').value,
      max_days_ahead: +m.querySelector('#t-horizon').value,
      daily_max: +m.querySelector('#t-daily').value,
      slot_step_min: +m.querySelector('#t-step').value,
      location_type: m.querySelector('#t-loc').value,
      location_detail: m.querySelector('#t-locd').value,
      color: m.querySelector('#t-color').value,
    };
    if (t) body.active = m.querySelector('#t-active').checked;
    try {
      if (t) await api(`/api/event-types/${t.id}`, { method: 'PUT', body });
      else await api('/api/event-types', { method: 'POST', body });
      m.remove();
      toast('Enregistré');
      viewTypes(document.querySelector('#admin-main'));
    } catch (e) { toast(e.message, true); }
  };
}

// ------------------------------------------------------------ disponibilités
async function viewAvailability(main) {
  const [rules, overrides, settings] = await Promise.all([
    api('/api/availability'), api('/api/overrides'), api('/api/settings'),
  ]);
  // regroupe les règles par jour
  const byDay = new Map(ORDER.map((d) => [d, []]));
  for (const r of rules) byDay.get(r.weekday)?.push({ start: r.start_min, end: r.end_min });

  main.innerHTML = `
    <div class="page-head"><h1>Disponibilités</h1><div class="grow"></div>
      <button class="btn primary" id="save">Enregistrer la grille</button></div>
    <div class="card mb">
      <p class="muted" style="margin-top:0">Horaires hebdomadaires récurrents, dans votre fuseau (<strong>${esc(settings.timezone.replace(/_/g, ' '))}</strong>).
      Ces plages s'appliquent à tous les types de rendez-vous.</p>
      <div id="days">${ORDER.map((d) => dayRow(d, byDay.get(d))).join('')}</div>
    </div>
    <div class="card">
      <div class="page-head" style="margin-bottom:12px"><strong>Exceptions de calendrier</strong><div class="grow"></div>
        <button class="btn small" id="add-override">+ Ajouter une exception</button></div>
      <p class="muted" style="margin-top:0;font-size:0.86rem">Fermer un jour précis (congés) ou définir des horaires spéciaux.</p>
      <table class="list" id="ov-list">
        ${overrides.length ? overrides.map(ovRow).join('') : '<tr><td class="empty">Aucune exception.</td></tr>'}
      </table>
    </div>`;

  const daysEl = main.querySelector('#days');
  const bindDay = (row) => {
    row.querySelector('.add-slot').onclick = () => {
      const slots = row.querySelector('.slots-wrap');
      slots.insertAdjacentHTML('beforeend', slotHtml(540, 1020));
      bindSlots(row);
    };
    bindSlots(row);
  };
  daysEl.querySelectorAll('.avail-day').forEach(bindDay);

  main.querySelector('#save').onclick = async () => {
    const out = [];
    daysEl.querySelectorAll('.avail-day').forEach((row) => {
      const wd = +row.dataset.wd;
      row.querySelectorAll('.avail-slot').forEach((sl) => {
        const start = hhmmToMin(sl.querySelector('.s').value);
        const end = hhmmToMin(sl.querySelector('.e').value);
        if (end > start) out.push({ weekday: wd, start_min: start, end_min: end });
      });
    });
    try {
      await api('/api/availability', { method: 'PUT', body: { rules: out } });
      toast('Disponibilités enregistrées');
    } catch (e) { toast(e.message, true); }
  };

  main.querySelector('#add-override').onclick = () => editOverride(main);
  main.querySelectorAll('[data-ov-del]').forEach((b) => b.onclick = async () => {
    await api(`/api/overrides/${b.dataset.ovDel}`, { method: 'DELETE' });
    viewAvailability(main);
  });
}

function slotHtml(s, e) {
  return `<span class="avail-slot"><input class="s" type="time" value="${minToHHMM(s)}"> – <input class="e" type="time" value="${minToHHMM(e)}"><button class="x" title="Retirer">✕</button></span>`;
}
function dayRow(wd, slots) {
  return `<div class="avail-day" data-wd="${wd}">
    <span class="dname">${DOW_FULL[wd]}</span>
    <span class="slots-wrap">${slots.length ? slots.map((s) => slotHtml(s.start, s.end)).join('') : '<span class="muted" style="font-size:0.85rem">Indisponible</span>'}</span>
    <button class="btn small ghost add-slot" style="margin-left:auto">+ Plage</button>
  </div>`;
}
function bindSlots(row) {
  row.querySelectorAll('.avail-slot .x').forEach((x) => x.onclick = () => {
    x.closest('.avail-slot').remove();
    if (!row.querySelector('.avail-slot')) {
      row.querySelector('.slots-wrap').innerHTML = '<span class="muted" style="font-size:0.85rem">Indisponible</span>';
    }
  });
}
function ovRow(o) {
  return `<tr><td><strong>${esc(o.day)}</strong>${o.note ? ` <span class="muted">— ${esc(o.note)}</span>` : ''}</td>
    <td>${o.available ? (o.start_min != null ? `${minToHHMM(o.start_min)}–${minToHHMM(o.end_min)}` : 'Ouvert (horaires normaux)') : '<span class="badge cancelled">Fermé</span>'}</td>
    <td class="right"><button class="btn small danger" data-ov-del="${esc(o.day)}">✕</button></td></tr>`;
}
function editOverride(main) {
  const m = modal(`<h2>Exception de calendrier</h2>
    <div class="field"><label>Date</label><input id="o-day" type="date"></div>
    <div class="field"><label>Type</label><select id="o-type">
      <option value="closed">Fermé (indisponible)</option>
      <option value="hours">Horaires spéciaux</option></select></div>
    <div class="row2" id="o-hours" style="display:none">
      <div class="field"><label>De</label><input id="o-start" type="time" value="09:00"></div>
      <div class="field"><label>À</label><input id="o-end" type="time" value="17:00"></div>
    </div>
    <div class="field"><label>Note (facultatif)</label><input id="o-note" placeholder="Congés, férié…"></div>
    <div class="actions"><button class="btn" id="cancel">Annuler</button><button class="btn primary" id="save">Enregistrer</button></div>`);
  m.querySelector('#o-type').onchange = (e) => { m.querySelector('#o-hours').style.display = e.target.value === 'hours' ? 'grid' : 'none'; };
  m.querySelector('#cancel').onclick = () => m.remove();
  m.querySelector('#save').onclick = async () => {
    const day = m.querySelector('#o-day').value;
    if (!day) return toast('Choisissez une date', true);
    const hours = m.querySelector('#o-type').value === 'hours';
    try {
      await api(`/api/overrides/${day}`, {
        method: 'PUT',
        body: {
          available: hours ? 1 : 0,
          start_min: hours ? hhmmToMin(m.querySelector('#o-start').value) : null,
          end_min: hours ? hhmmToMin(m.querySelector('#o-end').value) : null,
          note: m.querySelector('#o-note').value,
        },
      });
      m.remove();
      viewAvailability(main);
    } catch (e) { toast(e.message, true); }
  };
}

// ------------------------------------------------------------ rendez-vous
async function viewBookings(main) {
  let scope = 'upcoming';
  const render = async () => {
    const bookings = await api(`/api/bookings?scope=${scope}`);
    const tabs = [['upcoming', 'À venir'], ['past', 'Passés'], ['cancelled', 'Annulés']];
    main.innerHTML = `
      <div class="page-head"><h1>Rendez-vous</h1><div class="grow"></div>
        ${tabs.map(([v, l]) => `<button class="btn small ${v === scope ? 'primary' : ''}" data-scope="${v}">${l}</button>`).join('')}</div>
      <div class="card" style="padding:6px 10px">
        ${bookings.length ? `<table class="list"><thead><tr><th>Date</th><th>Type</th><th>Invité</th><th>Statut</th><th></th></tr></thead>
          <tbody>${bookings.map((b) => `<tr>
            <td><strong style="text-transform:capitalize">${esc(b.start_organizer)}</strong></td>
            <td>${esc(b.event_name)}</td>
            <td>${esc(b.invitee_name)}<div class="muted" style="font-size:0.82rem">${esc(b.invitee_email)} · ${esc((b.invitee_tz || '').replace(/_/g, ' '))}</div>
              ${b.invitee_notes ? `<div class="muted" style="font-size:0.82rem">« ${esc(b.invitee_notes)} »</div>` : ''}</td>
            <td><span class="badge ${b.status}">${b.status === 'confirmed' ? 'Confirmé' : 'Annulé'}</span></td>
            <td class="right"><a class="btn small" href="/api/bookings/${b.id}/ics">.ics</a>
              ${b.status === 'confirmed' ? `<button class="btn small danger" data-cancel="${b.id}">Annuler</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Aucun rendez-vous dans cette catégorie.</div>'}
      </div>`;
    main.querySelectorAll('[data-scope]').forEach((b) => b.onclick = () => { scope = b.dataset.scope; render(); });
    main.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = async () => {
      const reason = prompt('Motif de l’annulation (facultatif) :') ?? '';
      try { await api(`/api/bookings/${b.dataset.cancel}/cancel`, { method: 'POST', body: { reason } }); toast('Rendez-vous annulé'); render(); }
      catch (e) { toast(e.message, true); }
    });
  };
  await render();
}

// ------------------------------------------------------------ réglages
async function viewSettings(main) {
  const [settings, timezones] = await Promise.all([api('/api/settings'), api('/api/timezones')]);
  const tzOpts = timezones.map((t) => `<option value="${esc(t)}" ${t === settings.timezone ? 'selected' : ''}>${esc(t.replace(/_/g, ' '))}</option>`).join('');
  main.innerHTML = `
    <div class="page-head"><h1>Réglages</h1><div class="grow"></div><button class="btn primary" id="save">Enregistrer</button></div>
    <div class="card">
      <div class="row2">
        <div class="field"><label>Votre nom (organisateur)</label><input id="s-name" value="${esc(settings.organizer_name)}"></div>
        <div class="field"><label>E-mail (organisateur)</label><input id="s-email" type="email" value="${esc(settings.organizer_email)}"></div>
      </div>
      <div class="field"><label>Fuseau horaire de référence</label><select id="s-tz">${tzOpts}</select></div>
      <div class="field"><label>Titre de la page publique</label><input id="s-title" value="${esc(settings.page_title)}"></div>
      <div class="field"><label>Texte d'introduction</label><textarea id="s-intro" rows="2">${esc(settings.page_intro)}</textarea></div>
      <div class="row2">
        <div class="field"><label>Couleur d'accent</label><input id="s-color" type="color" value="${esc(settings.brand_color)}" style="height:42px;padding:3px"></div>
        <div class="field"><label>&nbsp;</label><a class="btn" href="#/" target="_blank">Prévisualiser la page publique ↗</a></div>
      </div>
    </div>
    <div class="card mt">
      <strong>Sécurité</strong>
      <div class="row3 mt">
        <div class="field"><label>Mot de passe actuel</label><input id="p-cur" type="password"></div>
        <div class="field"><label>Nouveau mot de passe</label><input id="p-new" type="password"></div>
        <div class="field"><label>&nbsp;</label><button class="btn" id="p-go">Changer</button></div>
      </div>
    </div>`;
  main.querySelector('#save').onclick = async () => {
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: {
          organizer_name: main.querySelector('#s-name').value,
          organizer_email: main.querySelector('#s-email').value,
          timezone: main.querySelector('#s-tz').value,
          page_title: main.querySelector('#s-title').value,
          page_intro: main.querySelector('#s-intro').value,
          brand_color: main.querySelector('#s-color').value,
        },
      });
      toast('Réglages enregistrés');
    } catch (e) { toast(e.message, true); }
  };
  main.querySelector('#p-go').onclick = async () => {
    try {
      await api('/api/password', { method: 'POST', body: { current: main.querySelector('#p-cur').value, next: main.querySelector('#p-new').value } });
      toast('Mot de passe modifié');
      main.querySelector('#p-cur').value = ''; main.querySelector('#p-new').value = '';
    } catch (e) { toast(e.message, true); }
  };
}
