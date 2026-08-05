// Page publique de réservation — parcours invité :
//   types de RDV → calendrier mensuel → créneaux (dans le fuseau de l'invité)
//   → formulaire → confirmation avec fichier .ics.
// Gère aussi la page de gestion d'une réservation via son jeton (#/rdv/<token>).

import { api, esc, toast, detectTimeZone } from './app.js';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DOW = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];

const LOC_ICON = { video: '📹', phone: '📞', in_person: '📍', custom: '🔗' };
const LOC_LABEL = { video: 'Visioconférence', phone: 'Téléphone', in_person: 'Sur place', custom: 'Lien' };

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const todayInTz = (tz) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return p; // en-CA => YYYY-MM-DD
};

// état du parcours
const st = {
  cfg: null, tz: detectTimeZone(), event: null,
  monthCursor: null, // Date (1er du mois affiché, en UTC calendaire)
  selectedDay: null, slotsCache: {}, chosenSlot: null,
};

function applyBrand(color) {
  if (color) document.documentElement.style.setProperty('--brand', color);
}

export async function renderPublic(root, hash) {
  // Page de gestion d'une réservation existante ?
  const m = hash.match(/^#\/rdv\/([\w-]+)$/);
  if (m) return renderManage(root, m[1]);

  root.innerHTML = '<div class="spinner"></div>';
  try {
    st.cfg = await api('/api/public/config');
  } catch (e) {
    root.innerHTML = `<div class="pub-wrap center"><p class="muted">Service indisponible.</p></div>`;
    return;
  }
  applyBrand(st.cfg.brand_color);
  document.title = `${st.cfg.page_title} — ${st.cfg.organizer_name || 'Créneau'}`;
  if (!st.event) renderTypeList(root);
  else renderScheduler(root);
}

function shell(inner) {
  return `<div class="pub-wrap">
    <div class="pub-header">
      <div class="org">${esc(st.cfg.organizer_name || '')}</div>
      <h1>${esc(st.cfg.page_title)}</h1>
      ${st.cfg.page_intro ? `<p>${esc(st.cfg.page_intro)}</p>` : ''}
    </div>
    ${inner}
    <div class="center" style="margin-top:40px"><a class="muted" style="font-size:0.8rem;text-decoration:none" href="#/admin">Espace organisateur</a></div>
  </div>`;
}

function durationLabel(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h} h ${r}` : `${h} h`;
}

function renderTypeList(root) {
  const types = st.cfg.event_types;
  const cards = types.length ? types.map((t) => `
    <button class="type-card" data-slug="${esc(t.slug)}" style="border-left-color:${esc(t.color)}">
      <h3>${esc(t.name)}</h3>
      ${t.description ? `<div class="desc">${esc(t.description)}</div>` : ''}
      <div class="meta">
        <span>🕑 ${durationLabel(t.duration_min)}</span>
        <span>${LOC_ICON[t.location_type] || '🔗'} ${esc(LOC_LABEL[t.location_type] || '')}</span>
      </div>
    </button>`).join('')
    : '<div class="empty">Aucun type de rendez-vous disponible pour le moment.</div>';
  root.innerHTML = shell(`<div class="type-grid">${cards}</div>`);
  root.querySelectorAll('.type-card').forEach((c) => c.onclick = () => {
    st.event = types.find((t) => t.slug === c.dataset.slug);
    st.selectedDay = null; st.chosenSlot = null; st.slotsCache = {};
    const today = todayInTz(st.tz);
    st.monthCursor = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, 1));
    renderScheduler(root);
  });
}

function renderScheduler(root) {
  const tzOptions = buildTzOptions(st.tz);
  root.innerHTML = shell(`
    <div class="booking-panel">
      <div class="booking-head">
        <button class="back" title="Retour">←</button>
        <div>
          <h2>${esc(st.event.name)}</h2>
          <div class="sub">🕑 ${durationLabel(st.event.duration_min)} · ${LOC_ICON[st.event.location_type]} ${esc(LOC_LABEL[st.event.location_type])}</div>
        </div>
      </div>
      <div class="scheduler">
        <div class="cal" id="cal"></div>
        <div class="slots" id="slots">
          <div class="tz-line">Fuseau horaire : <select id="tz">${tzOptions}</select></div>
          <div id="slot-body"><p class="muted center" style="padding:40px 0">Choisissez une date.</p></div>
        </div>
      </div>
    </div>`);
  root.querySelector('.back').onclick = () => { st.event = null; renderPublic(root, ''); };
  root.querySelector('#tz').onchange = (e) => {
    st.tz = e.target.value; st.slotsCache = {};
    if (st.selectedDay) loadDay(st.selectedDay);
    drawCalendar();
  };
  drawCalendar();
}

function buildTzOptions(current) {
  // Liste compacte des fuseaux fréquents + le fuseau détecté s'il diffère.
  const common = ['Europe/Paris', 'Europe/London', 'Europe/Berlin', 'Europe/Madrid',
    'America/New_York', 'America/Los_Angeles', 'America/Sao_Paulo', 'Africa/Casablanca',
    'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];
  if (!common.includes(current)) common.unshift(current);
  return common.map((t) => `<option value="${esc(t)}" ${t === current ? 'selected' : ''}>${esc(t.replace(/_/g, ' '))}</option>`).join('');
}

async function drawCalendar() {
  const cal = document.querySelector('#cal');
  if (!cal) return;
  const cur = st.monthCursor;
  const y = cur.getUTCFullYear(), mo = cur.getUTCMonth();
  const first = new Date(Date.UTC(y, mo, 1));
  const startDow = (first.getUTCDay() + 6) % 7; // lundi = 0
  const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const today = todayInTz(st.tz);
  const monthStr = `${y}-${pad(mo + 1)}`;
  const prevDisabled = monthStr <= today.slice(0, 7);

  let cells = '';
  for (const d of DOW) cells += `<div class="dow">${d}</div>`;
  for (let i = 0; i < startDow; i++) cells += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${y}-${pad(mo + 1)}-${pad(d)}`;
    const past = ds < today;
    const sel = ds === st.selectedDay ? ' selected' : '';
    cells += `<button class="cal-day${sel}" data-day="${ds}" ${past ? 'disabled' : ''}>${d}</button>`;
  }
  cal.innerHTML = `
    <div class="cal-nav">
      <button id="prev" ${prevDisabled ? 'disabled' : ''}>‹</button>
      <strong>${MONTHS[mo]} ${y}</strong>
      <button id="next">›</button>
    </div>
    <div class="cal-grid">${cells}</div>`;
  cal.querySelector('#prev').onclick = () => { st.monthCursor = new Date(Date.UTC(y, mo - 1, 1)); drawCalendar(); };
  cal.querySelector('#next').onclick = () => { st.monthCursor = new Date(Date.UTC(y, mo + 1, 1)); drawCalendar(); };
  cal.querySelectorAll('.cal-day[data-day]').forEach((b) => {
    if (b.disabled) return;
    b.onclick = () => { st.selectedDay = b.dataset.day; st.chosenSlot = null; drawCalendar(); loadDay(b.dataset.day); };
  });

  // Marque les jours ayant des créneaux (chargement du mois en tâche de fond).
  markAvailableDays(monthStr, today, daysInMonth, y, mo);
}

