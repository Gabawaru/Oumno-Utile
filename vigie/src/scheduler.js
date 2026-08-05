// Ordonnanceur en tâche de fond : sonde chaque monitor à son intervalle, de
// façon non bloquante et sans chevauchement (un monitor n'est jamais sondé deux
// fois en parallèle). Persiste naturellement puisque la « dernière sonde » est
// stockée en base : au redémarrage, tout monitor dû est immédiatement repris.

import { probe } from './probe.js';
import { recordProbe } from './monitor.js';
import { maintenance } from './stats.js';
import { getSettings } from './db.js';

export class Scheduler {
  constructor(db, { tickMs = 5000, concurrency = 8, onEvent = null } = {}) {
    this.db = db;
    this.tickMs = tickMs;
    this.concurrency = concurrency;
    this.onEvent = onEvent;           // callback(evt) optionnel (incidents…)
    this.inFlight = new Set();        // ids en cours de sonde
    this.timer = null;
    this.maintTimer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), this.tickMs);
    if (this.timer.unref) this.timer.unref();
    // Entretien horaire (rollups + purge).
    this.maintTimer = setInterval(() => this.runMaintenance(), 3600_000);
    if (this.maintTimer.unref) this.maintTimer.unref();
    this.tick().catch(() => {});
  }

  stop() {
    clearInterval(this.timer); this.timer = null;
    clearInterval(this.maintTimer); this.maintTimer = null;
  }

  /** Liste les monitors dus à sonder maintenant. */
  dueMonitors(now = Date.now()) {
    return this.db.prepare(
      `SELECT * FROM monitors WHERE active = 1
       AND (last_checked_at IS NULL OR last_checked_at + interval_sec * 1000 <= ?)`
    ).all(now).filter((m) => !this.inFlight.has(m.id));
  }

  /** Un passage : sonde les monitors dus, dans la limite de concurrence. */
  async tick(now = Date.now()) {
    const due = this.dueMonitors(now).slice(0, this.concurrency);
    await Promise.all(due.map((m) => this.checkOne(m)));
  }

  /** Sonde un monitor précis et enregistre le résultat. */
  async checkOne(monitor) {
    if (this.inFlight.has(monitor.id)) return null;
    this.inFlight.add(monitor.id);
    try {
      const fresh = this.db.prepare('SELECT * FROM monitors WHERE id = ?').get(monitor.id);
      if (!fresh || !fresh.active) return null;
      const result = await probe(fresh);
      const evt = recordProbe(this.db, fresh, result);
      if (this.onEvent && (evt.incidentOpened || evt.incidentResolved)) {
        this.onEvent({ monitor: fresh, ...evt, result });
      }
      return { result, evt };
    } finally {
      this.inFlight.delete(monitor.id);
    }
  }

  runMaintenance() {
    try {
      const s = getSettings(this.db);
      maintenance(this.db, { checkRetentionDays: s.check_retention_days, statsRetentionDays: s.stats_retention_days });
    } catch { /* l'entretien ne doit jamais interrompre le service */ }
  }
}
