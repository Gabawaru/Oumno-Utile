// Génération iCalendar (RFC 5545) — le fichier .ics qu'un invité ajoute à son
// agenda, et le message REQUEST/CANCEL destiné aux clients de messagerie.
//
// Points de conformité traités : CRLF, pliage des lignes à 75 octets, échappement
// des caractères spéciaux (\, ; , et retours ligne), horodatage UTC en « Zulu »,
// UID stable, SEQUENCE incrémentée à chaque reprogrammation, PRODID.

const PRODID = '-//Oumno//Creneau 1.0//FR';

/** Échappement des valeurs de texte (RFC 5545 §3.3.11). */
function escapeText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Pliage des lignes : une ligne de contenu ne doit pas dépasser 75 octets ;
 * les suivantes sont préfixées d'une espace. On compte en octets UTF-8 pour
 * ne jamais couper au milieu d'un caractère multi-octets.
 */
function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Ne pas couper une séquence UTF-8 : reculer tant qu'on est sur un octet de continuation.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((out.length ? ' ' : '') + bytes.toString('utf8', start, end));
    start = end;
    limit = 74; // les lignes de continuation portent une espace en tête
  }
  return out.join('\r\n');
}

/** Instant -> "YYYYMMDDTHHMMSSZ" (UTC). */
export function icsStamp(instant) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    instant.getUTCFullYear() +
    p(instant.getUTCMonth() + 1) +
    p(instant.getUTCDate()) + 'T' +
    p(instant.getUTCHours()) +
    p(instant.getUTCMinutes()) +
    p(instant.getUTCSeconds()) + 'Z'
  );
}

/**
 * Construit un fichier .ics pour une réservation.
 * @param {object} o
 * @param {string} o.uid
 * @param {number} o.sequence
 * @param {Date} o.start
 * @param {Date} o.end
 * @param {string} o.summary
 * @param {string} o.description
 * @param {string} o.location
 * @param {string} o.organizerName
 * @param {string} o.organizerEmail
 * @param {string} o.attendeeName
 * @param {string} o.attendeeEmail
 * @param {'REQUEST'|'CANCEL'} [o.method]
 * @param {'CONFIRMED'|'CANCELLED'} [o.status]
 * @param {Date} [o.stamp]
 */
export function buildIcs(o) {
  const method = o.method || 'REQUEST';
  const status = o.status || 'CONFIRMED';
  const stamp = o.stamp || new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${o.uid}`,
    `SEQUENCE:${o.sequence || 0}`,
    `DTSTAMP:${icsStamp(stamp)}`,
    `DTSTART:${icsStamp(o.start)}`,
    `DTEND:${icsStamp(o.end)}`,
    `SUMMARY:${escapeText(o.summary)}`,
  ];
  if (o.description) lines.push(`DESCRIPTION:${escapeText(o.description)}`);
  if (o.location) lines.push(`LOCATION:${escapeText(o.location)}`);
  if (o.organizerEmail) {
    lines.push(`ORGANIZER;CN=${escapeText(o.organizerName || o.organizerEmail)}:mailto:${o.organizerEmail}`);
  }
  if (o.attendeeEmail) {
    lines.push(
      `ATTENDEE;CN=${escapeText(o.attendeeName || o.attendeeEmail)};ROLE=REQ-PARTICIPANT;` +
        `PARTSTAT=${status === 'CANCELLED' ? 'DECLINED' : 'ACCEPTED'};RSVP=FALSE:mailto:${o.attendeeEmail}`
    );
  }
  lines.push(`STATUS:${status}`, 'END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
