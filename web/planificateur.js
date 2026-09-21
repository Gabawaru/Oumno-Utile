// Moteur de planification, en heures réelles.
//
// Une journée n'est pas « 5 h de travail » mais des PLAGES : 9 h – 16 h, pauses
// comprises. Les événements occupent eux aussi des plages. Le travail se pose
// dans ce qui reste, et ce qui n'est ni travail ni événement devient du temps
// libre — annonçable à l'entourage avec de vraies heures.
//
// Trois règles gouvernent tout le reste :
//   1. la journée normale d'abord ;
//   2. ce qui n'y tient pas glisse sur des heures inhabituelles (le soir), et
//      seulement là — c'est du rattrapage, pas la norme ;
//   3. une pause suit toute session de travail, sans exception.

export const DAY = 864e5;
export const JOURNEE = ["08:00", "22:00"];   // fenêtre de vie montrée aux autres

/** Une session de travail ne dépasse jamais `session` minutes, et la pause qui
 *  suit n'est pas négociable. Une coupure naturelle (repas, événement) en tient
 *  lieu : on ne rajoute une pause que quand le travail s'enchaînerait. */
export const REGLES = { session: 90, pause: 15, minBloc: 10 };

/** Le repas n'est jamais grignoté, même par le rattrapage. */
export const REPAS = [["12:15", "13:15"]];

/** Plafond de rattrapage par jour, en heures. Sans lui, une journée de retard
 *  se transforme en 8 h – 22 h non-stop : arithmétiquement juste, humainement
 *  faux. Ce qui dépasse remonte en alerte plutôt que d'être posé. */
export const MAX_RATTRAPAGE = 2.5;

/** Jours de repos, le week-end par défaut. On ne s'y repose pas « s'il reste du
 *  temps » : aucune heure n'y est posée, ni en journée ni le soir. La seule
 *  porte qui reste est la réserve ci-dessous. */
export const REPOS = [0, 6];

/** Matrice d'Eisenhower. Seul le quadrant 1 — urgent ET important — ouvre un
 *  jour de repos. Important : ce qui est noté (devoir, évaluation) ou marqué
 *  comme tel. Urgent : l'échéance est passée, ou elle tombe dans les sept
 *  jours. Important sans urgence attend lundi ; urgent sans importance n'a
 *  jamais mérité un dimanche. La réserve se prend le matin, et elle est
 *  plafonnée : un week-end sauvé n'est pas un week-end travaillé. */
export const URGENCE = { jours: 7, max: 3, plage: ["09:00", "19:00"] };
export const importante = (e) => Boolean(e && (e.dev || e.important));
export const urgente = (ech, maintenant) => ech - maintenant <= URGENCE.jours * DAY;
export const quadrant1 = (e, ech, maintenant) => importante(e) && urgente(ech, maintenant);

/** Prendre de l'avance, oui — pas six mois. Une étape peut commencer jusqu'à
 *  quatre semaines avant sa date prévue : de quoi vider un mois creux dans le
 *  mois plein qui suit, sans réviser un cours qu'on n'a pas encore lu. */
export const AVANCE_MAX = 28;

/** Une journée prise en avance doit être franchement plus légère que celles de
 *  la fenêtre, sinon on reste chez soi. Sans ce seuil, un écart d'arrondi
 *  suffirait à sortir de la période prévue. */
export const PREFERENCE = 0.75;

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
const copie = (segs) => segs.map((s) => [s[0], s[1]]);

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

/* ── journée type ──────────────────────────────────────── */
const MATIN = ["09:00", "12:15"], APREM = ["13:15", "16:00"];
export const TYPE = {
  0: [],                          // dimanche au repos
  1: [MATIN, APREM], 2: [MATIN, APREM], 3: [MATIN, APREM],
  4: [MATIN, APREM], 5: [MATIN, APREM],
  6: [],                          // samedi au repos
};
/** Journée type, prête à être enregistrée dans les réglages. */
export const journeeType = () => JSON.parse(JSON.stringify(TYPE));

