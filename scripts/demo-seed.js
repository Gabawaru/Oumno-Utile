#!/usr/bin/env node
// Peuple une base de démonstration réaliste (mot de passe : demo1234),
// puis lance le serveur. Usage : npm run demo
// La base est créée dans ./data/demo.db (supprimez le fichier pour repartir à zéro).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.FACTURIER_DATA || join(ROOT, 'data', 'demo.db');
process.env.FACTURIER_DATA = DB_PATH;

const fresh = !existsSync(DB_PATH);
const { openDb, setSettings, setRawSetting } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

if (fresh) {
  const db = openDb(DB_PATH);
  setRawSetting(db, 'auth', hashPassword('demo1234'));
  setSettings(db, {
    company_name: 'Jeanne Martin — Studio Web',
    legal_form: 'Entrepreneur individuel (EI)',
    siren: '912345678',
    siret: '91234567800014',
    ape_code: '6201Z',
    address_line1: '10 rue Oberkampf',
    postal_code: '75011',
    city: 'Paris',
    email: 'jeanne@studioweb.example',
    phone: '06 12 34 56 78',
    iban: 'FR76 3000 4000 0500 0012 3456 789',
    bic: 'BNPAFRPP',
    vat_regime: 'franchise',
  });

  const insClient = db.prepare(
    `INSERT INTO clients (kind, name, siren, address_line1, postal_code, city, email)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insClient.run('company', 'ACME SAS', '532183181', '1 avenue de la République', '75001', 'Paris', 'compta@acme.example');
  insClient.run('company', 'Boulangerie Petit', '811222333', '4 place du Marché', '69001', 'Lyon', 'contact@petit.example');
  insClient.run('individual', 'Marc Dupont', '', '8 rue des Lilas', '33000', 'Bordeaux', 'marc@dupont.example');

  const insItem = db.prepare(
    `INSERT INTO catalog_items (label, description, unit, unit_price_cents, vat_rate) VALUES (?, ?, ?, ?, ?)`
  );
  insItem.run('Développement web', 'Développement front-end et back-end', 'j', 45000, 20);
  insItem.run('Maquette UI', 'Conception graphique et prototypage', 'j', 40000, 20);
  insItem.run('Maintenance mensuelle', 'Mises à jour, sauvegardes, supervision', 'mois', 12000, 20);
  insItem.run('Formation', 'Prise en main de l’outil d’administration', 'h', 9000, 20);

  // Quelques documents émis sur l'année via l'API interne
  const { issueDocument } = await import('../src/api.js');
  const { getSettings } = await import('../src/db.js');
  const insDoc = db.prepare(
    `INSERT INTO documents (doc_type, client_id, subject, payment_means) VALUES (?, ?, ?, 'transfer')`
  );
  const insLine = db.prepare(
    `INSERT INTO document_lines (document_id, position, label, description, qty_milli, unit, unit_price_cents, vat_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insPay = db.prepare(
    `INSERT INTO payments (document_id, paid_on, amount_cents, method) VALUES (?, ?, ?, 'transfer')`
  );
  const mkDoc = (type, clientId, subject, lines, issueDate, payment) => {
    const id = insDoc.run(type, clientId, subject).lastInsertRowid;
    lines.forEach((l, i) => insLine.run(id, i, l[0], l[1] || '', l[2], l[3], l[4], 20));
    issueDocument(db, id, getSettings(db), { issue_date: issueDate });
    if (payment) {
      insPay.run(id, payment[0], payment[1]);
      const doc = db.prepare('SELECT totals_json FROM documents WHERE id = ?').get(id);
      if (payment[1] >= JSON.parse(doc.totals_json).total_ttc_cents) {
        db.prepare("UPDATE documents SET status = 'paid' WHERE id = ?").run(id);
      }
    }
    return id;
  };

  const year = new Date().getFullYear();
  mkDoc('invoice', 1, 'Refonte du site vitrine — phase 1',
    [['Maquette UI', 'Pages accueil, services, contact', 3000, 'j', 40000],
     ['Développement web', 'Intégration responsive', 5000, 'j', 45000]],
    `${year}-02-10`, [`${year}-03-02`, 345000]);
  mkDoc('invoice', 2, 'Site de commande en ligne',
    [['Développement web', 'Catalogue + panier', 8000, 'j', 45000]],
    `${year}-04-22`, [`${year}-05-15`, 360000]);
  mkDoc('invoice', 1, 'Maintenance T2',
    [['Maintenance mensuelle', '', 3000, 'mois', 12000]],
    `${year}-06-30`, [`${year}-07-12`, 36000]);
  mkDoc('invoice', 3, 'Formation à l’administration du site',
    [['Formation', '', 4000, 'h', 9000]],
    `${year}-07-15`, null);
  mkDoc('quote', 2, 'Application de fidélité',
    [['Maquette UI', '', 4000, 'j', 40000],
     ['Développement web', 'MVP application', 12000, 'j', 45000]],
    `${year}-07-28`, null);

  console.log(`Base de démonstration créée : ${DB_PATH}`);
  console.log('Mot de passe : demo1234');
  db.close();
} else {
  console.log(`Base existante réutilisée : ${DB_PATH} (mot de passe : demo1234)`);
}

const { createApp } = await import('../server.js');
const { server } = createApp(DB_PATH);
const PORT = Number(process.env.PORT || 3131);
const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => console.log(`Facturier (démo) : http://${HOST}:${PORT}`));
