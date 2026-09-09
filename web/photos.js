// Traitement des images avant dépôt.
//
// Trois raisons de passer par le navigateur plutôt que d'envoyer le fichier tel
// quel : le poids (une photo de téléphone fait dix mégaoctets, la vignette qui
// s'affiche en fait cent fois moins), le format (tout ressort en JPEG, donc
// pas de SVG déguisé en image), et surtout les métadonnées — un cliché pris au
// téléphone transporte la position GPS, l'appareil et l'heure exacte. Redessiner
// l'image dans un canevas ne recopie que les pixels : tout le reste tombe.

/* On ne filtre plus sur le type déclaré. Un iPhone rend ses photos en HEIC :
   la liste blanche « JPEG, PNG ou WebP » refusait donc la pellicule entière,
   avec un message qui accusait le fichier. Le seul test qui vaille est de
   tenter le décodage — ce que le navigateur sait faire ou non. Le SVG reste
   écarté : ce n'est pas une photo, et son décodage peut aller chercher
   ailleurs. */
/** Lit un fichier choisi et le rend en JPEG, redimensionné, sans métadonnées. */
export async function preparer(fichier, cote = 1280, qualite = 0.82) {
  if (!fichier) throw new Error("aucun fichier");
  if (/svg/i.test(fichier.type)) throw new Error("Choisis une photo, pas un dessin vectoriel.");
  if (fichier.size > 25 * 1024 * 1024) throw new Error("Image trop lourde (25 Mo maximum).");

  const image = await charger(fichier);
  const ech = Math.min(1, cote / Math.max(image.width, image.height));
  const l = Math.max(1, Math.round(image.width * ech));
  const h = Math.max(1, Math.round(image.height * ech));

  const toile = document.createElement("canvas");
  toile.width = l; toile.height = h;
  const ctx = toile.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, l, h);
  if (image.close) image.close();

  const blob = await new Promise((ok) => toile.toBlob(ok, "image/jpeg", qualite));
  if (!blob) throw new Error("Image illisible.");
  return blob;
}

