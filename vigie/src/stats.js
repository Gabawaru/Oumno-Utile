// Agrégation des séries temporelles : uptime, percentiles de latence, rollups
// journaliers et données pour la page de statut 90 jours.

const DAY_MS = 86400_000;

const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Percentile (interpolation « nearest-rank ») sur un tableau trié. */
export function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank - 1))];
}

/** Statistiques de latence + uptime sur une fenêtre [from, to] (ms epoch). */
export function windowStats(db, monitorId, from, to) {
  const rows = db.prepare(
    'SELECT up, degraded, latency_ms FROM checks WHERE monitor_id = ? AND ts >= ? AND ts <= ?'
  ).all(monitorId, from, to);
  const total = rows.length;
  const up = rows.filter((r) => r.up).length;
  const degraded = rows.filter((r) => r.degraded).length;
  const lat = rows.filter((r) => r.up && r.latency_ms != null).map((r) => r.latency_ms).sort((a, b) => a - b);
  return {
    total,
    up,
    degraded,
    uptime: total ? up / total : null,
    avg_latency: lat.length ? Math.round(lat.reduce((s, v) => s + v, 0) / lat.length) : null,
    p50: percentile(lat, 50),
    p95: percentile(lat, 95),
    p99: percentile(lat, 99),
    min_latency: lat[0] ?? null,
    max_latency: lat[lat.length - 1] ?? null,
  };
}

/**
 * Agrège un jour de sondes brutes en une ligne daily_stats.
 * `down_seconds` est estimé à partir des incidents recoupant ce jour.
 */
export function rollupDay(db, monitorId, day) {
  const from = Date.parse(day + 'T00:00:00.000Z');
  const to = from + DAY_MS - 1;
  const rows = db.prepare(
    'SELECT up, degraded, latency_ms FROM checks WHERE monitor_id = ? AND ts >= ? AND ts <= ?'
  ).all(monitorId, from, to);
  if (!rows.length) return null;
  const total = rows.length;
  const upCount = rows.filter((r) => r.up).length;
  const degradedCnt = rows.filter((r) => r.degraded).length;
  const lat = rows.filter((r) => r.up && r.latency_ms != null).map((r) => r.latency_ms).sort((a, b) => a - b);
  const avg = lat.length ? Math.round(lat.reduce((s, v) => s + v, 0) / lat.length) : null;
  const p95 = percentile(lat, 95);

  // Secondes d'indisponibilité : somme des intersections des incidents avec le jour.
  const incidents = db.prepare(
    'SELECT started_at, resolved_at FROM incidents WHERE monitor_id = ? AND started_at <= ? AND (resolved_at IS NULL OR resolved_at >= ?)'
  ).all(monitorId, to, from);
  let downMs = 0;
  for (const inc of incidents) {
    const s = Math.max(inc.started_at, from);
    const e = Math.min(inc.resolved_at ?? to, to);
    if (e > s) downMs += e - s;
  }

  db.prepare(
    `INSERT INTO daily_stats (monitor_id, day, total, up_count, degraded_cnt, avg_latency, p95_latency, down_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(monitor_id, day) DO UPDATE SET total=excluded.total, up_count=excluded.up_count,
       degraded_cnt=excluded.degraded_cnt, avg_latency=excluded.avg_latency,
       p95_latency=excluded.p95_latency, down_seconds=excluded.down_seconds`
  ).run(monitorId, day, total, upCount, degradedCnt, avg, p95, Math.round(downMs / 1000));
  return { day, total, up_count: upCount, uptime: upCount / total };
}

/**
 * Historique quotidien sur `days` jours pour la page de statut (barres type
 * « 90 jours »). Combine daily_stats (jours passés) et sondes brutes (jour courant).
 * @returns {Array<{day, uptime|null, down_seconds, has_data}>}  du plus ancien au plus récent
 */
