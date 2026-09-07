// Interactivité des pages documentaires.
//
// La politique de sécurité du contenu interdit tout script inline : ce fichier
// est servi depuis le même domaine que la page, comme le reste.
//
// Deux comportements, choisis selon ce que la page est :
//   · l'aide est parcourue par sujet          → de vrais onglets ;
//   · un texte juridique se lit de bout en bout → un sommaire qui suit la lecture.

const SOBRE = matchMedia("(prefers-reduced-motion: reduce)");
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ── onglets ─────────────────────────────────────────── */
function onglets(hote) {
  const blocs = $$(".bloc[data-onglet]", hote);
  if (blocs.length < 2) return;

  const barre = document.createElement("nav");
  barre.className = "docglets";
  barre.setAttribute("role", "tablist");
  barre.innerHTML = blocs.map((b, i) => `
    <button role="tab" id="gl${i}" aria-controls="pn${i}" data-i="${i}"
      aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${b.dataset.onglet}</button>`).join("");
  blocs[0].before(barre);

  blocs.forEach((b, i) => {
    b.id = "pn" + i;
    b.setAttribute("role", "tabpanel");
    b.setAttribute("aria-labelledby", "gl" + i);
    b.hidden = i !== 0;
  });

  const trait = () => {
    const a = $('button[aria-selected="true"]', barre);
    if (!a) return;
    barre.style.setProperty("--tx", a.offsetLeft + "px");
    barre.style.setProperty("--tw", a.offsetWidth + "px");
  };

  function ouvrir(i, focus) {
    $$("button", barre).forEach((b, k) => {
      b.setAttribute("aria-selected", k === i);
      b.tabIndex = k === i ? 0 : -1;
      if (k === i && focus) b.focus();
    });
    blocs.forEach((b, k) => {
      b.hidden = k !== i;
      if (k === i && !SOBRE.matches) {
        b.classList.remove("entre");
        void b.offsetWidth;
        b.classList.add("entre");
      }
    });
    trait();
    history.replaceState(null, "", "#" + (blocs[i].dataset.cle || "s" + i));
  }

  barre.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (b) ouvrir(+b.dataset.i);
  });
  barre.addEventListener("keydown", (e) => {
    const pas = { ArrowRight: 1, ArrowLeft: -1, Home: "d", End: "f" }[e.key];
    if (pas === undefined) return;
    e.preventDefault();
    const l = $$("button", barre);
    const i = l.findIndex((b) => b.getAttribute("aria-selected") === "true");
    ouvrir(pas === "d" ? 0 : pas === "f" ? l.length - 1 : (i + pas + l.length) % l.length, true);
  });
  addEventListener("resize", trait);

  // Une ancre dans l'adresse ouvre le bon onglet — les liens du pied en posent.
  const cible = decodeURIComponent(location.hash.slice(1));
  const dep = blocs.findIndex((b) => b.dataset.cle === cible || b.id === cible);
  ouvrir(dep > 0 ? dep : 0);
  if (dep > 0) barre.scrollIntoView({ block: "start" });
}

/* ── sommaire qui suit la lecture ────────────────────── */
function sommaire(hote) {
  const titres = $$(".bloc h2", hote);
  if (titres.length < 3) return;

  titres.forEach((t, i) => (t.id = t.id || "sec" + i));
  const nav = document.createElement("nav");
  nav.className = "sommaire";
  nav.innerHTML = `<div class="st">Sur cette page</div>` +
    titres.map((t) => `<a href="#${t.id}">${t.textContent}</a>`).join("");
  $(".tete", hote).after(nav);

  const liens = $$("a", nav);
  const vu = new Map();
  const obs = new IntersectionObserver((entrees) => {
    entrees.forEach((e) => vu.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0));
    let meilleur = null, score = 0;
    vu.forEach((v, k) => { if (v > score) { score = v; meilleur = k; } });
    liens.forEach((a) => a.classList.toggle("ici", a.hash === "#" + meilleur));
  }, { rootMargin: "-72px 0px -55% 0px", threshold: [0, .25, .6, 1] });
  titres.forEach((t) => obs.observe(t));
}

/* ── retour en haut ──────────────────────────────────── */
function retourHaut() {
  const b = document.createElement("button");
  b.className = "haut";
  b.type = "button";
  b.setAttribute("aria-label", "Revenir en haut de la page");
  b.textContent = "↑";
  b.hidden = true;
  b.onclick = () => scrollTo({ top: 0, behavior: SOBRE.matches ? "auto" : "smooth" });
  document.body.appendChild(b);
  let dernier = 0;
  addEventListener("scroll", () => {
    const y = scrollY;
    if (Math.abs(y - dernier) < 40) return;
    dernier = y;
    b.hidden = y < 600;
  }, { passive: true });
}

const doc = $(".doc");
if (doc) {
  if ($(".bloc[data-onglet]", doc)) onglets(doc);
  else sommaire(doc);
  retourHaut();
}