async function charger(fichier) {
  // createImageBitmap décode hors du fil principal quand il existe, et applique
  // l'orientation EXIF : sans ça, les photos prises de côté ressortent tournées.
  if (window.createImageBitmap) {
    try { return await createImageBitmap(fichier, { imageOrientation: "from-image" }); }
    catch {}
  }
  const url = URL.createObjectURL(fichier);
  try {
    return await new Promise((ok, non) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => non(new Error(
        "Ce format d'image n'est pas lisible par ton navigateur. Essaie une autre photo."));
      i.src = url;
    });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/* ═════════ RECADRAGE ═════════
   Une photo qu'on ne peut pas cadrer, c'est une photo qu'on renonce à mettre.
   Tout tient dans un canevas : on y dessine l'image sous une fenêtre, on la
   déplace au doigt, on la grossit à deux doigts, et on ne garde que ce qui est
   dans la fenêtre. Aucune dépendance — la politique de sécurité du contenu
   n'en accepterait aucune. */

const CADRES = [
  { id: "carre", nom: "Carré", r: 1 },
  { id: "portrait", nom: "Portrait", r: 4 / 5 },
  { id: "paysage", nom: "Paysage", r: 16 / 9 },
];

export function formatsCadre() { return CADRES; }

/**
 * Ouvre la fenêtre de recadrage. Rend le morceau retenu, en JPEG, ou `null`
 * si on annule.
 * @param {Blob} fichier    l'image choisie
 * @param {object} opts     { ratio, rond, cote, qualite, choixRatio, titre }
 */
export async function recadrer(fichier, opts = {}) {
  const { rond = false, cote = 1280, qualite = 0.85,
          choixRatio = false, titre = "Cadre ta photo" } = opts;
  let ratio = opts.ratio || 1;
  if (/svg/i.test(fichier.type)) throw new Error("Choisis une photo, pas un dessin vectoriel.");
  const img = await charger(fichier);
  const iw = img.width, ih = img.height;

  const fond = document.createElement("div");
  fond.className = "recadre";
  fond.innerHTML = `
    <div class="rboite" role="dialog" aria-modal="true" aria-label="${titre}">
      <div class="rtitre">${titre}</div>
      <div class="rscene"><canvas></canvas></div>
      ${choixRatio ? `<div class="rformats">${CADRES.map((c, i) =>
        `<button type="button" data-r="${c.id}"${i === 0 ? ' aria-pressed="true"' : ''}>${c.nom}</button>`
      ).join("")}</div>` : ""}
      <div class="rzoom">
        <label class="horsvue" for="rZoom">Grossissement</label>
        <input id="rZoom" type="range" min="1" max="400" value="1">
      </div>
      <div class="ractes">
        <button type="button" class="btn" data-non>Annuler</button>
        <button type="button" class="btn pri" data-oui>Utiliser cette photo</button>
      </div>
      <p class="raide">Fais glisser pour déplacer, pince ou molette pour grossir.</p>
    </div>`;
  document.body.appendChild(fond);

  const toile = fond.querySelector("canvas");
  const scene = fond.querySelector(".rscene");
  const ctx = toile.getContext("2d");
  const curseur = fond.querySelector("#rZoom");

  let L = 0, H = 0, fx = 0, fy = 0, fw = 0, fh = 0;   // scène et fenêtre, en pixels de toile
  // `ech` démarre à zéro pour que la première mesure impose l'échelle de
  // couverture : partir de 1 ouvrait la fenêtre déjà grossie, sur une image
  // dont on ne voyait plus qu'un timbre.
  let ech = 0, echMin = 1, cx = iw / 2, cy = ih / 2;

  function mesurer() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = scene.getBoundingClientRect();
    L = Math.round(r.width * dpr); H = Math.round(r.height * dpr);
    toile.width = L; toile.height = H;
    toile.style.width = r.width + "px"; toile.style.height = r.height + "px";
    // La fenêtre : le plus grand rectangle du bon rapport qui tient dans la scène.
    const m = 12 * dpr;
    fw = Math.min(L - 2 * m, (H - 2 * m) * ratio);
    fh = fw / ratio;
    fx = (L - fw) / 2; fy = (H - fh) / 2;
    const avant = echMin;
    echMin = Math.max(fw / iw, fh / ih);
    // À la réouverture ou au changement de format, on garde le grossissement
    // relatif choisi plutôt que de tout remettre à plat.
    ech = ech > 0 ? Math.max(echMin, ech * (echMin / avant)) : echMin;
    borner();
  }

  function borner() {
    ech = Math.max(echMin, Math.min(ech, echMin * 8));
    const dx = fw / (2 * ech), dy = fh / (2 * ech);
    cx = Math.max(dx, Math.min(cx, iw - dx));
    cy = Math.max(dy, Math.min(cy, ih - dy));
  }

  function peindre() {
    borner();
    ctx.clearRect(0, 0, L, H);
    const ox = fx + fw / 2 - cx * ech, oy = fy + fh / 2 - cy * ech;
    ctx.drawImage(img, 0, 0, iw, ih, ox, oy, iw * ech, ih * ech);
    // Assombrir tout ce qui est hors de la fenêtre : quatre bandes, pas de masque.
    ctx.fillStyle = "rgba(8,12,17,.62)";
    ctx.fillRect(0, 0, L, fy);
    ctx.fillRect(0, fy + fh, L, H - fy - fh);
    ctx.fillRect(0, fy, fx, fh);
    ctx.fillRect(fx + fw, fy, L - fx - fw, fh);
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.lineWidth = Math.max(1, L / 400);
    if (rond) {
      ctx.beginPath();
      ctx.arc(fx + fw / 2, fy + fh / 2, fw / 2, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeRect(fx + .5, fy + .5, fw - 1, fh - 1);
    }
    const v = Math.round(((ech / echMin) - 1) / 7 * 399) + 1;
    if (String(v) !== curseur.value) curseur.value = String(v);
  }

  /* ── le doigt et la souris ─────────────────────────────────────── */
  const doigts = new Map();
  let depart = null;
  const dpr = () => toile.width / toile.getBoundingClientRect().width;

  toile.addEventListener("pointerdown", (e) => {
    toile.setPointerCapture(e.pointerId);
    doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    depart = etatDoigts();
  });
  toile.addEventListener("pointermove", (e) => {
    if (!doigts.has(e.pointerId)) return;
    doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const m = etatDoigts();
    if (!depart || !m) return;
    if (doigts.size >= 2 && depart.ecart > 0) {
      ech = depart.ech * (m.ecart / depart.ecart);
    }
    cx = depart.cx - (m.x - depart.x) * dpr() / ech;
    cy = depart.cy - (m.y - depart.y) * dpr() / ech;
    peindre();
  });
  const lacher = (e) => {
    doigts.delete(e.pointerId);
    depart = doigts.size ? etatDoigts() : null;
  };
  toile.addEventListener("pointerup", lacher);
  toile.addEventListener("pointercancel", lacher);
  toile.addEventListener("wheel", (e) => {
    e.preventDefault();
    ech *= e.deltaY < 0 ? 1.12 : 1 / 1.12;
    peindre();
  }, { passive: false });

  function etatDoigts() {
    const l = [...doigts.values()];
    if (!l.length) return null;
    const x = l.reduce((a, p) => a + p.x, 0) / l.length;
    const y = l.reduce((a, p) => a + p.y, 0) / l.length;
    const ecart = l.length >= 2 ? Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y) : 0;
    return { x, y, ecart, cx, cy, ech };
  }

  curseur.addEventListener("input", () => {
    ech = echMin * (1 + (Number(curseur.value) - 1) / 399 * 7);
    peindre();
  });
  fond.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => {
    ratio = CADRES.find((c) => c.id === b.dataset.r).r;
    fond.querySelectorAll("[data-r]").forEach((x) =>
      x.setAttribute("aria-pressed", String(x === b)));
    mesurer(); peindre();
  }));

  const surMesure = () => { mesurer(); peindre(); };
  addEventListener("resize", surMesure);
  mesurer(); peindre();

  return new Promise((resoudre) => {
    const finir = (blob) => {
      removeEventListener("resize", surMesure);
      removeEventListener("keydown", auClavier);
      fond.remove();
      if (img.close) img.close();
      resoudre(blob);
    };
    function auClavier(e) { if (e.key === "Escape") finir(null); }
    addEventListener("keydown", auClavier);
    fond.querySelector("[data-non]").onclick = () => finir(null);
    fond.addEventListener("click", (e) => { if (e.target === fond) finir(null); });
    fond.querySelector("[data-oui]").onclick = async () => {
      const largeur = Math.min(cote, Math.round(fw / ech));
      const sortie = document.createElement("canvas");
      sortie.width = Math.max(1, largeur);
      sortie.height = Math.max(1, Math.round(largeur / ratio));
      const c2 = sortie.getContext("2d");
      c2.imageSmoothingQuality = "high";
      c2.drawImage(img, cx - fw / (2 * ech), cy - fh / (2 * ech), fw / ech, fh / ech,
                   0, 0, sortie.width, sortie.height);
      sortie.toBlob((b) => finir(b || null), "image/jpeg", qualite);
    };
  });
}

/** Dépose une image dans le dossier de son propriétaire et rend le chemin. */
export async function deposer(sb, seau, proprietaire, blob, cote, qualite) {
  const prepare = blob instanceof Blob && blob.type === "image/jpeg"
    ? blob : await preparer(blob, cote, qualite);
  const nom = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const chemin = `${proprietaire}/${nom}`;
  const { error } = await sb.stockage.televerser(seau, chemin, prepare);
  if (error) throw new Error(error.message);
  return chemin;
}
