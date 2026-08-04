// API REST — deux surfaces :
//   * publique (sans authentification) : consultée par la page de réservation ;
//   * admin (authentifiée) : configuration et gestion des rendez-vous.
//
// Invariant central : une réservation ne peut être créée que si le créneau est
// encore valide ET libre, la vérification et l'insertion se faisant dans une
// même transaction SQLite (empêche la double-réservation en cas de requêtes
// concurrentes).

import { randomBytes, randomUUID } from 'node:crypto';
import {
  getSettings, setSettings, getRawSetting, setRawSetting, audit,
} from './db.js';
import { computeSlots, validateSlot } from './availability.js';
import { buildIcs } from './ics.js';
import {
  isValidTimeZone, formatInstant, offsetLabel, localDateStr, addDays, listTimeZones,
} from './timezone.js';
import {
  hashPassword, verifyPassword, createSession, destroySession,
  loginAllowed, recordLoginFailure,
} from './auth.js';
import { sendJson, sendBuffer, readBody } from './router.js';

const err = (status, message) => Object.assign(new Error(message), { status });
const s = (v, max = 500) => String(v ?? '').slice(0, max).trim();
const slugify = (v) =>
  s(v, 60).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'rdv';

const LOCATION_TYPES = new Set(['video', 'phone', 'in_person', 'custom']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sessionCookie(token, req) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `creneau_session=${token}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Strict${secure}`;
}

function eventTypeFromBody(b, existing = {}) {
  const int = (v, def, min, max) => {
    const n = Number.isFinite(+v) ? Math.round(+v) : def;
    return Math.max(min, Math.min(max, n));
  };
  return {
    name: s(b.name ?? existing.name, 120),
    description: s(b.description ?? existing.description, 2000),
    duration_min: int(b.duration_min ?? existing.duration_min, 30, 5, 1440),
    buffer_before_min: int(b.buffer_before_min ?? existing.buffer_before_min, 0, 0, 480),
    buffer_after_min: int(b.buffer_after_min ?? existing.buffer_after_min, 0, 0, 480),
    min_notice_min: int(b.min_notice_min ?? existing.min_notice_min, 120, 0, 43200),
    max_days_ahead: int(b.max_days_ahead ?? existing.max_days_ahead, 60, 1, 730),
    slot_step_min: int(b.slot_step_min ?? existing.slot_step_min, 0, 0, 480),
    daily_max: int(b.daily_max ?? existing.daily_max, 0, 0, 100),
    location_type: LOCATION_TYPES.has(b.location_type) ? b.location_type : (existing.location_type || 'video'),
    location_detail: s(b.location_detail ?? existing.location_detail, 500),
    color: /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : (existing.color || '#2563eb'),
    active: b.active === undefined ? (existing.active ?? 1) : (b.active ? 1 : 0),
  };
}

function locationText(eventType, settings) {
  switch (eventType.location_type) {
    case 'phone': return eventType.location_detail || 'Par téléphone';
    case 'in_person': return eventType.location_detail || 'Sur place';
    case 'custom': return eventType.location_detail || '';
    default: return eventType.location_detail || 'Visioconférence';
  }
}

function publicEventType(e) {
  return {
    slug: e.slug, name: e.name, description: e.description, duration_min: e.duration_min,
    location_type: e.location_type, location_detail: e.location_detail, color: e.color,
  };
}

function bookingView(db, b, settings) {
  const e = db.prepare('SELECT * FROM event_types WHERE id = ?').get(b.event_type_id);
  return {
    id: b.id, uid: b.uid, status: b.status, sequence: b.sequence,
    start_utc: b.start_utc, end_utc: b.end_utc,
    event_name: e?.name || '(supprimé)', event_slug: e?.slug,
    duration_min: e?.duration_min,
    invitee_name: b.invitee_name, invitee_email: b.invitee_email,
    invitee_tz: b.invitee_tz, invitee_notes: b.invitee_notes,
    manage_token: b.manage_token, cancel_reason: b.cancel_reason,
    created_at: b.created_at,
    start_organizer: formatInstant(new Date(b.start_utc), settings.timezone, settings.locale),
  };
}

