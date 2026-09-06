// Inscription publique à la lettre d'information ; désinscription réservée au propriétaire.
import { db, isOwner, json, configured } from "./_lib.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export default async function handler(req, res) {
  if (!configured()) return json(res, 503, { error: "Base non configurée" });
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const email = String(body.email || "").trim().toLowerCase();

  if (req.method === "POST") {
    if (!EMAIL.test(email) || email.length > 160) {
      return json(res, 400, { error: "Adresse invalide" });
    }
    try {
      await db.addSub(email);
      await db.addJournal([`nouvelle inscription à la lettre d'information`]);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { error: String(e.message || e) });
    }
  }

  if (req.method === "DELETE") {
    if (!isOwner(req)) return json(res, 403, { error: "Lecture seule" });
    try {
      await db.removeSub(email);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { error: String(e.message || e) });
    }
  }

  res.setHeader("Allow", "POST, DELETE");
  return json(res, 405, { error: "Méthode non autorisée" });
}
