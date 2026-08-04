// Couche de persistance — SQLite natif de Node (node:sqlite), zéro dépendance.
// Le fichier de base est créé au premier lancement ; les migrations sont
// idempotentes et versionnées par PRAGMA user_version.

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
  CREATE TABLE clients (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL DEFAULT 'company' CHECK (kind IN ('company','individual')),
    name          TEXT NOT NULL,
    contact_name  TEXT NOT NULL DEFAULT '',
    siren         TEXT NOT NULL DEFAULT '',
    vat_number    TEXT NOT NULL DEFAULT '',
    address_line1 TEXT NOT NULL DEFAULT '',
    address_line2 TEXT NOT NULL DEFAULT '',
    postal_code   TEXT NOT NULL DEFAULT '',
    city          TEXT NOT NULL DEFAULT '',
    country       TEXT NOT NULL DEFAULT 'FR',
    email         TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    notes         TEXT NOT NULL DEFAULT '',
    archived      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE catalog_items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    label            TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    unit             TEXT NOT NULL DEFAULT 'u',
    unit_price_cents INTEGER NOT NULL DEFAULT 0,
    vat_rate         REAL NOT NULL DEFAULT 20,
    archived         INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE documents (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_type           TEXT NOT NULL CHECK (doc_type IN ('quote','invoice','credit_note')),
    status             TEXT NOT NULL DEFAULT 'draft',
    number             TEXT UNIQUE,
    client_id          INTEGER REFERENCES clients(id),
    client_snapshot    TEXT,
    issue_date         TEXT,
    due_date           TEXT,
    validity_date      TEXT,
    currency           TEXT NOT NULL DEFAULT 'EUR',
    subject            TEXT NOT NULL DEFAULT '',
    notes_public       TEXT NOT NULL DEFAULT '',
    purchase_order_ref TEXT NOT NULL DEFAULT '',
    payment_means      TEXT NOT NULL DEFAULT 'transfer',
    source_document_id INTEGER REFERENCES documents(id),
    vat_exempt         INTEGER NOT NULL DEFAULT 0,
    totals_json        TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    issued_at          TEXT
  );
  CREATE INDEX idx_documents_type_status ON documents (doc_type, status);
  CREATE TABLE document_lines (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id      INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    position         INTEGER NOT NULL DEFAULT 0,
    label            TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    qty_milli        INTEGER NOT NULL DEFAULT 1000,
    unit             TEXT NOT NULL DEFAULT 'u',
    unit_price_cents INTEGER NOT NULL DEFAULT 0,
    vat_rate         REAL NOT NULL DEFAULT 20
  );
  CREATE INDEX idx_lines_document ON document_lines (document_id, position);
  CREATE TABLE payments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    paid_on      TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    method       TEXT NOT NULL DEFAULT 'transfer',
    note         TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE counters (
    doc_type TEXT NOT NULL,
    year     INTEGER NOT NULL,
    next     INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (doc_type, year)
  );
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

// ---------------------------------------------------------------- settings

export const DEFAULT_SETTINGS = {
  // Profil de l'émetteur
  company_name: '',
  legal_form: 'Entrepreneur individuel (EI)', // EI, EURL, SASU…
  siren: '',            // 9 chiffres
  siret: '',            // 14 chiffres
  vat_number: '',       // FRxx999999999 si assujetti
  ape_code: '',
  address_line1: '',
  address_line2: '',
  postal_code: '',
  city: '',
  country: 'FR',
  email: '',
  phone: '',
  iban: '',
  bic: '',
  // Régime : 'franchise' => TVA non applicable art. 293 B du CGI
  vat_regime: 'franchise',
  vat_exemption_mention: 'TVA non applicable, art. 293 B du CGI',
  default_vat_rate: 20,
  // Conditions
  payment_terms_days: 30,
  quote_validity_days: 30,
  late_penalty_rate: '3 fois le taux d’intérêt légal',
  mention_recovery_indemnity: true, // indemnité forfaitaire 40 €
  mention_escompte: 'Pas d’escompte pour paiement anticipé',
  footer_note: '',
  // Numérotation (le numéro est figé à l'émission, jamais en brouillon)
  number_format_invoice: 'F-{YYYY}-{SEQ:4}',
  number_format_quote: 'D-{YYYY}-{SEQ:4}',
  number_format_credit_note: 'A-{YYYY}-{SEQ:4}',
  // Seuils (paramétrables : ils évoluent avec les lois de finances)
  threshold_micro_services_cents: 7770000,   // plafond micro (prestations) 77 700 €
  threshold_micro_sales_cents: 18870000,     // plafond micro (ventes) 188 700 €
  threshold_vat_services_cents: 3750000,     // franchise TVA (services) 37 500 €
  threshold_vat_sales_cents: 8500000,        // franchise TVA (ventes) 85 000 €
  activity_kind: 'services',                 // 'services' | 'sales'
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
    if (k === 'auth') continue; // l'authentification a son propre chemin
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

// ------------------------------------------------------------- numérotation

/**
 * Attribue le prochain numéro pour un type de document, de façon séquentielle
 * et sans trou (exigence légale) : le compteur n'est consommé qu'à l'émission,
 * dans la même transaction que le passage du statut brouillon -> émis.
 */
export function nextNumber(db, docType, format, date = new Date()) {
  const year = date.getFullYear();
  db.prepare(
    'INSERT INTO counters (doc_type, year, next) VALUES (?, ?, 1) ON CONFLICT(doc_type, year) DO NOTHING'
  ).run(docType, year);
  const { next } = db.prepare('SELECT next FROM counters WHERE doc_type = ? AND year = ?').get(docType, year);
  db.prepare('UPDATE counters SET next = next + 1 WHERE doc_type = ? AND year = ?').run(docType, year);
  return formatNumber(format, year, next, date);
}

export function formatNumber(format, year, seq, date = new Date()) {
  return format
    .replace('{YYYY}', String(year))
    .replace('{YY}', String(year).slice(-2))
    .replace('{MM}', String(date.getMonth() + 1).padStart(2, '0'))
    .replace(/\{SEQ:(\d)\}/, (_, w) => String(seq).padStart(Number(w), '0'))
    .replace('{SEQ}', String(seq));
}

export function audit(db, action, detail = '') {
  db.prepare('INSERT INTO audit_log (action, detail) VALUES (?, ?)').run(action, String(detail));
}
