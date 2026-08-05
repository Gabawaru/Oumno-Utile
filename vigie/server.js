#!/usr/bin/env node
// Vigie — point d'entrée.
//   VIGIE_DATA  chemin du fichier SQLite   (défaut : ./data/vigie.db)
//   PORT        port d'écoute              (défaut : 3223)
//   HOST        interface d'écoute         (défaut : 127.0.0.1)
//
// Deux surfaces :
//   - /api/public/*  : page de statut publique, SANS authentification ;
//   - le reste /api/* : console d'administration (session requise).
// L'ordonnanceur de sondes démarre avec le serveur.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { openDb } from './src/db.js';
import { Router, sendError, serveStatic, parseCookies } from './src/router.js';
import { registerApi } from './src/api.js';
import { Scheduler } from './src/scheduler.js';
import { checkSession } from './src/auth.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_PATH = resolve(process.env.VIGIE_DATA || join(ROOT, 'data', 'vigie.db'));
const PORT = Number(process.env.PORT || 3223);
const HOST = process.env.HOST || '127.0.0.1';

const PUBLIC_PREFIXES = ['/api/public/'];
const PUBLIC_EXACT = new Set(['/api/setup-status', '/api/setup', '/api/login']);
const isPublicApi = (p) => PUBLIC_EXACT.has(p) || PUBLIC_PREFIXES.some((x) => p.startsWith(x));

// startScheduler est conservé pour compat, mais l'ordonnanceur doit être
// démarré APRÈS server.listen() (sinon la première sonde d'un monitor
// auto-référencé part avant que le serveur n'écoute). Les points d'entrée
// ci-dessous appellent scheduler.start() dans le callback de listen().
export function createApp(dbPath = DATA_PATH, { startScheduler = false } = {}) {
  const db = openDb(dbPath);
  process.env.VIGIE_DATA = dbPath;
  const scheduler = new Scheduler(db);
  const router = new Router();
  registerApi(router, db, { scheduler });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    try {
      if (path.startsWith('/api/')) {
        const cookies = parseCookies(req);
        if (!isPublicApi(path) && !checkSession(db, cookies.vigie_session)) {
          return sendError(res, 401, 'Authentification requise');
        }
        if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') {
          return sendError(res, 403, 'Requête refusée (en-tête anti-CSRF absent)');
        }
        const match = router.match(req.method, path);
        if (!match) return sendError(res, 404, 'Route inconnue');
        await match.handler(req, res, { params: match.params, query: url.searchParams, cookies });
        return;
      }
      if (await serveStatic(res, PUBLIC_DIR, path)) return;
      await serveStatic(res, PUBLIC_DIR, '/');
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      if (!res.headersSent) sendError(res, status, e.status ? e.message : 'Erreur interne');
      else res.end();
    }
  });

  return { server, db, scheduler };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, scheduler } = createApp(DATA_PATH);
  server.listen(PORT, HOST, () => {
    scheduler.start(); // après listen : les monitors auto-référencés répondent
    console.log(`Vigie démarré : http://${HOST}:${PORT}`);
    console.log(`Page de statut : http://${HOST}:${PORT}/`);
    console.log(`Console admin : http://${HOST}:${PORT}/#/admin`);
    console.log(`Base de données : ${DATA_PATH}`);
  });
}
