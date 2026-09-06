// Moteur de planification, en heures réelles.
//
// Une journée n'est plus « 5 h de travail » mais des PLAGES : lundi de 9 h à
// 12 h et de 14 h à 18 h. Les événements occupent eux aussi des plages. Le
// travail se pose dans ce qui reste, et ce qui n'est ni travail ni événement
// devient du temps libre — annonçable à l'entourage avec de vraies heures.

export const DAY = 864e5;
export const JOURNEE = ["08:00", "22:00"]; // fenêtre de vie montrée aux autres

export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const minuit = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/* ── plages horaires ───────────────────────────────────── */
export const min = (v) => {
  const [h, m] = String(v).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const hhmm = (m) => {
  const v = Math.max(0, Math.round(m));
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
};
const longueur = (segs) => segs.reduce((a, s) => a + (s[1] - s[0]), 0);
export const heures = (segs) => Math.round((longueur(segs) / 60) * 100) / 100;
const arrondi = (v) => Math.round(v * 100) / 100;

/** Trie, fusionne les recouvrements, retire le vide. */
export function fusionner(segs) {
  const s = segs.filter((x) => x[1] > x[0]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const seg of s) {
    const d = out[out.length - 1];
    if (d && seg[0] <= d[1]) d[1] = Math.max(d[1], seg[1]);
    else out.push([seg[0], seg[1]]);
  }
  return out;
}

/** `base` moins `trous`. */
export function soustraire(base, trous) {
  let out = fusionner(base);
  for (const t of fusionner(trous)) {
    const suiv = [];
    for (const s of out) {
      if (t[1] <= s[0] || t[0] >= s[1]) { suiv.push(s); continue; }
      if (t[0] > s[0]) suiv.push([s[0], t[0]]);
      if (t[1] < s[1]) suiv.push([t[1], s[1]]);
    }
    out = suiv;
  }
  return out;
}

/** Durée d'un événement, en heures. */
export function duree(ev) {
  if (ev.debut && ev.fin) return Math.max(0, (min(ev.fin) - min(ev.debut)) / 60);
  if (typeof ev.h === "number") return ev.h;
  return 0;
}

/** Plage occupée par un événement. Sans horaire, il prend toute la journée. */
export function plageEvenement(ev) {
  if (ev.debut && ev.fin) return [min(ev.debut), min(ev.fin)];
  if (typeof ev.h === "number" && ev.h > 0) {
    const d = min(JOURNEE[0]);
    return [d, Math.min(min(JOURNEE[1]), d + ev.h * 60)];
  }
  return [min(JOURNEE[0]), min(JOURNEE[1])];
}

const DEFAUT = {
  0: [["14:00", "16:00"]],
  1: [["09:00", "12:00"], ["14:00", "18:00"]],
  2: [["09:00", "12:00"], ["14:00", "18:00"]],
  3: [["09:00", "12:00"], ["14:00", "18:00"]],
  4: [["09:00", "12:00"], ["14:00", "18:00"]],
  5: [["09:00", "12:00"], ["14:00", "18:00"]],
  6: [["10:00", "13:00"]],
};

/** Ancien format (un nombre d'heures par jour) → plages, pour ne rien perdre. */
export function normaliserCapacites(cap) {
  const out = {};
  for (let j = 0; j < 7; j++) {
    const v = cap?.[j];
    if (Array.isArray(v)) out[j] = v.map((s) => [String(s[0]), String(s[1])]);
    else if (typeof v === "number" && v > 0) {
      const matin = Math.min(v, 3);
      const p = [["09:00", hhmm(min("09:00") + matin * 60)]];
      if (v > 3) p.push(["14:00", hhmm(min("14:00") + (v - 3) * 60)]);
      out[j] = p;
    } else if (typeof v === "number") out[j] = [];
    else out[j] = DEFAUT[j];
  }
  return out;
}
const segmentsJour = (cap, js) => fusionner((cap?.[js] || []).map((s) => [min(s[0]), min(s[1])]));

/* ── grille des jours ──────────────────────────────────── */
export function grille(debut, fin, capacites, evenements) {
  const cap = normaliserCapacites(capacites);
  const parJour = new Map();
  for (const e of evenements || []) {
    if (!parJour.has(e.date)) parJour.set(e.date, []);
    parJour.get(e.date).push({ ...e, plage: plageEvenement(e) });
  }
  const jours = new Map();
  for (let t = minuit(debut); t <= fin; t += DAY) {
    const d = new Date(t);
    const cle = iso(d);
    const evs = (parJour.get(cle) || []).sort((a, b) => a.plage[0] - b.plage[0]);
    const occupees = evs.map((e) => e.plage);
    const travail = segmentsJour(cap, d.getDay());
    const dispo = soustraire(travail, occupees);
    jours.set(cle, {
      cle, t, jourSemaine: d.getDay(),
      evenements: evs,
      plagesTravail: travail,   // plages déclarées pour travailler
      dispo,                    // ce qu'il en reste après les événements
      restant: dispo.map((s) => [s[0], s[1]]),
      blocs: [],
      cap: heures(travail),
      occupe: arrondi(heures(occupees)),
      perdu: arrondi(heures(travail) - heures(dispo)),
    });
  }
  return jours;
}

/* ── répartition ───────────────────────────────────────── */
/**
 * Étale les heures de chaque étape sur toute sa fenêtre plutôt que de les
 * empiler au plus tôt, puis matérialise ces heures en vraies plages.
 * Une étape trop grosse pour une journée déborde sur les suivantes : c'est
 * le « 4 h, dont 2 h aujourd'hui et 2 h demain ».
 */
export function planifier({ etapes, done, evenements, capacites, reports = {}, maintenant, fin }) {
  const jours = grille(maintenant, fin, capacites, evenements);
  const cles = [...jours.keys()];
  const libre = new Map(cles.map((c) => [c, heures(jours.get(c).dispo)]));

  const restantes = etapes
    .filter((s) => !done[s.id])
    .map((s) => ({
      etape: s,
      ech: reports[s.id] ? new Date(reports[s.id] + "T23:59:59").getTime() : s.t1,
      h: s.h,
    }))
    .sort((a, b) => (a.ech - b.ech) || (b.h - a.h));

  const manques = [];
  const parts = new Map();
  for (const t of restantes) {
    const enRetard = t.ech < maintenant;
    const depart = minuit(Math.max(maintenant, t.etape.t0 ?? maintenant));
    const fenetre = cles.filter((c) => {
      const j = jours.get(c);
      return j.t >= depart && (enRetard || j.t <= t.ech);
    });
    const reste = etaler(libre, parts, fenetre, t.etape, t.h, enRetard);
    if (reste > 0.01) manques.push({ etape: t.etape, h: arrondi(reste), ech: t.ech, enRetard });
  }

  // Les heures deviennent des plages concrètes, dans l'ordre de la journée.
  for (const [cle, liste] of parts) {
    const j = jours.get(cle);
    for (const p of liste) {
      for (const b of decouper(j.restant, p.h)) {
        j.blocs.push({ etape: p.etape, debut: b[0], fin: b[1], retard: p.retard });
      }
    }
    j.blocs.sort((a, b) => a.debut - b.debut);
  }
  for (const j of jours.values()) {
    j.travailPose = arrondi(j.blocs.reduce((a, b) => a + (b.fin - b.debut) / 60, 0));
    j.libre = arrondi(heures(j.restant));
    j.creneaux = soustraire(
      [[min(JOURNEE[0]), min(JOURNEE[1])]],
      [...j.evenements.map((e) => e.plage), ...j.blocs.map((b) => [b.debut, b.fin])]
    );
  }
  return { jours, manques };
}

/** Verse `h` heures à parts égales sur la fenêtre, sans dépasser chaque jour. */
function etaler(libre, parts, fenetre, etape, h, retard) {
  let reste = h;
  let ouverts = fenetre.filter((c) => libre.get(c) > 0.002);
  while (reste > 0.01 && ouverts.length) {
    const part = reste / ouverts.length;
    const suivants = [];
    let place = 0;
    for (const cle of ouverts) {
      const dispo = libre.get(cle);
      const pris = Math.min(part, dispo);
      if (pris > 0.002) {
        libre.set(cle, dispo - pris);
        if (!parts.has(cle)) parts.set(cle, []);
        parts.get(cle).push({ etape, h: pris, retard });
        place += pris;
      }
      if (libre.get(cle) > 0.002) suivants.push(cle);
    }
    reste -= place;
    if (place < 0.001) break;
    ouverts = suivants;
  }
  return reste;
}

/** Prélève `h` heures au début des segments restants, renvoie les plages prises. */
function decouper(restant, h) {
  let minutes = h * 60;
  const pris = [];
  while (minutes > 0.5 && restant.length) {
    const s = restant[0];
    const dispo = s[1] - s[0];
    if (dispo <= minutes + 0.5) { pris.push([s[0], s[1]]); minutes -= dispo; restant.shift(); }
    else { pris.push([s[0], s[0] + minutes]); s[0] += minutes; minutes = 0; }
  }
  return pris.filter((p) => p[1] - p[0] >= 5);
}

/* ── lectures ──────────────────────────────────────────── */
export const totalManque = (m) => arrondi(m.reduce((a, x) => a + x.h, 0));

/** `travail` est le nombre d'heures posées ; `plagesTravail` les plages déclarées. */
export function bilanJour(jours, cle) {
  const j = jours.get(cle);
  return j ? { ...j, travail: j.travailPose ?? 0 } : null;
}

/** Les plages libres d'un jour, en texte lisible. */
export function creneauxTexte(j, minimum = 30) {
  return (j?.creneaux || [])
    .filter((s) => s[1] - s[0] >= minimum)
    .map((s) => `${hhmm(s[0])} – ${hhmm(s[1])}`);
}

/** Le plus long créneau libre d'un jour, en heures. */
export function plusLongCreneau(j) {
  const c = j?.creneaux || [];
  return c.length ? arrondi(Math.max(...c.map((s) => s[1] - s[0])) / 60) : 0;
}

/** Ce que coûterait l'ajout d'un événement. */
export function testerAjout(base, evenement) {
  const avant = planifier(base);
  const apres = planifier({ ...base, evenements: [...base.evenements, evenement] });
  const ja = avant.jours.get(evenement.date), jp = apres.jours.get(evenement.date);
  const coutAvant = totalManque(avant.manques), coutApres = totalManque(apres.manques);
  return {
    possible: coutApres <= coutAvant + 0.001,
    duree: duree(evenement),
    libreAvant: arrondi(ja?.libre ?? 0),
    capacite: arrondi(ja?.cap ?? 0),
    // Travail chassé de ce jour-là, qui se reporte sur les suivants.
    deplace: arrondi(Math.max(0, (ja?.travailPose ?? 0) - (jp?.travailPose ?? 0))),
    manqueAvant: coutAvant,
    manqueApres: coutApres,
    supplement: arrondi(coutApres - coutAvant),
    avant, apres,
  };
}

/** Première date où `h` heures de travail retrouvent leur place. */
export function proposerReport(jours, h, depuis = 0) {
  let reste = h;
  for (const j of jours.values()) {
    if (j.t < depuis || (j.libre ?? 0) <= 0) continue;
    reste -= j.libre;
    if (reste <= 0.001) return j.cle;
  }
  return null;
}

/**
 * Jours où poser `h` heures ne fait dérailler aucune échéance, avec les vraies
 * plages libres de chaque jour. C'est la réponse donnée à l'entourage.
 */
export function trouverCreneaux(base, h, { horizon = 45, max = 12 } = {}) {
  const reference = planifier(base);
  const seuil = totalManque(reference.manques);
  const debut = minuit(base.maintenant);
  const trouves = [];
  for (let i = 0; i < horizon && trouves.length < max; i++) {
    const t = debut + i * DAY;
    if (t > base.fin) break;
    const cle = iso(new Date(t));
    const jour = reference.jours.get(cle);
    if (!jour) continue;
    // Il faut d'abord une plage libre assez longue dans la journée.
    if (plusLongCreneau(jour) + 0.01 < h) continue;
    const apres = planifier({ ...base, evenements: [...base.evenements, { id: "_essai", date: cle, h }] });
    if (totalManque(apres.manques) <= seuil + 0.001) {
      trouves.push({
        cle, t,
        plages: creneauxTexte(jour),
        plusLong: plusLongCreneau(jour),
        deplace: arrondi(Math.max(0, jour.travailPose - (apres.jours.get(cle)?.travailPose ?? 0))),
      });
    }
  }
  return { creneaux: trouves, reference: seuil };
}