export function uptimeHistory(db, monitorId, days = 90, now = Date.now()) {
  const stats = new Map(
    db.prepare('SELECT * FROM daily_stats WHERE monitor_id = ?').all(monitorId).map((r) => [r.day, r])
  );
  const todayStr = dayStr(now);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayStr(now - i * DAY_MS);
    let row = stats.get(day);
    if (day === todayStr) {
      // Jour courant : calculer en direct depuis les sondes brutes.
      const from = Date.parse(day + 'T00:00:00.000Z');
      const w = windowStats(db, monitorId, from, now);
      if (w.total) row = { total: w.total, up_count: w.up, down_seconds: liveDownSeconds(db, monitorId, from, now) };
    }
    if (row && row.total) {
      out.push({ day, uptime: row.up_count / row.total, down_seconds: row.down_seconds ?? 0, has_data: true });
    } else {
      out.push({ day, uptime: null, down_seconds: 0, has_data: false });
    }
  }
  return out;
}

function liveDownSeconds(db, monitorId, from, to) {
  const incidents = db.prepare(
    'SELECT started_at, resolved_at FROM incidents WHERE monitor_id = ? AND started_at <= ? AND (resolved_at IS NULL OR resolved_at >= ?)'
  ).all(monitorId, to, from);
  let downMs = 0;
  for (const inc of incidents) {
    const s = Math.max(inc.started_at, from);
    const e = Math.min(inc.resolved_at ?? to, to);
    if (e > s) downMs += e - s;
  }
  return Math.round(downMs / 1000);
}

/** Uptime global agrégé sur `days` jours (pondéré par le nombre de sondes). */
export function overallUptime(db, monitorId, days = 90, now = Date.now()) {
  const hist = uptimeHistory(db, monitorId, days, now);
  let up = 0, total = 0;
  // On repondère via daily_stats.total quand dispo pour rester fidèle.
  const stats = new Map(
    db.prepare('SELECT day, total, up_count FROM daily_stats WHERE monitor_id = ?').all(monitorId).map((r) => [r.day, r])
  );
  for (const h of hist) {
    if (!h.has_data) continue;
    const s = stats.get(h.day);
    if (s) { up += s.up_count; total += s.total; }
    else { up += h.uptime; total += 1; } // jour courant live : approx par ratio
  }
  return total ? up / total : null;
}

/** Points de latence pour un graphique, échantillonnés sur une fenêtre. */
export function latencySeries(db, monitorId, from, to, maxPoints = 120) {
  const rows = db.prepare(
    'SELECT ts, up, latency_ms FROM checks WHERE monitor_id = ? AND ts >= ? AND ts <= ? ORDER BY ts'
  ).all(monitorId, from, to);
  if (rows.length <= maxPoints) return rows;
  // Sous-échantillonnage régulier.
  const step = rows.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(rows[Math.floor(i * step)]);
  return out;
}

/**
 * Tâche d'entretien : rollup des jours clos, purge des sondes brutes et des
 * agrégats trop anciens. À appeler périodiquement.
 */
export function maintenance(db, { checkRetentionDays = 7, statsRetentionDays = 90 } = {}, now = Date.now()) {
  const todayStr = dayStr(now);
  const monitors = db.prepare('SELECT id FROM monitors').all();
  // Rollup de tous les jours ayant des sondes mais pas (à jour) dans daily_stats,
  // sauf aujourd'hui (encore en cours).
  for (const m of monitors) {
    const days = db.prepare(
      "SELECT DISTINCT strftime('%Y-%m-%d', ts/1000, 'unixepoch') AS d FROM checks WHERE monitor_id = ?"
    ).all(m.id);
    for (const { d } of days) {
      if (d && d < todayStr) rollupDay(db, m.id, d);
    }
  }
  // Purge des sondes brutes plus vieilles que la rétention.
  const cutCheck = now - checkRetentionDays * DAY_MS;
  db.prepare('DELETE FROM checks WHERE ts < ?').run(cutCheck);
  // Purge des agrégats journaliers trop anciens.
  const cutStats = dayStr(now - statsRetentionDays * DAY_MS);
  db.prepare('DELETE FROM daily_stats WHERE day < ?').run(cutStats);
}
