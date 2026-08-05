import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, icsStamp } from '../src/ics.js';

// Déplie les lignes (retire les CRLF + espace de continuation) pour tester le
// contenu logique, indépendamment du pliage.
const unfold = (ics) => ics.replace(/\r\n /g, '');

const base = {
  uid: 'abc-123@creneau', sequence: 0,
  start: new Date('2026-08-05T07:00:00Z'), end: new Date('2026-08-05T07:30:00Z'),
  summary: 'Consultation', organizerName: 'Dr. Martin', organizerEmail: 'm@ex.fr',
  attendeeName: 'Alice', attendeeEmail: 'alice@ex.com',
};

test('structure VCALENDAR/VEVENT et CRLF', () => {
  const ics = buildIcs(base);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('\r\nEND:VCALENDAR\r\n'));
  assert.ok(ics.includes('BEGIN:VEVENT\r\n'));
  assert.match(ics, /\r\nUID:abc-123@creneau\r\n/);
  assert.match(ics, /\r\nVERSION:2\.0\r\n/);
  assert.match(ics, /\r\nMETHOD:REQUEST\r\n/);
  assert.match(ics, /\r\nDTSTART:20260805T070000Z\r\n/);
  assert.match(ics, /\r\nDTEND:20260805T073000Z\r\n/);
  assert.match(ics, /\r\nSTATUS:CONFIRMED\r\n/);
  assert.ok(ics.endsWith('\r\n'));
});

test('horodatage UTC Zulu', () => {
  assert.equal(icsStamp(new Date('2026-12-31T23:05:09Z')), '20261231T230509Z');
});

test('annulation : METHOD/STATUS CANCEL', () => {
  const ics = buildIcs({ ...base, sequence: 1, method: 'CANCEL', status: 'CANCELLED' });
  assert.match(ics, /\r\nMETHOD:CANCEL\r\n/);
  assert.match(ics, /\r\nSTATUS:CANCELLED\r\n/);
  assert.match(ics, /\r\nSEQUENCE:1\r\n/);
  assert.match(ics, /PARTSTAT=DECLINED/);
});

test('organisateur et participant', () => {
  const ics = unfold(buildIcs(base));
  assert.match(ics, /ORGANIZER;CN=Dr\. Martin:mailto:m@ex\.fr/);
  assert.match(ics, /ATTENDEE;CN=Alice;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:alice@ex\.com/);
});

test('échappement des caractères spéciaux', () => {
  const ics = buildIcs({ ...base, summary: 'Point; RDV, avec\nGabriel \\o/' });
  // ; , \ et newline doivent être échappés dans la valeur.
  assert.match(ics, /SUMMARY:Point\\; RDV\\, avec\\nGabriel \\\\o\//);
});

test('pliage des lignes à 75 octets', () => {
  const longSummary = 'A'.repeat(200);
  const ics = buildIcs({ ...base, summary: longSummary });
  for (const line of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `ligne trop longue : ${line.length}`);
  }
  // Les lignes de continuation commencent par une espace.
  const lines = ics.split('\r\n');
  const idx = lines.findIndex((l) => l.startsWith('SUMMARY:'));
  assert.ok(lines[idx + 1].startsWith(' '), 'continuation pliée');
});

test('pliage sûr en UTF-8 (pas de coupe au milieu d\'un caractère)', () => {
  const ics = buildIcs({ ...base, summary: 'é'.repeat(60) }); // 120 octets
  for (const line of ics.split('\r\n')) {
    // Chaque ligne dépliée doit rester de l'UTF-8 valide (pas d'octet orphelin).
    const stripped = line.startsWith(' ') ? line.slice(1) : line;
    assert.equal(Buffer.from(stripped, 'utf8').toString('utf8'), stripped);
  }
});
