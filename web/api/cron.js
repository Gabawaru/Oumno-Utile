// Tâche quotidienne : envoie aux abonnés le récapitulatif des changements
// non encore notifiés, et rappelle de rafraîchir le scan CNED le 1er du mois.
import { db, sendMail, json, configured } from "./_lib.js";

const TZ = "Europe/Paris";
const EXAM = new Date("2027-05-01T00:00:00+02:00");

function parisNow() {
  const p = {};
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date()).forEach((x) => (p[x.type] = x.value));
  return p;
}

export default async function handler(req, res) {
  // Vercel signe l'appel du cron ; on refuse tout déclenchement extérieur.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return json(res, 401, { error: "Non autorisé" });
  }
  if (!configured()) return json(res, 503, { error: "Base non configurée" });

  try {
    const [pending, subs] = await Promise.all([db.pendingJournal(), db.subs()]);
    const p = parisNow();
    const emails = subs.map((s) => s.email);
    const jours = Math.max(0, Math.ceil((EXAM - Date.now()) / 864e5));
    const premierDuMois = p.day === "01";

    if (!pending.length && !premierDuMois) {
      return json(res, 200, { ok: true, sent: 0, note: "rien à signaler" });
    }

    const L = [];
    L.push("Point du jour — BTS CIEL 2A (Gabriel)");
    L.push(`${p.day}/${p.month}/${p.year} · ${jours} jours avant la session 2027`);
    L.push("");

    if (pending.length) {
      L.push(`Changements (${pending.length}) :`);
      pending.forEach((j) => {
        const d = new Date(j.ts).toLocaleDateString("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
        L.push(`  · ${d} — ${j.body}`);
      });
    } else {
      L.push("Aucun changement depuis le dernier point.");
    }

    if (premierDuMois) {
      L.push("");
      L.push("RAPPEL DU MOIS — rafraîchir le scan de l'espace CNED :");
      L.push("  de nouveaux devoirs, corrigés ou sections ont pu être publiés");
      L.push("  depuis le dernier relevé. Relance le scan pour mettre le planning à jour.");
    }

    L.push("");
    L.push(process.env.PUBLIC_URL || "");

    const out = await sendMail(emails, "Point BTS CIEL 2A", L.join("\n"));
    if (out.sent > 0 && pending.length) await db.markNotified(pending.map((j) => j.id));

    return json(res, 200, { ok: true, ...out, changes: pending.length, rappelScan: premierDuMois });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
}
