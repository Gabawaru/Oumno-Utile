// Tests d'intégration : serveur HTTP réel sur port éphémère, base en mémoire
// n'existant que pour le test (fichier temporaire supprimé à la fin).

import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

const dir = mkdtempSync(join(tmpdir(), 'facturier-test-'));
const { server, db } = createApp(join(dir, 'test.db'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let cookie = '';
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'fetch',
      Cookie: cookie,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data };
}

test('cycle de vie complet', async (t) => {
  await t.test('setup initial + session', async () => {
    assert.equal((await call('GET', '/api/setup-status')).data.configured, false);
    const r = await call('POST', '/api/setup', { password: 'motdepasse123', company_name: 'Test EI' });
    assert.equal(r.status, 200);
    assert.equal((await call('GET', '/api/me')).status, 200);
  });

  await t.test('accès refusé sans session / sans en-tête anti-CSRF', async () => {
    const saved = cookie;
    cookie = '';
    assert.equal((await call('GET', '/api/clients')).status, 401);
    cookie = saved;
    const res = await fetch(BASE + '/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: '{}',
    });
    assert.equal(res.status, 403); // en-tête X-Requested-With absent
  });

  await t.test('profil, client, facture brouillon', async () => {
    await call('PUT', '/api/settings', {
      siret: '91234567800014', address_line1: '1 rue A', postal_code: '75011',
      city: 'Paris', vat_regime: 'franchise',
    });
    const client = (await call('POST', '/api/clients', {
      name: 'ACME SAS', siren: '532 183 181', address_line1: '1 av. B', postal_code: '75001', city: 'Paris',
    })).data;
    assert.equal(client.siren, '532183181'); // espaces retirés

    const doc = (await call('POST', '/api/documents', {
      doc_type: 'invoice', client_id: client.id,
      lines: [{ label: 'Dev', qty: '2', unit: 'j', unit_price: '450', vat_rate: 20 }],
    })).data;
    assert.equal(doc.status, 'draft');
    assert.equal(doc.number, null);
    assert.equal(doc.vat_exempt, 1); // franchise
    assert.equal(doc.totals.total_ttc_cents, 90000); // TTC = HT en franchise
  });

  await t.test('émission : numérotation séquentielle et gel', async () => {
    const issued = (await call('POST', '/api/documents/1/issue', {})).data;
    assert.equal(issued.status, 'issued');
    assert.match(issued.number, /^F-\d{4}-0001$/);
    assert.ok(issued.due_date > issued.issue_date);

    // modification interdite après émission
    const r = await call('PUT', '/api/documents/1', { subject: 'hack' });
    assert.equal(r.status, 409);
    // suppression interdite
    assert.equal((await call('DELETE', '/api/documents/1')).status, 409);

    // deuxième facture => 0002
    const d2 = (await call('POST', '/api/documents', { doc_type: 'invoice', client_id: 1, lines: [{ label: 'X', qty: 1, unit_price: '10', vat_rate: 0 }] })).data;
    const issued2 = (await call('POST', `/api/documents/${d2.id}/issue`, {})).data;
    assert.match(issued2.number, /-0002$/);
  });

  await t.test('PDF et XML Factur-X servis', async () => {
    const pdf = await call('GET', '/api/documents/1/pdf');
    assert.equal(pdf.status, 200);
    assert.match(Buffer.from(pdf.data.slice(0, 8)).toString(), /^%PDF/);
    const xml = await call('GET', '/api/documents/1/facturx.xml');
    assert.equal(xml.status, 200);
    assert.match(Buffer.from(xml.data).toString(), /CrossIndustryInvoice/);
  });

  await t.test('règlements : passage automatique en payée', async () => {
    const partial = (await call('POST', '/api/documents/1/payments', { amount: '400' })).data;
    assert.equal(partial.status, 'issued');
    assert.equal(partial.paid_cents, 40000);
    const full = (await call('POST', '/api/documents/1/payments', { amount: '500' })).data;
    assert.equal(full.status, 'paid');
  });

  await t.test('annulation impossible sans avoir ; avoir puis annulation OK', async () => {
    const d3 = (await call('POST', '/api/documents', { doc_type: 'invoice', client_id: 1, lines: [{ label: 'Y', qty: 1, unit_price: '100', vat_rate: 0 }] })).data;
    await call('POST', `/api/documents/${d3.id}/issue`, {});
    const refuse = await call('POST', `/api/documents/${d3.id}/status`, { status: 'cancelled' });
    assert.equal(refuse.status, 409);

    const cn = (await call('POST', `/api/documents/${d3.id}/credit-note`, {})).data;
    assert.equal(cn.doc_type, 'credit_note');
    assert.equal(cn.source_number, d3.number || (await call('GET', `/api/documents/${d3.id}`)).data.number);
    await call('POST', `/api/documents/${cn.id}/issue`, {});
    const cancelled = (await call('POST', `/api/documents/${d3.id}/status`, { status: 'cancelled' })).data;
    assert.equal(cancelled.status, 'cancelled');
  });

  await t.test('devis : émission, conversion en facture', async () => {
    const q = (await call('POST', '/api/documents', { doc_type: 'quote', client_id: 1, lines: [{ label: 'Presta', qty: 1, unit_price: '1000', vat_rate: 20 }] })).data;
    const iq = (await call('POST', `/api/documents/${q.id}/issue`, {})).data;
    assert.match(iq.number, /^D-/);
    assert.ok(iq.validity_date);
    const inv = (await call('POST', `/api/documents/${q.id}/convert`, {})).data;
    assert.equal(inv.doc_type, 'invoice');
    assert.equal(inv.status, 'draft');
    assert.equal(inv.source_number, iq.number);
    const qAfter = (await call('GET', `/api/documents/${q.id}`)).data;
    assert.equal(qAfter.status, 'accepted');
  });

  await t.test('tableau de bord et export CSV', async () => {
    const d = (await call('GET', '/api/stats/dashboard')).data;
    assert.ok(d.invoiced_ht_cents > 0);
    assert.ok(d.collected_ttc_cents >= 90000);
    assert.ok(Array.isArray(d.monthly_ht));
    const csv = await call('GET', '/api/export/documents.csv');
    assert.equal(csv.status, 200);
    assert.match(Buffer.from(csv.data).toString('utf8'), /Numéro;Statut/);
  });

  await t.test('verrouillage : trop de tentatives de connexion', async () => {
    cookie = '';
    for (let i = 0; i < 8; i++) {
      await call('POST', '/api/login', { password: 'mauvais' });
    }
    const r = await call('POST', '/api/login', { password: 'motdepasse123' });
    assert.equal(r.status, 429);
  });
});

test.after(() => {
  server.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