/** Jours de repos déclarés → ensemble d'indices sûrs. Une liste vide est un
 *  choix (travailler sept jours sur sept) ; seul l'absence de liste rend la
 *  valeur par défaut. */
export function normaliserRepos(v) {
  if (!Array.isArray(v)) return new Set(REPOS);
  return new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6));
}

/** Ancien format (un nombre d'heures par jour) → plages, pour ne rien perdre. */
export function normaliserCapacites(cap) {
  const out = {};
  for (let j = 0; j < 7; j++) {
    const v = cap?.[j];
    if (Array.isArray(v)) out[j] = v.map((s) => [String(s[0]), String(s[1])]);
    else if (typeof v === "number" && v > 0) {
      const matin = Math.min(v, 3.25);
      const p = [["09:00", hhmm(min("09:00") + matin * 60)]];
      if (v > 3.25) p.push(["13:15", hhmm(min("13:15") + (v - 3.25) * 60)]);
      out[j] = p;
    } else if (typeof v === "number") out[j] = [];
    else out[j] = TYPE[j];
  }
  return out;
}
const segmentsJour = (cap, js) => fusionner((cap?.[js] || []).map((s) => [min(s[0]), min(s[1])]));

/** Les heures de rattrapage se prennent d'abord après la journée de travail,
 *  puis seulement avant : « vraiment tard » plutôt que « vraiment tôt ». */
function ordreRattrapage(segs, travail) {
  const finJour = travail.length ? travail[travail.length - 1][1] : min("16:00");
  return [...segs].sort((a, b) => rang(a[0], finJour) - rang(b[0], finJour));
}
const rang = (debut, finJour) => (debut >= finJour ? debut : debut + 1440);

/* ── pose du travail, pauses comprises ─────────────────── */
/**
 * Verse la file de travail dans `segs`, en coupant toute session à
 * `REGLES.session` et en glissant une pause derrière. Une coupure de segment
 * (repas, événement) fait office de pause : on n'en rajoute pas.
 * `restant` est modifié sur place, comme la file.
 */
function materialiser(restant, file) {
  const blocs = [], pauses = [];
  let i = 0, k = 0, session = 0;
  while (k < file.length && i < restant.length) {
    const p = file[k];
    if (!(p.reste > 0.5)) { k++; continue; }
    const s = restant[i];
    if (s[1] - s[0] < REGLES.minBloc) { i++; session = 0; continue; }
    const t = Math.min(p.reste, REGLES.session - session, s[1] - s[0]);
    blocs.push({ etape: p.etape, debut: s[0], fin: s[0] + t,
                 retard: p.retard, tard: p.tard, urgence: p.urgence });
    s[0] += t; p.reste -= t; session += t;
    if (p.reste <= 0.5) k++;
    if (session >= REGLES.session - 0.5) {
      const pa = Math.min(REGLES.pause, s[1] - s[0]);
      if (pa > 0) { pauses.push([s[0], s[0] + pa]); s[0] += pa; }
      session = 0;
    }
  }
  for (let n = restant.length - 1; n >= 0; n--) if (restant[n][1] - restant[n][0] <= 0) restant.splice(n, 1);
  return { blocs, pauses, reste: file.reduce((a, x) => a + Math.max(0, x.reste), 0) };
}

/** Heures de travail réellement disponibles dans ces plages, pauses déduites. */
export function capaciteTravail(segs) {
  const r = materialiser(copie(segs), [{ etape: null, reste: Infinity }]);
  return arrondi(r.blocs.reduce((a, b) => a + (b.fin - b.debut), 0) / 60);
}

