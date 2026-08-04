import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { computeSlots, validateSlot } from '../src/availability.js';
import { dateAndMinutesToUtc } from '../src/timezone.js';

const TZ = 'Europe/Paris';

function seed() {
  const db = openDb(':memory:');
  db.prepare(
    `INSERT INTO event_types (id, slug, name, duration_min, buffer_before_min, buffer_after_min, min_notice_min, max_days_ahead, slot_step_min, daily_max)
     VALUES (1, 'call', 'Call', 30, 0, 0, 0, 60, 0, 0)`
  ).run();
  // Lun–Ven 9:00–17:00, global
  for (let wd = 1; wd <= 5; wd++) {
    db.prepare('INSERT INTO availability_rules (event_type_id, weekday, start_min, end_min) VALUES (NULL, ?, 540, 1020)').run(wd);
  }
  return db;
}
const et = (db) => db.prepare('SELECT * FROM event_types WHERE id = 1').get();
const NOW = new Date('2026-08-03T00:00:00Z'); // lundi

test('génère les bons créneaux un jour ouvré', () => {
  const db = seed();
  // Mercredi 5 août, invité même fuseau. 9:00–17:00, RDV 30 min => 16 créneaux.
  const r = computeSlots(db, et(db), TZ, '2026-08-05', '2026-08-05', TZ, NOW);
  assert.equal(r.days.length, 1);
  assert.equal(r.days[0].slots.length, 16);
  assert.equal(r.days[0].slots[0].start, '2026-08-05T07:00:00.000Z'); // 9:00 Paris
  assert.equal(r.days[0].slots.at(-1).start, '2026-08-05T14:30:00.000Z'); // 16:30 (dernier départ)
});

test('week-end fermé', () => {
  const db = seed();
  const r = computeSlots(db, et(db), TZ, '2026-08-08', '2026-08-09', TZ, NOW); // sam/dim
  assert.equal(r.days.every((d) => d.slots.length === 0), true);
});

test('réservation existante + buffer bloque les créneaux', () => {
  const db = seed();
  db.prepare('UPDATE event_types SET buffer_after_min = 15 WHERE id = 1').run();
  // Réservation 10:00–10:30 Paris (08:00–08:30Z)
  db.prepare(
    `INSERT INTO bookings (uid, event_type_id, start_utc, end_utc, invitee_name, invitee_email, manage_token)
     VALUES ('u1', 1, '2026-08-05T08:00:00.000Z', '2026-08-05T08:30:00.000Z', 'X', 'x@x', 't')`
  ).run();
  const starts = computeSlots(db, et(db), TZ, '2026-08-05', '2026-08-05', TZ, NOW).days[0].slots.map((s) => s.start);
  assert.ok(!starts.includes('2026-08-05T08:00:00.000Z'), '10:00 réservé');
  assert.ok(!starts.includes('2026-08-05T08:30:00.000Z'), '10:30 dans le buffer');
  assert.ok(starts.includes('2026-08-05T09:00:00.000Z'), '11:00 libre');
});

test('préavis minimal exclut les créneaux trop proches', () => {
  const db = seed();
  db.prepare('UPDATE event_types SET min_notice_min = 1440 WHERE id = 1').run(); // 24 h
  const now = new Date('2026-08-05T06:30:00Z'); // mercredi 08:30 Paris
  const r = computeSlots(db, et(db), TZ, '2026-08-05', '2026-08-05', TZ, now);
  // Rien le jour même (préavis 24h) ; le lendemain oui.
  assert.equal(r.days[0].slots.length, 0);
});

test('horizon maximal borne la plage', () => {
  const db = seed();
  db.prepare('UPDATE event_types SET max_days_ahead = 3 WHERE id = 1').run();
  const r = computeSlots(db, et(db), TZ, '2026-08-03', '2026-08-31', TZ, NOW);
  // Au-delà de J+3, plus aucun créneau.
  const far = r.days.find((d) => d.day > '2026-08-06');
  assert.ok(!far || far.slots.length === 0);
});

test('exception : jour fermé', () => {
  const db = seed();
  db.prepare("INSERT INTO date_overrides (day, available) VALUES ('2026-08-05', 0)").run();
  const r = computeSlots(db, et(db), TZ, '2026-08-05', '2026-08-05', TZ, NOW);
  assert.equal(r.days[0].slots.length, 0);
});

test('exception : horaires spéciaux', () => {
  const db = seed();
  db.prepare("INSERT INTO date_overrides (day, available, start_min, end_min) VALUES ('2026-08-05', 1, 600, 720)").run(); // 10:00–12:00
  const r = computeSlots(db, et(db), TZ, '2026-08-05', '2026-08-05', TZ, NOW);
  assert.equal(r.days[0].slots.length, 4); // 4 x 30 min entre 10:00 et 12:00
  assert.equal(r.days[0].slots[0].start, '2026-08-05T08:00:00.000Z'); // 10:00 Paris
});

test('quota journalier', () => {
  const db = seed();
  db.prepare('UPDATE event_types SET daily_max = 2 WHERE id = 1').run();
  db.prepare(
    `INSERT INTO bookings (uid, event_type_id, start_utc, end_utc, invitee_name, invitee_email, manage_token)
     VALUES ('a', 1, '2026-08-05T07:00:00.000Z', '2026-08-05T07:30:00.000Z', 'A', 'a@a', 't1'),
            ('b', 1, '2026-08-05T09:00:00.000Z', '2026-08-05T09:30:00.000Z', 'B', 'b@b', 't2')`
  ).run();
  const r = computeSlots(db, et(db), TZ, '2026-08-05', '2026-08-05', TZ, NOW);
  assert.equal(r.days[0].slots.length, 0); // quota atteint => plus de créneaux
});

test('regroupement dans le fuseau de l\'invité', () => {
  const db = seed();
  // Invité à New York : les créneaux Paris du matin tombent tôt le matin NY.
  const r = computeSlots(db, et(db), TZ, '2026-08-05', '2026-08-05', 'America/New_York', NOW);
  assert.ok(r.days[0].slots.length > 0);
  // Le premier créneau (9:00 Paris = 03:00 NY) est bien rangé au 5 août côté NY.
  assert.equal(r.days[0].slots[0].start, '2026-08-05T07:00:00.000Z');
});

test('validateSlot : accepte un créneau libre, refuse les invalides', () => {
  const db = seed();
  const type = et(db);
  assert.equal(validateSlot(db, type, TZ, '2026-08-05T09:00:00.000Z', NOW).ok, true);
  assert.equal(validateSlot(db, type, TZ, '2026-08-05T08:15:00.000Z', NOW).ok, false); // hors grille
  assert.equal(validateSlot(db, type, TZ, '2026-08-08T09:00:00.000Z', NOW).ok, false); // samedi
  assert.equal(validateSlot(db, type, TZ, '2026-08-05T05:00:00.000Z', NOW).ok, false); // avant ouverture
});

test('validateSlot : refuse un chevauchement (anti double-réservation)', () => {
  const db = seed();
  db.prepare(
    `INSERT INTO bookings (uid, event_type_id, start_utc, end_utc, invitee_name, invitee_email, manage_token)
     VALUES ('u1', 1, '2026-08-05T09:00:00.000Z', '2026-08-05T09:30:00.000Z', 'X', 'x@x', 't')`
  ).run();
  assert.equal(validateSlot(db, et(db), TZ, '2026-08-05T09:00:00.000Z', NOW).ok, false);
});
