// Moteur de disponibilités — le cœur du produit.
//
// Objectif : pour un type de rendez-vous et une plage de dates, calculer les
// créneaux réservables, en tenant compte de :
//   - règles hebdomadaires (dans le fuseau de l'organisateur, robustes au DST) ;
//   - exceptions de calendrier (jours fermés ou horaires spéciaux) ;
//   - réservations existantes et plages bloquées, avec buffers avant/après ;
//   - préavis minimal, horizon maximal, pas de créneau et quota journalier.
//
// Toute la logique manipule des instants absolus (ms epoch UTC) : deux créneaux
// se chevauchent si [a.start, a.end) ∩ [b.start, b.end) ≠ ∅, indépendamment des
// fuseaux. Les horaires « murs » ne servent qu'à matérialiser les fenêtres
// d'ouverture, converties en instants via le module timezone.

import {
  dateAndMinutesToUtc, localDateStr, addDays,
} from './timezone.js';

const MIN = 60000;

/** Intervalles occupés (busy) issus des réservations et blocages, en ms epoch. */
export function busyIntervals(db, fromUtc, toUtc) {
  const rows = db.prepare(
    `SELECT b.start_utc, b.end_utc,
            e.buffer_before_min AS bb, e.buffer_after_min AS ba
     FROM bookings b JOIN event_types e ON e.id = b.event_type_id
     WHERE b.status = 'confirmed' AND b.end_utc > ? AND b.start_utc < ?`
  ).all(fromUtc.toISOString(), toUtc.toISOString());
  const intervals = rows.map((r) => ({
    start: Date.parse(r.start_utc) - r.bb * MIN,
    end: Date.parse(r.end_utc) + r.ba * MIN,
  }));
  const blocks = db.prepare(
    `SELECT start_utc, end_utc FROM blocked_times WHERE end_utc > ? AND start_utc < ?`
  ).all(fromUtc.toISOString(), toUtc.toISOString());
  for (const b of blocks) {
    intervals.push({ start: Date.parse(b.start_utc), end: Date.parse(b.end_utc) });
  }
  return intervals;
}

/** Fenêtres d'ouverture (heure murale) applicables un jour donné. */
function windowsForDay(db, eventType, dayStr, weekday) {
  const override = db.prepare('SELECT * FROM date_overrides WHERE day = ?').get(dayStr);
  if (override) {
    if (!override.available) return []; // jour explicitement fermé
    if (override.start_min != null && override.end_min != null) {
      return [{ start_min: override.start_min, end_min: override.end_min }];
    }
    // override "ouvert" sans horaire => on retombe sur les règles hebdo
  }
  // Règles spécifiques au type si elles existent, sinon règles globales.
  const specific = db.prepare(
    'SELECT start_min, end_min FROM availability_rules WHERE event_type_id = ? AND weekday = ? ORDER BY start_min'
  ).all(eventType.id, weekday);
  if (specific.length) return specific;
  return db.prepare(
    'SELECT start_min, end_min FROM availability_rules WHERE event_type_id IS NULL AND weekday = ? ORDER BY start_min'
  ).all(weekday);
}

function overlaps(aStart, aEnd, intervals) {
  for (const iv of intervals) {
    if (aStart < iv.end && iv.start < aEnd) return true;
  }
  return false;
}

/**
 * Calcule les créneaux réservables.
 * @param {object} db
 * @param {object} eventType   ligne event_types
 * @param {string} organizerTz fuseau de l'organisateur
 * @param {string} fromDay     "YYYY-MM-DD" (dans le fuseau invité) — inclus
 * @param {string} toDay       "YYYY-MM-DD" — inclus
 * @param {string} inviteeTz   fuseau de l'invité (regroupement par jour)
 * @param {Date}   now         instant courant (injectable pour les tests)
 * @returns {{days: Array<{day:string, slots:Array<{start:string,end:string}>}>}}
 *          slots en ISO UTC, regroupés par jour local invité.
 */
