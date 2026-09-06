// Ouverture et fermeture de la session propriétaire.
import { mintToken, setCookie, json, isOwner } from "./_lib.js";
import crypto from "node:crypto";

export default async function handler(req, res) {
  if (req.method === "DELETE") {
    setCookie(res, "", 0);
    return json(res, 200, { owner: false });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, DELETE");
    return json(res, 405, { error: "Méthode non autorisée" });
  }

  const expected = process.env.OWNER_PASSCODE || "";
  const secret = process.env.AUTH_SECRET || "";
  if (!expected || !secret) {
    return json(res, 503, { error: "Connexion non configurée sur ce déploiement" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const given = String(body.code || "");
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    // légère temporisation contre le test exhaustif
    await new Promise((r) => setTimeout(r, 600));
    return json(res, 401, { error: "Code incorrect" });
  }

  setCookie(res, mintToken());
  return json(res, 200, { owner: true });
}
