// API REST — toute la logique métier applicative.
// Invariants clés :
//  - un document émis (status != draft) est INALTÉRABLE : lignes, client
//    (snapshot JSON) et totaux sont figés à l'émission ; toute correction
//    passe par un avoir, conformément aux règles de facturation ;
//  - le numéro est attribué à l'émission, séquentiellement, sans trou ;
//  - les montants sont des entiers (centimes) de bout en bout.

import {
  getSettings, setSettings, getRawSetting, setRawSetting, nextNumber, audit,
} from './db.js';
import { computeTotals, parseDecimalTo } from './compute.js';
import { buildFacturX } from './facturx.js';
import { renderDocumentPdf } from './pdf/layout.js';
import {
  hashPassword, verifyPassword, createSession, destroySession,
  loginAllowed, recordLoginFailure,
} from './auth.js';
import { sendJson, sendBuffer, readBody } from './router.js';
import { readFileSync } from 'node:fs';

const DOC_TYPES = new Set(['quote', 'invoice', 'credit_note']);

function sessionCookie(token, req) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `facturier_session=${token}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Strict${secure}`;
}

const PAYMENT_MEANS = new Set(['transfer', 'card', 'cheque', 'cash', 'direct_debit']);
const err = (status, message) => Object.assign(new Error(message), { status });

const s = (v, max = 500) => String(v ?? '').slice(0, max).trim();
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
const today = () => new Date().toISOString().slice(0, 10);

function addDays(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ clients

function clientFromBody(b) {
  return {
    kind: b.kind === 'individual' ? 'individual' : 'company',
    name: s(b.name, 200),
    contact_name: s(b.contact_name, 200),
    siren: s(b.siren, 20).replace(/\s/g, ''),
    vat_number: s(b.vat_number, 20).replace(/\s/g, ''),
    address_line1: s(b.address_line1, 200),
    address_line2: s(b.address_line2, 200),
    postal_code: s(b.postal_code, 12),
    city: s(b.city, 100),
    country: s(b.country, 2).toUpperCase() || 'FR',
    email: s(b.email, 200),
    phone: s(b.phone, 30),
    notes: s(b.notes, 2000),
  };
}

// ---------------------------------------------------------------- documents

function linesFromBody(rawLines) {
  if (!Array.isArray(rawLines)) return [];
  return rawLines
    .map((l, i) => {
      const qty = parseDecimalTo(l.qty ?? l.qty_milli / 1000, 1000);
      const price = parseDecimalTo(l.unit_price ?? l.unit_price_cents / 100, 100);
      const rate = Number(String(l.vat_rate ?? 20).replace(',', '.'));
      if (qty === null || price === null || !Number.isFinite(rate) || rate < 0 || rate > 100) {
        throw err(400, `Ligne ${i + 1} invalide (quantité, prix ou taux de TVA)`);
      }
      return {
        position: i,
        label: s(l.label, 300),
        description: s(l.description, 2000),
        qty_milli: qty,
        unit: s(l.unit, 20) || 'u',
        unit_price_cents: price,
        vat_rate: rate,
      };
    })
    .filter((l) => l.label);
}

function loadDocument(db, id, settings) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  if (!doc) throw err(404, 'Document introuvable');
  const lines = db
    .prepare('SELECT * FROM document_lines WHERE document_id = ? ORDER BY position')
    .all(id);
  const payments = db
    .prepare('SELECT * FROM payments WHERE document_id = ? ORDER BY paid_on, id')
    .all(id);
  const paid_cents = payments.reduce((t, p) => t + p.amount_cents, 0);

  let client = null;
  if (doc.status !== 'draft' && doc.client_snapshot) client = JSON.parse(doc.client_snapshot);
  else if (doc.client_id) client = db.prepare('SELECT * FROM clients WHERE id = ?').get(doc.client_id);

  const vatExempt = doc.status === 'draft' ? settings.vat_regime === 'franchise' : !!doc.vat_exempt;
  const totals =
    doc.status !== 'draft' && doc.totals_json
      ? JSON.parse(doc.totals_json)
      : computeTotals(lines, { vatExempt });

  let source_number = null;
  if (doc.source_document_id) {
    const src = db.prepare('SELECT number FROM documents WHERE id = ?').get(doc.source_document_id);
    source_number = src?.number || null;
  }

  let effective_status = doc.status;
  if (doc.doc_type === 'invoice' && ['issued', 'sent'].includes(doc.status) && doc.due_date && doc.due_date < today()) {
    effective_status = 'overdue';
  }

  return { ...doc, vat_exempt: vatExempt ? 1 : 0, lines, payments, paid_cents, client, totals, source_number, effective_status };
}

