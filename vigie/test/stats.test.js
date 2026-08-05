import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { recordProbe } from '../src/monitor.js';
import {
  percentile, windowStats, rollupDay, uptimeHistory, overallUptime, maintenance,
} from '../src/stats.js';

function db1() {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO monitors (id,name,url,failure_threshold,created_at) VALUES (1,?,?,2,0)').run('M', 'http://x');
  return db;
}
const mon = (db) => db.prepare('SELECT * FROM monitors WHERE id=1').get();
const T0 = Date.parse('2026-08-05T10:00:00Z');
const mk = (up, lat, i, deg = false) => ({ up, degraded: deg, status_code: up ? 200 : 500, latency_ms: lat, error: up ? '' : 'boom', ts: T0 + i * 60000 });

test('percentile nearest-rank', () => {
  const a = [10, 20, 30, 40, 50];
  assert.equal(percentile(a, 50), 30);
  assert.equal(percentile(a, 95), 50);
  assert.equal(percentile(a, 100), 50);
  assert.equal(percentile([], 50), null);
});

test('windowStats : uptime et latences', () => {
  const db = db1();
  const seq = [mk(1, 100, 0), mk(1, 200, 1), mk(0, null, 2), mk(1, 300, 3)];
  for (const r of seq) recordProbe(db, mon(db), r);
  const w = windowStats(db, 1, T0, T0 + 10 * 60000);
  assert.equal(w.total, 4);
  assert.equal(w.up, 3);
  assert.equal(w.uptime, 0.75);
  assert.equal(w.p50, 200);
  assert.equal(w.avg_latency, 200);
  assert.equal(w.max_latency, 300);
});

test('machine à états : incident ouvert au seuil, daté du 1er échec', () => {
  const db = db1();
  const seq = [mk(1, 50, 0), mk(0, null, 1), mk(0, null, 2), mk(0, null, 3), mk(1, 60, 4)];
  const evts = seq.map((r) => recordProbe(db, mon(db), r));
  assert.equal(evts[2].incidentOpened, true);   // 2e échec => ouverture
  assert.equal(evts[4].incidentResolved, true); // retour OK => résolution
  const inc = db.prepare('SELECT * FROM incidents').get();
  assert.equal(inc.started_at, T0 + 1 * 60000);  // 1er échec (minute 1)
  assert.equal(inc.resolved_at, T0 + 4 * 60000); // 1er succès (minute 4)
  assert.equal(inc.checks_failed, 3);
});

test('un seul incident ouvert à la fois', () => {
  const db = db1();
  for (const r of [mk(0, null, 0), mk(0, null, 1), mk(0, null, 2), mk(0, null, 3)]) recordProbe(db, mon(db), r);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM incidents').get().n, 1);
});

test('état dégradé n’ouvre pas d’incident', () => {
  const db = db1();
  for (const r of [mk(1, 500, 0, true), mk(1, 500, 1, true)]) recordProbe(db, mon(db), r);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM incidents').get().n, 0);
  assert.equal(mon(db).state, 'degraded');
});

test('rollupDay : agrégats + down_seconds depuis les incidents', () => {
  const db = db1();
  // 10 sondes minute par minute : 7 OK, incident de 3 min.
  const seq = [mk(1, 100, 0), mk(1, 120, 1), mk(1, 90, 2), mk(1, 110, 3), mk(1, 105, 4),
    mk(0, null, 5), mk(0, null, 6), mk(0, null, 7), mk(1, 130, 8), mk(1, 95, 9)];
  for (const r of seq) recordProbe(db, mon(db), r);
  const r = rollupDay(db, 1, '2026-08-05');
  assert.equal(r.total, 10);
  assert.equal(r.up_count, 7);
  const ds = db.prepare('SELECT * FROM daily_stats WHERE monitor_id=1').get();
  assert.equal(ds.down_seconds, 180); // 3 minutes
  assert.ok(ds.p95_latency >= ds.avg_latency);
});

test('uptimeHistory : jours sans données marqués has_data=false', () => {
  const db = db1();
  recordProbe(db, mon(db), mk(1, 100, 0));
  rollupDay(db, 1, '2026-08-05');
  const hist = uptimeHistory(db, 1, 7, Date.parse('2026-08-07T10:00:00Z'));
  assert.equal(hist.length, 7);
  const withData = hist.filter((h) => h.has_data);
  assert.equal(withData.length, 1);
  assert.equal(withData[0].day, '2026-08-05');
  assert.equal(withData[0].uptime, 1);
});

test('overallUptime pondéré par le nombre de sondes', () => {
  const db = db1();
  // jour 1 : 100 sondes 100% ; jour 2 : 1 sonde 0%. Pondéré => 100/101.
  const day1 = Date.parse('2026-08-01T00:00:00Z');
  for (let i = 0; i < 100; i++) recordProbe(db, mon(db), { up: 1, degraded: false, status_code: 200, latency_ms: 50, error: '', ts: day1 + i * 60000 });
  recordProbe(db, mon(db), { up: 0, degraded: false, status_code: 500, latency_ms: null, error: 'x', ts: Date.parse('2026-08-02T00:00:00Z') });
  recordProbe(db, mon(db), { up: 0, degraded: false, status_code: 500, latency_ms: null, error: 'x', ts: Date.parse('2026-08-02T00:01:00Z') });
  rollupDay(db, 1, '2026-08-01');
  rollupDay(db, 1, '2026-08-02');
  const u = overallUptime(db, 1, 90, Date.parse('2026-08-03T00:00:00Z'));
  assert.ok(Math.abs(u - 100 / 102) < 1e-9);
});

test('maintenance purge les sondes brutes anciennes', () => {
  const db = db1();
  const now = Date.parse('2026-08-30T00:00:00Z');
  recordProbe(db, mon(db), { up: 1, degraded: false, status_code: 200, latency_ms: 10, error: '', ts: now - 20 * 86400_000 });
  recordProbe(db, mon(db), { up: 1, degraded: false, status_code: 200, latency_ms: 10, error: '', ts: now - 1 * 86400_000 });
  maintenance(db, { checkRetentionDays: 7, statsRetentionDays: 90 }, now);
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM checks').get().n;
  assert.equal(remaining, 1); // la sonde de 20 jours est purgée
  // et un rollup a été créé pour le jour purgé
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM daily_stats').get().n >= 1);
});
