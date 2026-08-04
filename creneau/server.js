#!/usr/bin/env node
// Créneau — point d'entrée.
//   CRENEAU_DATA  chemin du fichier SQLite   (défaut : ./data/creneau.db)
//   PORT          port d'écoute              (défaut : 3222)
//   HOST          interface d'écoute         (défaut : 127.0.0.1)
//
// Deux surfaces d'API :
//   - /api/public/*  : consultée par la page de réservation, SANS authentification ;
//   - le reste /api/* : réservé à l'organisateur (session requise).
//
// Sécurité : écoute locale par défaut. Pour exposer la page de réservation,
// placez le service derrière un reverse proxy TLS et fixez HOST=0.0.0.0.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { openDb } from './src/db.js';
import { Router, sendError, serveStatic, parseCookies } from './src/router.js';
import { registerApi } from './src/api.js';
import { checkSession } from './src/auth.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_PATH = resolve(process.env.CRENEAU_DATA || join(ROOT, 'data', 'creneau.db'));
const PORT = Number(process.env.PORT || 3222);
const HOST = process.env.HOST || '127.0.0.1';

// Routes d'API accessibles sans session.
const PUBLIC_PREFIXES = ['/api/public/'];
const PUBLIC_EXACT = new Set(['/api/setup-status', '/api/setup', '/api/login']);
const isPublicApi = (path) =>
  PUBLIC_EXACT.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));

export function createApp(dbPath = DATA_PATH) {
  const db = openDb(dbPath);
  process.env.CRENEAU_DATA = dbPath;
  const router = new Router();
  registerApi(router, db);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    try {
      if (path.startsWith('/api/')) {
        const cookies = parseCookies(req);
        const isPublic = isPublicApi(path);
        if (!isPublic && !checkSession(db, cookies.creneau_session)) {
          return sendError(res, 401, 'Authentification requise');
        }
        // Anti-CSRF sur les mutations (en complément de SameSite=Strict).
        // La réservation publique en fait aussi partie : la page l'ajoute.
        if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') {
          return sendError(res, 403, 'Requête refusée (en-tête anti-CSRF absent)');
        }
        const match = router.match(req.method, path);
        if (!match) return sendError(res, 404, 'Route inconnue');
        await match.handler(req, res, { params: match.params, query: url.searchParams, cookies });
        return;
      }
      if (await serveStatic(res, PUBLIC_DIR, path)) return;
      // SPA : toute autre route sert l'index (routage côté client).
      await serveStatic(res, PUBLIC_DIR, '/');
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      if (!res.headersSent) sendError(res, status, e.status ? e.message : 'Erreur interne');
      else res.end();
    }
  });

  return { server, db };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createApp();
  server.listen(PORT, HOST, () => {
    console.log(`Créneau démarré : http://${HOST}:${PORT}`);
    console.log(`Page de réservation : http://${HOST}:${PORT}/`);
    console.log(`Console admin : http://${HOST}:${PORT}/#/admin`);
    console.log(`Base de données : ${DATA_PATH}`);
  });
}
