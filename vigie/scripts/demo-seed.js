#!/usr/bin/env node
// Base de démonstration (mot de passe : demo1234) avec un historique réaliste,
// puis lancement du serveur + ordonnanceur. Usage : npm run demo
// Supprimez data/demo.db pour repartir de zéro.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.VIGIE_DATA || join(ROOT, 'data', 'demo.db');
process.env.VIGIE_DATA = DB_PATH;
const PORT = Number(process.env.PORT || 3223);

const fresh = !existsSync(DB_PATH);
const { openDb, setSettings, setRawSetting } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { rollupDay } = await import('../src/stats.js');

if (fresh) {
  const db = openDb(DB_PATH);
  setRawSetting(db, 'auth', hashPassword('demo1234'));
  setSettings(db, {
    organization: 'Studio Oumno',
    page_title: 'État des services — Studio Oumno',
    page_intro: 'Suivi en temps réel de la disponibilité de nos services.',
    brand_color: '#0d9488',
  });

  const now = Date.now();
  const insMon = db.prepare(
    `INSERT INTO monitors (name,url,method,expected_status,interval_sec,timeout_ms,degraded_ms,
      failure_threshold,public,position,state,created_at)
     VALUES (?,?,?,?,?,?,?,?,1,?,'pending',?)`
  );
  // Monitor 1 : l'API de Vigie elle-même (sera UP une fois le serveur lancé).
  const selfId = insMon.run('Site principal', `http://127.0.0.1:${PORT}/`, 'GET', '2xx', 60, 10000, 800, 2, 1, now - 90 * 86400_000).lastInsertRowid;
  // Monitor 2 : une API interne (démo d'historique).
  const apiId = insMon.run('API interne', `http://127.0.0.1:${PORT}/api/public/status`, 'GET', '2xx', 60, 10000, 500, 2, 2, now - 90 * 86400_000).lastInsertRowid;
  // Monitor 3 : un service actuellement indisponible (port fermé => incident en cours).
  const downId = insMon.run('Service de paiement', 'http://127.0.0.1:9/', 'GET', '2xx', 120, 5000, 0, 2, 3, now - 90 * 86400_000).lastInsertRowid;

  // Historique synthétique : 90 jours de sondes horaires pour les 2 premiers,
  // avec un incident de 40 min il y a 6 jours sur l'API interne.
  const insCheck = db.prepare('INSERT INTO checks (monitor_id, ts, up, degraded, status_code, latency_ms, error) VALUES (?,?,?,?,?,?,?)');
  const insInc = db.prepare('INSERT INTO incidents (monitor_id, started_at, resolved_at, cause, checks_failed) VALUES (?,?,?,?,?)');
  const rand = (a, b) => Math.round(a + Math.random() * (b - a));

  const incidentStart = now - 6 * 86400_000;
  const incidentEnd = incidentStart + 40 * 60000;
  for (const [mid, baseLat, jitter] of [[selfId, 45, 30], [apiId, 90, 60]]) {
    for (let h = 90 * 24; h >= 1; h--) {
      const ts = now - h * 3600_000;
      const inIncident = mid === apiId && ts >= incidentStart && ts <= incidentEnd;
      if (inIncident) { insCheck.run(mid, ts, 0, 0, 503, null, 'Statut inattendu : 503'); continue; }
      const lat = rand(baseLat - jitter / 2, baseLat + jitter);
      const degraded = mid === apiId && lat > 130 ? 1 : 0;
      insCheck.run(mid, ts, 1, degraded, 200, lat, '');
    }
  }
  insInc.run(apiId, incidentStart, incidentEnd, 'Statut inattendu : 503', 3);

  // Rollups pour les jours passés (la page 90 jours lit surtout daily_stats).
  const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
  for (const mid of [selfId, apiId]) {
    for (let d = 90; d >= 1; d--) rollupDay(db, mid, dayStr(now - d * 86400_000));
  }

  console.log(`Base de démonstration créée : ${DB_PATH}`);
  console.log('Mot de passe admin : demo1234');
  db.close();
} else {
  console.log(`Base existante réutilisée : ${DB_PATH} (mot de passe : demo1234)`);
}

const { createApp } = await import('../server.js');
const { server, scheduler } = createApp(DB_PATH);
const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  scheduler.start(); // après listen : les monitors auto-référencés répondent
  console.log(`Vigie (démo) : http://${HOST}:${PORT}`);
  console.log(`Console admin : http://${HOST}:${PORT}/#/admin`);
});
