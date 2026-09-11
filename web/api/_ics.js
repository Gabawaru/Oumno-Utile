// Récupération et lecture d'un agenda ICS (RFC 5545).
//
// Aller chercher une adresse fournie par quelqu'un d'autre, depuis le serveur,
// c'est le manuel de la falsification de requête côté serveur : sans garde, on
// offre à n'importe qui un client HTTP à l'intérieur du réseau de l'hébergeur —
// y compris le service de métadonnées du nuage, sur 169.254.169.254, qui rend
// des jetons d'accès. Tout ce fichier tourne autour de ce risque.

import { lookup } from "node:dns/promises";

export const TAILLE_MAX = 2 * 1024 * 1024;   // 2 Mo : un an d'emploi du temps en pèse 100 Ko
export const DELAI = 12000;
const SAUTS_MAX = 3;

/** Adresses qu'on ne sort jamais chercher : elles ne mènent qu'à nous-mêmes. */
function priveeIPv4(ip) {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = o;
  return a === 0 || a === 10 || a === 127                      // ce lien, privé, bouclage
      || (a === 100 && b >= 64 && b <= 127)                    // espace partagé des opérateurs
      || (a === 169 && b === 254)                              // lien-local : métadonnées du nuage
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 192 && b === 0) || (a === 192 && b === 88)
      || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51)
      || (a === 203 && b === 0) || a >= 224;                   // multidiffusion et réservé
}
/** Développe une IPv6 en seize octets. Rend null si elle est illisible. */
function octetsIPv6(x) {
  const [avant, apres] = x.split("::");
  if (apres !== undefined && x.split("::").length > 2) return null;
  const lire = (part) => {
    const out = [];
    for (const g of (part ? part.split(":") : [])) {
      if (!g) continue;
      // Un dernier groupe peut s'écrire en pointé : ::ffff:127.0.0.1
      if (g.includes(".")) {
        const o = g.split(".").map(Number);
        if (o.length !== 4 || o.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return null;
        out.push(...o); continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      const v = parseInt(g, 16);
      out.push(v >> 8, v & 255);
    }
    return out;
  };
  const g = lire(avant), d = apres === undefined ? [] : lire(apres);
  if (g === null || d === null) return null;
  const trou = 16 - g.length - d.length;
  if (apres === undefined) return g.length === 16 ? g : null;
  if (trou < 0) return null;
  return [...g, ...Array(trou).fill(0), ...d];
}

function priveeIPv6(ip) {
  const x = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const o = octetsIPv6(x);
  if (!o) return true;                                   // illisible : on ne sort pas
  // ::ffff:a.b.c.d, sous sa forme pointée comme sous sa forme hexadécimale que
  // Node produit en normalisant : de l'IPv4 déguisée, à juger comme telle.
  const mappee = o.slice(0, 10).every((b) => b === 0) && o[10] === 255 && o[11] === 255;
  if (mappee) return priveeIPv4(o.slice(12).join("."));
  if (o.every((b) => b === 0)) return true;              // ::
  if (o.slice(0, 15).every((b) => b === 0) && o[15] === 1) return true;   // ::1
  if ((o[0] & 0xfe) === 0xfc) return true;               // fc00::/7, adresses uniques locales
  if (o[0] === 0xfe && (o[1] & 0xc0) === 0x80) return true;               // fe80::/10, lien-local
  if (o[0] === 0xff) return true;                        // multidiffusion
  if (o[0] === 0x20 && o[1] === 0x02) return priveeIPv4(o.slice(2, 6).join("."));   // 6to4
  if (o[0] === 0x01 && o[1] === 0x00 && o.slice(2, 8).every((b) => b === 0)) return true;
  return false;
}

/** Vérifie l'adresse *et* ce qu'elle résout : un nom peut pointer vers 127.0.0.1. */
export async function adresseSure(brut) {
  let u;
  try { u = new URL(brut); } catch { return { ok: false, pourquoi: "Adresse illisible." }; }
  if (u.protocol === "webcal:") u = new URL("https:" + brut.slice(brut.indexOf(":") + 1));
  if (u.protocol !== "https:" && u.protocol !== "http:")
    return { ok: false, pourquoi: "Seules les adresses http et https sont acceptées." };
  if (u.username || u.password)
    return { ok: false, pourquoi: "Une adresse avec identifiants n'est pas acceptée." };

  const hote = u.hostname.replace(/^\[|\]$/g, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hote) && priveeIPv4(hote))
    return { ok: false, pourquoi: "Cette adresse pointe vers un réseau privé." };
  if (hote.includes(":") && priveeIPv6(hote))
    return { ok: false, pourquoi: "Cette adresse pointe vers un réseau privé." };

  let res;
  try { res = await lookup(hote, { all: true }); }
  catch { return { ok: false, pourquoi: "Ce nom de domaine est introuvable." }; }
  for (const a of res) {
    const prive = a.family === 6 ? priveeIPv6(a.address) : priveeIPv4(a.address);
    if (prive) return { ok: false, pourquoi: "Ce nom mène à un réseau privé." };
  }
  return { ok: true, url: u.toString() };
}

/**
 * Va chercher l'agenda. Les redirections sont suivies à la main : laisser `fetch`
 * les suivre contournerait le contrôle ci-dessus, puisqu'on ne verrait jamais
 * l'adresse d'arrivée.
 */
export async function recuperer(brut) {
  let cible = brut;
  for (let saut = 0; saut <= SAUTS_MAX; saut++) {
    const v = await adresseSure(cible);
    if (!v.ok) return { ok: false, pourquoi: v.pourquoi };
    let r;
    try {
      r = await fetch(v.url, {
        redirect: "manual",
        signal: AbortSignal.timeout(DELAI),
        headers: { Accept: "text/calendar, text/plain;q=0.8, */*;q=0.5",
                   "User-Agent": "Repere/1.0 (+https://pilote-ciel.vercel.app)" },
      });
    } catch (e) {
      return { ok: false, pourquoi: e.name === "TimeoutError"
        ? "Le serveur n'a pas répondu à temps." : "Impossible de joindre cette adresse." };
    }
    if (r.status >= 300 && r.status < 400) {
      const suite = r.headers.get("location");
      if (!suite) return { ok: false, pourquoi: "Redirection sans destination." };
      cible = new URL(suite, v.url).toString();
      continue;
    }
    if (!r.ok) return { ok: false, pourquoi: `Le serveur a répondu ${r.status}.` };

    const annonce = Number(r.headers.get("content-length") || 0);
    if (annonce > TAILLE_MAX) return { ok: false, pourquoi: "Cet agenda est trop volumineux." };
    const texte = await lireBorne(r);
    if (texte === null) return { ok: false, pourquoi: "Cet agenda est trop volumineux." };
    if (!/BEGIN:VCALENDAR/i.test(texte))
      return { ok: false, pourquoi: "Cette adresse ne rend pas un agenda." };
    return { ok: true, texte };
  }
  return { ok: false, pourquoi: "Trop de redirections." };
}

/** Lit sans jamais dépasser la borne, même si l'en-tête mentait. */
async function lireBorne(r) {
  const lecteur = r.body && r.body.getReader ? r.body.getReader() : null;
  if (!lecteur) {
    const t = await r.text();
    return t.length > TAILLE_MAX ? null : t;
  }
  const morceaux = []; let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.length;
    if (total > TAILLE_MAX) { try { await lecteur.cancel(); } catch {} return null; }
    morceaux.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(morceaux.map(Buffer.from)));
}