/* ── grille des jours ──────────────────────────────────── */
export function grille(debut, fin, capacites, evenements, repos) {
  const cap = normaliserCapacites(capacites);
  const auRepos = normaliserRepos(repos);
  const vie = [[min(JOURNEE[0]), min(JOURNEE[1])]];
  const reserve = [[min(URGENCE.plage[0]), min(URGENCE.plage[1])]];
  const repas = REPAS.map((s) => [min(s[0]), min(s[1])]);
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
    const repose = auRepos.has(d.getDay());
    // Un jour de repos n'a ni heures de travail ni soirée de rattrapage. Ses
    // plages déclarées sont ignorées : c'est le repos qui décide, pas l'oubli
    // d'avoir vidé la case samedi.
    const travail = repose ? [] : segmentsJour(cap, d.getDay());
    const dispo = soustraire(travail, occupees);
    // Heures inhabituelles : tout le reste de la journée vécue, repas exclu.
    // On n'y pose du travail qu'en dernier recours, et le plus tard possible :
    // le rattrapage se fait le soir, jamais au petit matin s'il y a le choix.
    const rallonge = repose ? []
      : ordreRattrapage(soustraire(vie, [...occupees, ...travail, ...repas]), travail);
    // La réserve du jour de repos, elle, se prend dans l'ordre du matin : si un
    // devoir en retard doit manger un samedi, autant que le reste du jour soit
    // rendu entier.
    const secours = repose ? soustraire(reserve, [...occupees, ...repas]) : [];
    jours.set(cle, {
      cle, t, jourSemaine: d.getDay(), repos: repose,
      evenements: evs,
      plagesTravail: travail,   // plages déclarées pour travailler
      dispo,                    // ce qu'il en reste après les événements
      rallonge,                 // heures inhabituelles, réservées au rattrapage
      secours,                  // jour de repos : réservé au quadrant 1
      restant: copie(dispo),
      restantRallonge: copie(rallonge),
      restantSecours: copie(secours),
      blocs: [], pauses: [],
      cap: capaciteTravail(dispo),
      capRallonge: Math.min(capaciteTravail(rallonge), MAX_RATTRAPAGE),
      capUrgence: Math.min(capaciteTravail(secours), URGENCE.max),
      occupe: arrondi(heures(occupees)),
      perdu: arrondi(heures(travail) - heures(dispo)),
    });
  }
  return jours;
}

/* ── répartition ───────────────────────────────────────── */
/**
 * Trois passages, du plus souhaitable au moins souhaitable.
 *
 *   1. Les heures normales, en égalisant la charge des jours : on remplit
 *      d'abord les moins chargés. Une étape peut mordre jusqu'à `AVANCE_MAX`
 *      jours avant sa date prévue — c'est ce qui vide un mois creux dans le
 *      mois plein qui le suit, au lieu de laisser les deux côte à côte.
 *   2. Les heures inhabituelles du soir, au plus tôt : le retard se rattrape,
 *      il ne repousse pas l'échéance.
 *   3. La réserve des jours de repos, et seulement pour le quadrant 1 de la
 *      matrice d'Eisenhower — urgent ET important. Tout le reste attend lundi.
 *
 * Ce qui ne tient toujours nulle part remonte dans `manques` : c'est le signal
 * que le planning est devenu intenable, et il vaut mieux le lire que de le
 * noyer dans un dimanche.
 */
/**
 * `reste(etape)` dit combien d'heures il faut encore poser. Sans lui, une étape
 * entamée était replanifiée en entier : le planning redemandait des heures déjà
 * faites. Par défaut, une étape cochée dans `done` ne reste pas à faire.
 */
