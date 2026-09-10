// Envoie les notifications en attente. Appelée par le cron de Vercel, ou à la
// main avec le même secret.
//
// La règle de conduite est dans `a_pousser()`, en base : cette route ne décide
// rien, elle chiffre et elle poste. Un appareil que le service déclare mort est
// effacé plutôt que réessayé toutes les heures jusqu'à la fin des temps.

import { pousser } from "./_push.js";

const URL_SUPA = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;

async function rest(chemin, init = {}) {
  const r = await fetch(`${URL_SUPA}/rest/v1/${chemin}`, {
    ...init,
    headers: {
      apikey: SERVICE, Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json", ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status} : ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}
const rpc = (nom, corps = {}) =>
  rest(`rpc/${nom}`, { method: "POST", body: JSON.stringify(corps) });

export default async function handler(req, res) {
  // Deux appelants légitimes : le planificateur de Vercel, avec le secret qu'il
  // pose lui-même, et celui de Supabase — qui, lui, peut tourner plus souvent
  // qu'une fois par jour. Une notification qui arrive le lendemain n'en est plus une.
  const secrets = [process.env.PUSH_SECRET, process.env.CRON_SECRET].filter(Boolean);
  const donne = req.headers.authorization || "";
  if (secrets.length && !secrets.some((s) => donne === `Bearer ${s}`)) {
    res.status(401).json({ error: "Non autorisé" });
    return;
  }
  const vapid = {
    publique: process.env.VAPID_PUBLIC,
    privee: process.env.VAPID_PRIVATE,
    sujet: process.env.VAPID_SUBJECT || "mailto:contact@example.org",
  };
  if (!URL_SUPA || !SERVICE) {
    res.status(503).json({ error: "SUPABASE_URL ou SUPABASE_SERVICE_KEY absente" });
    return;
  }
  if (!vapid.publique || !vapid.privee) {
    res.status(503).json({ error: "VAPID_PUBLIC ou VAPID_PRIVATE absente" });
    return;
  }

  try {
    const attente = await rpc("a_pousser");
    if (!attente.length) {
      res.status(200).json({ ok: true, envoyes: 0, note: "rien à annoncer" });
      return;
    }

    // Un seul message par personne : cinq notifications d'un coup, c'est du bruit,
    // et c'est ainsi qu'on se fait couper le son pour de bon.
    const parPersonne = new Map();
    for (const x of attente) {
      const d = parPersonne.get(x.pour) || { items: [], jusqua: x.jusqua };
      d.items.push(x);
      if (x.jusqua > d.jusqua) d.jusqua = x.jusqua;
      parPersonne.set(x.pour, d);
    }

    const bilan = { personnes: 0, envoyes: 0, perimes: 0, echecs: 0 };
    for (const [qui, d] of parPersonne) {
      const appareils = await rest(
        `ciel_push?select=endpoint,p256dh,auth&user_id=eq.${qui}`);
      if (!appareils.length) continue;

      const seul = d.items.length === 1;
      const charge = seul
        ? { titre: d.items[0].titre, corps: d.items[0].corps, lien: d.items[0].lien }
        : { titre: "Du nouveau sur Repère",
            corps: d.items.map((i) => i.titre).join(" · ").slice(0, 120),
            lien: "#/nouveautes" };

      let unSucces = false;
      for (const a of appareils) {
        const r = await pousser(a, charge, vapid);
        if (r.ok) { bilan.envoyes++; unSucces = true; }
        else if (r.perime) { bilan.perimes++; await rpc("oublier_appareil", { pt: a.endpoint }); }
        else bilan.echecs++;
      }
      // La borne n'avance que si quelqu'un a reçu : sinon la nouvelle serait
      // perdue sans que personne ne l'ait jamais vue.
      if (unSucces) { await rpc("marquer_pousse", { qui, borne: d.jusqua }); bilan.personnes++; }
    }

    res.status(200).json({ ok: true, ...bilan });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
