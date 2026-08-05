// Persistance — SQLite natif de Node (node:sqlite), zéro dépendance.
// Migrations idempotentes versionnées par PRAGMA user_version.
//
// Conventions temporelles :
//  - les instants (réservations, blocages) sont stockés en ISO 8601 UTC ;
//  - les horaires de disponibilité sont des « minutes depuis minuit » dans le
//    fuseau de l'organisateur (settings.timezone), indépendants du DST.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS = [
  // v1 — schéma initial
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE event_types (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    slug              TEXT NOT NULL UNIQUE,
    name              TEXT NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    duration_min      INTEGER NOT NULL DEFAULT 30,
    buffer_before_min INTEGER NOT NULL DEFAULT 0,
    buffer_after_min  INTEGER NOT NULL DEFAULT 0,
    min_notice_min    INTEGER NOT NULL DEFAULT 120,
    max_days_ahead    INTEGER NOT NULL DEFAULT 60,
    slot_step_min     INTEGER NOT NULL DEFAULT 0,   -- 0 => pas = durée
    daily_max         INTEGER NOT NULL DEFAULT 0,   -- 0 => illimité
    location_type     TEXT NOT NULL DEFAULT 'video', -- video | phone | in_person | custom
    location_detail   TEXT NOT NULL DEFAULT '',
    color             TEXT NOT NULL DEFAULT '#2563eb',
    position          INTEGER NOT NULL DEFAULT 0,
    active            INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Règles hebdomadaires. event_type_id NULL => s'applique à tous les types.
  CREATE TABLE availability_rules (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type_id INTEGER REFERENCES event_types(id) ON DELETE CASCADE,
    weekday       INTEGER NOT NULL,   -- 0 = dimanche … 6 = samedi
    start_min     INTEGER NOT NULL,   -- minutes depuis minuit (fuseau organisateur)
    end_min       INTEGER NOT NULL
  );
  CREATE INDEX idx_rules_weekday ON availability_rules (weekday);
  -- Exceptions de calendrier (jour fermé ou horaires spéciaux).
  CREATE TABLE date_overrides (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    day       TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD
    available INTEGER NOT NULL DEFAULT 0,
    start_min INTEGER,
    end_min   INTEGER,
    note      TEXT NOT NULL DEFAULT ''
  );
  -- Plages occupées saisies à la main (indispo ponctuelle).
  CREATE TABLE blocked_times (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    start_utc  TEXT NOT NULL,
    end_utc    TEXT NOT NULL,
    reason     TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_blocked_start ON blocked_times (start_utc);
  CREATE TABLE bookings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    uid           TEXT NOT NULL UNIQUE,       -- UID iCalendar stable
    event_type_id INTEGER NOT NULL REFERENCES event_types(id),
    start_utc     TEXT NOT NULL,
    end_utc       TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | cancelled
    sequence      INTEGER NOT NULL DEFAULT 0,  -- SEQUENCE iCalendar (reprogrammations)
    invitee_name  TEXT NOT NULL,
    invitee_email TEXT NOT NULL,
    invitee_tz    TEXT NOT NULL DEFAULT 'UTC',
    invitee_notes TEXT NOT NULL DEFAULT '',
    manage_token  TEXT NOT NULL,              -- jeton d'annulation/repro côté invité
    cancel_reason TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_bookings_start ON bookings (start_utc);
  CREATE INDEX idx_bookings_status ON bookings (status, start_utc);
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE TABLE audit_log (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ts     TEXT NOT NULL DEFAULT (datetime('now')),
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  );
  `,
];

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  const { user_version: v } = db.prepare('PRAGMA user_version').get();
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

export const DEFAULT_SETTINGS = {
  organizer_name: '',
  organizer_email: '',
  timezone: 'Europe/Paris',
  page_title: 'Réserver un rendez-vous',
  page_intro: '',
  brand_color: '#2563eb',
  locale: 'fr-FR',
  // Fenêtre par défaut proposée dans le sélecteur de fuseau invité
  week_start: 1, // 1 = lundi
};

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (key === 'auth') continue;
    try { out[key] = JSON.parse(value); } catch { out[key] = value; }
  }
  return out;
}

export function setSettings(db, patch) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'auth') continue;
    if (!(k in DEFAULT_SETTINGS)) continue;
    stmt.run(k, JSON.stringify(v));
  }
}

export function getRawSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setRawSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export function audit(db, action, detail = '') {
  db.prepare('INSERT INTO audit_log (action, detail) VALUES (?, ?)').run(action, String(detail));
}