export function computeSlots(db, eventType, organizerTz, fromDay, toDay, inviteeTz, now = new Date()) {
  const duration = eventType.duration_min;
  const step = eventType.slot_step_min > 0 ? eventType.slot_step_min : duration;
  const earliest = now.getTime() + eventType.min_notice_min * MIN;
  const horizonDay = addDays(localDateStr(now, inviteeTz), eventType.max_days_ahead);
  const effectiveTo = toDay < horizonDay ? toDay : horizonDay;

  // On balaie les jours de l'organisateur couvrant la plage invité, avec une
  // marge d'un jour de part et d'autre (un créneau du soir chez l'un peut
  // tomber le lendemain chez l'autre selon le décalage).
  const scanFrom = addDays(fromDay, -1);
  const scanTo = addDays(effectiveTo, 1);
  const rangeStart = dateAndMinutesToUtc(scanFrom, 0, organizerTz);
  const rangeEnd = dateAndMinutesToUtc(addDays(scanTo, 1), 0, organizerTz);
  const busy = busyIntervals(db, rangeStart, rangeEnd);

  // Génère tous les créneaux candidats (instants), puis on les range par jour invité.
  const candidates = [];
  for (let day = scanFrom; day <= scanTo; day = addDays(day, 1)) {
    const windows = windowsForDay(db, eventType, day, localWeekdayOf(day));
    for (const w of windows) {
      // Dernier départ possible pour que le créneau tienne dans la fenêtre.
      for (let m = w.start_min; m + duration <= w.end_min; m += step) {
        const start = dateAndMinutesToUtc(day, m, organizerTz);
        const startMs = start.getTime();
        const endMs = startMs + duration * MIN;
        if (startMs < earliest) continue;
        if (overlaps(startMs, endMs, busy)) continue;
        candidates.push({ startMs, endMs });
      }
    }
  }

  // Dé-doublonnage (un créneau ne doit apparaître qu'une fois) et tri.
  const seen = new Set();
  const uniq = [];
  for (const c of candidates.sort((a, b) => a.startMs - b.startMs)) {
    if (seen.has(c.startMs)) continue;
    seen.add(c.startMs);
    uniq.push(c);
  }

  // Quota journalier : compté sur le jour de l'organisateur (règle métier :
  // « pas plus de N rendez-vous par jour ouvré »).
  const perOrganizerDay = new Map();
  if (eventType.daily_max > 0) {
    const existing = db.prepare(
      `SELECT start_utc FROM bookings WHERE status='confirmed' AND event_type_id = ?`
    ).all(eventType.id);
    for (const r of existing) {
      const d = localDateStr(new Date(r.start_utc), organizerTz);
      perOrganizerDay.set(d, (perOrganizerDay.get(d) || 0) + 1);
    }
  }

  // Regroupement par jour local de l'invité, en ne gardant que la plage demandée.
  const byDay = new Map();
  for (const c of uniq) {
    const startDate = new Date(c.startMs);
    const inviteeDay = localDateStr(startDate, inviteeTz);
    if (inviteeDay < fromDay || inviteeDay > effectiveTo) continue;
    if (eventType.daily_max > 0) {
      const orgDay = localDateStr(startDate, organizerTz);
      const used = perOrganizerDay.get(orgDay) || 0;
      // On réserve la place : on n'offre pas plus de créneaux que le quota restant.
      if (used >= eventType.daily_max) continue;
    }
    if (!byDay.has(inviteeDay)) byDay.set(inviteeDay, []);
    byDay.get(inviteeDay).push({
      start: startDate.toISOString(),
      end: new Date(c.endMs).toISOString(),
    });
  }

  const days = [];
  for (let day = fromDay; day <= effectiveTo; day = addDays(day, 1)) {
    days.push({ day, slots: byDay.get(day) || [] });
  }
  return { days, horizon: horizonDay };
}

/** Jour de la semaine (0=dim) d'une date "YYYY-MM-DD" pure (sans fuseau). */
function localWeekdayOf(dayStr) {
  const [y, m, d] = dayStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Vérifie qu'un instant de départ est toujours réservable pour un type donné,
 * au moment de la réservation (anti double-réservation et respect des règles).
 * Renvoie {ok:true} ou {ok:false, reason}.
 */
export function validateSlot(db, eventType, organizerTz, startIso, now = new Date()) {
  const start = new Date(startIso);
  if (isNaN(start.getTime())) return { ok: false, reason: 'Créneau invalide' };
  const startMs = start.getTime();
  const endMs = startMs + eventType.duration_min * MIN;

  if (startMs < now.getTime() + eventType.min_notice_min * MIN) {
    return { ok: false, reason: 'Préavis insuffisant' };
  }
  const horizon = dateAndMinutesToUtc(
    addDays(localDateStr(now, organizerTz), eventType.max_days_ahead + 1), 0, organizerTz
  );
  if (startMs >= horizon.getTime()) return { ok: false, reason: 'Au-delà de l’horizon de réservation' };

  // Le départ doit tomber sur une grille valide dans une fenêtre d'ouverture.
  const day = localDateStr(start, organizerTz);
  const weekday = localWeekdayOf(day);
  const windows = windowsForDay(db, eventType, day, weekday);
  const startMinLocal = minutesInDay(start, organizerTz, day);
  const step = eventType.slot_step_min > 0 ? eventType.slot_step_min : eventType.duration_min;
  let inWindow = false;
  for (const w of windows) {
    if (
      startMinLocal >= w.start_min &&
      startMinLocal + eventType.duration_min <= w.end_min &&
      (startMinLocal - w.start_min) % step === 0
    ) {
      inWindow = true;
      break;
    }
  }
  if (!inWindow) return { ok: false, reason: 'Hors des plages d’ouverture' };

  // Pas de chevauchement avec l'existant (buffers inclus).
  const pad = 60 * MIN;
  const busy = busyIntervals(db, new Date(startMs - pad), new Date(endMs + pad));
  if (overlaps(startMs, endMs, busy)) return { ok: false, reason: 'Créneau déjà réservé' };

  if (eventType.daily_max > 0) {
    const orgDay = localDateStr(start, organizerTz);
    const dayStart = dateAndMinutesToUtc(orgDay, 0, organizerTz).toISOString();
    const dayEnd = dateAndMinutesToUtc(addDays(orgDay, 1), 0, organizerTz).toISOString();
    const { n } = db.prepare(
      `SELECT COUNT(*) AS n FROM bookings WHERE status='confirmed' AND event_type_id = ?
       AND start_utc >= ? AND start_utc < ?`
    ).get(eventType.id, dayStart, dayEnd);
    if (n >= eventType.daily_max) return { ok: false, reason: 'Quota du jour atteint' };
  }
  return { ok: true, start, end: new Date(endMs) };
}

/** Minutes depuis minuit d'un instant, dans le fuseau tz (via le jour attendu). */
function minutesInDay(instant, tz, expectedDay) {
  // On reconstruit à partir des parts pour rester robuste au DST.
  const ds = localDateStr(instant, tz);
  const base = dateAndMinutesToUtc(ds, 0, tz).getTime();
  return Math.round((instant.getTime() - base) / MIN);
}
