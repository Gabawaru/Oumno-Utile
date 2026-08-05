// Persistance — SQLite natif de Node (node:sqlite), zéro dépendance.
// Migrations idempotentes versionnées par PRAGMA user_version.
//
// Modèle temporel : tous les instants sont stockés en millisecondes epoch UTC
// (entiers), ce qui rend les calculs de séries temporelles simples et exacts.
//
// Trois granularités de données :
//   checks       : sondes brutes (rétention courte, ex. 7 jours) ;
//   daily_stats  : agrégats journaliers (rétention longue, page 90 jours) ;
//   incidents    : périodes d'indisponibilité (ouverture/résolution).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE monitors (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    url                 TEXT NOT NULL,
    method              TEXT NOT NULL DEFAULT 'GET',
    expected_status     TEXT NOT NULL DEFAULT '2xx',  -- '200' | '2xx' | '3xx' | '2xx,3xx'
    keyword             TEXT NOT NULL DEFAULT '',      -- doit être présent dans le corps
    keyword_absent      TEXT NOT NULL DEFAULT '',      -- doit être absent du corps
    interval_sec        INTEGER NOT NULL DEFAULT 60,
    timeout_ms          INTEGER NOT NULL DEFAULT 10000,
    degraded_ms         INTEGER NOT NULL DEFAULT 0,    -- 0 => pas de seuil "dégradé"
    follow_redirects    INTEGER NOT NULL DEFAULT 1,
    failure_threshold   INTEGER NOT NULL DEFAULT 2,    -- échecs consécutifs => incident
    public              INTEGER NOT NULL DEFAULT 1,
    active              INTEGER NOT NULL DEFAULT 1,
    position            INTEGER NOT NULL DEFAULT 0,
    -- état courant (dénormalisé pour l'affichage rapide)
    state               TEXT NOT NULL DEFAULT 'pending', -- pending|up|degraded|down|paused
    last_checked_at     INTEGER,
    last_latency_ms     INTEGER,
    last_status_code    INTEGER,
    last_error          TEXT NOT NULL DEFAULT '',
    consecutive_fails   INTEGER NOT NULL DEFAULT 0,
    consecutive_ok      INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL
  );
  CREATE TABLE checks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id  INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    ts          INTEGER NOT NULL,       -- ms epoch
    up          INTEGER NOT NULL,       -- 1 = joignable et assertions OK
    degraded    INTEGER NOT NULL DEFAULT 0,
    status_code INTEGER,
    latency_ms  INTEGER,
    error       TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_checks_mon_ts ON checks (monitor_id, ts);
  CREATE TABLE daily_stats (
    monitor_id   INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    day          TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
    total        INTEGER NOT NULL DEFAULT 0,
    up_count     INTEGER NOT NULL DEFAULT 0,
    degraded_cnt INTEGER NOT NULL DEFAULT 0,
    avg_latency  INTEGER,
    p95_latency  INTEGER,
    down_seconds INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (monitor_id, day)
  );
  CREATE TABLE incidents (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id   INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    started_at   INTEGER NOT NULL,       -- ms epoch (1er échec)
    resolved_at  INTEGER,                -- null tant que non résolu
    cause        TEXT NOT NULL DEFAULT '',
    checks_failed INTEGER NOT NULL DEFAULT 1,
    manual_note  TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_incidents_mon ON incidents (monitor_id, started_at);
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
  page_title: 'État des services',
  page_intro: '',
  organization: '',
  brand_color: '#2563eb',
  locale: 'fr-FR',
  check_retention_days: 7,   // durée de conservation des sondes brutes
  stats_retention_days: 90,  // durée de conservation des agrégats journaliers
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