// Construit et renvoie le .ics d'une réservation (REQUEST ou CANCEL).
function icsFor(db, booking, settings, { method = 'REQUEST' } = {}) {
  const e = db.prepare('SELECT * FROM event_types WHERE id = ?').get(booking.event_type_id);
  const cancelled = booking.status === 'cancelled' || method === 'CANCEL';
  return buildIcs({
    uid: booking.uid,
    sequence: booking.sequence,
    start: new Date(booking.start_utc),
    end: new Date(booking.end_utc),
    summary: `${e?.name || 'Rendez-vous'} — ${settings.organizer_name || 'Créneau'}`,
    description: [
      booking.invitee_notes ? `Note : ${booking.invitee_notes}` : '',
      `Invité : ${booking.invitee_name} <${booking.invitee_email}>`,
    ].filter(Boolean).join('\n'),
    location: locationText(e || {}, settings),
    organizerName: settings.organizer_name,
    organizerEmail: settings.organizer_email,
    attendeeName: booking.invitee_name,
    attendeeEmail: booking.invitee_email,
    method: cancelled ? 'CANCEL' : 'REQUEST',
    status: cancelled ? 'CANCELLED' : 'CONFIRMED',
  });
}

export function registerApi(router, db) {
  const S = () => getSettings(db);

  // ============================ Authentification ============================
  router.get('/api/setup-status', (req, res) => {
    sendJson(res, 200, { configured: !!getRawSetting(db, 'auth') });
  });

  router.post('/api/setup', async (req, res) => {
    if (getRawSetting(db, 'auth')) throw err(409, 'Déjà configuré');
    const body = await readBody(req);
    if (String(body.password || '').length < 8) throw err(400, 'Mot de passe : 8 caractères minimum');
    setRawSetting(db, 'auth', hashPassword(String(body.password)));
    const patch = {};
    if (body.organizer_name) patch.organizer_name = s(body.organizer_name, 120);
    if (body.organizer_email) patch.organizer_email = s(body.organizer_email, 200);
    if (isValidTimeZone(body.timezone)) patch.timezone = body.timezone;
    setSettings(db, patch);
    const token = createSession(db);
    audit(db, 'setup');
    res.setHeader('Set-Cookie', sessionCookie(token, req));
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/login', async (req, res) => {
    const ip = req.socket.remoteAddress || '?';
    if (!loginAllowed(ip)) throw err(429, 'Trop de tentatives, réessayez dans 15 minutes');
    const body = await readBody(req);
    const stored = getRawSetting(db, 'auth');
    if (!stored || !verifyPassword(String(body.password || ''), stored)) {
      recordLoginFailure(ip);
      throw err(401, 'Mot de passe incorrect');
    }
    const token = createSession(db);
    res.setHeader('Set-Cookie', sessionCookie(token, req));
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/logout', (req, res, { cookies }) => {
    destroySession(db, cookies.creneau_session);
    res.setHeader('Set-Cookie', 'creneau_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict');
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/me', (req, res) => sendJson(res, 200, { ok: true }));

  router.post('/api/password', async (req, res) => {
    const body = await readBody(req);
    if (!verifyPassword(String(body.current || ''), getRawSetting(db, 'auth'))) {
      throw err(401, 'Mot de passe actuel incorrect');
    }
    if (String(body.next || '').length < 8) throw err(400, 'Nouveau mot de passe : 8 caractères minimum');
    setRawSetting(db, 'auth', hashPassword(String(body.next)));
    sendJson(res, 200, { ok: true });
  });

  // ================================ Réglages ================================
  router.get('/api/settings', (req, res) => sendJson(res, 200, S()));
  router.put('/api/settings', async (req, res) => {
    const body = await readBody(req);
    if (body.timezone !== undefined && !isValidTimeZone(body.timezone)) {
      throw err(400, 'Fuseau horaire invalide');
    }
    setSettings(db, body);
    audit(db, 'settings_update');
    sendJson(res, 200, S());
  });
  router.get('/api/timezones', (req, res) => {
    sendJson(res, 200, listTimeZones());
  });

  // ============================== Event types ==============================
  router.get('/api/event-types', (req, res) => {
    sendJson(res, 200, db.prepare('SELECT * FROM event_types ORDER BY position, id').all());
  });

  router.post('/api/event-types', async (req, res) => {
    const b = await readBody(req);
    const data = eventTypeFromBody(b);
    if (!data.name) throw err(400, 'Le nom est requis');
    let slug = slugify(b.slug || data.name);
    // unicité du slug
    let base = slug, i = 2;
    while (db.prepare('SELECT 1 FROM event_types WHERE slug = ?').get(slug)) slug = `${base}-${i++}`;
    const pos = (db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM event_types').get()).p;
    const info = db.prepare(
      `INSERT INTO event_types (slug, name, description, duration_min, buffer_before_min, buffer_after_min,
        min_notice_min, max_days_ahead, slot_step_min, daily_max, location_type, location_detail, color, position, active)
       VALUES (@slug,@name,@description,@duration_min,@buffer_before_min,@buffer_after_min,@min_notice_min,
        @max_days_ahead,@slot_step_min,@daily_max,@location_type,@location_detail,@color,@position,@active)`
    ).run({ ...data, slug, position: pos });
    audit(db, 'event_type_create', slug);
    sendJson(res, 201, db.prepare('SELECT * FROM event_types WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/api/event-types/:id', async (req, res, { params }) => {
    const existing = db.prepare('SELECT * FROM event_types WHERE id = ?').get(params.id);
    if (!existing) throw err(404, 'Type de rendez-vous introuvable');
    const b = await readBody(req);
    const data = eventTypeFromBody(b, existing);
    let slug = existing.slug;
    if (b.slug && slugify(b.slug) !== existing.slug) {
      slug = slugify(b.slug);
      let base = slug, i = 2;
      while (db.prepare('SELECT 1 FROM event_types WHERE slug = ? AND id <> ?').get(slug, params.id)) slug = `${base}-${i++}`;
    }
    db.prepare(
      `UPDATE event_types SET slug=@slug, name=@name, description=@description, duration_min=@duration_min,
        buffer_before_min=@buffer_before_min, buffer_after_min=@buffer_after_min, min_notice_min=@min_notice_min,
        max_days_ahead=@max_days_ahead, slot_step_min=@slot_step_min, daily_max=@daily_max,
        location_type=@location_type, location_detail=@location_detail, color=@color, active=@active
       WHERE id=@id`
    ).run({ ...data, slug, id: Number(params.id) });
    sendJson(res, 200, db.prepare('SELECT * FROM event_types WHERE id = ?').get(params.id));
  });

  router.delete('/api/event-types/:id', (req, res, { params }) => {
    const used = db.prepare(
      `SELECT COUNT(*) AS n FROM bookings WHERE event_type_id = ? AND status='confirmed' AND start_utc > datetime('now')`
    ).get(params.id);
    if (used.n > 0) {
      db.prepare('UPDATE event_types SET active = 0 WHERE id = ?').run(params.id);
      sendJson(res, 200, { deactivated: true, upcoming: used.n });
    } else {
      db.prepare('DELETE FROM event_types WHERE id = ?').run(params.id);
      sendJson(res, 200, { deleted: true });
    }
  });

  // ============================ Disponibilités =============================
  router.get('/api/availability', (req, res, { query }) => {
    const etId = query.get('event_type_id');
    const rules = etId
      ? db.prepare('SELECT * FROM availability_rules WHERE event_type_id = ? ORDER BY weekday, start_min').all(etId)
      : db.prepare('SELECT * FROM availability_rules WHERE event_type_id IS NULL ORDER BY weekday, start_min').all();
    sendJson(res, 200, rules);
  });

  // Remplace en bloc la grille hebdo (global si event_type_id absent).
  router.put('/api/availability', async (req, res) => {
    const b = await readBody(req);
    const etId = b.event_type_id ? Number(b.event_type_id) : null;
    if (etId && !db.prepare('SELECT 1 FROM event_types WHERE id = ?').get(etId)) throw err(404, 'Type inconnu');
    const rules = Array.isArray(b.rules) ? b.rules : [];
    for (const r of rules) {
      if (!(r.weekday >= 0 && r.weekday <= 6)) throw err(400, 'Jour invalide');
      if (!(r.start_min >= 0 && r.end_min <= 1440 && r.start_min < r.end_min)) throw err(400, 'Plage horaire invalide');
    }
    db.exec('BEGIN');
    try {
      if (etId === null) db.prepare('DELETE FROM availability_rules WHERE event_type_id IS NULL').run();
      else db.prepare('DELETE FROM availability_rules WHERE event_type_id = ?').run(etId);
      const ins = db.prepare('INSERT INTO availability_rules (event_type_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)');
      for (const r of rules) ins.run(etId, r.weekday, Math.round(r.start_min), Math.round(r.end_min));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    audit(db, 'availability_update', etId ? `type ${etId}` : 'global');
    sendJson(res, 200, { ok: true });
  });

  // Exceptions de calendrier
  router.get('/api/overrides', (req, res) => {
    sendJson(res, 200, db.prepare("SELECT * FROM date_overrides WHERE day >= date('now','-1 day') ORDER BY day").all());
  });
  router.put('/api/overrides/:day', async (req, res, { params }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.day)) throw err(400, 'Date invalide');
    const b = await readBody(req);
    const available = b.available ? 1 : 0;
    const start = available && b.start_min != null ? Math.round(b.start_min) : null;
    const end = available && b.end_min != null ? Math.round(b.end_min) : null;
    db.prepare(
      `INSERT INTO date_overrides (day, available, start_min, end_min, note) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET available=excluded.available, start_min=excluded.start_min,
       end_min=excluded.end_min, note=excluded.note`
    ).run(params.day, available, start, end, s(b.note, 200));
    sendJson(res, 200, { ok: true });
  });
  router.delete('/api/overrides/:day', (req, res, { params }) => {
    db.prepare('DELETE FROM date_overrides WHERE day = ?').run(params.day);
    sendJson(res, 200, { ok: true });
  });

  // Plages bloquées (indispos ponctuelles)
  router.get('/api/blocked', (req, res) => {
    sendJson(res, 200, db.prepare("SELECT * FROM blocked_times WHERE end_utc > datetime('now') ORDER BY start_utc").all());
  });
  router.post('/api/blocked', async (req, res) => {
    const b = await readBody(req);
    const start = new Date(b.start_utc), end = new Date(b.end_utc);
    if (isNaN(start) || isNaN(end) || end <= start) throw err(400, 'Plage invalide');
    const info = db.prepare('INSERT INTO blocked_times (start_utc, end_utc, reason) VALUES (?, ?, ?)')
      .run(start.toISOString(), end.toISOString(), s(b.reason, 200));
    sendJson(res, 201, db.prepare('SELECT * FROM blocked_times WHERE id = ?').get(info.lastInsertRowid));
  });
  router.delete('/api/blocked/:id', (req, res, { params }) => {
    db.prepare('DELETE FROM blocked_times WHERE id = ?').run(params.id);
    sendJson(res, 200, { ok: true });
  });

  // ============================== Réservations (admin) =====================
  router.get('/api/bookings', (req, res, { query }) => {
    const scope = query.get('scope') || 'upcoming';
    let sql = 'SELECT * FROM bookings WHERE 1=1';
    const args = [];
    if (scope === 'upcoming') sql += " AND status='confirmed' AND start_utc > datetime('now')";
    else if (scope === 'past') sql += " AND start_utc <= datetime('now')";
    else if (scope === 'cancelled') sql += " AND status='cancelled'";
    sql += " ORDER BY start_utc " + (scope === 'past' ? 'DESC' : 'ASC') + ' LIMIT 500';
    const settings = S();
    sendJson(res, 200, db.prepare(sql).all(...args).map((b) => bookingView(db, b, settings)));
  });

  router.post('/api/bookings/:id/cancel', async (req, res, { params }) => {
    const b = await readBody(req);
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(params.id);
    if (!booking) throw err(404, 'Réservation introuvable');
    if (booking.status === 'cancelled') throw err(409, 'Déjà annulée');
    db.prepare("UPDATE bookings SET status='cancelled', sequence=sequence+1, cancel_reason=? WHERE id=?")
      .run(s(b.reason, 500), params.id);
    audit(db, 'booking_cancel', booking.uid);
    sendJson(res, 200, bookingView(db, db.prepare('SELECT * FROM bookings WHERE id = ?').get(params.id), S()));
  });

  router.get('/api/bookings/:id/ics', (req, res, { params }) => {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(params.id);
    if (!booking) throw err(404, 'Réservation introuvable');
    sendBuffer(res, Buffer.from(icsFor(db, booking, S()), 'utf8'), 'text/calendar; charset=utf-8', `rdv-${booking.uid}.ics`);
  });

  // ============================ Surface PUBLIQUE ===========================
  router.get('/api/public/config', (req, res) => {
    const st = S();
    const types = db.prepare('SELECT * FROM event_types WHERE active = 1 ORDER BY position, id').all();
    sendJson(res, 200, {
      organizer_name: st.organizer_name,
      page_title: st.page_title,
      page_intro: st.page_intro,
      brand_color: st.brand_color,
      timezone: st.timezone,
      locale: st.locale,
      week_start: st.week_start,
      event_types: types.map(publicEventType),
    });
  });

  router.get('/api/public/slots', (req, res, { query }) => {
    const settings = S();
    const et = db.prepare('SELECT * FROM event_types WHERE slug = ? AND active = 1').get(query.get('type'));
    if (!et) throw err(404, 'Type de rendez-vous introuvable');
    const inviteeTz = isValidTimeZone(query.get('tz')) ? query.get('tz') : settings.timezone;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(query.get('from')) ? query.get('from') : localDateStr(new Date(), inviteeTz);
    const to = /^\d{4}-\d{2}-\d{2}$/.test(query.get('to')) ? query.get('to') : addDays(from, 6);
    if (to < from) throw err(400, 'Plage de dates invalide');
    // Bornage : 40 jours max par requête
    const safeTo = to > addDays(from, 40) ? addDays(from, 40) : to;
    const result = computeSlots(db, et, settings.timezone, from, safeTo, inviteeTz);
    sendJson(res, 200, {
      event: publicEventType(et),
      timezone: inviteeTz,
      offset_label: offsetLabel(new Date(), inviteeTz),
      ...result,
    });
  });

  router.post('/api/public/book', async (req, res) => {
    const settings = S();
    const b = await readBody(req);
    const et = db.prepare('SELECT * FROM event_types WHERE slug = ? AND active = 1').get(b.type);
    if (!et) throw err(404, 'Type de rendez-vous introuvable');
    const name = s(b.name, 120);
    const email = s(b.email, 200);
    if (!name) throw err(400, 'Votre nom est requis');
    if (!EMAIL_RE.test(email)) throw err(400, 'Adresse e-mail invalide');
    const inviteeTz = isValidTimeZone(b.tz) ? b.tz : settings.timezone;

    // Vérification + insertion atomiques : empêche la double réservation.
    db.exec('BEGIN IMMEDIATE');
    try {
      const check = validateSlot(db, et, settings.timezone, b.start);
      if (!check.ok) {
        db.exec('ROLLBACK');
        throw err(409, check.reason);
      }
      const uid = `${randomUUID()}@creneau`;
      const manageToken = randomBytes(18).toString('base64url');
      const info = db.prepare(
        `INSERT INTO bookings (uid, event_type_id, start_utc, end_utc, invitee_name, invitee_email,
          invitee_tz, invitee_notes, manage_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(uid, et.id, check.start.toISOString(), check.end.toISOString(), name, email, inviteeTz, s(b.notes, 2000), manageToken);
      db.exec('COMMIT');
      audit(db, 'booking_create', uid);
      const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid);
      sendJson(res, 201, publicBookingView(db, booking, settings));
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* déjà rollback */ }
      throw e;
    }
  });

  // Consultation / gestion côté invité, par jeton (pas d'authentification).
  const findByToken = (token) => db.prepare('SELECT * FROM bookings WHERE manage_token = ?').get(token);

  router.get('/api/public/booking/:token', (req, res, { params }) => {
    const booking = findByToken(params.token);
    if (!booking) throw err(404, 'Réservation introuvable');
    sendJson(res, 200, publicBookingView(db, booking, S()));
  });

  router.get('/api/public/booking/:token/ics', (req, res, { params }) => {
    const booking = findByToken(params.token);
    if (!booking) throw err(404, 'Réservation introuvable');
    sendBuffer(res, Buffer.from(icsFor(db, booking, S()), 'utf8'), 'text/calendar; charset=utf-8', `rdv-${booking.uid}.ics`);
  });

  router.post('/api/public/booking/:token/cancel', async (req, res, { params }) => {
    const booking = findByToken(params.token);
    if (!booking) throw err(404, 'Réservation introuvable');
    if (booking.status === 'cancelled') throw err(409, 'Déjà annulée');
    if (new Date(booking.start_utc) < new Date()) throw err(409, 'Ce rendez-vous est déjà passé');
    const b = await readBody(req);
    db.prepare("UPDATE bookings SET status='cancelled', sequence=sequence+1, cancel_reason=? WHERE id=?")
      .run(s(b.reason, 500), booking.id);
    audit(db, 'booking_cancel_invitee', booking.uid);
    sendJson(res, 200, publicBookingView(db, db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id), S()));
  });

  // Reprogrammation : annule l'ancien créneau et pose le nouveau (même UID
  // conservé côté agenda via un nouvel enregistrement lié par le jeton).
  router.post('/api/public/booking/:token/reschedule', async (req, res, { params }) => {
    const settings = S();
    const booking = findByToken(params.token);
    if (!booking) throw err(404, 'Réservation introuvable');
    if (booking.status === 'cancelled') throw err(409, 'Réservation annulée');
    const et = db.prepare('SELECT * FROM event_types WHERE id = ?').get(booking.event_type_id);
    const b = await readBody(req);
    db.exec('BEGIN IMMEDIATE');
    try {
      const check = validateSlot(db, et, settings.timezone, b.start);
      if (!check.ok) { db.exec('ROLLBACK'); throw err(409, check.reason); }
      db.prepare(
        "UPDATE bookings SET start_utc=?, end_utc=?, sequence=sequence+1 WHERE id=?"
      ).run(check.start.toISOString(), check.end.toISOString(), booking.id);
      db.exec('COMMIT');
      audit(db, 'booking_reschedule', booking.uid);
      sendJson(res, 200, publicBookingView(db, db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id), settings));
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* */ }
      throw e;
    }
  });

  function publicBookingView(db, b, settings) {
    const e = db.prepare('SELECT * FROM event_types WHERE id = ?').get(b.event_type_id);
    return {
      uid: b.uid, status: b.status, manage_token: b.manage_token,
      start_utc: b.start_utc, end_utc: b.end_utc,
      event_name: e?.name, duration_min: e?.duration_min,
      location: locationText(e || {}, settings),
      invitee_name: b.invitee_name, invitee_email: b.invitee_email, invitee_tz: b.invitee_tz,
      organizer_name: settings.organizer_name,
      start_invitee: formatInstant(new Date(b.start_utc), b.invitee_tz || settings.timezone, settings.locale),
    };
  }

  // Statistiques admin (tableau de bord)
  router.get('/api/stats', (req, res) => {
    const settings = S();
    const upcoming = db.prepare(
      "SELECT COUNT(*) AS n FROM bookings WHERE status='confirmed' AND start_utc > datetime('now')"
    ).get().n;
    const next = db.prepare(
      "SELECT * FROM bookings WHERE status='confirmed' AND start_utc > datetime('now') ORDER BY start_utc LIMIT 5"
    ).all().map((b) => bookingView(db, b, settings));
    const last30 = db.prepare(
      "SELECT COUNT(*) AS n FROM bookings WHERE created_at > datetime('now','-30 day')"
    ).get().n;
    const cancelled = db.prepare(
      "SELECT COUNT(*) AS n FROM bookings WHERE status='cancelled'"
    ).get().n;
    const byType = db.prepare(
      `SELECT e.name, COUNT(b.id) AS n FROM event_types e
       LEFT JOIN bookings b ON b.event_type_id = e.id AND b.status='confirmed' AND b.start_utc > datetime('now')
       GROUP BY e.id ORDER BY e.position`
    ).all();
    sendJson(res, 200, { upcoming, next, booked_last_30d: last30, cancelled_total: cancelled, by_type: byType });
  });
}
