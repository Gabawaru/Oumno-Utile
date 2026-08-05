// API REST — surface admin (authentifiée) + surface publique (page de statut).

import { randomBytes } from 'node:crypto';
import { getSettings, setSettings, getRawSetting, setRawSetting, audit } from './db.js';
import {
  windowStats, uptimeHistory, overallUptime, latencySeries, rollupDay,
} from './stats.js';
import { uptimeBars, latencyChart, fmtDuration } from './charts.js';
import { setPaused } from './monitor.js';
import { statusMatches } from './probe.js';
import {
  hashPassword, verifyPassword, createSession, destroySession,
  loginAllowed, recordLoginFailure,
} from './auth.js';
import { sendJson, sendBuffer, readBody } from './router.js';

const err = (status, message) => Object.assign(new Error(message), { status });
const s = (v, max = 500) => String(v ?? '').slice(0, max).trim();
const HOUR = 3600_000, DAY = 86400_000;

function sessionCookie(token, req) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `vigie_session=${token}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Strict${secure}`;
}

function monitorFromBody(b, existing = {}) {
  const int = (v, def, min, max) => {
    const n = Number.isFinite(+v) ? Math.round(+v) : def;
    return Math.max(min, Math.min(max, n));
  };
  let url = s(b.url ?? existing.url, 2000);
  // Validation d'URL http(s)
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
  } catch { throw err(400, 'URL invalide (http:// ou https:// requis)'); }
  const method = ['GET', 'HEAD', 'POST'].includes((b.method || existing.method || 'GET').toUpperCase())
    ? (b.method || existing.method || 'GET').toUpperCase() : 'GET';
  const expected = s(b.expected_status ?? existing.expected_status ?? '2xx', 40) || '2xx';
  // valide le format du statut attendu
  if (!expected.split(',').every((r) => /^\d{3}$/.test(r.trim()) || /^\dxx$/i.test(r.trim()))) {
    throw err(400, 'Statut attendu invalide (ex. « 200 », « 2xx », « 2xx,3xx »)');
  }
  return {
    name: s(b.name ?? existing.name, 120) || url,
    url,
    method,
    expected_status: expected,
    keyword: s(b.keyword ?? existing.keyword, 200),
    keyword_absent: s(b.keyword_absent ?? existing.keyword_absent, 200),
    interval_sec: int(b.interval_sec ?? existing.interval_sec, 60, 10, 86400),
    timeout_ms: int(b.timeout_ms ?? existing.timeout_ms, 10000, 500, 120000),
    degraded_ms: int(b.degraded_ms ?? existing.degraded_ms, 0, 0, 120000),
    follow_redirects: (b.follow_redirects ?? existing.follow_redirects ?? 1) ? 1 : 0,
    failure_threshold: int(b.failure_threshold ?? existing.failure_threshold, 2, 1, 20),
    public: (b.public ?? existing.public ?? 1) ? 1 : 0,
  };
}

function monitorPublic(db, m, now) {
  return {
    id: m.id, name: m.name, state: m.state,
    last_latency_ms: m.last_latency_ms,
    uptime_90d: overallUptime(db, m.id, 90, now),
    history: uptimeHistory(db, m.id, 90, now),
  };
}

// Verdict global du système à partir des états des monitors publics.
function systemStatus(monitors) {
  const pub = monitors.filter((m) => m.public);
  if (!pub.length) return { level: 'unknown', label: 'Aucun service supervisé' };
  if (pub.some((m) => m.state === 'down')) return { level: 'down', label: 'Incident en cours' };
  if (pub.some((m) => m.state === 'degraded')) return { level: 'degraded', label: 'Performances dégradées' };
  if (pub.every((m) => m.state === 'up')) return { level: 'up', label: 'Tous les services sont opérationnels' };
  return { level: 'pending', label: 'Vérification en cours…' };
}

