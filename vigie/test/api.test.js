// Tests d'intégration : serveur Vigie réel + une cible HTTP locale à surveiller.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

// Cible surveillée : petit serveur dont on pilote l'état (up/down).
let targetUp = true;
const target = http.createServer((req, res) => {
  if (!targetUp) { res.writeHead(503); res.end('indispo'); return; }
  res.writeHead(200); res.end('OK service en ligne');
});
await new Promise((r) => target.listen(0, '127.0.0.1', r));
const TARGET = `http://127.0.0.1:${target.address().port}/`;

const dir = mkdtempSync(join(tmpdir(), 'vigie-test-'));
const { server, db, scheduler } = createApp(join(dir, 'test.db'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let cookie = '';
async function call(method, path, body, { withCookie = true } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };
  if (withCookie && cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

test('parcours complet Vigie', async (t) => {
  await t.test('setup + session', async () => {
    assert.equal((await call('GET', '/api/setup-status')).data.configured, false);
    assert.equal((await call('POST', '/api/setup', { password: 'secret12', organization: 'Test' })).status, 200);
    assert.equal((await call('GET', '/api/me')).status, 200);
  });

  await t.test('surface publique ouverte, admin protégée', async () => {
    const saved = cookie; cookie = '';
    assert.equal((await call('GET', '/api/monitors', undefined, { withCookie: false })).status, 401);
    assert.equal((await call('GET', '/api/public/status', undefined, { withCookie: false })).status, 200);
    cookie = saved;
  });

  let monId;
  await t.test('création de moniteur + validation d’URL', async () => {
    assert.equal((await call('POST', '/api/monitors', { name: 'X', url: 'ftp://nope' })).status, 400);
    const m = (await call('POST', '/api/monitors', {
      name: 'Cible', url: TARGET, expected_status: '2xx', interval_sec: 10, failure_threshold: 1,
    })).data;
    monId = m.id;
    assert.ok(monId > 0);
  });

  await t.test('sonde à la demande => up', async () => {
    const r = await call('POST', `/api/monitors/${monId}/check`);
    assert.equal(r.status, 200);
    assert.equal(r.data.result.up, true);
    assert.equal(r.data.monitor.state, 'up');
    assert.equal(r.data.monitor.last_status_code, 200);
  });

  await t.test('bascule down => incident ouvert', async () => {
    targetUp = false;
    await call('POST', `/api/monitors/${monId}/check`); // failure_threshold=1 => incident immédiat
    const detail = (await call('GET', `/api/monitors/${monId}`)).data;
    assert.equal(detail.monitor.state, 'down');
    assert.ok(detail.incidents.length >= 1);
    assert.equal(detail.incidents[0].resolved_at, null);
    const inc = (await call('GET', '/api/incidents')).data;
    assert.ok(inc.some((i) => i.resolved_at === null));
  });

  await t.test('page publique reflète l’incident', async () => {
    const pub = (await call('GET', '/api/public/status', undefined, { withCookie: false })).data;
    assert.equal(pub.status.level, 'down');
    assert.ok(pub.ongoing_incidents.length >= 1);
  });

  await t.test('rétablissement => incident résolu', async () => {
    targetUp = true;
    await call('POST', `/api/monitors/${monId}/check`);
    const detail = (await call('GET', `/api/monitors/${monId}`)).data;
    assert.equal(detail.monitor.state, 'up');
    assert.ok(detail.incidents[0].resolved_at != null);
  });

  await t.test('SVG uptime public + latence admin', async () => {
    const bars = await call('GET', `/api/public/monitors/${monId}/uptime.svg`, undefined, { withCookie: false });
    assert.match(bars.data, /<svg/);
    const lat = await call('GET', `/api/monitors/${monId}/latency.svg?hours=24`);
    assert.match(lat.data, /<svg/);
  });

  await t.test('pause exclut le moniteur des sondes', async () => {
    await call('POST', `/api/monitors/${monId}/pause`, { paused: true });
    const due = scheduler.dueMonitors(Date.now()).map((m) => m.id);
    assert.ok(!due.includes(monId));
    await call('POST', `/api/monitors/${monId}/pause`, { paused: false });
  });

  await t.test('stats admin', async () => {
    const s = (await call('GET', '/api/stats')).data;
    assert.equal(s.total, 1);
    assert.ok('system' in s);
  });

  await t.test('monitor privé absent de la page publique', async () => {
    await call('POST', '/api/monitors', { name: 'Privé', url: TARGET, public: false });
    const pub = (await call('GET', '/api/public/status', undefined, { withCookie: false })).data;
    assert.ok(!pub.monitors.some((m) => m.name === 'Privé'));
  });
});

test.after(() => {
  scheduler.stop();
  server.close();
  target.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
