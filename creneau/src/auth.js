// Authentification mono-utilisateur (l'indépendant) : mot de passe haché
// scrypt (sel aléatoire, comparaison à temps constant), sessions opaques
// stockées hachées en base, cookie HttpOnly + SameSite=Strict.

import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const tokenHash = (t) => createHash('sha256').update(t).digest('hex');

export function createSession(db) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').run(tokenHash(token), expires);
  // ménage opportuniste des sessions expirées
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  return token;
}

export function checkSession(db, token) {
  if (!token) return false;
  const row = db
    .prepare("SELECT 1 AS ok FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')")
    .get(tokenHash(token));
  return !!row;
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

// Anti force-brute simple : 8 essais / 15 min par IP, en mémoire.
const attempts = new Map();
export function loginAllowed(ip) {
  const now = Date.now();
  const a = attempts.get(ip) || [];
  const recent = a.filter((t) => now - t < 15 * 60_000);
  attempts.set(ip, recent);
  return recent.length < 8;
}
export function recordLoginFailure(ip) {
  const a = attempts.get(ip) || [];
  a.push(Date.now());
  attempts.set(ip, a);
}