export function planifier({ etapes, done, evenements, capacites, reports = {},
                            plafonds = {}, maintenant, fin, reste, repos }) {
  const restant = reste || ((s) => (done[s.id] ? 0 : s.h));
  const jours = grille(maintenant, fin, capacites, evenements, repos);
  const cles = [...jours.keys()];
  const libre = new Map(cles.map((c) => [c, jours.get(c).cap]));
  const extra = new Map(cles.map((c) => [c, jours.get(c).capRallonge]));
  const reserve = new Map(cles.map((c) => [c, jours.get(c).capUrgence]));

  // Part du jour : une journée dont le quota est fixé ne se remplit pas parce
  // qu'on l'a terminée. Ce qui n'y tient plus part sur les jours suivants.
  for (const [cle, h] of Object.entries(plafonds)) {
    const j = jours.get(cle);
    if (!j) continue;
    const n = Math.max(0, Math.min(j.cap, h));
    const r = Math.max(0, Math.min(j.capRallonge, h - n));
    libre.set(cle, n);
    extra.set(cle, r);
    reserve.set(cle, Math.max(0, Math.min(j.capUrgence, h - n - r)));
    j.cap = n;
    j.capRallonge = r;
    j.capUrgence = reserve.get(cle);
    j.plafonne = true;
  }

  const restantes = etapes
    .map((s) => ({
      etape: s,
      ech: reports[s.id] ? new Date(reports[s.id] + "T23:59:59").getTime() : s.t1,
      h: restant(s),
    }))
    .filter((t) => t.h > 0.01)
    .sort((a, b) => (a.ech - b.ech) || (b.h - a.h));

  const parts = new Map();
  const debordent = [];
  for (const t of restantes) {
    const enRetard = t.ech < maintenant;
    const prevu = minuit(t.etape.t0 ?? maintenant);
    // La date prévue n'est plus un mur : on peut la devancer de quatre semaines
    // au plus. L'échéance, elle, reste un mur.
    const depart = Math.max(minuit(maintenant), prevu - AVANCE_MAX * DAY);
    const fenetre = cles.filter((c) => {
      const j = jours.get(c);
      return j.t >= depart && (enRetard || j.t <= t.ech);
    });
    const reste = etaler(libre, jours, parts, fenetre, t.etape, t.h, enRetard, prevu);
    if (reste > 0.01) debordent.push({ etape: t.etape, h: reste, ech: t.ech, enRetard, depart });
  }

  // Second passage : les heures inhabituelles, au plus tôt.
  const trainent = [];
  let tardif = 0;
  for (const d of debordent) {
    const fenetre = cles.filter((c) => jours.get(c).t >= d.depart);
    const reste = auPlusTot(extra, parts, fenetre, d.etape, d.h, d.enRetard, "tard");
    tardif += d.h - reste;
    if (reste > 0.01) trainent.push({ ...d, h: arrondi(reste) });
  }

  // Troisième passage : le week-end, et uniquement pour le quadrant 1. Une
  // étape qui n'est pas à la fois urgente et importante préfère manquer que
  // manger un jour de repos — c'est le manque qu'il faut voir, pas le dimanche.
  const manques = [];
  let weekend = 0;
  for (const d of trainent) {
    if (!quadrant1(d.etape, d.ech, maintenant)) {
      manques.push({ etape: d.etape, h: d.h, ech: d.ech, enRetard: d.enRetard });
      continue;
    }
    const fenetre = cles.filter((c) => jours.get(c).repos && jours.get(c).t >= d.depart);
    const reste = auPlusTot(reserve, parts, fenetre, d.etape, d.h, d.enRetard, "urgence");
    weekend += d.h - reste;
    if (reste > 0.01) manques.push({ etape: d.etape, h: arrondi(reste), ech: d.ech, enRetard: d.enRetard });
  }

  // Les heures deviennent des plages concrètes, dans l'ordre de la journée.
  for (const [cle, liste] of parts) {
    const j = jours.get(cle);
    const file = (garder) => liste.filter(garder).map((p) => ({ ...p, reste: p.h * 60 }));
    const a = materialiser(j.restant, file((p) => !p.tard && !p.urgence));
    const b = materialiser(j.restantRallonge, file((p) => p.tard));
    const c = materialiser(j.restantSecours, file((p) => p.urgence));
    j.blocs = [...a.blocs, ...b.blocs, ...c.blocs]
      .filter((x) => x.fin - x.debut >= 5).sort((x, y) => x.debut - y.debut);
    j.pauses = [...a.pauses, ...b.pauses, ...c.pauses].sort((x, y) => x[0] - y[0]);
  }
  // Les heures déjà écoulées ne sont pas du temps libre : à 21 h, personne n'est
  // disponible « de 12 h 15 à 13 h 15 ». On les retire de la journée en cours.
  const cleAuj = iso(new Date(maintenant));
  const dejaPasse = new Date(maintenant).getHours() * 60 + new Date(maintenant).getMinutes();

  for (const j of jours.values()) {
    j.travailPose = arrondi(j.blocs.reduce((a, b) => a + (b.fin - b.debut) / 60, 0));
    j.tardif = arrondi(j.blocs.filter((b) => b.tard).reduce((a, b) => a + (b.fin - b.debut) / 60, 0));
    j.urgent = arrondi(j.blocs.filter((b) => b.urgence).reduce((a, b) => a + (b.fin - b.debut) / 60, 0));
    j.libre = arrondi(capaciteTravail(j.restant));
    j.libreRallonge = arrondi(Math.max(0, j.capRallonge - j.tardif));
    j.plein = j.cap > 0 && j.libre <= 0.01;
    // Un jour de repos n'est pas saturé : il est fermé. Les confondre ferait
    // dire à l'application « tes journées suivantes sont pleines » un vendredi
    // soir, alors qu'il ne s'agit que du week-end.
    j.sature = !j.repos && j.libre <= 0.01 && j.libreRallonge <= 0.01;
    j.creneaux = soustraire(
      [[min(JOURNEE[0]), min(JOURNEE[1])]],
      [...j.evenements.map((e) => e.plage), ...j.blocs.map((b) => [b.debut, b.fin]), ...j.pauses,
       ...(j.cle === cleAuj ? [[0, dejaPasse]] : [])]
    );
  }
  return { jours, manques, tardif: arrondi(tardif), weekend: arrondi(weekend) };
}

