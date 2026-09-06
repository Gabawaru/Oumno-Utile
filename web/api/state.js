// GET  : lecture publique du planning, du journal et du nombre d'abonnés.
// POST : écriture réservée au propriétaire (cookie de session).
import { db, isOwner, json, configured } from "./_lib.js";

export default async function handler(req, res) {
  if (!configured()) return json(res, 503, { error: "Base non configurée" });
  const owner = isOwner(req);

  if (req.method === "GET") {
    try {
      const [state, journal, subs] = await Promise.all([db.getState(), db.journal(), db.subs()]);
      return json(res, 200, {
        data: state.data || {},
        updatedAt: state.updated_at,
        journal: journal.map((j) => ({ ts: j.ts, text: j.body })),
        subs: owner ? subs.map((s) => s.email) : [],
        subCount: subs.length,
        owner,
      });
    } catch (e) {
      return json(res, 500, { error: String(e.message || e) });
    }
  }

  if (req.method === "POST") {
    if (!owner) return json(res, 403, { error: "Lecture seule" });
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      if (body.data && typeof body.data === "object") await db.putState(body.data);
      const lines = Array.isArray(body.log) ? body.log.filter((l) => typeof l === "string").slice(0, 40) : [];
      if (lines.length) await db.addJournal(lines);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { error: String(e.message || e) });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return json(res, 405, { error: "Méthode non autorisée" });
}