async function markAvailableDays(monthStr, today, daysInMonth, y, mo) {
  const from = monthStr === today.slice(0, 7) ? today : `${monthStr}-01`;
  const to = `${monthStr}-${pad(daysInMonth)}`;
  const key = `${st.event.slug}|${st.tz}|${from}|${to}`;
  try {
    let data = st.slotsCache[key];
    if (!data) {
      data = await api(`/api/public/slots?type=${encodeURIComponent(st.event.slug)}&from=${from}&to=${to}&tz=${encodeURIComponent(st.tz)}`);
      st.slotsCache[key] = data;
    }
    const withSlots = new Set(data.days.filter((d) => d.slots.length).map((d) => d.day));
    document.querySelectorAll('.cal-day[data-day]').forEach((b) => {
      if (withSlots.has(b.dataset.day)) b.classList.add('has');
    });
  } catch { /* silencieux : le calendrier reste utilisable */ }
}

async function loadDay(day) {
  const body = document.querySelector('#slot-body');
  if (!body) return;
  body.innerHTML = '<div class="spinner"></div>';
  try {
    const data = await api(`/api/public/slots?type=${encodeURIComponent(st.event.slug)}&from=${day}&to=${day}&tz=${encodeURIComponent(st.tz)}`);
    const slots = data.days[0]?.slots || [];
    const dateLabel = new Intl.DateTimeFormat('fr-FR', { timeZone: st.tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(day + 'T12:00:00Z'));
    if (!slots.length) {
      body.innerHTML = `<p class="muted" style="font-weight:600;text-transform:capitalize">${esc(dateLabel)}</p><div class="empty-day">Aucun créneau disponible ce jour.</div>`;
      return;
    }
    const fmt = new Intl.DateTimeFormat('fr-FR', { timeZone: st.tz, hour: '2-digit', minute: '2-digit' });
    body.innerHTML = `<p style="font-weight:600;text-transform:capitalize;margin-bottom:12px">${esc(dateLabel)}</p>
      <div class="slot-list">${slots.map((s) =>
        `<button class="slot-btn" data-start="${s.start}" data-end="${s.end}">${fmt.format(new Date(s.start))}</button>`).join('')}</div>`;
    body.querySelectorAll('.slot-btn').forEach((b) => b.onclick = () => {
      st.chosenSlot = { start: b.dataset.start, end: b.dataset.end };
      renderConfirm();
    });
  } catch (e) {
    body.innerHTML = `<div class="empty-day">${esc(e.message)}</div>`;
  }
}

function renderConfirm() {
  const panel = document.querySelector('.booking-panel');
  const startFmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: st.tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(st.chosenSlot.start));
  panel.innerHTML = `
    <div class="booking-head">
      <button class="back" title="Retour">←</button>
      <div><h2>Confirmer le rendez-vous</h2><div class="sub">${esc(st.event.name)}</div></div>
    </div>
    <div class="confirm-form">
      <div class="summary-box">
        <div class="big" style="text-transform:capitalize">${esc(startFmt)}</div>
        <div class="muted">${durationLabel(st.event.duration_min)} · ${esc(st.tz.replace(/_/g, ' '))}</div>
      </div>
      <div class="field"><label>Votre nom *</label><input id="f-name" autocomplete="name"></div>
      <div class="field"><label>Votre e-mail *</label><input id="f-email" type="email" autocomplete="email"></div>
      <div class="field"><label>Message (facultatif)</label><textarea id="f-notes" rows="3" placeholder="Précisez l'objet du rendez-vous…"></textarea></div>
      <button class="btn primary" id="f-book" style="width:100%">Confirmer la réservation</button>
    </div>`;
  panel.querySelector('.back').onclick = () => { st.chosenSlot = null; renderScheduler(document.getElementById('root')); if (st.selectedDay) loadDay(st.selectedDay); };
  panel.querySelector('#f-book').onclick = doBook;
  panel.querySelector('#f-name').focus();
}