function assertDraft(doc) {
  if (doc.status !== 'draft') throw err(409, 'Document émis : modification impossible (créez un avoir pour corriger une facture)');
}

function issueDocument(db, id, settings, body = {}) {
  const doc = loadDocument(db, id, settings);
  assertDraft(doc);
  if (!doc.client) throw err(400, 'Sélectionnez un client avant d’émettre');
  if (!doc.lines.length) throw err(400, 'Ajoutez au moins une ligne avant d’émettre');
  if (!settings.company_name) throw err(400, 'Complétez votre profil (Paramètres) avant d’émettre');

  const issueDate = isoDate(body.issue_date) || today();
  const vatExempt = settings.vat_regime === 'franchise';
  const totals = computeTotals(doc.lines, { vatExempt });
  const formats = {
    invoice: settings.number_format_invoice,
    quote: settings.number_format_quote,
    credit_note: settings.number_format_credit_note,
  };

  db.exec('BEGIN');
  try {
    const number = nextNumber(db, doc.doc_type, formats[doc.doc_type], new Date(issueDate + 'T12:00:00Z'));
    const due =
      doc.doc_type === 'invoice'
        ? isoDate(body.due_date) || addDays(issueDate, settings.payment_terms_days)
        : null;
    const validity =
      doc.doc_type === 'quote'
        ? isoDate(body.validity_date) || addDays(issueDate, settings.quote_validity_days)
        : null;
    db.prepare(
      `UPDATE documents SET status = 'issued', number = ?, issue_date = ?, due_date = ?,
       validity_date = ?, vat_exempt = ?, client_snapshot = ?, totals_json = ?,
       issued_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).run(
      number, issueDate, due, validity, vatExempt ? 1 : 0,
      JSON.stringify(doc.client), JSON.stringify(totals), id
    );
    audit(db, 'issue', `${doc.doc_type} #${id} => ${number}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return loadDocument(db, id, settings);
}

// Transitions autorisées après émission (le retour en brouillon est interdit).
const TRANSITIONS = {
  quote: { issued: ['sent', 'accepted', 'refused'], sent: ['accepted', 'refused'], accepted: [], refused: ['sent'] },
  invoice: { issued: ['sent', 'paid', 'cancelled'], sent: ['paid', 'cancelled'], paid: [], cancelled: [] },
  credit_note: { issued: ['sent'], sent: [] },
};

// -------------------------------------------------------------------- stats

function dashboard(db, settings) {
  const year = new Date().getFullYear();
  const y0 = `${year}-01-01`;

  const invoiced = db.prepare(
    `SELECT COALESCE(SUM(json_extract(totals_json, '$.total_ht_cents')), 0) AS ht,
            COALESCE(SUM(json_extract(totals_json, '$.total_ttc_cents')), 0) AS ttc,
            COUNT(*) AS n
     FROM documents WHERE doc_type = 'invoice' AND status != 'draft' AND status != 'cancelled'
       AND issue_date >= ?`
  ).get(y0);
  const credited = db.prepare(
    `SELECT COALESCE(SUM(json_extract(totals_json, '$.total_ht_cents')), 0) AS ht,
            COALESCE(SUM(json_extract(totals_json, '$.total_ttc_cents')), 0) AS ttc
     FROM documents WHERE doc_type = 'credit_note' AND status != 'draft' AND issue_date >= ?`
  ).get(y0);

  // Encaissé : paiements de l'année ; l'HT est reconstitué au prorata HT/TTC
  // de chaque facture (identiques en franchise de TVA).
  const payRows = db.prepare(
    `SELECT p.amount_cents,
            json_extract(d.totals_json, '$.total_ht_cents') AS ht,
            json_extract(d.totals_json, '$.total_ttc_cents') AS ttc
     FROM payments p JOIN documents d ON d.id = p.document_id
     WHERE p.paid_on >= ?`
  ).all(y0);
  let collectedTtc = 0;
  let collectedHt = 0;
  for (const r of payRows) {
    collectedTtc += r.amount_cents;
    collectedHt += r.ttc ? Math.round((r.amount_cents * r.ht) / r.ttc) : r.amount_cents;
  }

  const outstanding = db.prepare(
    `SELECT d.id, d.number, d.due_date, d.client_snapshot,
            json_extract(d.totals_json, '$.total_ttc_cents') AS ttc,
            COALESCE((SELECT SUM(amount_cents) FROM payments WHERE document_id = d.id), 0) AS paid
     FROM documents d
     WHERE d.doc_type = 'invoice' AND d.status IN ('issued', 'sent')`
  ).all();
  let pendingCents = 0;
  let overdueCents = 0;
  let overdueCount = 0;
  const t = today();
  for (const o of outstanding) {
    const rest = (o.ttc || 0) - o.paid;
    if (rest <= 0) continue;
    pendingCents += rest;
    if (o.due_date && o.due_date < t) { overdueCents += rest; overdueCount++; }
  }

  const monthly = db.prepare(
    `SELECT substr(issue_date, 1, 7) AS month,
            SUM(json_extract(totals_json, '$.total_ht_cents')
                * (CASE doc_type WHEN 'credit_note' THEN -1 ELSE 1 END)) AS ht
     FROM documents
     WHERE status != 'draft' AND status != 'cancelled' AND doc_type IN ('invoice', 'credit_note')
       AND issue_date >= ?
     GROUP BY month ORDER BY month`
  ).all(y0);

  const quotes = db.prepare(
    `SELECT COUNT(*) AS n FROM documents WHERE doc_type = 'quote' AND status IN ('issued', 'sent')`
  ).get();

  const isServices = settings.activity_kind !== 'sales';
  const microThreshold = isServices ? settings.threshold_micro_services_cents : settings.threshold_micro_sales_cents;
  const vatThreshold = isServices ? settings.threshold_vat_services_cents : settings.threshold_vat_sales_cents;
  const revenueHt = invoiced.ht - credited.ht;

  return {
    year,
    invoiced_ht_cents: revenueHt,
    invoiced_ttc_cents: invoiced.ttc - credited.ttc,
    invoice_count: invoiced.n,
    collected_ttc_cents: collectedTtc,
    collected_ht_cents: collectedHt,
    pending_cents: pendingCents,
    overdue_cents: overdueCents,
    overdue_count: overdueCount,
    open_quotes: quotes.n,
    monthly_ht: monthly,
    thresholds: {
      micro_cents: microThreshold,
      vat_cents: vatThreshold,
      basis: 'invoiced_ht',
      micro_ratio: microThreshold ? revenueHt / microThreshold : 0,
      vat_ratio: vatThreshold ? revenueHt / vatThreshold : 0,
    },
  };
}

// --------------------------------------------------------------- exports CSV

function csvEscape(v) {
  const str = String(v ?? '');
  return /[";\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

function documentsCsv(db) {
  const rows = db.prepare(
    `SELECT d.doc_type, d.number, d.status, d.issue_date, d.due_date,
            json_extract(d.client_snapshot, '$.name') AS client,
            json_extract(d.totals_json, '$.total_ht_cents') AS ht,
            json_extract(d.totals_json, '$.total_vat_cents') AS tva,
            json_extract(d.totals_json, '$.total_ttc_cents') AS ttc,
            COALESCE((SELECT SUM(amount_cents) FROM payments WHERE document_id = d.id), 0) AS paye
     FROM documents d WHERE d.status != 'draft' ORDER BY d.issue_date, d.number`
  ).all();
  const typeLabels = { invoice: 'Facture', quote: 'Devis', credit_note: 'Avoir' };
  const head = 'Type;Numéro;Statut;Émission;Échéance;Client;Total HT;TVA;Total TTC;Payé\n';
  const cents = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
  return (
    '﻿' + head +
    rows.map((r) =>
      [typeLabels[r.doc_type] || r.doc_type, r.number, r.status, r.issue_date, r.due_date || '',
        r.client || '', cents(r.ht), cents(r.tva), cents(r.ttc), cents(r.paye),
      ].map(csvEscape).join(';')
    ).join('\n')
  );
}

// ------------------------------------------------------------------- routes

export function registerApi(router, db) {
  const S = () => getSettings(db);

  // --- setup & session ---
  router.get('/api/setup-status', (req, res) => {
    sendJson(res, 200, { configured: !!getRawSetting(db, 'auth') });
  });

  router.post('/api/setup', async (req, res) => {
    if (getRawSetting(db, 'auth')) throw err(409, 'Déjà configuré');
    const body = await readBody(req);
    const password = String(body.password || '');
    if (password.length < 8) throw err(400, 'Mot de passe : 8 caractères minimum');
    setRawSetting(db, 'auth', hashPassword(password));
    if (body.company_name) setSettings(db, { company_name: s(body.company_name, 200) });
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
    destroySession(db, cookies.facturier_session);
    res.setHeader('Set-Cookie', 'facturier_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict');
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/me', (req, res) => sendJson(res, 200, { ok: true }));

  router.post('/api/password', async (req, res) => {
    const body = await readBody(req);
    const stored = getRawSetting(db, 'auth');
    if (!verifyPassword(String(body.current || ''), stored)) throw err(401, 'Mot de passe actuel incorrect');
    if (String(body.next || '').length < 8) throw err(400, 'Nouveau mot de passe : 8 caractères minimum');
    setRawSetting(db, 'auth', hashPassword(String(body.next)));
    audit(db, 'password_change');
    sendJson(res, 200, { ok: true });
  });

  // --- settings ---
  router.get('/api/settings', (req, res) => sendJson(res, 200, S()));
  router.put('/api/settings', async (req, res) => {
    const body = await readBody(req);
    setSettings(db, body);
    audit(db, 'settings_update');
    sendJson(res, 200, S());
  });

  // --- clients ---
  router.get('/api/clients', (req, res, { query }) => {
    const rows = query.get('all')
      ? db.prepare('SELECT * FROM clients ORDER BY archived, name COLLATE NOCASE').all()
      : db.prepare('SELECT * FROM clients WHERE archived = 0 ORDER BY name COLLATE NOCASE').all();
    sendJson(res, 200, rows);
  });

  router.post('/api/clients', async (req, res) => {
    const c = clientFromBody(await readBody(req));
    if (!c.name) throw err(400, 'Le nom du client est requis');
    const info = db.prepare(
      `INSERT INTO clients (kind, name, contact_name, siren, vat_number, address_line1, address_line2,
        postal_code, city, country, email, phone, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(...Object.values(c));
    sendJson(res, 201, db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/api/clients/:id', async (req, res, { params }) => {
    const body = await readBody(req);
    const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(params.id);
    if (!existing) throw err(404, 'Client introuvable');
    const c = clientFromBody({ ...existing, ...body });
    if (!c.name) throw err(400, 'Le nom du client est requis');
    db.prepare(
      `UPDATE clients SET kind=?, name=?, contact_name=?, siren=?, vat_number=?, address_line1=?,
        address_line2=?, postal_code=?, city=?, country=?, email=?, phone=?, notes=?, archived=?
       WHERE id=?`
    ).run(...Object.values(c), body.archived ? 1 : 0, params.id);
    sendJson(res, 200, db.prepare('SELECT * FROM clients WHERE id = ?').get(params.id));
  });

  router.delete('/api/clients/:id', (req, res, { params }) => {
    const used = db.prepare('SELECT COUNT(*) AS n FROM documents WHERE client_id = ?').get(params.id);
    if (used.n > 0) {
      db.prepare('UPDATE clients SET archived = 1 WHERE id = ?').run(params.id);
      sendJson(res, 200, { archived: true });
    } else {
      db.prepare('DELETE FROM clients WHERE id = ?').run(params.id);
      sendJson(res, 200, { deleted: true });
    }
  });

  // --- catalogue ---
  router.get('/api/catalog', (req, res) => {
    sendJson(res, 200, db.prepare('SELECT * FROM catalog_items WHERE archived = 0 ORDER BY label COLLATE NOCASE').all());
  });

  router.post('/api/catalog', async (req, res) => {
    const b = await readBody(req);
    const price = parseDecimalTo(b.unit_price ?? 0, 100);
    if (!s(b.label) || price === null) throw err(400, 'Libellé et prix requis');
    const info = db.prepare(
      'INSERT INTO catalog_items (label, description, unit, unit_price_cents, vat_rate) VALUES (?, ?, ?, ?, ?)'
    ).run(s(b.label, 300), s(b.description, 2000), s(b.unit, 20) || 'u', price, Number(b.vat_rate) || 0);
    sendJson(res, 201, db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/api/catalog/:id', async (req, res, { params }) => {
    const b = await readBody(req);
    const existing = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(params.id);
    if (!existing) throw err(404, 'Prestation introuvable');
    const price = b.unit_price !== undefined ? parseDecimalTo(b.unit_price, 100) : existing.unit_price_cents;
    if (price === null) throw err(400, 'Prix invalide');
    db.prepare(
      'UPDATE catalog_items SET label=?, description=?, unit=?, unit_price_cents=?, vat_rate=?, archived=? WHERE id=?'
    ).run(
      s(b.label ?? existing.label, 300), s(b.description ?? existing.description, 2000),
      s(b.unit ?? existing.unit, 20) || 'u', price,
      b.vat_rate !== undefined ? Number(b.vat_rate) || 0 : existing.vat_rate,
      b.archived ? 1 : 0, params.id
    );
    sendJson(res, 200, db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(params.id));
  });

  router.delete('/api/catalog/:id', (req, res, { params }) => {
    db.prepare('UPDATE catalog_items SET archived = 1 WHERE id = ?').run(params.id);
    sendJson(res, 200, { archived: true });
  });

  // --- documents ---
  router.get('/api/documents', (req, res, { query }) => {
    let sql = `SELECT d.*, c.name AS client_name,
      json_extract(d.client_snapshot, '$.name') AS snapshot_name,
      COALESCE((SELECT SUM(amount_cents) FROM payments WHERE document_id = d.id), 0) AS paid_cents,
      json_extract(d.totals_json, '$.total_ttc_cents') AS frozen_ttc
      FROM documents d LEFT JOIN clients c ON c.id = d.client_id WHERE 1=1`;
    const args = [];
    if (query.get('type') && DOC_TYPES.has(query.get('type'))) {
      sql += ' AND d.doc_type = ?';
      args.push(query.get('type'));
    }
    if (query.get('status')) {
      sql += ' AND d.status = ?';
      args.push(query.get('status'));
    }
    sql += ' ORDER BY d.status = \'draft\' DESC, d.issue_date DESC, d.id DESC LIMIT 500';
    const settings = S();
    const t = today();
    const rows = db.prepare(sql).all(...args).map((r) => {
      let effective = r.status;
      if (r.doc_type === 'invoice' && ['issued', 'sent'].includes(r.status) && r.due_date && r.due_date < t) {
        effective = 'overdue';
      }
      let ttc = r.frozen_ttc;
      if (r.status === 'draft') {
        const lines = db.prepare('SELECT * FROM document_lines WHERE document_id = ? ORDER BY position').all(r.id);
        ttc = computeTotals(lines, { vatExempt: settings.vat_regime === 'franchise' }).total_ttc_cents;
      }
      return { ...r, client_name: r.snapshot_name || r.client_name, effective_status: effective, total_ttc_cents: ttc };
    });
    sendJson(res, 200, rows);
  });

  router.post('/api/documents', async (req, res) => {
    const b = await readBody(req);
    if (!DOC_TYPES.has(b.doc_type)) throw err(400, 'Type de document invalide');
    const lines = linesFromBody(b.lines || []);
    const info = db.prepare(
      `INSERT INTO documents (doc_type, client_id, subject, notes_public, purchase_order_ref, payment_means, source_document_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      b.doc_type, b.client_id || null, s(b.subject, 300), s(b.notes_public, 2000),
      s(b.purchase_order_ref, 100), PAYMENT_MEANS.has(b.payment_means) ? b.payment_means : 'transfer',
      b.source_document_id || null
    );
    const id = info.lastInsertRowid;
    const insLine = db.prepare(
      `INSERT INTO document_lines (document_id, position, label, description, qty_milli, unit, unit_price_cents, vat_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const l of lines) {
      insLine.run(id, l.position, l.label, l.description, l.qty_milli, l.unit, l.unit_price_cents, l.vat_rate);
    }
    sendJson(res, 201, loadDocument(db, id, S()));
  });

  router.get('/api/documents/:id', (req, res, { params }) => {
    sendJson(res, 200, loadDocument(db, params.id, S()));
  });

  router.put('/api/documents/:id', async (req, res, { params }) => {
    const settings = S();
    const doc = loadDocument(db, params.id, settings);
    assertDraft(doc);
    const b = await readBody(req);
    const lines = b.lines !== undefined ? linesFromBody(b.lines) : null;
    db.exec('BEGIN');
    try {
      db.prepare(
        `UPDATE documents SET client_id=?, subject=?, notes_public=?, purchase_order_ref=?,
         payment_means=?, updated_at=datetime('now') WHERE id=?`
      ).run(
        b.client_id !== undefined ? b.client_id || null : doc.client_id,
        s(b.subject ?? doc.subject, 300),
        s(b.notes_public ?? doc.notes_public, 2000),
        s(b.purchase_order_ref ?? doc.purchase_order_ref, 100),
        PAYMENT_MEANS.has(b.payment_means) ? b.payment_means : doc.payment_means,
        params.id
      );
      if (lines !== null) {
        db.prepare('DELETE FROM document_lines WHERE document_id = ?').run(params.id);
        const insLine = db.prepare(
          `INSERT INTO document_lines (document_id, position, label, description, qty_milli, unit, unit_price_cents, vat_rate)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const l of lines) {
          insLine.run(params.id, l.position, l.label, l.description, l.qty_milli, l.unit, l.unit_price_cents, l.vat_rate);
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    sendJson(res, 200, loadDocument(db, params.id, settings));
  });

  router.delete('/api/documents/:id', (req, res, { params }) => {
    const doc = loadDocument(db, params.id, S());
    assertDraft(doc); // seul un brouillon peut être supprimé (piste d'audit)
    db.prepare('DELETE FROM documents WHERE id = ?').run(params.id);
    audit(db, 'delete_draft', `#${params.id}`);
    sendJson(res, 200, { deleted: true });
  });

  router.post('/api/documents/:id/issue', async (req, res, { params }) => {
    const body = await readBody(req);
    sendJson(res, 200, issueDocument(db, params.id, S(), body));
  });

  router.post('/api/documents/:id/status', async (req, res, { params }) => {
    const settings = S();
    const doc = loadDocument(db, params.id, settings);
    const b = await readBody(req);
    const next = String(b.status || '');
    const allowed = TRANSITIONS[doc.doc_type]?.[doc.status] || [];
    if (!allowed.includes(next)) {
      throw err(409, `Transition impossible : ${doc.status} → ${next || '?'}`);
    }
    if (next === 'cancelled') {
      const hasCredit = db.prepare(
        `SELECT 1 FROM documents WHERE doc_type='credit_note' AND source_document_id=? AND status!='draft'`
      ).get(params.id);
      if (!hasCredit) throw err(409, 'Une facture émise ne peut être annulée que par un avoir émis');
    }
    db.prepare("UPDATE documents SET status=?, updated_at=datetime('now') WHERE id=?").run(next, params.id);
    audit(db, 'status', `#${params.id} ${doc.status} → ${next}`);
    sendJson(res, 200, loadDocument(db, params.id, settings));
  });

  router.post('/api/documents/:id/duplicate', (req, res, { params }) => {
    const doc = loadDocument(db, params.id, S());
    const info = db.prepare(
      `INSERT INTO documents (doc_type, client_id, subject, notes_public, purchase_order_ref, payment_means)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(doc.doc_type, doc.client?.id ?? doc.client_id, doc.subject, doc.notes_public, doc.purchase_order_ref, doc.payment_means);
    copyLines(db, doc.lines, info.lastInsertRowid);
    sendJson(res, 201, loadDocument(db, info.lastInsertRowid, S()));
  });

  router.post('/api/documents/:id/convert', (req, res, { params }) => {
    const settings = S();
    const doc = loadDocument(db, params.id, settings);
    if (doc.doc_type !== 'quote') throw err(400, 'Seul un devis peut être converti en facture');
    if (doc.status === 'draft') throw err(409, 'Émettez le devis avant de le convertir');
    const info = db.prepare(
      `INSERT INTO documents (doc_type, client_id, subject, notes_public, purchase_order_ref, payment_means, source_document_id)
       VALUES ('invoice', ?, ?, ?, ?, ?, ?)`
    ).run(doc.client_id, doc.subject, doc.notes_public, doc.purchase_order_ref, doc.payment_means, doc.id);
    copyLines(db, doc.lines, info.lastInsertRowid);
    if (['issued', 'sent'].includes(doc.status)) {
      db.prepare("UPDATE documents SET status='accepted', updated_at=datetime('now') WHERE id=?").run(doc.id);
    }
    audit(db, 'convert', `devis #${doc.id} → facture brouillon`);
    sendJson(res, 201, loadDocument(db, info.lastInsertRowid, settings));
  });

  router.post('/api/documents/:id/credit-note', (req, res, { params }) => {
    const settings = S();
    const doc = loadDocument(db, params.id, settings);
    if (doc.doc_type !== 'invoice' || doc.status === 'draft') {
      throw err(400, 'Un avoir se crée depuis une facture émise');
    }
    const info = db.prepare(
      `INSERT INTO documents (doc_type, client_id, subject, notes_public, payment_means, source_document_id)
       VALUES ('credit_note', ?, ?, '', ?, ?)`
    ).run(doc.client_id, `Avoir sur facture ${doc.number}`, doc.payment_means, doc.id);
    copyLines(db, doc.lines, info.lastInsertRowid);
    audit(db, 'credit_note', `sur facture ${doc.number}`);
    sendJson(res, 201, loadDocument(db, info.lastInsertRowid, settings));
  });

  // --- paiements ---
  router.post('/api/documents/:id/payments', async (req, res, { params }) => {
    const settings = S();
    const doc = loadDocument(db, params.id, settings);
    if (doc.doc_type !== 'invoice' || doc.status === 'draft') {
      throw err(400, 'Les règlements s’enregistrent sur une facture émise');
    }
    const b = await readBody(req);
    const amount = parseDecimalTo(b.amount, 100);
    if (amount === null || amount === 0) throw err(400, 'Montant invalide');
    db.prepare(
      'INSERT INTO payments (document_id, paid_on, amount_cents, method, note) VALUES (?, ?, ?, ?, ?)'
    ).run(params.id, isoDate(b.paid_on) || today(), amount,
      PAYMENT_MEANS.has(b.method) ? b.method : 'transfer', s(b.note, 500));
    const updated = loadDocument(db, params.id, settings);
    if (updated.paid_cents >= updated.totals.total_ttc_cents && updated.status !== 'paid') {
      db.prepare("UPDATE documents SET status='paid', updated_at=datetime('now') WHERE id=?").run(params.id);
    }
    sendJson(res, 201, loadDocument(db, params.id, settings));
  });

  router.delete('/api/documents/:id/payments/:pid', (req, res, { params }) => {
    db.prepare('DELETE FROM payments WHERE id = ? AND document_id = ?').run(params.pid, params.id);
    const settings = S();
    const updated = loadDocument(db, params.id, settings);
    if (updated.status === 'paid' && updated.paid_cents < updated.totals.total_ttc_cents) {
      db.prepare("UPDATE documents SET status='sent', updated_at=datetime('now') WHERE id=?").run(params.id);
    }
    sendJson(res, 200, loadDocument(db, params.id, settings));
  });

  // --- PDF & Factur-X ---
  const buildPdf = (id) => {
    const settings = S();
    const doc = loadDocument(db, id, settings);
    if (!doc.client) throw err(400, 'Aucun client associé à ce document');
    let facturxXml = null;
    if (doc.status !== 'draft' && (doc.doc_type === 'invoice' || doc.doc_type === 'credit_note')) {
      facturxXml = Buffer.from(buildFacturX(doc, settings, doc.client, doc.totals), 'utf8');
    }
    const pdf = renderDocumentPdf({
      doc, seller: settings, buyer: doc.client, totals: doc.totals,
      paidCents: doc.paid_cents, facturxXml,
    });
    return { pdf, doc };
  };

  router.get('/api/documents/:id/pdf', (req, res, { params }) => {
    const { pdf, doc } = buildPdf(params.id);
    const prefix = { invoice: 'facture', quote: 'devis', credit_note: 'avoir' }[doc.doc_type];
    sendBuffer(res, pdf, 'application/pdf', `${prefix}-${doc.number || 'brouillon'}.pdf`);
  });

  router.get('/api/documents/:id/facturx.xml', (req, res, { params }) => {
    const settings = S();
    const doc = loadDocument(db, params.id, settings);
    if (doc.status === 'draft' || doc.doc_type === 'quote') {
      throw err(400, 'Le XML Factur-X n’existe que pour les factures et avoirs émis');
    }
    const xml = buildFacturX(doc, settings, doc.client, doc.totals);
    sendBuffer(res, Buffer.from(xml, 'utf8'), 'application/xml; charset=utf-8', `${doc.number}-factur-x.xml`);
  });

  // --- stats, export, sauvegarde ---
  router.get('/api/stats/dashboard', (req, res) => sendJson(res, 200, dashboard(db, S())));

  router.get('/api/export/documents.csv', (req, res) => {
    sendBuffer(res, Buffer.from(documentsCsv(db), 'utf8'), 'text/csv; charset=utf-8', 'facturier-export.csv');
  });

  router.get('/api/backup', (req, res) => {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const file = db.location?.() || process.env.FACTURIER_DATA || 'data/facturier.db';
    sendBuffer(res, readFileSync(file), 'application/octet-stream', `facturier-backup-${today()}.db`);
  });
}

function copyLines(db, lines, newId) {
  const ins = db.prepare(
    `INSERT INTO document_lines (document_id, position, label, description, qty_milli, unit, unit_price_cents, vat_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  lines.forEach((l, i) => ins.run(newId, i, l.label, l.description, l.qty_milli, l.unit, l.unit_price_cents, l.vat_rate));
}

export { loadDocument, issueDocument, dashboard };
