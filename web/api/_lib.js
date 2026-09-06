// Accès Supabase et authentification propriétaire.
// La clé Supabase reste côté serveur : elle n'est jamais envoyée au navigateur.
import crypto from "node:crypto";

const URL = process.env.SUPABASE_URL;
// Clé publique : lecture du planning et inscription à la lettre uniquement.
const ANON = process.env.SUPABASE_KEY;
// Clé de service : seule habilitée à écrire. Reste dans Vercel, jamais dans le dépôt.
const SERVICE = process.env.SUPABASE_SERVICE_KEY;

export function configured() {
  return Boolean(URL && ANON);
}
export function canWrite() {
  return Boolean(URL && SERVICE);
}

async function rest(path, init = {}, write = false) {
  if (!configured()) throw new Error("Supabase non configuré");
  if (write && !SERVICE) throw new Error("SUPABASE_SERVICE_KEY absente : écriture impossible");
  const key = write ? SERVICE : ANON;
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} : ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

export const db = {
  async getState() {
    const rows = await rest("ciel_state?id=eq.main&select=data,updated_at");
    return rows[0] || { data: {}, updated_at: null };
  },
  async putState(data) {
    await rest("ciel_state?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ id: "main", data, updated_at: new Date().toISOString() }]),
    }, true);
  },
  async journal(limit = 120) {
    return rest(`ciel_journal?select=id,ts,body&order=ts.desc&limit=${limit}`);
  },
  async addJournal(lines) {
    if (!lines.length) return;
    await rest("ciel_journal", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(lines.map((body) => ({ body }))),
    }, true);
  },
  async pendingJournal() {
    return rest("ciel_journal?select=id,ts,body&notified=is.false&order=ts.asc&limit=200", {}, true);
  },
  async markNotified(ids) {
    if (!ids.length) return;
    await rest(`ciel_journal?id=in.(${ids.join(",")})`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ notified: true }),
    }, true);
  },
  // Les adresses ne sont lisibles qu'avec la clé de service : pas de moissonnage.
  async subs() {
    if (!SERVICE) return [];
    return rest("ciel_subs?select=email&active=is.true&order=created_at.asc", {}, true);
  },
  // Inscription publique : passe par la clé anon, seule insertion autorisée.
  async addSub(email) {
    await rest("ciel_subs?on_conflict=email", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ email, active: true }]),
    });
  },
  async removeSub(email) {
    await rest(`ciel_subs?email=eq.${encodeURIComponent(email)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ active: false }),
    }, true);
  },
};

/* ── session propriétaire ───────────────────────────────── */
const SECRET = process.env.AUTH_SECRET || "";
const MAX_AGE = 60 * 60 * 24 * 120; // 120 jours

export function mintToken() {
  const exp = Date.now() + MAX_AGE * 1000;
  const sig = crypto.createHmac("sha256", SECRET).update(`owner.${exp}`).digest("hex");
  return `${exp}.${sig}`;
}

export function validToken(tok) {
  if (!SECRET || !tok) return false;
  const [exp, sig] = String(tok).split(".");
  if (!exp || !sig || Date.now() > Number(exp)) return false;
  const want = crypto.createHmac("sha256", SECRET).update(`owner.${exp}`).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function isOwner(req) {
  const raw = req.headers.cookie || "";
  const hit = raw.split(";").map((c) => c.trim()).find((c) => c.startsWith("ciel_owner="));
  return hit ? validToken(decodeURIComponent(hit.slice("ciel_owner=".length))) : false;
}

export function setCookie(res, value, maxAge = MAX_AGE) {
  res.setHeader(
    "Set-Cookie",
    `ciel_owner=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
  );
}

/* ── courriel (Resend) ──────────────────────────────────── */
export async function sendMail(to, subject, text) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || "Pilote CIEL <onboarding@resend.dev>";
  if (!key) return { sent: 0, skipped: "RESEND_API_KEY absente" };
  if (!to.length) return { sent: 0, skipped: "aucun destinataire" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: from, bcc: to, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status} : ${await res.text()}`);
  return { sent: to.length };
}

export function json(res, code, body) {
  res.status(code).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
