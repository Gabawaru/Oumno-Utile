// Tests de la sonde contre un vrai serveur HTTP local (déterministe, sans réseau
// externe). Le cas « injoignable » utilise un port fermé (connexion refusée).

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { probe, statusMatches } from '../src/probe.js';

let server, base;
test.before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/ok') { res.writeHead(200); res.end('Bonjour le monde OK'); }
    else if (req.url === '/500') { res.writeHead(500); res.end('boom'); }
    else if (req.url === '/slow') { setTimeout(() => { res.writeHead(200); res.end('lent'); }, 250); }
    else if (req.url === '/redir') { res.writeHead(302, { location: '/ok' }); res.end(); }
    else if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); res.end(); }
    else { res.writeHead(404); res.end('nope'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('statusMatches : codes exacts et familles', () => {
  assert.ok(statusMatches(200, '200'));
  assert.ok(statusMatches(204, '2xx'));
  assert.ok(!statusMatches(404, '2xx'));
  assert.ok(statusMatches(301, '2xx,3xx'));
  assert.ok(statusMatches(503, '5xx'));
});

test('service disponible', async () => {
  const r = await probe({ url: base + '/ok', expected_status: '2xx' });
  assert.equal(r.up, true);
  assert.equal(r.status_code, 200);
  assert.ok(r.latency_ms >= 0);
});

test('assertion de mot-clé', async () => {
  assert.equal((await probe({ url: base + '/ok', expected_status: '2xx', keyword: 'le monde' })).up, true);
  const miss = await probe({ url: base + '/ok', expected_status: '2xx', keyword: 'absent' });
  assert.equal(miss.up, false);
  assert.match(miss.error, /Mot-clé absent/);
});

test('mot-clé interdit', async () => {
  const r = await probe({ url: base + '/ok', expected_status: '2xx', keyword_absent: 'monde' });
  assert.equal(r.up, false);
  assert.match(r.error, /interdit/);
});

test('statut inattendu vs attendu', async () => {
  assert.equal((await probe({ url: base + '/500', expected_status: '2xx' })).up, false);
  assert.equal((await probe({ url: base + '/500', expected_status: '5xx' })).up, true);
});

test('suivi de redirection', async () => {
  const r = await probe({ url: base + '/redir', expected_status: '2xx', follow_redirects: 1 });
  assert.equal(r.up, true);
  assert.equal(r.status_code, 200);
});

test('redirection non suivie => code 3xx', async () => {
  const r = await probe({ url: base + '/redir', expected_status: '2xx', follow_redirects: 0 });
  assert.equal(r.status_code, 302);
  assert.equal(r.up, false);
});

test('boucle de redirection bornée (pas de dépassement de pile)', async () => {
  const r = await probe({ url: base + '/loop', expected_status: '2xx', follow_redirects: 1, timeout_ms: 3000 });
  assert.equal(r.up, false); // s'arrête après MAX_REDIRECTS
});

test('seuil dégradé', async () => {
  const r = await probe({ url: base + '/slow', expected_status: '2xx', degraded_ms: 100 });
  assert.equal(r.up, true);
  assert.equal(r.degraded, true);
});

test('délai dépassé', async () => {
  const r = await probe({ url: base + '/slow', expected_status: '2xx', timeout_ms: 80 });
  assert.equal(r.up, false);
  assert.match(r.error, /Délai/);
});

test('connexion refusée (port fermé)', async () => {
  const r = await probe({ url: 'http://127.0.0.1:1/', expected_status: '2xx', timeout_ms: 2000 });
  assert.equal(r.up, false);
  assert.match(r.error, /refus/i);
});

test('URL invalide', async () => {
  assert.equal((await probe({ url: 'pas une url', expected_status: '2xx' })).up, false);
});
