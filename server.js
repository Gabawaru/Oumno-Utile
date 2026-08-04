#!/usr/bin/env node
// Facturier — point d'entrée.
//   FACTURIER_DATA  chemin du fichier SQLite   (défaut : ./data/facturier.db)
//   PORT            port d'écoute              (défaut : 3131)
//   HOST            interface d'écoute         (défaut : 127.0.0.1)
//
// Sécurité : par défaut le serveur n'écoute qu'en local. Pour l'exposer,
// placez-le derrière un reverse proxy TLS (Caddy, nginx…) et passez
// HOST=0.0.0.0 explicitement.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { openDb } from './src/db.js';
import { Router, sendError, serveStatic, parseCookies } from './src/router.js';
import { registerApi } from './src/api.js';
import { checkSession } from './src/auth.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_PATH = resolve(process.env.FACTURIER_DATA || join(ROOT, 'data', 'facturier.db'));
const PORT = Number(process.env.PORT || 3131);
const HOST = process.env.HOST || '127.0.0.1';

// Routes accessibles sans session
const PUBLIC_API = new Set(['/api/setup-status', '/api/setup', '/api/login']);

export function createApp(dbPath = DATA_PATH) {
  const db = openDb(dbPath);
  process.env.FACTURIER_DATA = dbPath;
  const router = new Router();
  registerApi(router, db);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    try {
      if (path.startsWith('/api/')) {
        const cookies = parseCookies(req);
        if (!PUBLIC_API.has(path) && !checkSession(db, cookies.facturier_session)) {
          return sendError(res, 401, 'Authentification requise');
        }
        // Anti-CSRF : les mutations exigent un en-tête custom (impossible à
        // forger cross-site sans CORS), en plus du cookie SameSite=Strict.
        if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') {
          return sendError(res, 403, 'Requête refusée (en-tête anti-CSRF absent)');
        }
        const match = router.match(req.method, path);
        if (!match) return sendError(res, 404, 'Route inconnue');
        await match.handler(req, res, { params: match.params, query: url.searchParams, cookies });
        return;
      }
      if (await serveStatic(res, PUBLIC_DIR, path)) return;
      // SPA : toute autre route sert l'index
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
    console.log(`Facturier démarré : http://${HOST}:${PORT}`);
    console.log(`Base de données : ${DATA_PATH}`);
  });
}