/** Plus petite tranche de travail qu'on accepte de poser dans une journée.
 *  Sans ce garde-fou, étaler 1 h sur trois mois donne des blocs de deux
 *  minutes : juste, mais illisible et intravaillable. */
export const GRAIN = 1;

/**
 * Étale `h` heures sur la fenêtre en égalisant la charge : on sert d'abord les
 * jours les moins chargés, jusqu'à ce qu'ils rejoignent les autres. C'est la
 * différence entre « chaque étape sur sa période » et « le même poids chaque
 * jour » : la première laisse un novembre à 33 h à côté d'un décembre à 126 h,
 * la seconde non.
 *
 * Deux garde-fous. `GRAIN` limite le nombre de jours servis en un tour — sans
 * lui, étaler 1 h sur trois mois donne des blocs de deux minutes. `PREFERENCE`
 * alourdit les jours situés avant la date prévue de l'étape : on ne prend de
 * l'avance que sur un jour franchement plus léger.
 */
function etaler(libre, jours, parts, fenetre, etape, h, retard, prevu = 0) {
  const charge = (c) =>
    jours.get(c).cap - libre.get(c) + (jours.get(c).t < prevu ? PREFERENCE : 0);
  let reste = h;
  while (reste > 0.01) {
    const ouverts = fenetre.filter((c) => libre.get(c) > 0.002);
    if (!ouverts.length) break;
    const n = Math.max(1, Math.min(ouverts.length, Math.round(reste / GRAIN)));
    const choisis = ouverts
      .map((c) => [c, charge(c)])
      .sort((a, b) => (a[1] - b[1]) || (a[0] < b[0] ? -1 : 1))
      .slice(0, n)
      .map((x) => x[0]);
    const pose = niveler(libre, charge, parts, choisis, etape, reste, retard);
    if (pose < 0.001) break;
    reste -= pose;
  }
  return arrondi(Math.max(0, reste));
}

/**
 * Verse jusqu'à `h` heures sur `choisis` en les montant tous au même niveau de
 * charge — le niveau se cherche par dichotomie, puisque chaque jour plafonne à
 * sa propre capacité. Rend ce qui a été posé.
 */
