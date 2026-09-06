// Moteur de planification.
//
// Principe : chaque jour de la semaine a une capacité de travail en heures.
// Les événements personnels (sortie, rendez-vous, cours) consomment ces heures.
// Ce qui reste est réparti entre les étapes non terminées, échéance la plus
// proche d'abord. Une étape dont l'échéance est dépassée retombe simplement
// sur les premiers jours disponibles : le retard se recale tout seul.

export const DAY = 864e5;

export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const minuit = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Durée d'un événement en heures, depuis ses bornes horaires. */
export function duree(ev) {
  if (typeof ev.h === "number") return ev.h;
  if (!ev.debut || !ev.fin) return 0;
  const [h1, m1] = ev.debut.split(":").map(Number);
  const [h2, m2] = ev.fin.split(":").map(Number);
  return Math.max(0, (h2 * 60 + m2 - (h1 * 60 + m1)) / 60);
}

/** Construit la grille des jours entre deux instants, capacité et occupation comprises. */
export function grille(debut, fin, capacites, evenements) {
  const jours = new Map();
  const parJour = new Map();
  for (const e of evenements) {
    parJour.set(e.date, (parJour.get(e.date) || 0) + duree(e));
  }
  for (let t = minuit(debut); t <= fin; t += DAY) {
    const d = new Date(t);
    const cle = iso(d);
    const cap = Number(capacites?.[d.getDay()] ?? 0);
    const occupe = parJour.get(cle) || 0;
    jours.set(cle, {
      cle,
      t,
      jourSemaine: d.getDay(),
      cap,
      occupe,
      libre: Math.max(0, cap - occupe),
      surcharge: Math.max(0, occupe - cap),
      taches: [],
    });
  }
  return jours;
}

/**
 * Répartit les heures restantes sur les jours libres.
 * `reports` permet de repousser volontairement l'échéance d'une étape.
 * Renvoie la grille remplie et la liste de ce qui ne rentre pas.
 */
export function planifier({ etapes, done, evenements, capacites, reports = {}, maintenant, fin }) {
  const jours = grille(maintenant, fin, capacites, evenements);
  const cles = [...jours.keys()];

  const restantes = etapes
    .filter((s) => !done[s.id])
    .map((s) => ({
      etape: s,
      ech: reports[s.id] ? new Date(reports[s.id] + "T23:59:59").getTime() : s.t1,
      h: s.h,
    }))
    .sort((a, b) => a.ech - b.ech || b.h - a.h);

  const manques = [];
  for (const t of restantes) {
    let reste = t.h;
    // Une étape dont l'échéance est déjà passée n'a plus de fenêtre à respecter :
    // elle se replace sur les premiers jours libres, c'est le rattrapage du retard.
    const enRetard = t.ech < maintenant;
    for (const cle of cles) {
      const j = jours.get(cle);
      if (!enRetard && j.t > t.ech) break;
      if (j.libre <= 0) continue;
      const pris = Math.min(reste, j.libre);
      j.libre -= pris;
      j.taches.push({ etape: t.etape, h: pris, retard: enRetard });
      reste -= pris;
      if (reste <= 0.001) break;
    }
    if (reste > 0.001) {
      manques.push({ etape: t.etape, h: Math.round(reste * 10) / 10, ech: t.ech, enRetard });
    }
  }
  return { jours, manques };
}

/** Somme des heures qui ne rentrent pas. */
export const totalManque = (manques) =>
  Math.round(manques.reduce((a, m) => a + m.h, 0) * 10) / 10;

/**
 * Teste l'ajout d'un événement : renvoie ce qu'il coûterait au planning.
 * `possible` est faux si l'ajout crée du travail qui ne rentre plus nulle part.
 */
export function testerAjout(base, evenement) {
  const avant = planifier(base);
  const apres = planifier({ ...base, evenements: [...base.evenements, evenement] });
  const jour = apres.jours.get(evenement.date);
  const d = duree(evenement);
  const coutAvant = totalManque(avant.manques);
  const coutApres = totalManque(apres.manques);
  return {
    possible: coutApres <= coutAvant + 0.001,
    duree: d,
    libreAvant: avant.jours.get(evenement.date)?.libre ?? 0,
    capacite: jour?.cap ?? 0,
    debordement: jour?.surcharge ?? 0,
    manqueAvant: coutAvant,
    manqueApres: coutApres,
    supplement: Math.round((coutApres - coutAvant) * 10) / 10,
    apres,
  };
}

/**
 * Première date à laquelle `heures` de travail rentrent, en repartant du
 * planning courant. Sert au bouton « remettre à plus tard ».
 */
export function proposerReport(jours, heures, depuis = 0) {
  let reste = heures;
  for (const j of jours.values()) {
    if (j.t < depuis || j.libre <= 0) continue;
    reste -= j.libre;
    if (reste <= 0.001) return j.cle;
  }
  return null;
}

/** Bilan d'un jour : capacité, occupation, travail planifié, reste. */
export function bilanJour(jours, cle) {
  const j = jours.get(cle);
  if (!j) return null;
  const travail = j.taches.reduce((a, t) => a + t.h, 0);
  return {
    ...j,
    travail: Math.round(travail * 10) / 10,
    libre: Math.round(j.libre * 10) / 10,
    occupe: Math.round(j.occupe * 10) / 10,
  };
}