export function registerApi(router, db, { scheduler = null } = {}) {
  const S = () => getSettings(db);

  // ---------------------------------------------------------- auth
  router.get('/api/setup-status', (req, res) => sendJson(res, 200, { configured: !!getRawSetting(db, 'auth') }));
  router.post('/api/setup', async (req, res) => {
    if (getRawSetting(db, 'auth')) throw err(409, 'Déjà configuré');
    const body = await readBody(req);
    if (String(body.password || '').length < 8) throw err(400, 'Mot de passe : 8 caractères minimum');
    setRawSetting(db, 'auth', hashPassword(String(body.password)));
    if (body.organization) setSettings(db, { organization: s(body.organization, 120) });
    const token = createSession(db);
    audit(db, 'setup');
    res.setHeader('Set-Cookie', sessionCookie(token, req));
    sendJson(res, 200, { ok: true });
  });
  router.post('/api/login', async (req, res) => {
    const ip = req.socket.remoteAddress || '?';
    if (!loginAllowed(ip)) throw err(429, 'Trop de tentatives, réessayez dans 15 minutes');
    const body = await readBody(req);
    const stored = getRawSetting(db, 'auth');
    if (!stored || !verifyPassword(String(body.password || ''), stored)) {
      recordLoginFailure(ip);
      throw err(401, 'Mot de passe incorrect');
    }
    const token = createSession(db);
    res.setHeader('Set-Cookie', sessionCookie(token, req));
    sendJson(res, 200, { ok: true });
  });
  router.post('/api/logout', (req, res, { cookies }) => {
    destroySession(db, cookies.vigie_session);
    res.setHeader('Set-Cookie', 'vigie_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict');
    sendJson(res, 200, { ok: true });
  });
  router.get('/api/me', (req, res) => sendJson(res, 200, { ok: true }));
  router.post('/api/password', async (req, res) => {
    const body = await readBody(req);
    if (!verifyPassword(String(body.current || ''), getRawSetting(db, 'auth'))) throw err(401, 'Mot de passe actuel incorrect');
    if (String(body.next || '').length < 8) throw err(400, 'Nouveau mot de passe : 8 caractères minimum');
    setRawSetting(db, 'auth', hashPassword(String(body.next)));
    sendJson(res, 200, { ok: true });
  });

  // ---------------------------------------------------------- settings
  router.get('/api/settings', (req, res) => sendJson(res, 200, S()));
  router.put('/api/settings', async (req, res) => {
    setSettings(db, await readBody(req));
    audit(db, 'settings_update');
    sendJson(res, 200, S());
  });

  // ---------------------------------------------------------- monitors (admin)
  router.get('/api/monitors', (req, res) => {
    const now = Date.now();
    const rows = db.prepare('SELECT * FROM monitors ORDER BY position, id').all().map((m) => ({
      ...m,
      uptime_24h: windowStats(db, m.id, now - DAY, now).uptime,
      uptime_7d: overallUptime(db, m.id, 7, now),
    }));
    sendJson(res, 200, rows);
  });

  router.post('/api/monitors', async (req, res) => {
    const data = monitorFromBody(await readBody(req));
    const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM monitors').get().p;
    const info = db.prepare(
      `INSERT INTO monitors (name,url,method,expected_status,keyword,keyword_absent,interval_sec,
        timeout_ms,degraded_ms,follow_redirects,failure_threshold,public,position,created_at)
       VALUES (@name,@url,@method,@expected_status,@keyword,@keyword_absent,@interval_sec,@timeout_ms,
        @degraded_ms,@follow_redirects,@failure_threshold,@public,@position,@created_at)`
    ).run({ ...data, position: pos, created_at: Date.now() });
    audit(db, 'monitor_create', data.url);
    const m = db.prepare('SELECT * FROM monitors WHERE id = ?').get(info.lastInsertRowid);
    // La première sonde est prise en charge par l'ordonnanceur au prochain tick ;
    // l'utilisateur peut aussi la déclencher immédiatement via « Sonder maintenant ».
    sendJson(res, 201, m);
  });

  router.get('/api/monitors/:id', (req, res, { params }) => {
    const now = Date.now();
    const m = db.prepare('SELECT * FROM monitors WHERE id = ?').get(params.id);
    if (!m) throw err(404, 'Monitor introuvable');
    const incidents = db.prepare(
      'SELECT * FROM incidents WHERE monitor_id = ? ORDER BY started_at DESC LIMIT 30'
    ).all(m.id).map((i) => ({ ...i, duration_sec: ((i.resolved_at ?? now) - i.started_at) / 1000 }));
    const recent = db.prepare(
      'SELECT ts, up, degraded, status_code, latency_ms, error FROM checks WHERE monitor_id = ? ORDER BY ts DESC LIMIT 30'
    ).all(m.id);
    sendJson(res, 200, {
      monitor: m,
      stats_24h: windowStats(db, m.id, now - DAY, now),
      uptime_7d: overallUptime(db, m.id, 7, now),
      uptime_30d: overallUptime(db, m.id, 30, now),
      uptime_90d: overallUptime(db, m.id, 90, now),
      history: uptimeHistory(db, m.id, 90, now),
      incidents,
      recent,
    });
  });

  router.put('/api/monitors/:id', async (req, res, { params }) => {
    const existing = db.prepare('SELECT * FROM monitors WHERE id = ?').get(params.id);
    if (!existing) throw err(404, 'Monitor introuvable');
    const data = monitorFromBody(await readBody(req), existing);
    db.prepare(
      `UPDATE monitors SET name=@name,url=@url,method=@method,expected_status=@expected_status,
        keyword=@keyword,keyword_absent=@keyword_absent,interval_sec=@interval_sec,timeout_ms=@timeout_ms,
        degraded_ms=@degraded_ms,follow_redirects=@follow_redirects,failure_threshold=@failure_threshold,
        public=@public WHERE id=@id`
    ).run({ ...data, id: Number(params.id) });
    sendJson(res, 200, db.prepare('SELECT * FROM monitors WHERE id = ?').get(params.id));
  });

  router.delete('/api/monitors/:id', (req, res, { params }) => {
    db.prepare('DELETE FROM monitors WHERE id = ?').run(params.id);
    audit(db, 'monitor_delete', params.id);
    sendJson(res, 200, { deleted: true });
  });

  router.post('/api/monitors/:id/pause', async (req, res, { params }) => {
    const b = await readBody(req);
    setPaused(db, Number(params.id), !!b.paused);
    sendJson(res, 200, db.prepare('SELECT * FROM monitors WHERE id = ?').get(params.id));
  });

  // Sonde immédiate à la demande.
  router.post('/api/monitors/:id/check', async (req, res, { params }) => {
    const m = db.prepare('SELECT * FROM monitors WHERE id = ?').get(params.id);
    if (!m) throw err(404, 'Monitor introuvable');
    if (!scheduler) throw err(503, 'Ordonnanceur indisponible');
    const out = await scheduler.checkOne({ ...m, active: 1 });
    sendJson(res, 200, { result: out?.result || null, monitor: db.prepare('SELECT * FROM monitors WHERE id = ?').get(params.id) });
  });

  // Graphique de latence (SVG) sur une fenêtre (heures).
  router.get('/api/monitors/:id/latency.svg', (req, res, { params, query }) => {
    const hours = Math.max(1, Math.min(720, Number(query.get('hours')) || 24));
    const now = Date.now();
    const pts = latencySeries(db, Number(params.id), now - hours * HOUR, now);
    sendBuffer(res, Buffer.from(latencyChart(pts), 'utf8'), 'image/svg+xml; charset=utf-8');
  });

  // ---------------------------------------------------------- incidents (admin)
  router.get('/api/incidents', (req, res) => {
    const now = Date.now();
    const rows = db.prepare(
      `SELECT i.*, m.name AS monitor_name FROM incidents i JOIN monitors m ON m.id = i.monitor_id
       ORDER BY i.started_at DESC LIMIT 100`
    ).all().map((i) => ({ ...i, duration_sec: ((i.resolved_at ?? now) - i.started_at) / 1000 }));
    sendJson(res, 200, rows);
  });

  // ---------------------------------------------------------- surface PUBLIQUE
  router.get('/api/public/status', (req, res) => {
    const now = Date.now();
    const settings = S();
    const monitors = db.prepare('SELECT * FROM monitors WHERE public = 1 ORDER BY position, id').all();
    const status = systemStatus(monitors);
    const ongoing = db.prepare(
      `SELECT i.*, m.name AS monitor_name FROM incidents i JOIN monitors m ON m.id = i.monitor_id
       WHERE i.resolved_at IS NULL AND m.public = 1 ORDER BY i.started_at DESC`
    ).all().map((i) => ({ ...i, duration_sec: (now - i.started_at) / 1000 }));
    const recent = db.prepare(
      `SELECT i.*, m.name AS monitor_name FROM incidents i JOIN monitors m ON m.id = i.monitor_id
       WHERE i.resolved_at IS NOT NULL AND m.public = 1 AND i.resolved_at > ?
       ORDER BY i.started_at DESC LIMIT 20`
    ).all(now - 90 * DAY).map((i) => ({ ...i, duration_sec: (i.resolved_at - i.started_at) / 1000 }));
    sendJson(res, 200, {
      page_title: settings.page_title,
      page_intro: settings.page_intro,
      organization: settings.organization,
      brand_color: settings.brand_color,
      generated_at: now,
      status,
      monitors: monitors.map((m) => monitorPublic(db, m, now)),
      ongoing_incidents: ongoing,
      recent_incidents: recent,
    });
  });

  // Barres d'uptime publiques (SVG) pour un monitor public.
  router.get('/api/public/monitors/:id/uptime.svg', (req, res, { params }) => {
    const m = db.prepare('SELECT * FROM monitors WHERE id = ? AND public = 1').get(params.id);
    if (!m) throw err(404, 'Introuvable');
    const hist = uptimeHistory(db, m.id, 90);
    sendBuffer(res, Buffer.from(uptimeBars(hist), 'utf8'), 'image/svg+xml; charset=utf-8');
  });

  // Résumé pour le tableau de bord admin.
  router.get('/api/stats', (req, res) => {
    const now = Date.now();
    const monitors = db.prepare('SELECT * FROM monitors').all();
    const up = monitors.filter((m) => m.state === 'up').length;
    const down = monitors.filter((m) => m.state === 'down').length;
    const degraded = monitors.filter((m) => m.state === 'degraded').length;
    const ongoing = db.prepare('SELECT COUNT(*) AS n FROM incidents WHERE resolved_at IS NULL').get().n;
    const incidents24 = db.prepare('SELECT COUNT(*) AS n FROM incidents WHERE started_at > ?').get(now - DAY).n;
    sendJson(res, 200, {
      total: monitors.length, up, down, degraded,
      paused: monitors.filter((m) => m.state === 'paused').length,
      ongoing_incidents: ongoing, incidents_24h: incidents24,
      system: systemStatus(monitors),
    });
  });
}

export { systemStatus };