/* ═════════ Lecture ═════════ */

/** Les lignes pliées à 75 octets se recollent : une valeur peut tenir sur dix lignes. */
function deplier(texte) {
  return texte.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
}

const desechapper = (v) => v
  .replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\\\/g, "\\");

/** `20260911T140000Z`, `20260911T140000` ou `20260911`. Rendu en ISO. */
function enInstant(valeur, params) {
  const v = valeur.trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (m) {
    const [, a, mo, j, h, mi, s, z] = m;
    // Sans Z ni fuseau nommé, on prend l'heure telle qu'écrite : c'est l'heure
    // locale de l'établissement, et la rattacher à UTC la décalerait de deux heures.
    return { iso: `${a}-${mo}-${j}T${h}:${mi}:${s}${z ? "Z" : ""}`, jour: false,
             tz: params.TZID || (z ? "UTC" : null) };
  }
  m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { iso: `${m[1]}-${m[2]}-${m[3]}`, jour: true, tz: null };
  return null;
}

/**
 * Rend les événements, au format que le planning attend. On ne garde que ce dont
 * il a besoin : un titre, un début, une fin. Ni participants, ni organisateur,
 * ni description — importer un agenda ne doit pas importer un carnet d'adresses.
 */
export function lire(texte, { max = 600 } = {}) {
  const lignes = deplier(texte).split("\n");
  const evenements = [];
  let cour = null, tronque = false;

  for (const ligne of lignes) {
    const l = ligne.trim();
    if (!l) continue;
    if (/^BEGIN:VEVENT$/i.test(l)) { cour = {}; continue; }
    if (/^END:VEVENT$/i.test(l)) {
      if (cour && cour.debut && cour.titre) {
        if (evenements.length < max) evenements.push(cour);
        else tronque = true;
      }
      cour = null; continue;
    }
    if (!cour) continue;

    const sep = l.indexOf(":");
    if (sep < 0) continue;
    const gauche = l.slice(0, sep), valeur = l.slice(sep + 1);
    const [nom, ...bouts] = gauche.split(";");
    const params = {};
    for (const b of bouts) {
      const e = b.indexOf("=");
      if (e > 0) params[b.slice(0, e).toUpperCase()] = b.slice(e + 1).replace(/^"|"$/g, "");
    }
    const N = nom.toUpperCase();
    if (N === "SUMMARY") cour.titre = desechapper(valeur).slice(0, 120);
    else if (N === "LOCATION") cour.lieu = desechapper(valeur).slice(0, 80);
    else if (N === "DTSTART") cour.debut = enInstant(valeur, params);
    else if (N === "DTEND") cour.fin = enInstant(valeur, params);
    else if (N === "UID") cour.uid = valeur.slice(0, 120);
    else if (N === "RRULE") cour.repete = true;
  }

  return { evenements, tronque };
}
