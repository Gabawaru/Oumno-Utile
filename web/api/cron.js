// Tâche quotidienne : pour chaque profil, envoie à ses abonnés le récapitulatif
// des changements non encore notifiés. Le 1er du mois, rappelle en plus de
// rafraîchir le scan de l'espace CNED.
//
// Le navigateur parle directement à Supabase ; cette route est le seul endroit
// qui a besoin de privilèges élevés, pour lire les adresses des abonnés.

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
const TZ = "Europe/Paris";
const EXAM = new Date("2027-05-01T00:00:00+02:00");

async function rest(chemin, init = {}) {
  const r = await fetch(`${URL}/rest/v1/${chemin}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status} : ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

async function envoyer(destinataires, sujet, texte) {
  const cle = process.env.RESEND_API_KEY;
  const de = process.env.MAIL_FROM || "Pilote CIEL <onboarding@resend.dev>";
  if (!cle) return { envoyes: 0, ignore: "RESEND_API_KEY absente" };
  if (!destinataires.length) return { envoyes: 0, ignore: "aucun abonné" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: de, to: de, bcc: destinataires, subject: sujet, text: texte }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status} : ${await r.text()}`);
  return { envoyes: destinataires.length };
}

function dateParis() {
  const p = {};
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).forEach((x) => (p[x.type] = x.value));
  return p;
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Non autorisé" });
    return;
  }
  if (!URL || !SERVICE) {
    res.status(503).json({ error: "SUPABASE_URL ou SUPABASE_SERVICE_KEY absente" });
    return;
  }

  try {
    const p = dateParis();
    const premierDuMois = p.day === "01";
    const jours = Math.max(0, Math.ceil((EXAM - Date.now()) / 864e5));
    const base = process.env.PUBLIC_URL || "";

    const profils = await rest("ciel_profiles?select=id,slug,nom");
    const bilan = [];

    for (const profil of profils) {
      const attente = await rest(
        `ciel_journal?select=id,ts,body&user_id=eq.${profil.id}&notified=is.false&order=ts.asc&limit=200`
      );
      if (!attente.length && !premierDuMois) continue;

      const abonnes = (
        await rest(`ciel_subs?select=email&user_id=eq.${profil.id}&actif=is.true`)
      ).map((a) => a.email);
      if (!abonnes.length) continue;

      const L = [];
      L.push(`Point du jour — planning de ${profil.nom}`);
      L.push(`${p.day}/${p.month}/${p.year} · ${jours} jours avant la session 2027`);
      L.push("");
      if (attente.length) {
        L.push(`Changements (${attente.length}) :`);
        for (const j of attente) {
          const d = new Date(j.ts).toLocaleDateString("fr-FR", {
            timeZone: TZ, day: "2-digit", month: "2-digit",
          });
          L.push(`  · ${d} — ${j.body}`);
        }
      } else {
        L.push("Aucun changement depuis le dernier point.");
      }
      if (premierDuMois) {
        L.push("");
        L.push("RAPPEL DU MOIS — rafraîchir le scan de l'espace CNED :");
        L.push("  de nouveaux devoirs, corrigés ou sections ont pu y être publiés.");
      }
      if (base) {
        L.push("");
        L.push(`${base}?profil=${profil.slug}`);
      }

      const out = await envoyer(abonnes, `Point — planning de ${profil.nom}`, L.join("\n"));
      if (out.envoyes > 0 && attente.length) {
        await rest(`ciel_journal?id=in.(${attente.map((j) => j.id).join(",")})`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ notified: true }),
        });
      }
      bilan.push({ profil: profil.slug, changements: attente.length, ...out });
    }

    res.status(200).json({ ok: true, rappelScan: premierDuMois, profils: bilan });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
