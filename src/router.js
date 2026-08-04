// Micro-routeur HTTP zéro dépendance : routes paramétrées (:id), corps JSON
// borné, fichiers statiques avec types MIME, helpers de réponse et cookies.

import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

const MAX_BODY = 1_000_000; // 1 Mo

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const regex = new RegExp(
      '^' + pattern.replace(/:[^/]+/g, (m) => (keys.push(m.slice(1)), '([^/]+)')) + '$'
    );
    this.routes.push({ method, regex, keys, handler });
  }

  get(p, h) { this.add('GET', p, h); }
  post(p, h) { this.add('POST', p, h); }
  put(p, h) { this.add('PUT', p, h); }
  delete(p, h) { this.add('DELETE', p, h); }

  match(method, path) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.regex.exec(path);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { handler: r.handler, params };
      }
    }
    return null;
  }
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

export function sendBuffer(res, buf, contentType, filename = null) {
  const headers = { 'Content-Type': contentType, 'Content-Length': buf.length, 'Cache-Control': 'no-store' };
  if (filename) {
    headers['Content-Disposition'] = `inline; filename="${filename.replace(/[^\w.\-]/g, '_')}"`;
  }
  res.writeHead(200, headers);
  res.end(buf);
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Corps de requête trop volumineux'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON invalide'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export async function serveStatic(res, publicDir, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(publicDir, safe);
  if (!file.startsWith(publicDir)) return false;
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Content-Length': data.length,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}