async function doBook() {
  const name = document.querySelector('#f-name').value.trim();
  const email = document.querySelector('#f-email').value.trim();
  const notes = document.querySelector('#f-notes').value.trim();
  if (!name) return toast('Votre nom est requis', true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Adresse e-mail invalide', true);
  const btn = document.querySelector('#f-book');
  btn.disabled = true; btn.textContent = 'Réservation…';
  try {
    const booking = await api('/api/public/book', {
      method: 'POST',
      body: { type: st.event.slug, start: st.chosenSlot.start, name, email, notes, tz: st.tz },
    });
    location.hash = `#/rdv/${booking.manage_token}`;
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Confirmer la réservation';
    toast(e.message, true);
    if (e.status === 409) { st.slotsCache = {}; } // le créneau vient d'être pris
  }
}

// ---- gestion d'une réservation (confirmation / annulation) ----
async function renderManage(root, token) {
  root.innerHTML = '<div class="spinner"></div>';
  let b;
  try { b = await api(`/api/public/booking/${token}`); }
  catch { root.innerHTML = `<div class="pub-wrap center"><p class="muted">Réservation introuvable.</p></div>`; return; }
  // recharge la config pour le branding si arrivée directe
  if (!st.cfg) { try { st.cfg = await api('/api/public/config'); applyBrand(st.cfg.brand_color); } catch { st.cfg = { organizer_name: '' }; } }

  const cancelled = b.status === 'cancelled';
  root.innerHTML = `<div class="pub-wrap"><div class="booking-panel">
    <div class="success-card">
      <div class="check" style="${cancelled ? 'background:var(--danger-soft);color:var(--danger)' : ''}">${cancelled ? '✕' : '✓'}</div>
      <h2>${cancelled ? 'Rendez-vous annulé' : 'Rendez-vous confirmé'}</h2>
      <p class="muted">${cancelled ? 'Ce rendez-vous a été annulé.' : 'Un récapitulatif peut être ajouté à votre agenda.'}</p>
      <div class="success-detail">
        <div><strong>${esc(b.event_name)}</strong></div>
        <div style="text-transform:capitalize">📅 ${esc(b.start_invitee)}</div>
        <div>${LOC_ICON[st.event?.location_type] || '🔗'} ${esc(b.location || '')}</div>
        <div class="muted">avec ${esc(b.organizer_name || '')}</div>
      </div>
      <div class="success-actions">
        ${cancelled ? '' : `<a class="btn primary" href="/api/public/booking/${token}/ics">Ajouter à mon agenda (.ics)</a>`}
        ${cancelled ? '' : `<button class="btn danger" id="cancel">Annuler le rendez-vous</button>`}
        <a class="btn ghost" href="#/">${cancelled ? 'Prendre un nouveau rendez-vous' : 'Retour'}</a>
      </div>
    </div>
  </div></div>`;
  const cancelBtn = root.querySelector('#cancel');
  if (cancelBtn) cancelBtn.onclick = async () => {
    if (!confirm('Confirmer l’annulation de ce rendez-vous ?')) return;
    try {
      await api(`/api/public/booking/${token}/cancel`, { method: 'POST', body: { reason: '' } });
      renderManage(root, token);
    } catch (e) { toast(e.message, true); }
  };
}
