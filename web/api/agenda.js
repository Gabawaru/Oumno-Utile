// Va chercher un agenda ICS et rend ses événements.
//
// Le navigateur ne peut pas le faire lui-même : la politique de sécurité du
// contenu lui interdit de joindre un autre domaine, et c'est une bonne chose.
// Cette route est donc le seul endroit qui sort du domaine — d'où les gardes
// de `_ics.js`, et la vérification de session ci-dessous : on ne prête pas un
// client HTTP à des inconnus.

import { recuperer, lire } from "./_ics.js";

// La clé publiable circule déjà dans chaque navigateur : la répéter ici ne
// révèle rien, et évite une variable de plus à poser pour que ça marche.
const URL_SUPA = process.env.SUPABASE_URL || "https://hnmeefndnckqkdjjbgwe.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY
  || "sb_publishable_ciLHalsy_YvWIUbEbCnN2g_TZfT4aPU";

/** Qui appelle ? On le demande à Supabase plutôt que de lire le jeton nous-mêmes :
 *  vérifier une signature à la main est le genre de code qu'on croit juste. */
async function quiAppelle(jeton) {
  if (!URL_SUPA || !ANON || !jeton) return null;
  try {
    const r = await fetch(`${URL_SUPA}/auth/v1/user`, {
      headers: { apikey: ANON, Authorization: `Bearer ${jeton}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u.id : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Méthode non autorisée" }); return; }
  if (!URL_SUPA || !ANON) {
    res.status(503).json({ error: "SUPABASE_URL ou SUPABASE_ANON_KEY absente" }); return;
  }
  const entete = req.headers.authorization || "";
  const qui = await quiAppelle(entete.startsWith("Bearer ") ? entete.slice(7) : null);
  if (!qui) { res.status(401).json({ error: "Connexion requise" }); return; }

  let corps = req.body;
  if (typeof corps === "string") { try { corps = JSON.parse(corps); } catch { corps = null; } }
  const adresse = corps && typeof corps.adresse === "string" ? corps.adresse.trim() : "";
  if (!adresse) { res.status(400).json({ error: "Adresse manquante" }); return; }
  if (adresse.length > 2000) { res.status(400).json({ error: "Adresse trop longue" }); return; }

  const r = await recuperer(adresse);
  if (!r.ok) { res.status(422).json({ error: r.pourquoi }); return; }

  const { evenements, tronque } = lire(r.texte);
  if (!evenements.length) {
    res.status(422).json({ error: "Aucun événement lisible dans cet agenda." }); return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ evenements, tronque, nombre: evenements.length });
}
