// Traitement des images avant dépôt.
//
// Trois raisons de passer par le navigateur plutôt que d'envoyer le fichier tel
// quel : le poids (une photo de téléphone fait dix mégaoctets, la vignette qui
// s'affiche en fait cent fois moins), le format (tout ressort en JPEG, donc
// pas de SVG déguisé en image), et surtout les métadonnées — un cliché pris au
// téléphone transporte la position GPS, l'appareil et l'heure exacte. Redessiner
// l'image dans un canevas ne recopie que les pixels : tout le reste tombe.

const FORMATS = ["image/jpeg", "image/png", "image/webp"];

/** Lit un fichier choisi et le rend en JPEG, redimensionné, sans métadonnées. */
export async function preparer(fichier, cote = 1280, qualite = 0.82) {
  if (!fichier) throw new Error("aucun fichier");
  if (!FORMATS.includes(fichier.type)) {
    throw new Error("Formats acceptés : JPEG, PNG ou WebP.");
  }
  if (fichier.size > 20 * 1024 * 1024) throw new Error("Image trop lourde (20 Mo maximum).");

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
      i.onerror = () => non(new Error("Image illisible."));
      i.src = url;
    });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
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
