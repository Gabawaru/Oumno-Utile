// Tests d'intégration : serveur HTTP réel sur port éphémère, base temporaire.

import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

const dir = mkdtempSync(join(tmpdir(), 'creneau-test-'));
const { server, db } = createApp(join(dir, 'test.db'));
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

// helper : trouve un mercredi futur (jour ouvré fiable) au format YYYY-MM-DD
function nextWednesday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((3 - d.getUTCDay() + 7) % 7 || 7) + 7); // +1 à 2 semaines
  return d.toISOString().slice(0, 10);
}

test('parcours complet Créneau', async (t) => {
  await t.test('setup + session', async () => {
    assert.equal((await call('GET', '/api/setup-status')).data.configured, false);
    const r = await call('POST', '/api/setup', { password: 'secret12', organizer_name: 'Org', timezone: 'Europe/Paris' });
    assert.equal(r.status, 200);
    assert.equal((await call('GET', '/api/me')).status, 200);
  });

  await t.test('surface admin protégée, surface publique ouverte', async () => {
    const saved = cookie; cookie = '';
    assert.equal((await call('GET', '/api/event-types', undefined, { withCookie: false })).status, 401);
    assert.equal((await call('GET', '/api/public/config', undefined, { withCookie: false })).status, 200);
    cookie = saved;
  });

  let etSlug;
  await t.test('création type + disponibilités', async () => {
    const et = (await call('POST', '/api/event-types', { name: 'Consultation 30', duration_min: 30, min_notice_min: 0, max_days_ahead: 90 })).data;
    etSlug = et.slug;
    assert.equal(et.slug, 'consultation-30');
    // Grille lun–ven 9:00–17:00
    const rules = [];
    for (let wd = 1; wd <= 5; wd++) rules.push({ weekday: wd, start_min: 540, end_min: 1020 });
    assert.equal((await call('PUT', '/api/availability', { rules })).status, 200);
  });

  let day, firstSlot, token;
  await t.test('slots publics disponibles', async () => {
    day = nextWednesday();
    const r = await call('GET', `/api/public/slots?type=${etSlug}&from=${day}&to=${day}&tz=America/New_York`, undefined, { withCookie: false });
    assert.equal(r.status, 200);
    assert.equal(r.data.timezone, 'America/New_York');
    assert.ok(r.data.days[0].slots.length > 0, 'des créneaux existent');
    firstSlot = r.data.days[0].slots[0].start;
  });

  await t.test('réservation publique + anti double-réservation', async () => {
    const r = await call('POST', '/api/public/book', {
      type: etSlug, start: firstSlot, name: 'Alice', email: 'alice@ex.com', tz: 'America/New_York', notes: 'test',
    }, { withCookie: false });
    assert.equal(r.status, 201);
    assert.equal(r.data.status, 'confirmed');
    token = r.data.manage_token;
    // même créneau à nouveau => conflit
    const dup = await call('POST', '/api/public/book', { type: etSlug, start: firstSlot, name: 'Bob', email: 'bob@ex.com' }, { withCookie: false });
    assert.equal(dup.status, 409);
  });

  await t.test('validation e-mail et champs', async () => {
    const bad = await call('POST', '/api/public/book', { type: etSlug, start: firstSlot, name: 'X', email: 'pas-un-email' }, { withCookie: false });
    assert.equal(bad.status, 400);
  });

  await t.test('le créneau réservé disparaît des disponibilités', async () => {
    const r = await call('GET', `/api/public/slots?type=${etSlug}&from=${day}&to=${day}&tz=America/New_York`, undefined, { withCookie: false });
    const starts = r.data.days[0].slots.map((s) => s.start);
    assert.ok(!starts.includes(firstSlot));
  });

  await t.test('ICS public bien formé', async () => {
    const r = await call('GET', `/api/public/booking/${token}/ics`, undefined, { withCookie: false });
    assert.equal(r.status, 200);
    assert.match(r.data, /BEGIN:VCALENDAR/);
    assert.match(r.data, /SUMMARY:Consultation 30/);
  });

  await t.test('gestion invité : consultation puis annulation', async () => {
    const view = await call('GET', `/api/public/booking/${token}`, undefined, { withCookie: false });
    assert.equal(view.data.status, 'confirmed');
    const cancel = await call('POST', `/api/public/booking/${token}/cancel`, { reason: 'empêchement' }, { withCookie: false });
    assert.equal(cancel.data.status, 'cancelled');
    // Le créneau redevient disponible.
    const r = await call('GET', `/api/public/slots?type=${etSlug}&from=${day}&to=${day}&tz=America/New_York`, undefined, { withCookie: false });
    assert.ok(r.data.days[0].slots.map((s) => s.start).includes(firstSlot));
  });

  await t.test('admin : liste et stats', async () => {
    const up = await call('GET', '/api/bookings?scope=upcoming');
    assert.equal(up.status, 200);
    const cancelled = await call('GET', '/api/bookings?scope=cancelled');
    assert.ok(cancelled.data.length >= 1);
    const stats = await call('GET', '/api/stats');
    assert.ok('upcoming' in stats.data && 'cancelled_total' in stats.data);
  });

  await t.test('exceptions de calendrier ferment un jour', async () => {
    await call('PUT', `/api/overrides/${day}`, { available: 0, note: 'congés' });
    const r = await call('GET', `/api/public/slots?type=${etSlug}&from=${day}&to=${day}&tz=Europe/Paris`, undefined, { withCookie: false });
    assert.equal(r.data.days[0].slots.length, 0);
  });

  await t.test('fuseau invalide rejeté', async () => {
    assert.equal((await call('PUT', '/api/settings', { timezone: 'Mars/Base' })).status, 400);
    assert.equal((await call('PUT', '/api/settings', { timezone: 'Asia/Tokyo' })).status, 200);
  });
});

test.after(() => {
  server.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
