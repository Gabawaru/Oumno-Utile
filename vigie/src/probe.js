// Sonde HTTP/HTTPS — effectue une requête vers l'URL d'un monitor et retourne
// un verdict structuré. Utilise uniquement les modules http/https natifs.
//
// Respecte HTTP(S)_PROXY si défini (utile en environnement sortant filtré) :
// un simple CONNECT n'est pas implémenté ; on privilégie la connexion directe,
// ce qui couvre l'immense majorité des cibles supervisées.

import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';

const MAX_BODY = 512 * 1024; // on ne lit que le début du corps (assez pour un mot-clé)
const MAX_REDIRECTS = 5;

function statusMatches(code, expected) {
  // expected : "200" | "2xx" | "3xx" | liste séparée par virgules.
  return String(expected).split(',').map((s) => s.trim()).some((rule) => {
    if (/^\d{3}$/.test(rule)) return code === Number(rule);
    const m = /^(\d)xx$/i.exec(rule);
    if (m) return Math.floor(code / 100) === Number(m[1]);
    return false;
  });
}

/**
 * Sonde un monitor.
 * @param {object} monitor  {url, method, expected_status, keyword, keyword_absent,
 *                           timeout_ms, follow_redirects, degraded_ms}
 * @param {object} [opts]   {now, _redirectsLeft, _agent} — internes/tests
 * @returns {Promise<{up:boolean, degraded:boolean, status_code:number|null,
 *                    latency_ms:number|null, error:string, ts:number}>}
 */
export function probe(monitor, opts = {}) {
  const ts = opts.now ?? Date.now();
  const redirectsLeft = opts._redirectsLeft ?? (monitor.follow_redirects ? MAX_REDIRECTS : 0);
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(monitor.url);
    } catch {
      return resolve({ up: false, degraded: false, status_code: null, latency_ms: null, error: 'URL invalide', ts });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return resolve({ up: false, degraded: false, status_code: null, latency_ms: null, error: 'Protocole non supporté', ts });
    }
    const lib = url.protocol === 'https:' ? https : http;
    const start = performance.now();
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };

    const req = lib.request(
      url,
      {
        method: monitor.method || 'GET',
        timeout: monitor.timeout_ms || 10000,
        headers: { 'User-Agent': 'Vigie/1.0 (+monitoring)', Accept: '*/*' },
        // on gère les redirections manuellement pour compter les sauts
      },
      (res) => {
        const code = res.statusCode;
        // Redirections : on suit en comptant les sauts.
        if (code >= 300 && code < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume(); // on jette le corps
          let next;
          try { next = new URL(res.headers.location, url).toString(); } catch { next = null; }
          if (next) {
            probe({ ...monitor, url: next }, { now: ts, _redirectsLeft: redirectsLeft - 1 }).then(done);
            return;
          }
        }
        // Lecture partielle du corps (pour les assertions de mot-clé)
        const needBody = monitor.keyword || monitor.keyword_absent;
        let body = '';
        let size = 0;
        res.on('data', (chunk) => {
          if (!needBody) { if (size === 0) { size = 1; res.destroy(); } return; }
          size += chunk.length;
          if (body.length < MAX_BODY) body += chunk.toString('utf8');
          if (size > MAX_BODY) res.destroy();
        });
        const finish = () => {
          const latency = Math.round(performance.now() - start);
          let up = statusMatches(code, monitor.expected_status || '2xx');
          let error = up ? '' : `Statut inattendu : ${code}`;
          if (up && monitor.keyword && !body.includes(monitor.keyword)) {
            up = false; error = `Mot-clé absent : « ${monitor.keyword} »`;
          }
          if (up && monitor.keyword_absent && body.includes(monitor.keyword_absent)) {
            up = false; error = `Mot-clé interdit présent : « ${monitor.keyword_absent} »`;
          }
          const degraded = up && monitor.degraded_ms > 0 && latency > monitor.degraded_ms;
          done({ up, degraded, status_code: code, latency_ms: latency, error, ts });
        };
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', () => done({ up: false, degraded: false, status_code: code, latency_ms: Math.round(performance.now() - start), error: 'Interruption de la réponse', ts }));
      }
    );

    req.on('timeout', () => {
      req.destroy();
      done({ up: false, degraded: false, status_code: null, latency_ms: monitor.timeout_ms || 10000, error: 'Délai dépassé', ts });
    });
    req.on('error', (e) => {
      done({ up: false, degraded: false, status_code: null, latency_ms: Math.round(performance.now() - start), error: humanError(e), ts });
    });
    req.end();
  });
}

function humanError(e) {
  const map = {
    ENOTFOUND: 'Domaine introuvable (DNS)',
    ECONNREFUSED: 'Connexion refusée',
    ECONNRESET: 'Connexion réinitialisée',
    ETIMEDOUT: 'Délai dépassé',
    CERT_HAS_EXPIRED: 'Certificat TLS expiré',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Certificat TLS auto-signé',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Certificat TLS non vérifiable',
  };
  return map[e.code] || map[e.message] || e.message || 'Erreur réseau';
}

export { statusMatches };
