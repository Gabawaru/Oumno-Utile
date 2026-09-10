// Web Push à la main : VAPID (RFC 8292) et chiffrement aes128gcm (RFC 8291).
//
// Aucune dépendance : le projet n'en a pas une seule, et en ajouter une pour
// signer un jeton et dériver trois clés reviendrait à confier la boîte aux
// lettres de chacun à du code qu'on ne lit pas. `node:crypto` fait tout.

import { createHmac, createECDH, createPrivateKey, createPublicKey,
         createSign, createCipheriv, randomBytes } from "node:crypto";

const b64u = (b) => Buffer.from(b).toString("base64url");
const deB64u = (s) => Buffer.from(String(s), "base64url");
const hmac = (cle, ...morceaux) =>
  createHmac("sha256", cle).update(Buffer.concat(morceaux.map(Buffer.from))).digest();

/** HKDF réduit à ce qu'utilise RFC 8291 : une seule passe, jamais plus de 32 octets. */
const hkdf = (sel, ikm, info, taille) =>
  hmac(hmac(sel, ikm), Buffer.from(info), Buffer.from([1])).subarray(0, taille);

/* ═════════ VAPID ═════════ */

/** Paire P-256, au format que le navigateur et Vercel attendent. */
export function nouvellesClesVapid() {
  const e = createECDH("prime256v1");
  e.generateKeys();
  return { publique: b64u(e.getPublicKey()), privee: b64u(e.getPrivateKey()) };
}

/** La clé privée arrive en 32 octets bruts : PKCS#8 la veut habillée. */
function clePriveePkcs8(priveeB64u, publiqueB64u) {
  const d = deB64u(priveeB64u), q = deB64u(publiqueB64u);
  if (d.length !== 32) throw new Error("clé privée VAPID : 32 octets attendus");
  if (q.length !== 65 || q[0] !== 4) throw new Error("clé publique VAPID : point non compressé de 65 octets attendu");
  // SEQUENCE(version, privateKey, [0] namedCurve, [1] publicKey) — courbe prime256v1.
  const der = Buffer.concat([
    Buffer.from("308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420", "hex"),
    d,
    Buffer.from("a144034200", "hex"),
    q,
  ]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

/** En-tête Authorization d'une poussée, valable pour l'origine de ce point d'envoi. */
export function enteteVapid(endpoint, { publique, privee, sujet }) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;   // 24 h au plus, dit la RFC
  const tete = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const corps = b64u(JSON.stringify({ aud, exp, sub: sujet }));
  const sig = createSign("SHA256")
    .update(`${tete}.${corps}`)
    // ES256 veut r||s bruts ; sans ceci Node signe en DER et le serveur refuse.
    .sign({ key: clePriveePkcs8(privee, publique), dsaEncoding: "ieee-p1363" });
  return `vapid t=${tete}.${corps}.${b64u(sig)}, k=${publique}`;
}

/* ═════════ Chiffrement du contenu ═════════ */

/**
 * Un seul enregistrement aes128gcm, tel que RFC 8188 le dispose :
 * sel(16) ‖ taille(4) ‖ longueur de l'identifiant(1) ‖ clé éphémère(65) ‖ chiffré.
 */
export function chiffrer(texte, { p256dh, auth }) {
  const clientPub = deB64u(p256dh), secretAuth = deB64u(auth);
  if (clientPub.length !== 65 || clientPub[0] !== 4) throw new Error("p256dh invalide");
  if (secretAuth.length !== 16) throw new Error("secret auth : 16 octets attendus");

  const moi = createECDH("prime256v1");
  moi.generateKeys();
  const monPub = moi.getPublicKey();
  const partage = moi.computeSecret(clientPub);
  const sel = randomBytes(16);

  // RFC 8291 §3.4 : le secret d'authentification sert de sel à la première dérivation,
  // et les deux clés publiques entrent dans l'info — c'est ce qui lie le message à
  // cet abonnement précis, et à aucun autre.
  const ikm = hkdf(secretAuth, partage,
    Buffer.concat([Buffer.from("WebPush: info\0"), clientPub, monPub]), 32);
  const cle = hkdf(sel, ikm, "Content-Encoding: aes128gcm\0", 16);
  const nonce = hkdf(sel, ikm, "Content-Encoding: nonce\0", 12);

  const clair = Buffer.concat([Buffer.from(texte, "utf8"), Buffer.from([2])]); // 2 : dernier enregistrement
  const c = createCipheriv("aes-128-gcm", cle, nonce);
  const chiffre = Buffer.concat([c.update(clair), c.final(), c.getAuthTag()]);

  const taille = Buffer.alloc(4);
  taille.writeUInt32BE(4096, 0);
  return Buffer.concat([sel, taille, Buffer.from([monPub.length]), monPub, chiffre]);
}

/* ═════════ Envoi ═════════ */

/**
 * Pousse un message vers un abonnement. Rend `{ ok }` ou, si le service dit que
 * l'abonnement n'existe plus (404 ou 410), `{ perime: true }` — au parieur de
 * l'effacer plutôt que de réessayer chaque heure jusqu'à la fin des temps.
 */
export async function pousser(abonnement, charge, vapid, { ttl = 3600, urgence = "normal" } = {}) {
  const corps = chiffrer(JSON.stringify(charge), abonnement);
  let r;
  try {
    r = await fetch(abonnement.endpoint, {
      method: "POST",
      headers: {
        Authorization: enteteVapid(abonnement.endpoint, vapid),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(ttl),
        Urgency: urgence,
      },
      body: corps,
    });
  } catch (e) {
    return { ok: false, erreur: String(e.message || e) };
  }
  if (r.status === 404 || r.status === 410) return { ok: false, perime: true, code: r.status };
  if (!r.ok) return { ok: false, code: r.status, erreur: (await r.text()).slice(0, 200) };
  return { ok: true, code: r.status };
}
