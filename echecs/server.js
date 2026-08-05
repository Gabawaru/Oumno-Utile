#!/usr/bin/env node
// Échiquier — serveur statique minimal.
//   PORT  port d'écoute (défaut 3224)   HOST  interface (défaut 127.0.0.1)
//
// Sert l'interface (public/) à la racine et les modules du moteur (src/) sous
// /src, afin que la page ET le Web Worker puissent les importer directement.
// Le moteur tourne intégralement dans le navigateur : aucun calcul côté serveur.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3224);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serve(res, baseDir, rel) {
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(baseDir, safe);
  if (!file.startsWith(baseDir)) { res.writeHead(403); res.end('Interdit'); return true; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
    return true;
  } catch { return false; }
}

export function createApp() {
  return createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/src/')) {
      if (await serve(res, join(ROOT, 'src'), path.slice(5))) return;
    } else {
      const rel = path === '/' ? 'index.html' : path;
      if (await serve(res, join(ROOT, 'public'), rel)) return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Introuvable');
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createApp().listen(PORT, HOST, () => {
    console.log(`Échiquier : http://${HOST}:${PORT}`);
  });
}