function niveler(libre, charge, parts, choisis, etape, h, retard) {
  const dispo = choisis.reduce((a, c) => a + libre.get(c), 0);
  let niveau = Infinity;                    // tout rentre : on prend tout
  if (dispo > h + 0.002) {
    let bas = 0, haut = Math.max(...choisis.map((c) => charge(c) + libre.get(c)));
    for (let i = 0; i < 60; i++) {
      const m = (bas + haut) / 2;
      const somme = choisis.reduce(
        (a, c) => a + Math.min(libre.get(c), Math.max(0, m - charge(c))), 0);
      if (somme < h) bas = m; else haut = m;
    }
    niveau = (bas + haut) / 2;
  }
  let pose = 0;
  for (const cle of choisis) {
    const pris = Math.min(libre.get(cle), h - pose,
                          niveau === Infinity ? Infinity : Math.max(0, niveau - charge(cle)));
    if (!(pris > 0.002)) continue;
    libre.set(cle, libre.get(cle) - pris);
    if (!parts.has(cle)) parts.set(cle, []);
    parts.get(cle).push({ etape, h: pris, retard });
    pose += pris;
  }
  return pose;
}

/** Remplit les jours dans l'ordre, sans étaler : le rattrapage se fait vite. */
function auPlusTot(libre, parts, fenetre, etape, h, retard, canal) {
  let reste = h;
  for (const cle of fenetre) {
    if (reste <= 0.01) break;
    const dispo = libre.get(cle);
    if (!(dispo > 0.002)) continue;
    const pris = Math.min(reste, dispo);
    libre.set(cle, dispo - pris);
    if (!parts.has(cle)) parts.set(cle, []);
    parts.get(cle).push({ etape, h: pris, retard,
                          tard: canal === "tard", urgence: canal === "urgence" });
    reste -= pris;
  }
  return arrondi(Math.max(0, reste));
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

/**
 * Ce que coûterait l'ajout d'un événement.
 * `possible` est faux uniquement quand des heures ne retrouvent de place nulle
 * part, heures inhabituelles comprises : c'est le seul cas où l'on bloque.
 */
export function testerAjout(base, evenement) {
  // Un événement, ou toute une série : un stage de huit semaines ne se juge pas
  // sur sa première journée.
  const ajouts = Array.isArray(evenement) ? evenement : [evenement];
  const premier = ajouts[0];
  const avant = planifier(base);
  const apres = planifier({ ...base, evenements: [...base.evenements, ...ajouts] });
  const ja = avant.jours.get(premier.date), jp = apres.jours.get(premier.date);
  const coutAvant = totalManque(avant.manques), coutApres = totalManque(apres.manques);
  const supplement = arrondi(coutApres - coutAvant);

  // Sur quel jour bute-t-on ? Le premier jour saturé à partir de l'événement.
  let bloquant = null;
  if (supplement > 0.001) {
    for (const j of apres.jours.values()) {
      if (j.cle < premier.date) continue;
      if (j.sature) { bloquant = j; break; }
    }
  }
  return {
    possible: supplement <= 0.001,
    duree: arrondi(ajouts.reduce((a, e) => a + duree(e), 0)),
    jours: ajouts.length,
    libreAvant: arrondi(ja?.libre ?? 0),
    capacite: arrondi(ja?.cap ?? 0),
    // Travail chassé de ce jour-là, qui se reporte sur les suivants.
    deplace: arrondi(Math.max(0, (ja?.travailPose ?? 0) - (jp?.travailPose ?? 0))),
    // Heures repoussées sur des horaires inhabituels par cet ajout.
    tardif: arrondi(Math.max(0, apres.tardif - avant.tardif)),
    manqueAvant: coutAvant,
    manqueApres: coutApres,
    supplement,
    bloquant,
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
  const seuilTard = reference.tardif;
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
    // Un créneau n'est proposé que s'il ne coûte ni échéance ni soirée de rattrapage.
    if (totalManque(apres.manques) <= seuil + 0.001 && apres.tardif <= seuilTard + 0.001) {
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
