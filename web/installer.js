// Page d'installation : ouvrir le bon onglet, et proposer le bouton natif quand
// le navigateur le permet.

const $ = (s) => document.querySelector(s);

/** Ce que le navigateur dit de lui-même — indicatif, jamais bloquant. */
function plateforme() {
  const ua = navigator.userAgent;
  const tactile = navigator.maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && tactile)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "bureau";
}
const installee = matchMedia("(display-mode: standalone)").matches
  || navigator.standalone === true;

// L'onglet correspondant s'ouvre de lui-même, sauf si une ancre en demande un autre.
if (!location.hash) location.hash = "#" + plateforme();

addEventListener("DOMContentLoaded", () => {
  const e = $("#etat");
  if (!e) return;
  if (installee) {
    e.hidden = false;
    e.className = "bloc etat ok";
    e.innerHTML = `<b>C'est déjà fait.</b> Tu lis cette page depuis l'application
      installée. Rien de plus à faire.`;
  } else if (plateforme() === "ios" && !/Safari/.test(navigator.userAgent)) {
    e.hidden = false;
    e.className = "bloc etat att";
    e.innerHTML = `<b>Ouvre cette page dans Safari.</b> Sur iPhone et iPad, seul
      Safari sait installer une application — c'est une limite d'iOS.`;
  }
});

// Chrome et consorts proposent l'installation par un événement : on garde la main
// dessus pour l'offrir au bon moment plutôt que de laisser le navigateur décider.
let invite = null;
addEventListener("beforeinstallprompt", (ev) => {
  ev.preventDefault();
  invite = ev;
  const zone = plateforme() === "android" ? $("#zoneAndroid") : $("#zoneBureau");
  if (zone) zone.hidden = false;
});

for (const id of ["#installer", "#installer2"]) {
  const b = $(id);
  if (b) b.onclick = async () => {
    if (!invite) return;
    b.disabled = true;
    invite.prompt();
    const { outcome } = await invite.userChoice;
    invite = null;
    const e = $("#etat");
    if (e && outcome === "accepted") {
      e.hidden = false; e.className = "bloc etat ok";
      e.innerHTML = `<b>Installée.</b> Retrouve l'icône avec tes autres applications.`;
    } else {
      b.disabled = false;
    }
  };
}
