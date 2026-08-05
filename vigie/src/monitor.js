// Enregistrement des sondes et machine à états des incidents.
//
// État d'un monitor à chaque sonde :
//   up        joignable + assertions OK + latence sous le seuil (ou pas de seuil)
//   degraded  joignable + assertions OK mais latence au-dessus du seuil
//   down      injoignable ou assertion en échec
//
// Incident : on ouvre un incident après `failure_threshold` échecs CONSÉCUTIFS,
// daté du premier de ces échecs (le vrai début de la panne). On le résout à la
// première sonde réussie. Un état « degraded » n'ouvre pas d'incident (le
// service répond) mais est visible et historisé.

/**
 * Enregistre une sonde et met à jour l'état + les incidents.
 * @param {object} db
 * @param {object} monitor  ligne monitors (état courant lu avant l'appel)
 * @param {object} result   sortie de probe()
 * @returns {{state:string, incidentOpened:boolean, incidentResolved:boolean}}
 */
export function recordProbe(db, monitor, result) {
  const ts = result.ts;
  const state = result.up ? (result.degraded ? 'degraded' : 'up') : 'down';

  db.prepare(
    `INSERT INTO checks (monitor_id, ts, up, degraded, status_code, latency_ms, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(monitor.id, ts, result.up ? 1 : 0, result.degraded ? 1 : 0,
    result.status_code, result.latency_ms, result.error || '');

  const consecutiveFails = result.up ? 0 : monitor.consecutive_fails + 1;
  const consecutiveOk = result.up ? monitor.consecutive_ok + 1 : 0;

  db.prepare(
    `UPDATE monitors SET state=?, last_checked_at=?, last_latency_ms=?, last_status_code=?,
      last_error=?, consecutive_fails=?, consecutive_ok=? WHERE id=?`
  ).run(state, ts, result.latency_ms, result.status_code, result.error || '',
    consecutiveFails, consecutiveOk, monitor.id);

  let incidentOpened = false;
  let incidentResolved = false;
  const openIncident = db.prepare(
    'SELECT * FROM incidents WHERE monitor_id = ? AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1'
  ).get(monitor.id);

  if (!result.up) {
    const threshold = Math.max(1, monitor.failure_threshold);
    if (!openIncident && consecutiveFails >= threshold) {
      // Début réel = ts du premier échec de la série consécutive.
      const firstFail = db.prepare(
        `SELECT ts FROM checks WHERE monitor_id = ? AND up = 0 AND ts <= ?
         ORDER BY ts DESC LIMIT ?`
      ).all(monitor.id, ts, threshold);
      const startedAt = firstFail.length ? firstFail[firstFail.length - 1].ts : ts;
      db.prepare(
        'INSERT INTO incidents (monitor_id, started_at, cause, checks_failed) VALUES (?, ?, ?, ?)'
      ).run(monitor.id, startedAt, result.error || 'Indisponible', consecutiveFails);
      incidentOpened = true;
    } else if (openIncident) {
      db.prepare('UPDATE incidents SET checks_failed = checks_failed + 1, cause = ? WHERE id = ?')
        .run(result.error || openIncident.cause, openIncident.id);
    }
  } else if (openIncident) {
    db.prepare('UPDATE incidents SET resolved_at = ? WHERE id = ?').run(ts, openIncident.id);
    incidentResolved = true;
  }

  return { state, incidentOpened, incidentResolved };
}

/** Passe un monitor en pause (aucune sonde) ou le réactive. */
export function setPaused(db, monitorId, paused) {
  if (paused) {
    db.prepare("UPDATE monitors SET active = 0, state = 'paused' WHERE id = ?").run(monitorId);
  } else {
    db.prepare("UPDATE monitors SET active = 1, state = 'pending' WHERE id = ?").run(monitorId);
  }
}
