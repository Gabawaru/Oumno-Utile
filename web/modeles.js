// Modèles de programme.
//
// L'application n'est pas réservée au BTS CIEL : le référentiel CNED n'est
// qu'un modèle parmi d'autres. Chacun peut partir d'une page blanche et
// déclarer ses propres matières. Le moteur, lui, ne connaît que des étapes
// avec un volume d'heures et une période — d'où qu'elles viennent.

import { GROUPS as CNED_GROUPS } from "./planning.js";

/** 20 quinzaines, de septembre à juin : la maille de l'année scolaire. */
export const QUINZAINES = (() => {
  const m = ["septembre","octobre","novembre","décembre","janvier","février",
             "mars","avril","mai","juin"];
  const out = [];
  for (let i = 0; i < 20; i++) {
    out.push({ q: i, texte: `${i % 2 ? "2ᵉ" : "1re"} quinzaine de ${m[Math.floor(i / 2)]}` });
  }
  return out;
})();

/** Palette proposée pour les matières créées à la main. */
export const COULEURS = [
  { id: "b1", nom: "Bleu" }, { id: "phy", nom: "Turquoise" }, { id: "b2", nom: "Violet" },
  { id: "b3", nom: "Rouge" }, { id: "gen", nom: "Ocre" }, { id: "stg", nom: "Vert" },
  { id: "exa", nom: "Ardoise" },
];

export const MODELES = {
  cned: {
    id: "cned",
    nom: "BTS CIEL 2ᵉ année — CNED",
    resume: "Le référentiel complet relevé sur eformation.cned.fr : 7 lots, 121 étapes, 1024 h.",
    groupes: () => CNED_GROUPS,
  },
  vierge: {
    id: "vierge",
    nom: "Programme vierge",
    resume: "Une page blanche : tu déclares tes matières et tes étapes, à ta main.",
    groupes: () => [],
  },
  revisions: {
    id: "revisions",
    nom: "Révisions d'examen",
    resume: "Une trame courante — cours à relire, exercices, annales, oral — à ajuster ensuite.",
    groupes: () => [
      matiere("rev.c", "Cours à relire", "b1", [
        etape("rev.c.1", "Première lecture de tout le programme", 20, 0, 6),
        etape("rev.c.2", "Fiches de synthèse", 16, 4, 10),
      ]),
      matiere("rev.e", "Exercices", "stg", [
        etape("rev.e.1", "Exercices par chapitre", 30, 2, 12),
        etape("rev.e.2", "Reprise des erreurs", 12, 8, 14),
      ]),
      matiere("rev.a", "Annales", "b3", [
        etape("rev.a.1", "Sujets des années précédentes", 24, 10, 17),
        etape("rev.a.2", "Épreuves en temps réel", 16, 14, 19),
      ]),
    ],
  },
};

/** Une matière : un lot d'étapes, une couleur, une place dans l'année. */
export function matiere(id, nom, couleur, etapes) {
  const s = Math.min(...etapes.map((e) => e.s));
  const e = Math.max(...etapes.map((x) => x.e));
  return {
    id, name: nom, code: "", c: `var(--${couleur || "b1"})`, couleur: couleur || "b1",
    rows: [{ id: id + ".r", n: nom, s, e, steps: etapes.map((x) => ({ id: x.id, n: x.n, h: x.h })) }],
    etapes,
  };
}
export const etape = (id, n, h, s, e) => ({ id, n, h, s, e });

/* ── frontière de confiance ────────────────────────────
   Un programme vient de la base, donc de son propriétaire — qui peut y écrire
   ce qu'il veut, y compris par appel direct à l'API. Or ce programme est rendu
   chez les gens qui consultent son planning public. Tout ce qui en sort est
   donc contraint ici, avant d'atteindre le moindre gabarit HTML. */

const ID_VALIDE = /^[A-Za-z0-9._-]{1,48}$/;
const COULEURS_OK = new Set(COULEURS.map((c) => c.id));
const CTRL = /[\u0000-\u001f\u007f]/g;
let compteur = 0;

const texteSur = (v, max) => String(v == null ? "" : v).replace(CTRL, "").slice(0, max).trim();
const idSur = (v, prefixe) => (ID_VALIDE.test(String(v == null ? "" : v)) ? String(v) : prefixe + ++compteur);
const entierSur = (v, min, max, defaut) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut;
};

/** Programme nettoyé : identifiants, couleurs, libellés et bornes sous contrôle. */
export function assainirProgramme(prog) {
  const brut = prog && typeof prog === "object" ? prog : {};
  const modele = MODELES[brut.modele] ? brut.modele : brut.modele === "perso" ? "perso" : "cned";
  if (modele !== "perso") return { modele, matieres: [] };
  const matieres = (Array.isArray(brut.matieres) ? brut.matieres : []).slice(0, 40).map((m) => {
    const mm = m && typeof m === "object" ? m : {};
    return {
      id: idSur(mm.id, "m"),
      nom: texteSur(mm.nom, 60) || "Sans titre",
      couleur: COULEURS_OK.has(mm.couleur) ? mm.couleur : "b1",
      etapes: (Array.isArray(mm.etapes) ? mm.etapes : []).slice(0, 120).map((e) => {
        const ee = e && typeof e === "object" ? e : {};
        const s = entierSur(ee.s, 0, 19, 0);
        return {
          id: idSur(ee.id, "e"),
          n: texteSur(ee.n, 90) || "Sans titre",
          h: entierSur(ee.h, 1, 400, 1),
          s,
          e: entierSur(ee.e, s + 1, 20, Math.min(20, s + 2)),
        };
      }),
    };
  });
  return { modele, matieres };
}

/**
 * Programme enregistré → structure attendue par le reste de l'application.
 * Chaque matière devient un lot d'une seule ligne : le diagramme, l'accordéon
 * et le planificateur n'ont rien à savoir de plus.
 */
export function versGroupes(programme) {
  const prog = assainirProgramme(programme);
  if (prog.modele !== "perso") return MODELES[prog.modele].groupes();
  return prog.matieres
    .filter((m) => m.etapes.length)
    .map((m) => matiere(m.id, m.nom, m.couleur, m.etapes));
}

/** Un modèle tout fait, converti en programme modifiable. */
export function depuisModele(id) {
  if (id === "cned") return { modele: "cned", matieres: [] };
  const g = (MODELES[id] || MODELES.vierge).groupes();
  return {
    modele: "perso",
    matieres: g.map((x) => ({ id: x.id, nom: x.name, couleur: x.couleur || "b1", etapes: x.etapes })),
  };
}
