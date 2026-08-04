import test from 'node:test';
import assert from 'node:assert/strict';
import {
  offsetMinutes, wallTimeToUtc, dateAndMinutesToUtc, localDateStr, localMinutes,
  localWeekday, addDays, isValidTimeZone, offsetLabel,
} from '../src/timezone.js';

test('offsets DST et demi-heure', () => {
  assert.equal(offsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Europe/Paris'), 60);
  assert.equal(offsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Europe/Paris'), 120);
  assert.equal(offsetMinutes(new Date('2026-01-15T12:00:00Z'), 'America/New_York'), -300);
  assert.equal(offsetMinutes(new Date('2026-07-15T12:00:00Z'), 'America/New_York'), -240);
  assert.equal(offsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Asia/Kolkata'), 330);
  assert.equal(offsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Australia/Adelaide'), 630);
});

test('heure murale -> UTC (été/hiver)', () => {
  assert.equal(wallTimeToUtc(2026, 7, 15, 14 * 60 + 30, 'Europe/Paris').toISOString(), '2026-07-15T12:30:00.000Z');
  assert.equal(wallTimeToUtc(2026, 1, 15, 14 * 60 + 30, 'Europe/Paris').toISOString(), '2026-01-15T13:30:00.000Z');
  assert.equal(wallTimeToUtc(2026, 7, 15, 10 * 60, 'Asia/Kolkata').toISOString(), '2026-07-15T04:30:00.000Z');
});

test('round-trip heure murale sur 365 jours (DST inclus)', () => {
  for (const tz of ['Europe/Paris', 'America/New_York', 'Australia/Adelaide', 'Pacific/Chatham']) {
    let day = '2026-01-01';
    for (let i = 0; i < 365; i++) {
      const inst = dateAndMinutesToUtc(day, 9 * 60 + 15, tz);
      assert.equal(localDateStr(inst, tz), day, `${tz} ${day} date`);
      assert.equal(localMinutes(inst, tz), 9 * 60 + 15, `${tz} ${day} minutes`);
      day = addDays(day, 1);
    }
  }
});

test('heure inexistante (saut de printemps) reste déterministe', () => {
  // Paris 29/03/2026 02:30 n'existe pas ; l'instant doit être valide et unique.
  const d = wallTimeToUtc(2026, 3, 29, 2 * 60 + 30, 'Europe/Paris');
  assert.ok(!isNaN(d.getTime()));
  // Après le saut, l'heure locale est 03:30 (+120).
  assert.equal(offsetMinutes(d, 'Europe/Paris'), 120);
});

test('jour de semaine local', () => {
  // 2026-08-05 est un mercredi (3)
  const inst = dateAndMinutesToUtc('2026-08-05', 12 * 60, 'Europe/Paris');
  assert.equal(localWeekday(inst, 'Europe/Paris'), 3);
});

test('addDays traverse les mois et années bissextiles', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29'); // 2028 bissextile
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-15', -20), '2026-02-23');
});

test('validation des fuseaux et étiquette', () => {
  assert.ok(isValidTimeZone('Europe/Paris'));
  assert.ok(!isValidTimeZone('Mars/Olympus'));
  assert.ok(!isValidTimeZone(''));
  assert.equal(offsetLabel(new Date('2026-07-15T12:00:00Z'), 'Europe/Paris'), 'UTC+02:00');
  assert.equal(offsetLabel(new Date('2026-01-15T12:00:00Z'), 'America/New_York'), 'UTC-05:00');
  assert.equal(offsetLabel(new Date('2026-07-15T12:00:00Z'), 'Asia/Kolkata'), 'UTC+05:30');
});
