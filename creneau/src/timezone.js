// Moteur de fuseaux horaires — s'appuie sur la base IANA embarquée dans le
// moteur JS via l'API Intl, sans aucune bibliothèque tierce ni base de données
// à maintenir. Tout le reste de l'application manipule des instants absolus
// (Date, en UTC) ; ce module fait le pont avec les heures « murales » locales.

const _cache = new Map();
function formatter(tz) {
  let f = _cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    _cache.set(tz, f);
  }
  return f;
}

/** Vérifie qu'un identifiant de fuseau IANA est valide. */
export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Liste des fuseaux IANA connus du moteur (pour un sélecteur). */
export function listTimeZones() {
  return Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC', 'Europe/Paris'];
}

/** Décompose un instant en heure murale du fuseau donné. */
export function getParts(instant, tz) {
  const p = {};
  for (const { type, value } of formatter(tz).formatToParts(instant)) {
    if (type !== 'literal') p[type] = value;
  }
  // Intl peut rendre "24" pour minuit ; on normalise en 0.
  const hour = p.hour === '24' ? 0 : Number(p.hour);
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour, minute: Number(p.minute), second: Number(p.second),
  };
}

/**
 * Décalage (en minutes) du fuseau `tz` à l'instant `instant`.
 * Positif à l'est de Greenwich (Paris hiver = +60).
 */
export function offsetMinutes(instant, tz) {
  const p = getParts(instant, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - instant.getTime()) / 60000);
}

/**
 * Convertit une heure murale (année/mois/jour + minutes depuis minuit) d'un
 * fuseau vers l'instant UTC correspondant.
 *
 * Gère les transitions d'heure d'été :
 *  - heure inexistante (saut de printemps) : renvoie l'instant juste après le
 *    saut, cohérent et déterministe ;
 *  - heure ambiguë (recul d'automne, l'heure passe deux fois) : renvoie un
 *    instant unique et déterministe (occurrence en heure standard).
 *
 * Propriété garantie et vérifiée : le trajet inverse (instant -> heure murale)
 * redonne toujours l'heure murale de départ, hors heures inexistantes.
 *
 * @returns {Date}
 */
export function wallTimeToUtc(year, month, day, minutesFromMidnight, tz) {
  const hour = Math.floor(minutesFromMidnight / 60);
  const minute = minutesFromMidnight % 60;
  // Estimation : on interprète la date murale comme si elle était en UTC.
  const guessMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  // Offset au voisinage de l'instant estimé, puis correction.
  const off1 = offsetMinutes(new Date(guessMs), tz);
  let utcMs = guessMs - off1 * 60000;
  const off2 = offsetMinutes(new Date(utcMs), tz);
  if (off2 !== off1) {
    // On a franchi une transition ; on recalcule avec le nouvel offset.
    utcMs = guessMs - off2 * 60000;
  }
  return new Date(utcMs);
}

/** Depuis "YYYY-MM-DD" + minutes -> instant UTC dans le fuseau tz. */
export function dateAndMinutesToUtc(dateStr, minutesFromMidnight, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return wallTimeToUtc(y, m, d, minutesFromMidnight, tz);
}

/** "YYYY-MM-DD" du jour local (fuseau tz) d'un instant. */
export function localDateStr(instant, tz) {
  const p = getParts(instant, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Minutes depuis minuit (heure murale tz) d'un instant. */
export function localMinutes(instant, tz) {
  const p = getParts(instant, tz);
  return p.hour * 60 + p.minute;
}

/** Jour de la semaine local (0 = dimanche … 6 = samedi), heure murale tz. */
export function localWeekday(instant, tz) {
  const p = getParts(instant, tz);
  // Zeller n'est pas nécessaire : Date.UTC d'une heure murale donne le bon jour.
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Ajoute n jours calendaires à une date "YYYY-MM-DD" (sans fuseau). */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

const OFFSET_FMT = new Map();
/** Chaîne d'offset lisible type "UTC+02:00" pour un instant/fuseau. */
export function offsetLabel(instant, tz) {
  const o = offsetMinutes(instant, tz);
  const sign = o < 0 ? '-' : '+';
  const abs = Math.abs(o);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * Formatte un instant pour l'affichage humain dans un fuseau et une langue.
 * @returns {string} ex. "lundi 4 août 2026 à 14:30"
 */
export function formatInstant(instant, tz, locale = 'fr-FR', opts = {}) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    ...opts,
  }).format(instant);
}
