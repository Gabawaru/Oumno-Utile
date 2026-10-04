import { MONTHS, MFULL, DOW, DAY, TZ, CNED, EXAM } from "./planning.js";
import { versGroupes, MODELES, QUINZAINES, COULEURS, depuisModele,
         assainirProgramme } from "./modeles.js";
import { planifier, testerAjout, proposerReport, bilanJour, totalManque, duree,
         trouverCreneaux, creneauxTexte, plusLongCreneau, normaliserCapacites,
         journeeType, normaliserRepos, REGLES, JOURNEE, REPOS, URGENCE, AVANCE_MAX,
         hhmm as enHeure, min as enMin, iso as isoJour } from "./planificateur.js";
import { preparer as preparerImage } from "./photos.js";

/* Repère vit sur cet appareil. Pas de compte, pas de serveur : le planning est
   celui de la personne qui tient le navigateur, enregistré dans le navigateur,
   et sauvegardé dans un fichier quand elle le décide. Tout ce qui supposait une
   base — le fil, les messages, les contacts, les partages — est parti avec elle.
*/

/* ═════════ ÉTAT DE SESSION ═════════ */
// Il n'y a plus qu'un planning : le sien. `vue` reste, parce que tout le code de
// rendu demande « le planning de qui ? » — la réponse est désormais toujours la même.
const vue = { id: "local", nom: "Moi" };
let capacites = { 0: 2, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 3 };
let repos = [...REPOS];  // jours où l'on ne pose rien : le week-end par défaut
const NOMS_JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
/* Un repos qui se mérite : coché, il ne s'applique que lorsqu'aucune étape
   n'est en retard. Tant qu'il y en a une, le jour de repos redevient un jour
   ordinaire, avec ses plages — et c'est là que le rattrapage trouve sa marge. */
let reposCond = false;
const reposSuspendu = () => reposCond && repos.length > 0 &&
  ALL.some((s) => !estFait(s) && NOW > s.t1 && !estBloque(s.id));
const reposEffectifs = () => (reposSuspendu() ? [] : repos);
const auRepos = (j) => reposEffectifs().includes(Number(j));
let reports = {};        // échéances repoussées à la main
let programme = null;    // modèle choisi, ou matières déclarées à la main
let demarrageFait = false;  // la question « par quoi on commence ? » a été posée
let partJour = null;     // { date, h } — la part de travail fixée pour le jour
let plan = null;         // résultat du planificateur

const estMoi = () => true;
const $ = (id) => document.getElementById(id);


/* ═════════ CONSTANTES ═════════ */
const Y0=2026,M0=8;
const qStart=q=>new Date(Y0,M0+Math.floor(q/2),q%2?16:1);
const qEnd  =q=>q%2?new Date(Y0,M0+Math.floor(q/2)+1,1):new Date(Y0,M0+Math.floor(q/2),16);
const T0=qStart(0).getTime(),T1=qEnd(19).getTime();

/* Le programme n'est plus figé : c'est celui du profil consulté. Le moteur ne
   connaît que des étapes avec un volume d'heures et une période — le référentiel
   CNED n'est qu'un modèle parmi d'autres. */
let GROUPES=[], ALL=[], DEVS=[], TOTAL_H=0, byId={};
let avance={}, seances=[], fiches={}, bloques={};

function chargerProgramme(prog){
  GROUPES = versGroupes(prog);
  ALL=[]; DEVS=[]; byId={};
  GROUPES.forEach(g=>g.rows.forEach(r=>{
    r.g=g; r.h=r.steps.reduce((a,s)=>a+s.h,0);
    r.cid=r.cid||g.cid;
    r.url=r.cid?CNED+r.cid+(r.u?"&section="+r.u:""):null;
    const a=qStart(r.s).getTime(),b=qEnd(r.e-1).getTime(),span=b-a;
    let cum=0;
    r.steps.forEach(s=>{
      // Deux étapes de même identifiant se voleraient leurs heures faites : le
      // modèle a la priorité, la matière ajoutée à la main passe son tour.
      if(byId[s.id]) return;
      s.row=r;s.g=g;s.t0=a+span*(cum/Math.max(r.h,1));cum+=s.h;s.t1=a+span*(cum/Math.max(r.h,1));
      ALL.push(s); byId[s.id]=s; if(s.dev) DEVS.push(s);
    });
  }));
  GROUPES.forEach(g=>{g.h=g.rows.reduce((a,r)=>a+r.h,0);
    g.s=Math.min(...g.rows.map(r=>r.s));g.e=Math.max(...g.rows.map(r=>r.e));});
  TOTAL_H=GROUPES.reduce((a,g)=>a+g.h,0);
}

function planned(t){let v=0;for(const s of ALL){
  if(t>=s.t1)v+=s.h; else if(t>s.t0)v+=s.h*(t-s.t0)/(s.t1-s.t0);}return v;}
function plannedDate(h){if(h<=0)return T0;let lo=T0,hi=T1;
  for(let i=0;i<48;i++){const m=(lo+hi)/2;planned(m)<h?lo=m:hi=m;}return (lo+hi)/2;}

/* ═════════ HORLOGE DE PARIS ═════════
   NOW est l'instant de Paris réécrit dans le calendrier local du navigateur :
   toutes les comparaisons se font donc sur l'heure de Paris, où que soit le lecteur. */
let NOW=Date.now();
const PF=new Intl.DateTimeFormat("fr-FR",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",
  hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
function parisNow(){
  const p={}; PF.formatToParts(new Date()).forEach(x=>p[x.type]=x.value);
  return new Date(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second).getTime();
}
const fmtD =t=>new Date(t).toLocaleDateString("fr-FR",{day:"numeric",month:"short"});
const fmtDL=t=>new Date(t).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
const hhmm =t=>new Date(t).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
const iso  =d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const sameDay=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
const plural=(n,w)=>n+" "+w+(Math.abs(n)>1?"s":"");
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/**
 * Un lien saisi par quelqu'un n'est rendu que s'il pointe vers le web. Sans ce
 * filtre, « javascript:… » dans le lien d'un événement s'exécute au clic — et
 * un lien peut arriver d'un fichier de sauvegarde fabriqué par quelqu'un d'autre. Le protocole est vérifié après analyse, pas par comparaison de
 * chaîne — « JaVaScRiPt: » et « java\tscript: » passeraient.
 */
function lienSur(v){
  if(!v) return null;
  try{
    const u=new URL(String(v), location.origin);
    return (u.protocol==="https:"||u.protocol==="http:") ? u.href : null;
  }catch{ return null; }
}

/** Le système peut demander qu'on ne bouge rien : on l'écoute partout. */
const SOBRE = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Tout est calé sur l'heure de Paris, quel que soit le fuseau du visiteur. */
function tickClock(){ NOW = parisNow(); majHorloge(); }

/** L'horloge de l'en-tête : c'est l'heure de Paris, pas celle du visiteur. */
function majHorloge(){
  const d = new Date(NOW);
  const q = $("clkD"), t = $("clkT"), sec = $("clkS");
  if (!q) return;
  const j = d.toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long" });
  q.textContent = j.charAt(0).toUpperCase() + j.slice(1);
  t.firstChild.textContent =
    `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  sec.textContent = ":" + String(d.getSeconds()).padStart(2, "0");
}
const nowQ=()=>{const d=new Date(NOW);
  return Math.max(0,Math.min(19,(d.getFullYear()-Y0)*24+(d.getMonth()-M0)*2+(d.getDate()>15?1:0)));};

/* ═════════ ÉTAT ═════════ */
let done=Object.create(null), events=[], journal=[], grades={};
const canEdit=true;
let pendingLog=[], tmr={};
const LS="repere.local.v1";
// La copie que gardait la version avec serveur. On la reprend une fois, au
// premier lancement : c'est tout ce qui reste du planning tant que la base dort.
const LS_ANCIEN="ciel.v4";

/* ── Ce qui attend d'être écrit ──────────────────────────────────────────
   Toutes les écritures de l'application sont différées : 600 ms pour l'état,
   2,5 s pour ce qu'on tape. Une minuterie qui ne sonne jamais n'enregistre
   rien — et sur un téléphone, poser une coche puis basculer d'application la
   tue avant qu'elle ne sonne. C'est ainsi qu'un « je suis bloqué » coché
   disparaissait.

   Deux promesses, donc. Tout ce qui attend part quand la page se cache. Et ce
   qui malgré tout n'est pas parti est repris au chargement suivant, parce que
   la copie locale sait qu'elle porte du retard. */
const differes = new Map();
function differer(cle, ms, faire){
  const v = differes.get(cle); if (v) clearTimeout(v.t);
  differes.set(cle, { faire, t: setTimeout(() => { differes.delete(cle); faire(); }, ms) });
}
/** Tout écrire maintenant. Plusieurs tours : écrire une note rappelle
    saveState, qui redépose une attente qu'il faut vider à son tour. */
function viderDifferes(){
  for (let tour = 0; tour < 3 && differes.size; tour++){
    for (const [cle, v] of [...differes]){
      clearTimeout(v.t); differes.delete(cle);
      try { v.faire(); } catch(e){}
    }
  }
}
// La page est en train de disparaître : ce qui attend doit partir maintenant.
let enFermeture = false;

/** Écrit tout le planning dans le navigateur. Rend faux si le navigateur refuse
 *  — mémoire pleine, navigation privée — pour qu'on le dise au lieu de mentir. */
function saveLocal(){
  try{
    localStorage.setItem(LS, JSON.stringify({ version: 1, data: etat(),
      journal: journal.slice(0, 150), pris: new Date().toISOString() }));
    return true;
  }catch(e){ return false; }
}
/** La copie de cet appareil ; à défaut, celle de l'ancienne version. */
function lireLocal(){
  try{
    const r = JSON.parse(localStorage.getItem(LS) || "null");
    if (r && r.data) return r;
    const v = JSON.parse(localStorage.getItem(LS_ANCIEN) || "null");
    if (v && v.data) return { data: v.data, journal: [], pris: v.pris || null, repris: true };
  }catch(e){}
  return null;
}
/** Message d'état discret, affiché dans l'en-tête. */
function setSync(k,t){
  const e=$("sousTitre"); if(!e) return;
  e.dataset.etat=k||""; e.textContent=t||"";
}

function appliquerEtat(d){
  d=d||{};
  done      = d.done      || {};
  avance    = d.avance    || {};
  seances   = Array.isArray(d.seances) ? d.seances : [];
  fiches    = d.fiches    || {};
  bloques   = d.bloques   || {};
  events    = d.evenements|| d.events || [];
  grades    = d.notes     || d.grades || {};
  capacites = normaliserCapacites(d.capacites);
  repos     = [...normaliserRepos(d.repos)].sort();
  reposCond = Boolean(d.reposCond);
  reports   = d.reports   || {};
  partJour  = d.partJour && /^\d{4}-\d{2}-\d{2}$/.test(d.partJour.date)
              && Number.isFinite(d.partJour.h) ? d.partJour : null;
  demarrageFait = Boolean(d.demarrage);
  // Le programme vécu est le programme assaini, pas celui qu'on a lu. `versGroupes`
  // le nettoyait déjà à chaque rendu, mais l'objet gardé en mémoire, lui, restait
  // brut : une matière sans liste d'étapes suffisait à faire tomber les réglages.
  programme = assainirProgramme(d.programme);
  chargerProgramme(programme);
  Object.keys(done).forEach(k=>{if(done[k]===true)done[k]="";});
  migrerAvance();
  // Un minuteur laissé en route doit se retrouver : l'onglet a pu être fermé,
  // le téléphone verrouillé, la page rechargée.
  lireMinuteur();
  if (minuteur) battre();
}
const etat=()=>({done,avance,seances,fiches,bloques,evenements:events,notes:grades,capacites,
                 repos,reposCond,reports,partJour,programme,demarrage:demarrageFait});

/* ═════════ HEURES POSÉES ═════════
   `done` disait oui ou non. Cocher une tranche d'une heure sur une étape de six
   créditait les six : le diagramme montrait des heures qui n'avaient pas été
   faites, et l'avance était fausse d'autant. `avance[etape][jour] = heures` dit
   ce qui a vraiment été posé, et quel jour — ce que la courbe et le rythme
   demandaient déjà sans pouvoir le lire.

   `done` reste écrit quand une étape est finie : c'est ce que lisent le
   planificateur, le retard, et les plages libres publiées aux autres. */

/** Les comptes d'avant ne connaissent que `done` : une étape finie devient une
 *  séance unique, le jour de sa validation. Rien ne se perd, rien ne s'invente. */
function migrerAvance(){
  let bouge=false;
  for(const id in done){
    if(avance[id]) continue;
    const s2=byId[id]; if(!s2) continue;
    const jour=String(done[id]||"").slice(0,10) || isoJour(new Date(T0));
    avance[id]={[jour]:s2.h}; bouge=true;
  }
  // On ne supprime pas les heures d'une étape absente du programme courant :
  // changer de modèle et revenir doit retrouver son travail. Elles sont inertes —
  // tous les comptes parcourent les étapes du programme, jamais la table brute.
  return bouge;
}

const EPS=0.01;
/** Le reste d'une étape, corrigé de ce qu'elle coûte réellement à cette personne.
 *  Borné : un facteur tiré d'une seule séance courte ne doit pas tordre l'année. */
/** Ce qu'il reste à placer dans le planning. Une étape bloquée n'y entre pas :
 *  la reproposer chaque matin ne fait avancer personne. */
function restePlanifiable(s2){ return estBloque(s2.id) ? 0 : resteReel(s2); }

/** Ce qu'il reste à faire, bloqué compris. Le travail ne disparaît pas parce
 *  qu'on attend quelqu'un : le retard le compte toujours. */
function resteReel(s2){
  const r=resteDe(s2); if(r<=EPS) return 0;
  const m=mesureDe(s2.id); if(!m||m.seances<2) return r;
  return r*Math.max(0.5,Math.min(2,m.facteur));
}
/** Heures posées sur une étape, jamais plus que son volume. */
const faitDe =id=>{const m=avance[id]; if(!m) return 0;
  let t=0; for(const j in m) t+=Number(m[j])||0;
  const s2=byId[id]; return s2?Math.min(s2.h,t):t;};
const resteDe=s2=>Math.max(0,s2.h-faitDe(s2.id));
const estFait=s2=>resteDe(s2)<=EPS;

/** Pose (ou retire) des heures un jour donné, et tient `done` en accord. */
function poserHeures(s2,jour,h){
  // On ne travaille pas demain : une tranche d'un jour à venir se pose aujourd'hui.
  const auj=isoJour(new Date(NOW));
  if(jour>auj) jour=auj;
  const m=avance[s2.id]||(avance[s2.id]={});
  const autres=Object.keys(m).reduce((a,j)=>a+(j===jour?0:(Number(m[j])||0)),0);
  const v=Math.max(0,Math.min(s2.h-autres,(Number(m[jour])||0)+h));
  if(v<=EPS) delete m[jour]; else m[jour]=Math.round(v*100)/100;
  if(!Object.keys(m).length) delete avance[s2.id];
  if(estFait(s2)){
    // Le jour de fin est le dernier jour travaillé, pas celui du dernier clic.
    const jours=Object.keys(avance[s2.id]||{}).filter(j=>/^\d{4}-\d{2}-\d{2}$/.test(j)).sort();
    const dernier=jours[jours.length-1]||jour;
    done[s2.id]=jours.length?new Date(dernier+"T18:00:00").toISOString():new Date(T0).toISOString();
  } else delete done[s2.id];
}

function log(text){
  pendingLog.push(text);
  journal.unshift({ts:new Date(NOW).toISOString(),text});
  journal=journal.slice(0,150);
}
function saveState(){
  pendingLog.length = 0;
  if (saveLocal()) setSync("ok", "enregistré sur cet appareil");
  else setSync("warn", "pas enregistré — le navigateur refuse d'écrire");
}
const saveProgress=saveState, saveEvents=saveState, saveGrades=saveState;

/* ═════════ CALCULS ═════════ */
const doneH=r=>r.steps.reduce((a,s)=>a+faitDe(s.id),0);
const actualH=()=>ALL.reduce((a,s)=>a+faitDe(s.id),0);
const isLate=s=>!estFait(s)&&NOW>s.t1;
const lateDays=s=>Math.floor((NOW-s.t1)/DAY);
function status(){
  const act=actualH(),exp=planned(NOW),eq=plannedDate(act);
  const days=Math.round((eq-NOW)/DAY), late=ALL.filter(isLate);
  let kind,word,detail;
  if(days>=3){kind="ahead";word="En avance";detail=`de ${plural(days,"jour")}`;}
  else if(days<=-3){kind="late";word="En retard";detail=`de ${plural(-days,"jour")}`;}
  else{kind="ontime";word="Dans les temps";detail="";}
  return{act,exp,days,kind,word,detail,late,eq,gap:Math.round(act-exp),
    pct:act/TOTAL_H*100,expPct:exp/TOTAL_H*100};
}
const COL={ahead:"var(--ahead)",ontime:"var(--ok)",late:"var(--late)"};
const short=g=>g.name.split("—")[0].trim()
  .replace("Enseignement général","Général").replace("Expérience en milieu professionnel","Stage")
  .replace("Sciences physiques","Physique").replace("Préparation aux épreuves","Épreuves");

/* ═════════ AUJOURD'HUI ═════════ */
/* La première chose à l'écran répond à la seule question qu'on se pose en
   l'ouvrant : sur quoi je travaille, là, maintenant ? Avant, il fallait la
   déduire d'un bandeau, d'un pourcentage et d'une frise. */
function prochaineSeance() {
  const auj = isoJour(new Date(NOW));
  const mnt = new Date(NOW).getHours() * 60 + new Date(NOW).getMinutes();
  for (const j of plan.jours.values()) {
    if (j.cle < auj) continue;
    const blocs = j.blocs.filter((b) => j.cle > auj || b.fin > mnt);
    if (!blocs.length) continue;
    const id = blocs[0].etape.id;
    // Une séance, c'est la même étape d'un bout à l'autre ; une pause ne la coupe pas.
    let i = 1, fin = blocs[0].fin, duree = blocs[0].fin - blocs[0].debut;
    while (i < blocs.length && blocs[i].etape.id === id && blocs[i].debut - fin <= REGLES.pause + 1) {
      duree += blocs[i].fin - blocs[i].debut; fin = blocs[i].fin; i++;
    }
    return { jour: j, debut: blocs[0].debut, fin, duree: duree / 60, bloc: blocs[0],
             ensuite: blocs[i] || null, auj: j.cle === auj, mnt };
  }
  return null;
}

function renderMaintenant() {
  const box = $("maintenant"); if (!box) return;
  const p = prochaineSeance();
  if (!p) {
    box.style.removeProperty("--c");
    box.innerHTML = `<div class="mlab plus-tard">Rien de prévu</div>
      <div class="mquoi"><b>Aucune séance dans les semaines qui viennent.</b>
      <span>Tout est fait, ou tes heures de travail sont vides : regarde Moi → Mon travail.</span></div>`;
    return;
  }
  const e = p.bloc.etape;
  box.style.setProperty("--c", e.g.c);
  const enCours = p.auj && p.debut <= p.mnt;
  const plage = `${enHeure(p.debut)} – ${enHeure(p.fin)}`;
  const lab = enCours ? `Maintenant · jusqu'à ${enHeure(p.fin)}`
    : p.auj ? `Aujourd'hui · ${plage}`
    : `Prochaine séance · ${fmtDL(p.jour.t)}, ${plage}`;
  const restera = Math.max(0, resteDe(e) - p.duree);
  box.innerHTML = `
    <div class="mlab${enCours ? "" : " plus-tard"}">${esc(lab)}</div>
    <div class="mquoi"><b>${esc(e.n)}</b><span>${esc(e.row.n)} · ${esc(short(e.g))}</span></div>
    <div class="mmeta">
      <span><b>${unH(p.duree)}</b> de séance</span>
      <span>${restera > EPS ? `il restera <b>${unH(restera)}</b> sur ${unH(e.h)}` : `<b>finit l'étape</b>`}</span>
      ${p.bloc.urgence ? `<span class="lt">urgent et important</span>`
        : p.bloc.tard ? `<span class="lt">hors horaires</span>`
        : p.bloc.retard ? `<span class="lt">rattrapage</span>` : ""}
    </div>
    <div class="mact">
      ${e.row.url ? `<a class="btn" href="${esc(e.row.url)}" target="_blank" rel="noopener">Ouvrir le cours ↗</a>` : ""}
      ${canEdit && p.auj ? `<button class="btn pri" data-chrono="${esc(e.id)}">Lancer le minuteur</button>` : ""}
      <button class="btn" data-fiche="${esc(e.id)}">Ma fiche</button>
    </div>
    ${p.ensuite ? `<div class="mens">Ensuite, ${enHeure(p.ensuite.debut)} :
      <b>${esc(p.ensuite.etape.n)}</b> · ${esc(p.ensuite.etape.row.n)}</div>` : ""}`;
}

function renderToday(){
  renderMaintenant();
  const st = status();
  const hero = $("hero");
  hero.style.setProperty("--hc", COL[st.kind]);
  $("hbig").textContent = st.word + (st.detail ? " " + st.detail : "");

  $("hsub").innerHTML = st.kind === "ontime"
    ? `Tu es au niveau prévu pour aujourd'hui.`
    : st.kind === "ahead"
      ? `Le plan n'atteint ton niveau que le <b>${fmtDL(st.eq)}</b>.`
      : `Le plan prévoyait ce niveau le <b>${fmtDL(st.eq)}</b>.`;

  $("gfill").style.width = st.pct + "%";
  const gm = $("gmark");
  gm.style.left = `calc(${st.expPct}% - 1px)`;
  gm.title = `Attendu aujourd'hui : ${Math.round(st.exp)} h`;

  const restJours = Math.max(0, Math.ceil((EXAM - NOW) / DAY));
  $("hpied").innerHTML =
    `<span><b>${Math.round(st.act)} h</b> faites sur ${TOTAL_H} h</span>
     <span><b>${Math.round(st.pct)} %</b> du parcours</span>
     <span><b>${restJours}</b> jours avant les épreuves</span>`;

  // Prévenir quand la charge dépasse ce qui tient dans les heures normales.
  const av = $("alerteJour");
  const manque = totalManque(plan.manques);
  const soirs = [...plan.jours.values()].slice(0, 14).reduce((a, j) => a + (j.tardif || 0), 0);
  if (manque >= 0.1) {
    av.hidden = false; av.className = "bandeau stop";
    av.innerHTML = `<b>C'est devenu trop.</b> ${Math.round(manque)} h de cours ne rentrent
      nulle part avant leur échéance, même en travaillant le soir. Valide des étapes, élargis
      tes heures dans Réglages, ou repousse une échéance depuis le calendrier.`;
  } else if (soirs >= 0.5) {
    av.hidden = false; av.className = "bandeau warn";
    av.innerHTML = `<b>Ça déborde sur tes soirées.</b> ${unH(soirs)} de
      rattrapage sont posées hors de tes heures normales sur les deux prochaines semaines.
      Chaque étape validée en retire d'autant.`;
  } else {
    av.hidden = true;
  }

  // La journée d'aujourd'hui, heure par heure. Ce qui est coché disparaît du
  // planning : quand il ne reste rien, la part du jour est faite.
  const cle = isoJour(new Date(NOW));
  const jAuj = plan.jours.get(cle);
  const reste = jAuj ? jAuj.travailPose : 0;
  const cible = $("dateJour");
  const avant = cible.dataset.reste;
  // Un jour de repos n'a pas « fait sa part » : il n'en avait pas.
  // Ce qui est encore devant soi, pas ce qui était prévu ce matin : à 19 h, « 5 h
  // à faire » sur des plages toutes passées disait l'inverse de la frise en dessous.
  const mntJ = new Date(NOW).getHours() * 60 + new Date(NOW).getMinutes();
  const aVenir = jAuj ? jAuj.blocs.reduce((a, b2) => a + Math.max(0, b2.fin - Math.max(b2.debut, mntJ)), 0) / 60 : 0;
  cible.innerHTML = `${fmtDL(NOW)} — ` + (aVenir >= 0.05
    ? `<b>${unH(aVenir)}</b> à faire`
    : reste >= 0.05
    ? `plages du jour passées — <b>${unH(reste)}</b> non validées`
    : jAuj && jAuj.repos
      ? `<b class="fini">jour de repos</b>`
      : `<b class="fini">part du jour faite</b>`);
  cible.dataset.reste = String(reste);
  if (avant !== undefined && avant !== String(reste) && !SOBRE.matches) {
    const b = cible.querySelector("b");
    if (b) { b.classList.add("pulse"); setTimeout(() => b.classList.remove("pulse"), 400); }
  }
  const mnt = new Date(NOW).getHours() * 60 + new Date(NOW).getMinutes();
  $("journee").innerHTML = friseHTML(cle, { compact: true, depuis: mnt, max: 6 });

  // Retard : on ne montre le bloc que s'il y a quelque chose dedans.
  // Le retard global compte tout ; la liste du jour, elle, ne réclame que ce
  // qu'on peut réellement faire. Les bloquées ont leur propre bloc.
  const lates = st.late.filter((x) => !estBloque(x.id)).sort((a, b) => a.t1 - b.t1);
  $("blocRetard").hidden = lates.length === 0;
  if (lates.length) {
    $("lateNote").textContent = `${lates.length} en retard`;
    $("lateq").innerHTML = lates.slice(0, 8).map((s2) => `
      <label class="qitem" style="--c:${esc(s2.g.c)}">
        <input type="checkbox" class="cb" data-cb="${esc(s2.id)}"${canEdit ? "" : " disabled"}>
        <span class="qbody"><span class="qtitle">${esc(s2.row.n)} · ${esc(s2.n)}</span>
        <span class="qmeta"><span class="lt">${lateDays(s2) < 1 ? "échéance passée aujourd'hui" : plural(lateDays(s2), "jour") + " de retard"}</span>
          <span>${faitDe(s2.id) > 0.01 ? `${unH(faitDe(s2.id))} sur ${unH(s2.h)}` : unH(s2.h)}</span>
          ${s2.row.url ? `<a href="${esc(s2.row.url)}" target="_blank" rel="noopener">cours ↗</a>` : ""}
        </span></span></label>`).join("") +
      (lates.length > 8 ? `<div class="empty muted">+ ${lates.length - 8} autres</div>` : "");
  }
}

/* ═════════ CALENDRIER ═════════ */
let calCur=null,calSel=null;
/* le calendrier et la zone de tâche sont définis plus bas */

/* ═════════ GANTT ═════════ */
const col=v=>v+2;

/** Une date → sa quinzaine, l'inverse de `qStart`. */
function quinzaineDe(iso){
  const d=new Date(iso+"T00:00");
  const mois=(d.getFullYear()-Y0)*12+d.getMonth()-M0;
  return Math.max(0,Math.min(19,mois*2+(d.getDate()>=16?1:0)));
}

/**
 * Les périodes qui tiennent des semaines entières : les séries d'événements.
 * Une vue d'ensemble bâtie sur le seul programme ne les montrait nulle part —
 * un stage de huit semaines y était invisible, alors que c'est lui qui décide
 * de ce qu'on peut faire d'autre pendant ce temps.
 */
function seriesEvenements(){
  const par=new Map();
  for(const e of events){
    if(!e.serie||!e.date) continue;
    const nom=e.titre||e.title||"Période";
    const v=par.get(e.serie)||{serie:e.serie,titre:nom,jours:0,debut:e.date,fin:e.date};
    v.jours++;
    if(e.date<v.debut)v.debut=e.date;
    if(e.date>v.fin)v.fin=e.date;
    par.set(e.serie,v);
  }
  return [...par.values()].filter(v=>v.jours>1)
    .map(v=>({...v,q0:quinzaineDe(v.debut),q1:quinzaineDe(v.fin)}))
    .sort((a,b)=>a.debut.localeCompare(b.debut));
}
const signePeriodes=()=>seriesEvenements().map(v=>`${v.serie}:${v.q0}-${v.q1}:${v.jours}:${v.titre}`).join("|");
let periodesDessinees=null;

function buildGantt(){
  const g=document.getElementById("gantt"),NQ=nowQ();
  let h='<div class="corner"></div>';
  MONTHS.forEach((m,i)=>h+=`<div class="mcell${Math.floor(NQ/2)===i?" now":""}">${m}</div>`);
  GROUPES.forEach((grp,gi)=>{
    if(gi)h+='<div class="spacer"></div>';
    h+=`<div class="glabel grp">${esc(grp.name)}${grp.code?`<span class="code">${esc(grp.code)}</span>`:""}<span class="code">${grp.h} h</span></div>
      <div class="lane grp"><div class="bar grp" data-g="${esc(grp.id)}" style="--c:${esc(grp.c)};grid-column:${col(grp.s)}/${col(grp.e)}"><div class="fill"></div></div></div>`;
    grp.rows.forEach(r=>{
      h+=`<div class="glabel sub" data-lab="${esc(r.id)}" title="${esc(r.n)}">${r.url?`<a href="${esc(r.url)}" target="_blank" rel="noopener" style="color:inherit">${esc(r.n)}</a>`:esc(r.n)}${r.code?`<span class="code">${esc(r.code)}</span>`:""}</div>
        <div class="lane"><div class="bar" data-r="${esc(r.id)}" style="--c:${esc(grp.c)};grid-column:${col(r.s)}/${col(r.e)}">
          <div class="fill"></div><span class="blab"></span>
          <span class="retard" data-rt="${esc(r.id)}" hidden></span></div></div>`;
    });
  });
  const periodes=seriesEvenements();
  if(periodes.length){
    h+='<div class="spacer"></div>';
    h+=`<div class="glabel grp">Mes périodes<span class="code">${plural(periodes.length,"série")}</span></div>
      <div class="lane grp"></div>`;
    periodes.forEach(v=>{
      h+=`<div class="glabel sub" title="${esc(v.titre)}">${esc(v.titre)}<span class="code">${plural(v.jours,"jour")}</span></div>
        <div class="lane"><div class="bar periode" style="grid-column:${col(v.q0)}/${col(v.q1+1)}">
          <span class="blab">${esc(fmtD(new Date(v.debut+"T00:00")))} → ${esc(fmtD(new Date(v.fin+"T00:00")))}</span>
        </div></div>`;
    });
  }
  periodesDessinees=signePeriodes();
  g.innerHTML=h;
  // Le renvoi vers le CNED n'a de sens que si les lots portent un lien de cours.
  const liens=GROUPES.some(gp=>gp.rows.some(r=>r.url));
  document.getElementById("legend").innerHTML=
    GROUPES.map(gp=>`<span class="li"><span class="sw" style="background:${esc(gp.c)}"></span>${esc(short(gp))} — ${gp.h} h</span>`).join("")+
    `<span class="li"><span class="sw vide"></span>Vide — reste à faire</span>`+
    `<span class="li"><span class="sw" style="background:var(--late)"></span>En retard — échéance passée</span>`+
    (liens?`<span class="li muted" style="margin-left:auto">Clique le nom d'un lot pour ouvrir le cours</span>`:"");
}
function paintGantt(){
  // Les périodes sont une structure, pas un remplissage : si elles ont changé,
  // la grille est à rebâtir avant d'être repeinte.
  if(signePeriodes()!==periodesDessinees) buildGantt();
  GROUPES.forEach(g=>{
    let gd=0;
    g.rows.forEach(r=>{
      const d=doneH(r);gd+=d;const pc=r.h?d/r.h*100:0;
      const tardives=r.steps.filter(isLate);
      const late=tardives.length>0;
      // Le vide dit déjà qu'il manque quelque chose ; il ne dit pas depuis quand.
      const jours=late?Math.max(...tardives.map(lateDays)):0;
      const bar=document.querySelector(`[data-r="${r.id}"]`);
      if(bar){bar.querySelector(".fill").style.width=pc+"%";
        bar.querySelector(".blab").textContent=`${Math.round(d*10)/10}/${r.h} h`;
        bar.classList.toggle("done",pc>=99.5);bar.classList.toggle("lt",late&&pc<99.5);}
      const rt=document.querySelector(`[data-rt="${r.id}"]`);
      if(rt){
        const montre=late&&pc<99.5;
        rt.hidden=!montre;
        if(montre){
          rt.textContent=jours<1?"en retard":`${jours} j`;
          rt.title=`${plural(tardives.length,"étape")} dont l'échéance est passée`
            +(jours>=1?`, la plus ancienne depuis ${plural(jours,"jour")}`:"");
        }
      }
      const lab=document.querySelector(`[data-lab="${esc(r.id)}"]`);
      if(lab){lab.classList.toggle("full",pc>=99.5);lab.classList.toggle("lt",late&&pc<99.5);}
      const rh=document.querySelector(`[data-rh="${r.id}"]`);if(rh)rh.textContent=`${d}/${r.h} h`;
    });
    const gp=g.h?gd/g.h*100:0;
    const f=document.querySelector(`[data-g="${g.id}"] .fill`);if(f)f.style.width=gp+"%";
    const mi=document.querySelector(`[data-mini="${g.id}"]`);if(mi)mi.style.width=gp+"%";
    const ct=document.querySelector(`[data-ct="${g.id}"]`);if(ct)ct.textContent=`${gd}/${g.h} h`;
  });
}

/* ═════════ ÉTAPES ═════════ */
function buildAcc(){
  document.getElementById("acc").innerHTML=GROUPES.map(g=>`
   <div class="grpblk" style="--c:${esc(g.c)}">
     <div class="grphd" role="button" tabindex="0" aria-expanded="false">
       <span class="car">▶</span><span class="nm">${esc(g.name)}</span>
       <span class="mini"><i data-mini="${g.id}"></i></span>
       <span class="ct" data-ct="${g.id}">0/${g.h} h</span></div>
     <div class="grpbody">${g.rows.map(r=>`
       <div><div class="rowhd">${r.url?`<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.n)} ↗</a>`:esc(r.n)}
         <span class="rh" data-rh="${r.id}">0/${r.h} h</span></div>
       <div class="steps">${r.steps.map(s=>`
         <div class="step" data-step="${s.id}">
           <label class="zcoche"><input type="checkbox" class="cb" data-cb="${esc(s.id)}"></label>
           <span class="lbl">${esc(s.n)}${s.date?` <b class="mono" style="color:var(--sig)">${s.date}</b>`:""}</span>
           <span class="hh">${unH(s.h)}</span>
           <button class="ici" data-ici="${esc(s.id)}" title="J'en suis là : tout ce qui précède est acquis">j'en suis là</button>
           <button class="fic" data-fiche="${esc(s.id)}" title="Ma fiche sur cette étape"
             aria-label="Ma fiche"><svg viewBox="0 0 24 24" aria-hidden="true">
             <path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h5"/></svg></button>
           <button class="chrono" data-chrono="${esc(s.id)}" title="Lancer le minuteur"
             aria-label="Minuteur"><svg viewBox="0 0 24 24" aria-hidden="true">
             <circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/></svg></button>
         </div>`).join("")}</div></div>`).join("")}</div>
   </div>`).join("");
  document.querySelectorAll(".grphd").forEach(hd=>{
    const t=()=>{const b=hd.parentElement;b.classList.toggle("open");
      hd.setAttribute("aria-expanded",b.classList.contains("open"));};
    hd.onclick=t; hd.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();t();}};
  });
  document.getElementById("expandAll").onclick=()=>document.querySelectorAll(".grpblk").forEach(b=>b.classList.add("open"));
  document.getElementById("collapseAll").onclick=()=>document.querySelectorAll(".grpblk").forEach(b=>b.classList.remove("open"));
}

/* ═════════ J'EN SUIS LÀ ═════════
   Le planning ne savait pas où l'on en était : il partait de zéro, déclarait
   « 34 jours de retard » et reposait, chaque soir, des étapes faites depuis
   longtemps. Cocher les cent étapes une à une, personne ne le fait.

   Ce qui a été acquis avant l'application n'a pas de date. On ne l'invente
   pas : ces heures sont rangées sous « avant », comptées comme faites, mais
   absentes du rythme — sinon le jour du clic aurait l'air d'une journée de
   cent heures, et toutes les prévisions en seraient faussées. */
function etapesAvant(id, portee) {
  const s2 = byId[id]; if (!s2) return [];
  const g = GROUPES.find((x) => x.rows.includes(s2.row)); if (!g) return [];
  const out = [];
  for (const r of g.rows) {
    if (portee === "ligne" && r !== s2.row) continue;
    for (const x of r.steps) { if (x === s2) return out; out.push(x); }
  }
  return out;
}
function acquerirAvant(id, portee) {
  const liste = etapesAvant(id, portee).filter((x) => !estFait(x));
  for (const x of liste) {
    const m = avance[x.id] || (avance[x.id] = {});
    m.avant = Math.round(((Number(m.avant) || 0) + resteDe(x)) * 100) / 100;
    done[x.id] = new Date(T0).toISOString();
  }
  return liste;
}
function demanderIci(id) {
  const s2 = byId[id]; if (!s2 || !canEdit) return;
  const ligne = etapesAvant(id, "ligne").filter((x) => !estFait(x));
  const bloc = etapesAvant(id, "bloc").filter((x) => !estFait(x));
  const somme = (l) => unH(l.reduce((a, x) => a + resteDe(x), 0));
  const faire = (portee) => {
    const fait = acquerirAvant(id, portee);
    log(`en est à ${s2.row.n} · ${s2.n} : ${plural(fait.length, "étape")} marquée(s) acquise(s)`);
    saveProgress(); renderAll();
  };
  if (!bloc.length) {
    dialogue({ ton: "warn", titre: "Rien à marquer",
      corps: `<p>Tout ce qui précède <b>${esc(s2.n)}</b> est déjà validé.</p>`,
      actions: [{ texte: "D'accord", pri: true }] });
    return;
  }
  const actions = [{ texte: "Annuler" }];
  if (ligne.length && ligne.length < bloc.length)
    actions.push({ texte: `Dans ${s2.row.n} seulement (${ligne.length})`, faire: () => faire("ligne") });
  actions.push({ texte: `Tout ce qui précède (${bloc.length})`, pri: true, faire: () => faire("bloc") });
  dialogue({ ton: "warn", titre: "J'en suis là",
    corps: `<p>Tu travailles sur <b>${esc(s2.row.n)} · ${esc(s2.n)}</b>. Les étapes avant elle
      seront comptées comme acquises — ${plural(bloc.length, "étape")}, ${somme(bloc)},
      ${ligne.length && ligne.length < bloc.length ? `dont ${plural(ligne.length, "étape")} dans cette ligne,` : ""}
      sans date : elles ne gonfleront pas ton rythme du jour.</p>
      <p class="petit">Une étape se rouvre en la décochant.</p>`,
    actions });
}

/* ═════════ COURBE DE PROGRESSION ═════════
   Deux séries : le plan, en gris, sert de repère ; les heures réellement faites
   portent la couleur du statut — c'est elle qu'on vient lire. La ligne du fait
   s'arrête à aujourd'hui : on ne dessine pas un avenir qui n'existe pas. */
/* ═════════ BLOCAGES ═════════
   Certaines étapes ne peuvent pas avancer sans quelqu'un : une question au
   tuteur, un corrigé qui n'est pas encore sorti. L'application les reproposait
   chaque matin et les comptait en retard — ce qui n'aide en rien et décourage.

   Une étape bloquée sort du planning du jour. Elle ne sort pas du retard :
   le travail reste à faire, le retard le compte toujours. Seule l'alarme
   quotidienne se tait, parce qu'elle réclamait l'impossible. */

const estBloque = (id) => Boolean(bloques[id]);
const heuresBloquees = () => ALL.reduce((a, s2) => a + (estBloque(s2.id) ? resteDe(s2) : 0), 0);

function basculerBlocage(id, bloque, note = "") {
  const s2 = byId[id];
  if (!s2 || !canEdit) return;
  if (bloque) {
    bloques[id] = { n: String(note || "").slice(0, 500), le: new Date(NOW).toISOString() };
    log(`s'est déclaré bloqué sur ${s2.row.n} · ${s2.n}`);
  } else {
    delete bloques[id];
    log(`n'est plus bloqué sur ${s2.row.n} · ${s2.n}`);
  }
  saveProgress(); renderAll();
  // renderAll ne connaît pas la fiche : sans ceci, la coche s'enregistre mais
  // le champ de note n'apparaît jamais.
  if (vueCourante === "fiche") renderFiche();
}

/**
 * La note s'écrit à deux endroits : dans la fiche et dans le panneau des
 * blocages. On tient les deux en accord sans tout redessiner — un rendu complet
 * pendant qu'on tape volerait le curseur et effacerait la fin du mot.
 */
function noterBlocage(id, note) {
  if (!bloques[id]) return;
  const v = String(note || "").slice(0, 500);
  if (bloques[id].n === v) return;
  bloques[id].n = v;
  document.querySelectorAll(`[data-note="${CSS.escape(id)}"], #ficheBloqueNote`)
    .forEach((t) => { if (t !== document.activeElement && t.value !== v) t.value = v; });
  saveState();
}

function renderEtapesBloquees() {
  const box = $("bloquees");
  if (!box) return;
  const l = ALL.filter((s2) => estBloque(s2.id));
  const bloc = $("blocbloc");
  if (bloc) bloc.hidden = l.length === 0;
  if (!l.length) { box.innerHTML = ""; return; }

  const h = heuresBloquees();
  box.innerHTML = `
    <p class="aide">Ces étapes ne sont plus proposées dans ta journée. Elles restent
      dans ton retard : <b>${unH(h)}</b> qui attendent quelqu'un, pas toi.</p>
    ${l.map((s2) => {
      const b = bloques[s2.id];
      return `<details class="blq" style="--c:${esc(s2.g.c)}">
        <summary>
          <span class="bnom"><b>${esc(s2.n)}</b> <em>${esc(s2.row.n)}</em></span>
          <span class="bh">${unH(resteDe(s2))}</span>
          <span class="bdate">depuis le ${fmtDY(Date.parse(b.le) || NOW)}</span>
        </summary>
        <div class="blqcorps">
          <label class="ch"><span>De quoi as-tu besoin ?</span>
            <textarea data-note="${esc(s2.id)}" rows="2" maxlength="500"
              placeholder="La question à poser au tuteur, ce qui manque…"
              ${canEdit ? "" : "readonly"}>${esc(b.n || "")}</textarea></label>
          <div class="actes">
            <button class="btn" data-fiche="${esc(s2.id)}">Ma fiche</button>
            ${canEdit ? `<button class="btn pri" data-debloque="${esc(s2.id)}">Je ne suis plus bloqué</button>` : ""}
          </div>
        </div>
      </details>`;
    }).join("")}`;
}

/* ═════════ FICHES ═════════
   Ce que l'application gardait d'une étape : faite ou non, les heures posées,
   une note si c'était un devoir. Rien de ce qu'on y avait compris. On validait
   « SP 6 · Mission 1 » et il n'en restait aucune trace.

   Une fiche tient le reste : le texte qu'on écrit, les photos d'une page
   manuscrite. Elle vit à l'endroit où le planning a rangé l'étape, donc on la
   retrouve en révisant sans avoir à se souvenir où on l'avait mise. */

const laFiche = (id) => fiches[id] || null;
const aUneFiche = (id) => { const f = fiches[id]; return Boolean(f && (f.t || (f.p || []).length)); };

function poserFiche(id, champs) {
  const f = fiches[id] || (fiches[id] = { t: "", p: [] });
  Object.assign(f, champs, { m: new Date(NOW).toISOString() });
  if (!f.t && !(f.p || []).length) delete fiches[id];
  saveState();
}

let ficheOuverte = null;

function ouvrirFiche2(id) {
  const s2 = byId[id];
  if (!s2) return;
  ficheOuverte = id;
  aller("fiche", id);
}

async function renderFiche() {
  const box = $("ficheBox");
  if (!box) return;
  const id = argCourant || ficheOuverte;
  const s2 = byId[id];
  if (!s2) {
    box.innerHTML = `<div class="vide">Cette étape n'existe plus.
      <button class="btn" data-aller="planning">Revenir</button></div>`;
    return;
  }
  const f = laFiche(id) || { t: "", p: [] };
  const fait = faitDe(id);

  box.innerHTML = `
    <div class="fichetete" style="--c:${esc(s2.g.c)}">
      <div class="matiere">${esc(s2.g.name)}</div>
      <h2>${esc(s2.n)}</h2>
      <div class="ssq">${esc(s2.row.n)} · ${unH(fait)} sur ${unH(s2.h)}
        ${f.m ? ` · modifiée le ${fmtDY(Date.parse(f.m))}` : ""}</div>
      <div class="actes">
        <button class="btn" data-chrono="${esc(id)}">Travailler dessus</button>
        ${s2.row.url ? `<a class="btn" href="${esc(s2.row.url)}" target="_blank" rel="noopener">Ouvrir le cours ↗</a>` : ""}
      </div>
    </div>

    <textarea id="ficheTexte" class="fichetexte" ${canEdit ? "" : "readonly"}
      placeholder="Ce que tu as compris, une formule, un piège à ne pas refaire…">${esc(f.t || "")}</textarea>
    <div class="fl2" id="ficheEtat"></div>

    <div class="zbloc${estBloque(id) ? " on" : ""}">
      <label class="bascule"><input type="checkbox" id="ficheBloque"
          ${estBloque(id) ? "checked" : ""}${canEdit ? "" : " disabled"}>
        <span class="piste"></span>
        <span class="dit">Je suis bloqué — il me faut de l'aide pour avancer</span></label>
      ${estBloque(id) ? `<label class="ch"><span>De quoi as-tu besoin ?</span>
        <textarea id="ficheBloqueNote" rows="2" maxlength="500"
          placeholder="La question à poser au tuteur, ce qui manque…"
          ${canEdit ? "" : "readonly"}>${esc((bloques[id] || {}).n || "")}</textarea></label>
        <p class="aide">Cette étape ne sera plus proposée dans ta journée.
          Elle reste dans ton retard — le travail est toujours à faire.</p>` : ""}
    </div>

    <div class="soustitre">Photos</div>
    <div class="fichephotos" id="fichePhotos"></div>
    ${canEdit ? `<input type="file" id="ficheFichier" accept="image/*" class="horsvue">
      <button class="btn" id="fichePhoto">Ajouter une photo</button>` : ""}`;

  renderFichePhotos(id);

  if (!canEdit) return;
  const t = $("ficheTexte");
  t.oninput = () => {
    $("ficheEtat").textContent = "…";
    // L'état part en entier à chaque enregistrement. On attend donc que la frappe
    // se soit vraiment arrêtée, et on ne renvoie rien si le texte n'a pas bougé —
    // sinon écrire dix minutes renvoie l'état des centaines de fois.
    differer("fiche:" + id, 2500, () => {
      const v = t.value.slice(0, 20000);
      if (v === (laFiche(id) || {}).t) { const e = $("ficheEtat"); if (e) e.textContent = ""; return; }
      poserFiche(id, { t: v });
      const e = $("ficheEtat");
      if (e) {
        e.textContent = "enregistrée";
        setTimeout(() => { const x = $("ficheEtat"); if (x && x.textContent === "enregistrée") x.textContent = ""; }, 1500);
      }
      majFichePastilles();
    });
  };

  const fb = $("ficheBloque");
  if (fb) fb.onchange = () => basculerBlocage(id, fb.checked, (bloques[id] || {}).n || "");
  const fbn = $("ficheBloqueNote");
  // Même clé que le panneau des blocages : c'est la même note, elle ne doit
  // pas partir deux fois ni se doubler elle-même.
  if (fbn) fbn.oninput = () => differer("note:" + id, 2500, () => noterBlocage(id, fbn.value));

  $("fichePhoto").onclick = () => $("ficheFichier").click();
  $("ficheFichier").onchange = async (e) => {
    const fichier = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!fichier) return;
    const etat = $("ficheEtat");
    etat.textContent = "préparation…";
    try {
      // 1600 px : une page manuscrite doit rester lisible une fois agrandie.
      const chemin = await rangerPhoto(await preparerImage(fichier, 1600, 0.82));
      const fi = laFiche(id) || { t: "", p: [] };
      poserFiche(id, { p: [...(fi.p || []), chemin].slice(0, 20) });
      etat.textContent = "";
      renderFichePhotos(id);
      majFichePastilles();
    } catch (err) {
      etat.innerHTML = `<b class="late">${esc(String(err.message || err))}</b>`;
    }
  };
}

async function renderFichePhotos(id) {
  const box = $("fichePhotos");
  if (!box) return;
  const f = laFiche(id);
  const l = (f && f.p) || [];
  if (!l.length) { box.innerHTML = `<div class="fl2">Aucune photo.</div>`; return; }
  const par = await adressesPhotos(l);
  const restees = l.filter((c) => !par.has(c)).length;
  box.innerHTML = l.filter((c) => par.has(c)).map((c) => `<figure class="fph">
    <img src="${esc(par.get(c))}" alt="Photo de la fiche" loading="lazy">
    ${canEdit ? `<button class="btn mini" data-fph="${esc(c)}" title="Retirer">✕</button>` : ""}
  </figure>`).join("") + (restees ? `<div class="fl2">${plural(restees, "photo")} restée(s)
    sur l'ancien serveur, en pause : elles ne s'affichent plus ici.</div>` : "");
}

function retirerPhotoFiche(chemin) {
  const id = argCourant || ficheOuverte;
  const f = laFiche(id);
  if (!f) return;
  poserFiche(id, { p: (f.p || []).filter((x) => x !== chemin) });
  oublierPhoto(chemin).catch(() => {});
  renderFichePhotos(id);
  majFichePastilles();
}

/** Une étape qui porte une fiche se signale dans la liste : sans ça, on ne sait
 *  pas où l'on a déjà écrit, et on réécrit. */
function majFichePastilles() {
  document.querySelectorAll(".step[data-step]").forEach((l) => {
    l.classList.toggle("afiche", aUneFiche(l.dataset.step));
  });
}

/* ═════════ SÉANCES ET MINUTEUR ═════════
   L'application savait ce qu'on valide, jamais ce que ça coûte. Une étape de six
   heures finie en trois et une finie en dix se ressemblaient exactement dans les
   données : le planning ne pouvait donc rien apprendre, il n'avait que la durée
   du CNED — une moyenne pour tout le monde, jamais la tienne.

   Une séance enregistre le temps réellement passé. De là vient le seul chiffre
   qui manquait : le facteur de réalité, temps réel divisé par temps indicatif.

   Le minuteur vit dans le navigateur, pas en mémoire : un téléphone qui verrouille
   son écran gèle l'onglet, et un compteur qui s'incrémente à la seconde perdrait
   tout. On ne garde que des horodatages, et l'écoulé se recalcule à l'horloge. */

const CLE_MIN = "ciel.minuteur";
let minuteur = null;          // { etape, debut, cumul, pause, pom, phase, cycle }
let battement = null;

const POM = { travail: 25 * 60, pause: 5 * 60, longue: 15 * 60, avantLongue: 4 };
/** Sous ce seuil, on a ouvert le minuteur par erreur : rien n'est enregistré. */
const FAUX_DEPART = 30;

function lireMinuteur() {
  try { minuteur = JSON.parse(localStorage.getItem(CLE_MIN) || "null"); }
  catch { minuteur = null; }
  if (minuteur && !byId[minuteur.etape]) minuteur = null;   // étape disparue du programme
  return minuteur;
}
function poserMinuteur() {
  try {
    if (minuteur) localStorage.setItem(CLE_MIN, JSON.stringify(minuteur));
    else localStorage.removeItem(CLE_MIN);
  } catch { /* navigation privée : le minuteur ne survivra pas au rechargement */ }
}

/** Secondes effectivement travaillées, pauses déduites, recalculées à l'horloge. */
function ecoule(m = minuteur) {
  if (!m) return 0;
  const base = m.cumul || 0;
  return m.pause ? base : base + Math.max(0, Math.floor((Date.now() - m.depuis) / 1000));
}

/** Le cadran du minuteur. `mmss` existe déjà, pour les minutes d'un planning. */
const cadran = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + ":" + String(r).padStart(2, "0");
};

function demarrerMinuteur(etapeId, { pom = false } = {}) {
  const s2 = byId[etapeId];
  if (!s2 || !canEdit) return;
  if (minuteur && minuteur.etape !== etapeId) arreterMinuteur({ silencieux: true });
  minuteur = { etape: etapeId, depuis: Date.now(), cumul: 0, pause: false,
               pom, phase: "travail", cycle: 0, pauses: 0, debutLe: new Date(NOW).toISOString() };
  poserMinuteur(); battre(); aller("minuteur", etapeId);
}

function basculerPause() {
  if (!minuteur) return;
  if (minuteur.pause) { minuteur.depuis = Date.now(); minuteur.pause = false; }
  else { minuteur.cumul = ecoule(); minuteur.pause = true; minuteur.pauses++; }
  poserMinuteur(); renderMinuteur();
}

/**
 * Clôt la séance. `pose` est le nombre d'heures d'avance à créditer : on propose
 * le temps réel, mais c'est bien ce qu'on a avancé qu'on valide, pas ce qu'on a
 * passé — sinon une heure de ramage compterait comme une heure de programme.
 */
function arreterMinuteur({ pose = 0, fini = false, silencieux = false } = {}) {
  if (!minuteur) return null;
  const sec = ecoule(), s2 = byId[minuteur.etape];
  const m = minuteur;
  minuteur = null; poserMinuteur();
  if (battement) { clearInterval(battement); battement = null; }
  if (!s2 || sec < FAUX_DEPART) return null;
  const seance = { e: m.etape, d: m.debutLe, s: sec, p: m.pauses || 0,
                   pom: Boolean(m.pom), h: 0 };
  if (pose > 0) { poserHeures(s2, isoJour(new Date(NOW)), pose); seance.h = pose; }
  if (fini) poserHeures(s2, isoJour(new Date(NOW)), resteDe(s2));
  seances.unshift(seance);
  // Une année de travail tient largement ici ; au-delà, on ne garde que le récent.
  if (seances.length > 400) seances.length = 400;
  if (!silencieux) {
    log(`a travaillé ${unDuree(sec)} sur ${s2.row.n} · ${s2.n}` +
        (pose > 0 ? ` et validé ${unH(pose)}` : ""));
    saveProgress(); renderAll();
  }
  return seance;
}

const unDuree = (sec) => {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
};

/** Le battement ne sert qu'à redessiner : il ne compte rien, l'horloge s'en charge. */
function battre() {
  if (battement) clearInterval(battement);
  battement = setInterval(() => {
    if (!minuteur) { clearInterval(battement); battement = null; return; }
    if (minuteur.pom && !minuteur.pause) verifierPomodoro();
    // Seule l'horloge bouge. Réécrire le panneau entier chaque seconde
    // détruirait le focus, la case pomodoro sous le doigt, et la sélection.
    if (vueCourante === "minuteur") tictac();
  }, 1000);
}

/** Met à jour le seul chiffre qui change, sans toucher au reste du panneau. */
function tictac() {
  const t = $("chronoTemps"), so = $("chronoSous"), eq = $("chronoVaut");
  if (!t || !minuteur) return;
  const sec = ecoule();
  t.textContent = cadran(sec);
  if (so) so.textContent = sousTitreMinuteur(sec);
  if (eq) {
    const m = mesureDe(minuteur.etape);
    eq.textContent = unH(Math.max(0, m ? sec / 3600 / m.facteur : sec / 3600));
  }
  const c = t.closest(".cadran");
  if (c) {
    c.classList.toggle("tourne", !minuteur.pause);
    c.classList.toggle("repos", Boolean(minuteur.pom) && minuteur.phase === "repos");
  }
}

function sousTitreMinuteur(sec) {
  if (!minuteur) return "prêt";
  if (minuteur.pause) return "en pause";
  if (!minuteur.pom) return "en cours";
  const cible = minuteur.phase === "travail" ? POM.travail
    : (minuteur.cycle % POM.avantLongue === 0 ? POM.longue : POM.pause);
  const dans = Math.max(0, sec - (minuteur.ancre || 0));
  return `${minuteur.phase === "travail" ? "travail" : "pause"} · ${cadran(Math.max(0, cible - dans))} restantes`;
}

/** Le pomodoro ne coupe rien tout seul : il annonce, on décide. */
function verifierPomodoro() {
  const cible = minuteur.phase === "travail" ? POM.travail
    : (minuteur.cycle % POM.avantLongue === 0 ? POM.longue : POM.pause);
  const depuisPhase = ecoule() - (minuteur.ancre || 0);
  if (depuisPhase < cible || minuteur.sonne === minuteur.cycle + ":" + minuteur.phase) return;
  minuteur.sonne = minuteur.cycle + ":" + minuteur.phase;
  poserMinuteur();
  const box = $("pomAlerte");
  if (box) {
    box.hidden = false;
    box.textContent = minuteur.phase === "travail"
      ? "25 minutes. Une pause de 5 minutes tiendrait la distance."
      : "Fin de la pause. On repart ?";
  }
}

function phaseSuivante() {
  if (!minuteur) return;
  minuteur.ancre = ecoule();
  if (minuteur.phase === "travail") { minuteur.phase = "repos"; minuteur.cycle++; }
  else minuteur.phase = "travail";
  minuteur.sonne = null;
  const box = $("pomAlerte"); if (box) box.hidden = true;
  poserMinuteur(); renderMinuteur();
}

function renderMinuteur() {
  const box = $("minuteurBox");
  if (!box) return;
  const id = argCourant || (minuteur && minuteur.etape);
  const s2 = byId[id];
  if (!s2) {
    box.innerHTML = `<div class="vide">Cette étape n'existe plus.
      <button class="btn" data-aller="jour">Revenir</button></div>`;
    return;
  }
  const actif = minuteur && minuteur.etape === id;
  const sec = actif ? ecoule() : 0;
  const fait = faitDe(s2.id), reste = resteDe(s2);
  const mes = mesureDe(s2.id);
  // Ce que ce temps vaut en avance, si le rythme observé se confirme.
  const equivalent = mes ? sec / 3600 / mes.facteur : sec / 3600;
  const pom = actif && minuteur.pom;

  box.innerHTML = `
    <div class="chro" style="--c:${esc(s2.g.c)}">
      <div class="chrotete">
        <div class="matiere">${esc(s2.g.name)}</div>
        <h2>${esc(s2.n)}</h2>
        <div class="ssq">${esc(s2.row.n)}</div>
      </div>

      <div class="cadran${actif && !minuteur.pause ? " tourne" : ""}${
        pom && minuteur.phase === "repos" ? " repos" : ""}">
        <div class="temps" id="chronoTemps">${cadran(sec)}</div>
        <div class="sous" id="chronoSous">${actif ? sousTitreMinuteur(sec) : "prêt"}</div>
      </div>

      <div class="pomAlerte" id="pomAlerte" hidden></div>

      <div class="chroboutons">
        <button class="btn" data-fiche="${esc(s2.id)}">Ma fiche${
          aUneFiche(s2.id) ? " ✓" : ""}</button>
        ${!actif
          ? `<button class="btn pri gros" data-min="demarrer">Démarrer</button>`
          : `<button class="btn gros" data-min="pause">${minuteur.pause ? "Reprendre" : "Pause"}</button>
             <button class="btn pri gros" data-min="arreter">Terminer</button>`}
        ${pom && actif ? `<button class="btn" data-min="phase">Passer à la ${
          minuteur.phase === "travail" ? "pause" : "suite"}</button>` : ""}
      </div>

      <label class="bascule chropom"><input type="checkbox" id="pomOn"
          ${pom ? "checked" : ""}${actif && !minuteur.pom ? "" : ""}>
        <span class="piste"></span>
        <span class="dit">Pomodoro — 25 min de travail, 5 de pause</span></label>

      <div class="chrofaits">
        <div class="cf"><div class="k">Cette étape</div>
          <div class="v">${unH(fait)}<span class="u"> / ${unH(s2.h)}</span></div>
          <div class="d">${reste > 0.01 ? `${unH(reste)} à poser` : "terminée"}</div></div>
        <div class="cf"><div class="k">Ton facteur</div>
          <div class="v">${mes ? "×" + mes.facteur.toFixed(2).replace(".", ",") : "—"}</div>
          <div class="d">${mes
            ? `${mes.propre ? "sur cette étape" : "sur " + esc(s2.g.name.split("—")[0].trim())},
               ${plural(mes.seances, "séance")}. ${mes.facteur > 1.05
                 ? "Elle te coûte plus que l'indicatif."
                 : mes.facteur < 0.95 ? "Elle te coûte moins que l'indicatif."
                 : "Tu es sur le rythme du référentiel."}`
            : "Termine une séance pour que l'application apprenne ton rythme."}</div></div>
        ${actif ? `<div class="cf"><div class="k">Ça vaut</div>
          <div class="v" id="chronoVaut">${unH(Math.max(0, equivalent))}</div>
          <div class="d">d'avance sur le programme, à ton rythme observé.</div></div>` : ""}
      </div>
    </div>`;

  const pb = $("pomOn");
  if (pb) pb.onchange = () => {
    if (minuteur && minuteur.etape === id) {
      minuteur.pom = pb.checked; minuteur.ancre = ecoule();
      minuteur.phase = "travail"; minuteur.sonne = null; poserMinuteur();
    }
    prefPom = pb.checked;
    try { localStorage.setItem("ciel.pomodoro", prefPom ? "1" : ""); } catch {}
    renderMinuteur();
  };
}

let prefPom = false;
try { prefPom = Boolean(localStorage.getItem("ciel.pomodoro")); } catch {}

/** Terminer : on demande ce qui a vraiment avancé, pas ce qui s'est écoulé. */
function finirSeance() {
  if (!minuteur) return;
  const s2 = byId[minuteur.etape], sec = ecoule();
  const mes = mesureDe(s2.id);
  // Proposition : le temps passé, corrigé du facteur observé, borné au reste.
  const brut = mes ? sec / 3600 / mes.facteur : sec / 3600;
  const propose = Math.min(resteDe(s2), Math.round(brut * 4) / 4);
  dialogue({
    titre: `${unDuree(sec)} sur ${s2.n}`,
    ton: "info",
    corps: `<p class="aide">Combien d'heures du programme cela a-t-il fait avancer ?
        Le temps passé et l'avance ne sont pas la même chose — c'est justement l'écart
        entre les deux que l'application apprend.</p>
      <label class="ch"><span>Heures validées</span>
        <input type="number" id="poseH" min="0" max="${s2.h}" step="0.25" value="${propose}"></label>
      <p class="aide">Reste ${unH(resteDe(s2))} sur cette étape.</p>`,
    actions: [
      { texte: "Valider", pri: true, faire: () => {
          const v = parseFloat(($("poseH") || {}).value);
          arreterMinuteur({ pose: isNaN(v) ? 0 : Math.max(0, v) });
          proposerSuite(s2);
        } },
      { texte: "J'ai fini l'étape", faire: () => {
          arreterMinuteur({ fini: true }); aller("jour");
        } },
      { texte: "Rien validé", faire: () => { arreterMinuteur({ pose: 0 }); aller("jour"); } },
    ],
  });
  setTimeout(() => { const i = $("poseH"); if (i) { i.focus(); i.select(); } }, 60);
}

/** La question que le minuteur permet enfin de poser : on continue, ou on décale ? */
function proposerSuite(s2) {
  const reste = resteDe(s2);
  if (reste <= 0.01) { aller("jour"); return; }
  const mes = mesureDe(s2.id);
  const attendu = mes ? reste * mes.facteur : reste;
  dialogue({
    titre: "On continue, ou on décale ?",
    ton: "info",
    corps: `<p class="aide">Il reste <b>${unH(reste)}</b> sur cette étape —
      environ <b>${unDuree(attendu * 3600)}</b> à ton rythme.
      ${mes && mes.facteur > 1.1
        ? `Elle te coûte <b>${Math.round((mes.facteur - 1) * 100)} %</b> de plus que l'indicatif :
           le planning en tiendra compte pour la suite.`
        : ""}</p>`,
    actions: [
      { texte: "Repartir dessus", pri: true, faire: () => demarrerMinuteur(s2.id, { pom: prefPom }) },
      { texte: "Passer à autre chose", faire: () => aller("jour") },
    ],
  });
}

/* ═════════ FACTEUR DE RÉALITÉ ═════════
   Temps réellement passé divisé par temps indicatif, sur les séances qui ont
   validé des heures. Au-dessus de 1, une étape coûte plus cher que ce que le
   CNED annonce ; au-dessous, moins. C'est le seul chiffre qui dise si le plan
   parle de toi ou d'un élève moyen. */

/** Le facteur d'une étape, ou de sa matière si l'étape n'a pas d'historique. */
function mesureDe(etapeId) {
  const s2 = byId[etapeId];
  if (!s2) return null;
  const pertinentes = seances.filter((x) => x.h > 0.01 && byId[x.e]);
  const propre = pertinentes.filter((x) => x.e === etapeId);
  const meme = pertinentes.filter((x) => byId[x.e].g === s2.g);
  const lot = propre.length ? propre : (meme.length >= 3 ? meme : null);
  if (!lot) return null;
  const sec = lot.reduce((a, x) => a + x.s, 0);
  const heures = lot.reduce((a, x) => a + x.h, 0);
  if (heures <= 0) return null;
  return { facteur: sec / 3600 / heures, seances: lot.length,
           propre: propre.length > 0, matiere: s2.g };
}

/**
 * Le panneau du rythme réel. Une matière par ligne : son facteur, et la courbe
 * de ses séances dans le temps. Un facteur qui descend, c'est qu'on apprend —
 * et c'est le seul endroit de l'application où ça se voit.
 */
function renderRendement() {
  const box = $("rendement");
  if (!box) return;
  const par = facteursParMatiere();
  const total = seances.length;

  if (!par.length) {
    box.innerHTML = `<div class="vide">Aucune séance mesurée pour l'instant.
      ${total ? `${plural(total, "séance")} enregistrée${total > 1 ? "s" : ""}, mais aucune
        n'a validé d'heures : c'est le rapport entre les deux qui fait la mesure.`
      : `Touche l'icône de minuteur sur une tâche de la journée : l'application saura
         ce qu'une étape te coûte vraiment, au lieu de croire la moyenne du CNED.`}</div>`;
    return;
  }

  const global = par.reduce((a, d) => a + d.sec, 0) / 3600 /
                 par.reduce((a, d) => a + d.h, 0);
  const ligne = (d) => {
    const f = d.facteur;
    const classe = f > 1.15 ? "lent" : f < 0.9 ? "vite" : "juste";
    // La barre se lit autour de 1 : à gauche plus rapide que l'indicatif, à droite plus lent.
    const pos = Math.max(4, Math.min(96, 50 + (Math.log(f) / Math.log(2)) * 50));
    return `<div class="rend ${classe}" style="--c:${esc(d.g.c)}">
      <div class="rtete"><span class="rnom">${esc(short(d.g))}</span>
        <span class="rfac">×${f.toFixed(2).replace(".", ",")}</span></div>
      <div class="rbarre"><i style="left:${pos}%"></i><u></u></div>
      <div class="rdetail">${plural(d.n, "séance")} ·
        ${unDuree(d.sec)} passées pour ${unH(d.h)} validées${
        d.points.length >= 3 ? " · " + tendanceTexte(d.points) : ""}</div>
      ${d.points.length >= 2 ? courbeFacteur(d.points) : ""}
    </div>`;
  };

  box.innerHTML = `
    <div class="rglobal">Toutes matières confondues, une heure de programme te demande
      <b>${unDuree(global * 3600)}</b>. ${global > 1.1
        ? `Le référentiel est optimiste pour toi — ce n'est ni bon ni mauvais signe,
           c'est une information que le planning peut enfin utiliser.`
        : global < 0.9
        ? `Tu vas plus vite que le référentiel.`
        : `Tu es sur le rythme du référentiel.`}</div>
    <div class="rends">${par.map(ligne).join("")}</div>`;
}

/* ═════════ PRÉVISION PAR MATIÈRE ═════════
   Le diagramme dit où l'on en est. Ce tableau dit où l'on va : pour chaque
   matière, ce qui reste, ce que ça coûtera vraiment, et si ça tient avant
   l'échéance de la matière — pas seulement avant l'examen. */

const echeanceDe = (etapes) => Math.max(...etapes.map((s2) => s2.t1));

/** Au-delà, une date projetée cesse d'être une prévision : c'est un chiffre
 *  qui affole sans rien dire. On nomme l'impasse et on donne l'effort à fournir. */
const HORIZON_PREV = 18 * 30 * DAY;

function previsions() {
  const ry = rythmeTravail();
  const parJour = ry && ry.hParJour > 0 ? ry.hParJour : 0;
  const total = GROUPES.reduce((a, g) => a + g.rows.reduce(
    (b, r) => b + r.steps.reduce((c, s2) => c + resteReel(s2), 0), 0), 0);

  return GROUPES.map((g) => {
    const etapes = g.rows.flatMap((r) => r.steps);
    const resteInd = etapes.reduce((a, s2) => a + resteDe(s2), 0);
    const resteVrai = etapes.reduce((a, s2) => a + resteReel(s2), 0);
    const fait = etapes.reduce((a, s2) => a + faitDe(s2.id), 0);
    const tardives = etapes.filter(isLate);
    const mes = etapes.length ? mesureDe(etapes[0].id) : null;
    // Part du temps qui revient à cette matière, au prorata de ce qu'il lui reste.
    const part = total > 0 ? resteVrai / total : 0;
    const jours = parJour > 0 && part > 0 ? resteVrai / (parJour * part) : null;
    const fin = jours != null ? NOW + jours * DAY : null;
    // Le rythme qu'il faudrait tenir sur cette matière pour tenir son échéance.
    const reste_j = Math.max(1, (echeanceDe(etapes) - NOW) / DAY);
    const requis = resteVrai > 0.01 ? (resteVrai / reste_j) * 7 : 0;
    // L'échéance de la matière, pas celle de l'examen : une matière finie en
    // juin quand son dernier devoir tombe en mars n'est pas « dans les temps ».
    const echeance = echeanceDe(etapes);
    return { g, resteInd, resteVrai, fait, h: g.h, tardives: tardives.length,
             facteur: mes ? mes.facteur : null, fin, echeance, requis,
             actuel: parJour * part * 7,
             marge: fin != null ? Math.round((echeance - fin) / DAY) : null };
  }).filter((p) => p.h > 0);
}

function renderPrevision() {
  const box = $("prevision");
  if (!box) return;
  const l = previsions();
  const ry = rythmeTravail();

  if (!ry || ry.hParJour <= 0) {
    box.innerHTML = `<div class="vide">Valide quelques heures : la prévision part de
      ton rythme réel, pas d'une moyenne.</div>`;
    return;
  }

  const etat = (p) => {
    if (p.resteVrai <= 0.01) return { c: "fini", t: "Terminée" };
    if (p.marge == null) return { c: "", t: "—" };
    if (p.fin - NOW > HORIZON_PREV) return { c: "late", t: "Hors d'atteinte" };
    if (p.marge < 0) return { c: "late", t: `${-p.marge} j de trop` };
    if (p.marge < 14) return { c: "serre", t: `${p.marge} j de marge` };
    return { c: "ok", t: `${p.marge} j de marge` };
  };
  const quandFin = (p) => p.resteVrai <= 0.01 ? "—"
    : p.fin == null ? "—"
    : p.fin - NOW > HORIZON_PREV ? "au-delà" : fmtDY(p.fin);

  box.innerHTML = `
    <p class="aide">À ton rythme des quatre dernières semaines, et en répartissant
      ton temps entre les matières au prorata de ce qui leur reste.</p>
    <div class="scroll"><table class="prev">
      <thead><tr>
        <th>Matière</th><th class="num">Reste</th><th class="num">À ton rythme</th>
        <th class="num">Facteur</th><th>Fin prévue</th><th>Échéance</th>
        <th class="num">À tenir</th><th>Verdict</th>
      </tr></thead>
      <tbody>${l.map((p) => {
        const e = etat(p);
        return `<tr class="${e.c}${p.tardives ? " a-retard" : ""}">
          <td><span class="pastille" style="background:${esc(p.g.c)}"></span>${esc(short(p.g))}
            ${p.tardives ? `<span class="mini-rt">${p.tardives} en retard</span>` : ""}</td>
          <td class="num">${p.resteInd > 0.01 ? unH(p.resteInd) : "—"}</td>
          <td class="num">${p.resteVrai > 0.01 ? unH(p.resteVrai) : "—"}</td>
          <td class="num">${p.facteur ? "×" + p.facteur.toFixed(2).replace(".", ",") : "—"}</td>
          <td>${quandFin(p)}</td>
          <td>${fmtDY(p.echeance)}</td>
          <td class="num">${p.resteVrai > 0.01
            ? `${unH(p.requis)}<span class="par">/sem</span>` : "—"}</td>
          <td class="verdict">${e.t}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>
    <p class="pjpied">« À ton rythme » applique le facteur mesuré : une matière qui te
      coûte 1,4× occupe 1,4× plus de temps que ne le dit le référentiel. Sans séance
      mesurée, la colonne reprend l'indicatif — la prévision vaut alors ce que vaut
      la moyenne du CNED. <b>À tenir</b> est le rythme hebdomadaire qu'il faudrait sur
      cette matière pour tenir son échéance : c'est le seul chiffre du tableau sur
      lequel tu peux agir aujourd'hui.</p>`;
}

/** Pente sur les séances, en pourcentage par mois. Trois points au minimum. */
function tendanceTexte(points) {
  const MOIS = 30 * DAY;
  const n = points.length;
  const xs = points.map((p) => (p.t - points[0].t) / MOIS);
  const ys = points.map((p) => Math.log(p.f));            // le facteur est un rapport : on raisonne en log
  const mx = xs.reduce((a, x) => a + x, 0) / n, my = ys.reduce((a, y) => a + y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  if (den <= 0) return "pas assez d'écart dans le temps";
  const parMois = Math.expm1(num / den) * 100;
  if (Math.abs(parMois) < 4) return "stable";
  return parMois < 0
    ? `<b class="vite">${Math.round(-parMois)} % plus vite par mois</b>`
    : `<b class="lent">${Math.round(parMois)} % plus lent par mois</b>`;
}

/** Une courbe minuscule : chaque séance, dans le temps, autour de la ligne du 1. */
function courbeFacteur(points) {
  const L = 300, H = 44, m = 4;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const etendue = Math.max(1, t1 - t0);
  // Échelle logarithmique bornée à ×4 et ÷4 : au-delà, c'est une séance aberrante,
  // pas une tendance, et elle écraserait tout le reste.
  const Y = (f) => {
    const v = Math.max(-2, Math.min(2, Math.log(f) / Math.log(2)));
    return m + ((2 - v) / 4) * (H - 2 * m);
  };
  const X = (t) => m + ((t - t0) / etendue) * (L - 2 * m);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)} ${Y(p.f).toFixed(1)}`).join(" ");
  return `<svg class="rcourbe" viewBox="0 0 ${L} ${H}" role="img"
      aria-label="Facteur de chaque séance dans le temps">
    <line class="un" x1="${m}" x2="${L - m}" y1="${Y(1)}" y2="${Y(1)}"/>
    <path class="tr" d="${d}"/>
    ${points.map((p) => `<circle class="pt" cx="${X(p.t).toFixed(1)}" cy="${Y(p.f).toFixed(1)}" r="2.5"/>`).join("")}
  </svg>`;
}

/** Le facteur par matière, et son évolution semaine après semaine. */
function facteursParMatiere() {
  const par = new Map();
  for (const x of seances) {
    const s2 = byId[x.e];
    if (!s2 || x.h <= 0.01) continue;
    const g = s2.g;
    const d = par.get(g.id) || { g, sec: 0, h: 0, n: 0, points: [] };
    d.sec += x.s; d.h += x.h; d.n++;
    d.points.push({ t: Date.parse(x.d) || T0, f: x.s / 3600 / x.h });
    par.set(g.id, d);
  }
  return [...par.values()]
    .map((d) => ({ ...d, facteur: d.sec / 3600 / d.h,
                   points: d.points.sort((a, b) => a.t - b.t) }))
    .sort((a, b) => b.facteur - a.facteur);
}

/* ═════════ PROJECTION ═════════
   Deux questions, et on se garde de les mélanger. « À ce rythme, est-ce que je
   finis avant l'examen ? » se lit dans les heures validées. « Où va ma
   moyenne ? » se lit dans les notes. Rien dans ces données ne dit combien une
   heure de travail vaut de points : inventer ce coefficient donnerait un chiffre
   précis et faux. Le seul pont honnête entre les deux est la part du programme
   qu'on n'aura pas traitée — elle n'est dans aucune note, et c'est dit. */

const FENETRE_RYTHME = 28 * DAY;

/** « 15 févr. » pour une date de l'année suivante se lit comme une date proche,
 *  et retourne le sens de la phrase. L'année n'apparaît que si elle change. */
const fmtDY = (t) => new Date(t).getFullYear() === new Date(NOW).getFullYear()
  ? fmtD(t) : new Date(t).toLocaleDateString("fr-FR",
      { day: "numeric", month: "short", year: "numeric" });

/** Heures validées par jour. La fenêtre récente prime : un mois d'arrêt doit se
 *  voir, et une moyenne depuis septembre l'effacerait. */
function rythmeTravail() {
  const faits = [];
  for (const id in avance) {
    if (!byId[id]) continue;
    for (const j in avance[id]) {
      const t = Date.parse(j + "T12:00:00"), h = Number(avance[id][j]) || 0;
      if (h > 0 && !isNaN(t) && t <= NOW) faits.push({ t, h });
    }
  }
  faits.sort((a, b) => a.t - b.t);
  if (!faits.length) return null;
  const debut = faits[0].t;
  let depuis = Math.max(debut, NOW - FENETRE_RYTHME);
  // Moins de trois validations dans le mois : la fenêtre ne dit rien, on remonte.
  if (faits.filter((x) => x.t >= depuis).length < 3) depuis = debut;
  const heures = faits.filter((x) => x.t >= depuis).reduce((a, x) => a + x.h, 0);
  // Plancher d'un jour : sans lui, une seule journée chargée donne un rythme absurde.
  const jours = Math.max(1, (NOW - depuis) / DAY);
  return { hParJour: heures / jours, heures, jours, depuis, recent: depuis > debut };
}

function projection() {
  const st = status();
  const ry = rythmeTravail();
  // Ce qui reste, en heures réelles : c'est ce temps-là qu'il faudra trouver.
  const reste = ALL.reduce((a, s2) => a + resteReel(s2), 0);
  const jusquExam = Math.max(0, (+EXAM - NOW) / DAY);
  const p = { st, ry, reste, jusquExam, exam: +EXAM };
  p.hSemaineRequis = reste > 0 && jusquExam > 0 ? (reste / jusquExam) * 7 : 0;
  if (!ry || ry.hParJour <= 0) return p;
  p.hSemaine = ry.hParJour * 7;
  p.fin = reste > 0 ? NOW + (reste / ry.hParJour) * DAY : NOW;
  p.faitAuExam = Math.min(TOTAL_H, st.act + ry.hParJour * jusquExam);
  p.couverture = TOTAL_H > 0 ? p.faitAuExam / TOTAL_H : 1;
  p.manque = Math.max(0, TOTAL_H - p.faitAuExam);
  p.marge = Math.round((+EXAM - p.fin) / DAY);   // > 0 : fini avant l'examen
  return p;
}

/** Trois mois : au-delà, prolonger une droite tirée de quelques notes ne dit plus
 *  rien du tout. Mieux vaut projeter moins loin et le dire. */
const HORIZON_NOTES = 90 * DAY;

function projectionNotes() {
  const vals = DEVS.map((s) => ({ t: s.t1, v: grades[s.id] }))
    .filter((x) => typeof x.v === "number" && !isNaN(x.v))
    .sort((a, b) => a.t - b.t);
  if (!vals.length) return null;
  const n = vals.length;
  const moyenne = vals.reduce((a, x) => a + x.v, 0) / n;
  const r = { n, moyenne, total: DEVS.length };
  // Deux points font toujours une droite parfaite : ce n'est pas une tendance.
  if (n < 3) return r;
  const MOIS = 30 * DAY;
  const xs = vals.map((x) => (x.t - vals[0].t) / MOIS);
  const mx = xs.reduce((a, x) => a + x, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (vals[i].v - moyenne); den += (xs[i] - mx) ** 2; }
  if (den <= 0) return r;             // toutes les notes à la même date
  const pente = num / den, ord = moyenne - pente * mx;
  const cible = Math.min(+EXAM, vals[n - 1].t + HORIZON_NOTES);
  const xc = (cible - vals[0].t) / MOIS;
  const res = vals.map((x, i) => x.v - (ord + pente * xs[i]));
  // n-2 : deux paramètres estimés. Avec n = 3 la fourchette est large, et elle doit l'être.
  const sigma = Math.sqrt(res.reduce((a, e) => a + e * e, 0) / Math.max(1, n - 2));
  r.pente = pente;
  r.cible = cible;
  r.brideeParHorizon = cible < +EXAM - DAY;
  r.projetee = Math.max(0, Math.min(20, ord + pente * xc));
  r.fourchette = Math.max(0.5, sigma);
  return r;
}

/** Une demi-heure affichée « 1 h » est un mensonge d'arrondi, et c'est ce genre
 *  d'écart qui rend un total incompréhensible. Sous dix heures, on dit les
 *  minutes ; au-dessus, l'heure ronde suffit et se lit mieux. */
const unH = (h) => {
  if (h >= 10) return `${Math.round(h)} h`;
  const m = Math.round(h * 60);
  // Une durée non nulle ne doit jamais s'afficher « 0 h » : c'est un mensonge
  // par arrondi, et c'est exactement ce qu'on est censé ne plus faire.
  if (m === 0 && h > 0) return "moins d'1 min";
  if (m % 60 === 0) return `${m / 60} h`;
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
};
const unN = (v) => v.toFixed(1).replace(".", ",");

function renderProjection() {
  const box = $("proj");
  if (!box) return;
  const p = projection(), g = projectionNotes();
  const bl = [];

  /* — Où mène le rythme — */
  if (!p.ry) {
    bl.push(`<div class="pj"><div class="k">À ce rythme</div>
      <div class="v">—</div>
      <div class="d">Valide une première étape : la projection part de tes heures réelles,
        pas d'une moyenne inventée.</div></div>`);
  } else if (p.reste <= 0) {
    bl.push(`<div class="pj ok"><div class="k">Programme</div>
      <div class="v">Terminé</div>
      <div class="d">Toutes les heures sont validées : il n'y a plus rien à projeter.</div></div>`);
  } else {
    const tard = p.marge < 0;
    bl.push(`<div class="pj ${tard ? "late" : "ok"}">
      <div class="k">À ce rythme</div>
      <div class="v">${fmtDY(p.fin)}</div>
      <div class="d">${unH(p.hSemaine)} par semaine ces derniers temps.
        ${tard
          ? `C'est <b>${plural(-p.marge, "jour")}</b> après l'examen du ${fmtDY(p.exam)}.`
          : `Soit <b>${plural(p.marge, "jour")}</b> avant l'examen du ${fmtDY(p.exam)}.`}</div></div>`);
    bl.push(`<div class="pj"><div class="k">Rythme à tenir</div>
      <div class="v">${unH(p.hSemaineRequis)}<span class="u"> / semaine</span></div>
      <div class="d">Pour poser les <b>${unH(p.reste)}</b> qui restent avant l'examen.
        ${p.hSemaine >= p.hSemaineRequis
          ? `Tu es au-dessus.`
          : `Il te manque <b>${unH(p.hSemaineRequis - p.hSemaine)}</b> par semaine.`}</div></div>`);
  }

  /* — Où mènent les notes — */
  if (!g) {
    bl.push(`<div class="pj"><div class="k">Moyenne projetée</div>
      <div class="v">—</div>
      <div class="d">Saisis tes notes dans <b>Moi → Mon travail</b> pour qu'elle apparaisse.</div></div>`);
  } else if (!g.projetee) {
    bl.push(`<div class="pj"><div class="k">Moyenne actuelle</div>
      <div class="v">${unN(g.moyenne)}<span class="u"> /20</span></div>
      <div class="d">Sur ${plural(g.n, "note")}. Il en faut <b>trois</b> à des dates
        différentes pour qu'une tendance veuille dire quelque chose.</div></div>`);
  } else {
    const sens = g.pente > 0.15 ? "monte" : g.pente < -0.15 ? "baisse" : "tient";
    const cl = g.projetee >= 10 ? "ok" : "late";
    bl.push(`<div class="pj ${cl}"><div class="k">Moyenne projetée</div>
      <div class="v">${unN(g.projetee)}<span class="u"> /20</span></div>
      <div class="d">Fourchette <b>${unN(Math.max(0, g.projetee - g.fourchette))}</b>
        à <b>${unN(Math.min(20, g.projetee + g.fourchette))}</b>,
        ${g.brideeParHorizon ? `au ${fmtDY(g.cible)}` : `à l'examen`}.
        Ta moyenne ${sens} de <b>${unN(Math.abs(g.pente))} pt</b> par mois,
        sur ${plural(g.n, "note")}.</div></div>`);
  }

  let pied = "";
  if (p.ry && p.manque > 0.5) {
    pied = `Cette moyenne ne parle que de ce que tu auras traité. Au rythme actuel il te
      manquera <b>${unH(p.manque)}</b> à l'examen, soit <b>${Math.round((1 - p.couverture) * 100)} %</b>
      du programme — et ça, aucune note ne le mesure.`;
  } else if (g && g.projetee) {
    pied = `La projection prolonge la pente de tes notes ; elle suppose que rien ne change,
      ce qui n'arrive jamais tout à fait. Lis la fourchette, pas le chiffre.`;
  }
  if (p.ry && p.ry.recent) {
    pied += ` Le rythme est mesuré depuis le ${fmtDY(p.ry.depuis)} : tu n'as pas encore
      un mois d'historique.`;
  }
  // Les volumes viennent des « durées indicatives » du CNED. Indicatif veut dire
  // indicatif : c'est une moyenne, pas ton rythme, et tu peux la corriger.
  if (programme.modele !== "perso") {
    pied += ` Les volumes viennent des <b>durées indicatives</b> publiées par le CNED.
      Indicatif veut dire moyen : si une situation professionnelle te prend
      systématiquement plus ou moins de temps, rends ton programme modifiable dans
      <b>Moi → Mon travail</b> et corrige ses heures — tout ce qui est au-dessus suivra.`;
  }

  box.innerHTML = `<div class="pjs">${bl.join("")}</div>` +
    (pied ? `<div class="pjpied">${pied}</div>` : "");
}

/** Le cadre du graphique suit la largeur : sur 390 px, un viewBox de 960 réduit
 *  le texte à quatre pixels. Plus étroit, il reste lisible. */
const cadreCourbe = () => (window.innerWidth < 640
  ? { l: 42, r: 12, h: 22, b: 28, L: 460, H: 240 }
  : { l: 48, r: 16, h: 24, b: 30, L: 960, H: 250 });

/**
 * La fenêtre montrée grandit avec l'année : au début, dix mois d'axe écraseraient
 * dix jours d'historique en un trait de trois pixels. On garde toujours environ
 * six semaines de piste devant, jusqu'à couvrir l'année entière en juin.
 */
function fenetreCourbe() {
  const base = Math.max(NOW + 42 * DAY, T0 + (NOW - T0) * 1.35);
  // La date de fin projetée doit tenir dans le cadre : l'annoncer sans la montrer
  // laisserait le lecteur chercher un trait qui s'arrête au bord.
  const pr = projection();
  const vise = pr.fin ? Math.min(Math.max(pr.fin, +EXAM), T1) + 10 * DAY : base;
  return Math.min(T1, Math.max(base, vise));
}

/** Plan continu, réalisé en marches d'escalier, ~60 points sur la fenêtre. */
function pointsCourbe(tFin) {
  // Une étape étalée sur trois jours pose trois points, pas un seul le jour où
  // la case a été cochée : c'est la différence entre une courbe et un escalier faux.
  const faits = [];
  for (const id in avance) {
    if (!byId[id]) continue;
    for (const j in avance[id]) {
      const h = Number(avance[id][j]) || 0;
      // Une séance compte à la fin de sa journée — sauf aujourd'hui, où elle compte
      // maintenant : sinon la courbe ignore le travail du jour jusqu'à minuit,
      // pendant que la légende, elle, le compte déjà.
      if (h > 0) faits.push([Math.min(Date.parse(j + "T23:59:59") || T0, NOW), h]);
    }
  }
  faits.sort((a, b) => a[0] - b[0]);
  const cumule = (t) => faits.reduce((a, x) => a + (x[0] <= t ? x[1] : 0), 0);
  const pas = Math.max(DAY, (tFin - T0) / 60);
  const pts = [];
  for (let t = T0; t <= tFin; t += pas) pts.push({ t, prevu: planned(t), fait: t <= NOW ? cumule(t) : null });
  // Un point tombe exactement sur maintenant, pas sur le pas d'avant.
  if (NOW > T0 && NOW < tFin) pts.push({ t: NOW, prevu: planned(NOW), fait: cumule(NOW) });
  return pts.sort((a, b) => a.t - b.t);
}

function renderCourbe() {
  const box = $("courbe");
  if (!box) return;
  const CB = cadreCourbe();
  const st = status();
  const tFin = fenetreCourbe();
  const pts = pointsCourbe(tFin);
  const pr = projection();
  // Le trait projeté s'arrête au bord du cadre, ou au programme fini — le premier des deux.
  const tProj = pr.fin ? Math.min(pr.fin, tFin) : null;
  const hProj = tProj != null
    ? Math.min(TOTAL_H, pr.st.act + pr.ry.hParJour * ((tProj - NOW) / DAY)) : null;
  // Un programme déjà fini n'a pas d'avenir à tracer : la légende doit se taire aussi.
  const traceProj = tProj != null && tProj > NOW;
  // L'échelle verticale suit la fenêtre : sinon la courbe rampe au ras de l'axe.
  const haut = Math.max(20, hProj || 0, ...pts.map((p) => Math.max(p.prevu, p.fait || 0)));
  const pas = haut > 400 ? 200 : haut > 150 ? 50 : 10;
  const hMax = haut * 1.06;   // un peu d'air au-dessus, sans repère : rien ne l'atteint
  const X = (t) => CB.l + ((t - T0) / (tFin - T0)) * (CB.L - CB.l - CB.r);
  const Y = (h) => CB.H - CB.b - (h / hMax) * (CB.H - CB.h - CB.b);
  const ligne = (cle) => pts.filter((p) => p[cle] != null)
    .map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)} ${Y(p[cle]).toFixed(1)}`).join(" ");

  const faits = pts.filter((p) => p.fait != null);
  const dernier = faits[faits.length - 1];
  const aire = faits.length
    ? `${ligne("fait")} L${X(dernier.t).toFixed(1)} ${Y(0)} L${X(T0)} ${Y(0)} Z` : "";

  // Repères : uniquement des valeurs et des dates que la courbe atteint vraiment.
  // Aucun repère ne porte une valeur que la courbe n'atteint pas.
  const paliers = [0];
  for (let h = pas; h <= haut; h += pas) paliers.push(h);
  const jours = (tFin - T0) / DAY;
  const etroit = CB.L < 600;
  const saut = jours > (etroit ? 120 : 200) ? 2 : jours > (etroit ? 55 : 90) ? 1 : 0;
  const mois = [];
  if (saut) {
    for (const m = new Date(T0); m.getTime() <= tFin; m.setMonth(m.getMonth() + saut)) {
      // MONTHS est indexé sur l'année scolaire (septembre = 0), pas sur le calendrier.
      mois.push({ t: m.getTime(), n: MONTHS[(m.getMonth() - 8 + 12) % 12] });
    }
  } else {
    const pasDates = etroit ? 21 : 14;
    for (let t = T0; t <= tFin; t += pasDates * DAY) mois.push({ t, n: fmtD(t) });
  }

  box.innerHTML = `<svg viewBox="0 0 ${CB.L} ${CB.H}" role="img"
      aria-label="Heures faites face au plan, du ${fmtD(T0)} au ${fmtD(tFin)}">
    ${paliers.map((h) => `<line class="grille" x1="${CB.l}" x2="${CB.L - CB.r}"
        y1="${Y(h)}" y2="${Y(h)}"/>
      <text class="axe" x="${CB.l - 8}" y="${Y(h) + 4}" text-anchor="end">${Math.round(h)} h</text>`).join("")}
    ${mois.map((m) => `<text class="axe" x="${X(m.t)}" y="${CB.H - 9}" text-anchor="middle">${m.n}</text>`).join("")}
    <line class="auj" x1="${X(NOW)}" x2="${X(NOW)}" y1="${CB.h - 4}" y2="${CB.H - CB.b}"/>
    <text class="axe" x="${X(NOW)}" y="${CB.h - 9}" text-anchor="middle">aujourd'hui</text>
    ${+EXAM > T0 && +EXAM <= tFin ? `<line class="exam" x1="${X(+EXAM)}" x2="${X(+EXAM)}"
        y1="${CB.h - 4}" y2="${CB.H - CB.b}"/>
      <text class="axe exam" x="${X(+EXAM)}" y="${CB.h - 9}" text-anchor="middle">examen</text>` : ""}
    ${aire ? `<path class="aire" d="${aire}"/>` : ""}
    <path class="plan" d="${ligne("prevu")}"/>
    ${traceProj ? `<path class="proj" d="M${X(NOW).toFixed(1)} ${Y(pr.st.act).toFixed(1)}
      L${X(tProj).toFixed(1)} ${Y(hProj).toFixed(1)}"/>` : ""}
    ${faits.length ? `<path class="fait" d="${ligne("fait")}"/>
      <circle class="bout" cx="${X(dernier.t)}" cy="${Y(dernier.fait)}" r="4"/>` : ""}
    <g id="viseur" hidden><line class="viseur" y1="${CB.h - 6}" y2="${CB.H - CB.b}"/>
      <circle class="bout" r="3.5"/></g>
    <rect id="capteur" x="${CB.l}" y="${CB.h - 6}" width="${CB.L - CB.l - CB.r}"
      height="${CB.H - CB.b - CB.h + 6}" fill="transparent" style="cursor:crosshair"/>
  </svg><div class="bulle" id="bulle" hidden></div>`;
  box.style.setProperty("--hc", COL[st.kind]);

  const note = box.parentElement.querySelector(".note");
  if (note) note.textContent = `Heures faites face au plan, jusqu'au ${fmtD(tFin)}`;

  $("ckey").innerHTML =
    `<span><i style="background:${COL[st.kind]}"></i>Fait — <b>${Math.round(st.act)} h</b></span>
     <span><i style="background:var(--ink3);opacity:.7"></i>Plan — <b>${Math.round(st.exp)} h</b> à ce jour</span>
     <span>${st.gap >= 0 ? `<b>${st.gap} h</b> d'avance sur le plan`
        : `<b>${-st.gap} h</b> de retard sur le plan`}</span>
     ${traceProj ? `<span><i class="tirets"></i>Projeté — à ton rythme actuel</span>` : ""}`;

  // Survol : viseur, point et bulle, sur le point le plus proche.
  const svg = box.querySelector("svg"), capt = $("capteur"), vis = $("viseur"), bul = $("bulle");
  const bouger = (ev) => {
    const r = svg.getBoundingClientRect();
    const cx = ((ev.clientX - r.left) / r.width) * CB.L;
    const t = T0 + ((cx - CB.l) / (CB.L - CB.l - CB.r)) * (tFin - T0);
    let p = pts[0];
    for (const q of pts) if (Math.abs(q.t - t) < Math.abs(p.t - t)) p = q;
    vis.hidden = false;
    vis.querySelector("line").setAttribute("x1", X(p.t));
    vis.querySelector("line").setAttribute("x2", X(p.t));
    const c = vis.querySelector("circle");
    c.setAttribute("cx", X(p.t));
    c.setAttribute("cy", Y(p.fait != null ? p.fait : p.prevu));
    c.setAttribute("opacity", p.fait != null ? 1 : 0);
    bul.hidden = false;
    bul.innerHTML = `<div class="q">${fmtDL(p.t)}</div>
      ${p.fait != null ? `<div class="l"><i style="background:${COL[st.kind]}"></i>Fait <b>${Math.round(p.fait)} h</b></div>` : ""}
      <div class="l"><i style="background:var(--ink3)"></i>Plan <b>${Math.round(p.prevu)} h</b></div>
      ${p.t > NOW && traceProj && p.t <= tProj
        ? `<div class="l"><i class="tirets"></i>Projeté <b>${Math.round(
            Math.min(TOTAL_H, pr.st.act + pr.ry.hParJour * ((p.t - NOW) / DAY)))} h</b></div>` : ""}`;
    // La bulle reste dans le cadre, même sur le tout premier point.
    const demi = bul.offsetWidth / 2;
    bul.style.left = Math.min(r.width - demi - 4, Math.max(demi + 4, (X(p.t) / CB.L) * r.width)) + "px";
    bul.style.top = (Y(p.fait != null ? p.fait : p.prevu) / CB.H) * r.height + "px";
  };
  capt.addEventListener("pointermove", bouger);
  capt.addEventListener("pointerleave", () => { vis.hidden = true; bul.hidden = true; });
}

/* La matrice d'Eisenhower a ete retiree : le statut en toutes
   lettres dit deja si l'on est dans les temps, et c'est le planificateur qui
   arbitre les priorites, en placant chaque etape a une heure precise. */
/* ═════════ NOTES ═════════ */
function renderGrades(){
  const vals=DEVS.map(s=>({s,v:grades[s.id]})).filter(x=>typeof x.v==="number"&&!isNaN(x.v));
  const avg=vals.length?vals.reduce((a,x)=>a+x.v,0)/vals.length:null;
  const best=vals.length?Math.max(...vals.map(x=>x.v)):null;
  const worst=vals.length?Math.min(...vals.map(x=>x.v)):null;
  document.getElementById("gsum").innerHTML=`
    <div class="hn"><div class="k">Moyenne générale</div><div class="avg">${avg!==null?avg.toFixed(2):"—"}<span style="font-size:.8rem;color:var(--ink3)"> /20</span></div></div>
    <div class="hn"><div class="k">Notes saisies</div><div class="v">${vals.length} / ${DEVS.length}</div></div>
    <div class="hn"><div class="k">Meilleure</div><div class="v ok">${best!==null?best.toFixed(1):"—"}</div></div>
    <div class="hn"><div class="k">Plus basse</div><div class="v ${worst!==null&&worst<10?"late":""}">${worst!==null?worst.toFixed(1):"—"}</div></div>`;
  let h=`<thead><tr><th>Devoir ou évaluation</th><th>Matière</th><th style="text-align:right">Note /20</th></tr></thead><tbody>`;
  DEVS.forEach(s=>{
    const v=grades[s.id];
    h+=`<tr><td>${esc(s.n)}</td><td style="color:var(--ink3)">${esc(short(s.g))}</td>
      <td class="num"><input type="number" min="0" max="20" step="0.25" data-gr="${esc(s.id)}"
        value="${typeof v==="number"?v:""}" placeholder="—"${canEdit?"":" disabled"}></td></tr>`;});
  document.getElementById("gtab").innerHTML=h+"</tbody>";
}

/* ═════════ JOURNAL ═════════ */
function renderJournal(){
  document.getElementById("jNote").textContent=
    journal.length?`${journal.length} entrée${journal.length>1?"s":""} — la plus récente en haut`:"";
  document.getElementById("jlist").innerHTML=journal.length
    ? journal.slice(0,80).map(j=>`<div class="jrow" style="--c:var(--evt)">
        <span class="jt">${new Date(j.ts).toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit"})} ${hhmm(Date.parse(j.ts))}</span>
        <span>${esc(j.text)}</span></div>`).join("")
    : `<div class="empty muted">Rien encore. Chaque changement s'inscrira ici.</div>`;
}
/* ═════════ ORCHESTRATION ═════════ */
function applyMode(){
  const r=$("robar"); if(r) r.hidden=canEdit;
  const f=$("evf");   if(f) f.hidden=!canEdit;
  document.querySelectorAll("input[data-cb],input[data-gr],input[data-cap]")
    .forEach(i=>i.disabled=!canEdit);
}
function syncChecks(){
  document.querySelectorAll("input[data-cb]").forEach(cb=>{
    // Les tranches de la journée sont cochées à la construction, d'après les
    // heures posées ce jour-là : les réécrire ici les effacerait toutes.
    if(cb.dataset.bh===undefined){
      const s2=byId[cb.dataset.cb];
      const on=!!s2&&estFait(s2); cb.checked=on;
      const st=cb.closest(".step");
      if(st){
        st.classList.toggle("on",on);
        st.classList.toggle("lt",!!s2&&isLate(s2));
        const f=s2?faitDe(s2.id):0;
        st.classList.toggle("part",!!s2&&!on&&f>0.01);
        st.classList.toggle("bloq",!!s2&&estBloque(s2.id));
        const hh=st.querySelector(".hh");
        if(hh&&s2) hh.textContent = (!on&&f>0.01) ? `${unH(f)} / ${unH(s2.h)}` : unH(s2.h);
      }
    }
    cb.disabled=!canEdit;});
  majFichePastilles();
}
let painting=false;
function renderAll(){
  painting=true;
  replanifier();
  renderToday();renderEtapesBloquees();renderCourbe();renderProjection();renderRendement();renderPrevision();
  paintGantt();renderGrades();renderJournal();
  // Reconstruire les champs de réglage sous les doigts de quelqu'un qui écrit
  // efface ce qu'il tape : on ne les redessine que s'ils sont à l'écran.
  if(vueCourante==="moi"){renderCapacites();renderProgramme();renderSauvegarde();}
  if(!document.querySelector('[data-panel="cal"]').hidden) renderCal();
  syncChecks();applyMode();
  painting=false;
}
/* Les gestionnaires d'interface sont définis plus bas, avec le planificateur. */

/* ═════════ DIALOGUE PLEIN ÉCRAN ═════════
   Un refus ne se murmure pas en bas de page : il s'affiche devant, et il faut
   le fermer. */
function dialogue({ titre, corps, actions, ton = "stop" }) {
  const m = $("modal");
  if (!m) return;
  $("modalT").textContent = titre;
  $("modalC").innerHTML = corps || "";
  m.className = "modal " + ton;
  const zone = $("modalA");
  zone.innerHTML = "";
  for (const a of (actions && actions.length ? actions : [{ texte: "J'ai compris", pri: true }])) {
    const b = document.createElement("button");
    b.className = "btn" + (a.pri ? " pri" : "");
    b.textContent = a.texte;
    b.onclick = () => { fermerDialogue(); a.faire && a.faire(); };
    zone.appendChild(b);
  }
  m.hidden = false;
  zone.querySelector("button").focus();
}
function fermerDialogue() { const m = $("modal"); if (m) m.hidden = true; }
$("modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.dataset.fermer) fermerDialogue(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fermerDialogue(); });

/* ═════════ PLANIFICATEUR ═════════ */
const FIN_ANNEE = new Date(2027, 5, 30).getTime();

/** Heures validées un jour donné, d'après l'horodatage posé à la validation. */
function heuresFaitesLe(cle) {
  let h = 0;
  for (const id in avance) if (byId[id]) h += Number(avance[id][cle]) || 0;
  return Math.round(h * 100) / 100;
}

/**
 * La part du jour est arrêtée au premier calcul de la journée, puis elle ne
 * fait que décroître à mesure qu'on valide. Sans ça, terminer sa journée la
 * remplirait aussitôt avec le travail des jours suivants — l'inverse de ce
 * qu'on attend d'un planning.
 */
function replanifier() {
  const cle = isoJour(new Date(NOW));
  // Le planificateur raisonnait en heures du référentiel. Il raisonne maintenant
  // en heures réelles : une étape qui coûte 1,4× prend 1,4× de place. Sans ça,
  // la projection annonçait une date que le rythme mesuré contredisait déjà.
  const base = { etapes: ALL, done, evenements: events, capacites, repos, rattrapageRepos: reposSuspendu(), reports,
                 maintenant: NOW, fin: FIN_ANNEE, reste: restePlanifiable };
  if (!partJour || partJour.date !== cle) {
    const brut = planifier(base);
    partJour = { date: cle, h: brut.jours.get(cle)?.travailPose ?? 0 };
    if (canEdit) saveState();
  }
  plan = planifier({
    ...base,
    plafonds: { [cle]: Math.max(0, partJour.h - heuresFaitesLe(cle)) },
  });
  return plan;
}
const evOn = (t, tEnd) =>
  events.filter((e) => { const d = new Date(e.date + "T00:00").getTime(); return d >= t && d < tEnd; });

/* Rappels automatiques : le 1er de chaque mois, revérifier l'espace CNED. */
const SCAN = (() => {
  const out = [];
  for (let m = 1; m <= 9; m++) {
    const d = new Date(2026, 8 + m, 1);
    out.push({ id: "scan" + m, systeme: true, date: isoJour(d), titre: "Rafraîchir le scan CNED" });
  }
  return out;
})();
const scanOn = (t, tEnd) =>
  SCAN.filter((e) => { const d = new Date(e.date + "T00:00").getTime(); return d >= t && d < tEnd; });

/* ═════════ CALENDRIER ═════════ */
function renderCal() {
  const auj = new Date(NOW);
  if (!calCur) calCur = new Date(auj.getFullYear(), auj.getMonth(), 1);
  replanifier();
  $("calM").textContent = MFULL[calCur.getMonth()] + " " + calCur.getFullYear();

  const premier = new Date(calCur.getFullYear(), calCur.getMonth(), 1);
  const debut = new Date(premier);
  debut.setDate(1 - ((premier.getDay() + 6) % 7));

  let h = DOW.map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(debut); d.setDate(debut.getDate() + i);
    const t = d.getTime(), tE = t + DAY, cle = isoJour(d);
    const b = bilanJour(plan.jours, cle);
    const evs = evOn(t, tE), scans = scanOn(t, tE);
    const passe = t < minuitLocal(NOW);
    const pleine = b && b.plein;
    // Un jour de repos entamé par une urgence se signale comme un débordement :
    // c'est bien une exception, et elle doit se voir d'un coup d'œil sur le mois.
    const deborde = b && (b.tardif > 0 || b.urgent > 0);

    h += `<div class="day${d.getMonth() !== calCur.getMonth() ? " out" : ""}${
      sameDay(d, auj) ? " today" : ""}${calSel && sameDay(d, calSel) ? " sel" : ""}${
      b && b.repos ? " repos" : ""}${
      deborde ? " deborde" : pleine ? " pleine" : ""}" data-d="${t}">
      <span class="num">${d.getDate()}</span>
      ${scans.map(() => `<span class="chip ev sys">Scan CNED</span>`).join("")}
      ${evs.slice(0, 2).map((e) => `<span class="chip ev">${esc(e.titre || e.title)}</span>`).join("")}
      ${evs.length > 2 ? `<span class="more">+${evs.length - 2}</span>` : ""}
      ${b && !passe && b.travail > 0
        ? `<span class="charge"><i style="width:${Math.min(100, (b.travail / Math.max(b.cap, 1)) * 100)}%"></i></span>
           <span class="hcount">${unH(b.travail)}</span>` : ""}
    </div>`;
  }
  $("cal").innerHTML = h;
  document.querySelectorAll(".day").forEach((el) => (el.onclick = () => {
    calSel = new Date(+el.dataset.d);
    const di = $("evD"); if (di) di.value = isoJour(calSel);
    renderCal();
  }));
  renderZone();
}

const minuitLocal = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/* ═════════ LA JOURNÉE, HEURE PAR HEURE ═════════ */
/** Construit la frise d'un jour : événements, travail et temps libre dans l'ordre. */
function friseHTML(cle, { compact = false, depuis = null, max = 0 } = {}) {
  const b = bilanJour(plan.jours, cle);
  if (!b) return `<div class="empty muted">Rien pour ce jour.</div>`;

  const items = [
    ...b.evenements.map((e) => ({ d: e.plage[0], f: e.plage[1], type: e.pause ? "pausep" : e.urgent ? "urgent" : "ev", ev: e })),
    ...b.blocs.map((x) => ({ d: x.debut, f: x.fin, type: "trav", bloc: x })),
    ...(b.pauses || []).map((s2) => ({ d: s2[0], f: s2[1], type: "pause" })),
    ...(b.creneaux || []).filter((s2) => s2[1] - s2[0] >= 30).map((s2) => ({ d: s2[0], f: s2[1], type: "libre" })),
  ].sort((x, y) => x.d - y.d);

  if (!items.length) return b.repos
    ? `<div class="empty">Jour de repos. Rien n'y est posé, et rien ne s'y posera.</div>`
    : `<div class="empty">Journée entièrement libre.</div>`;
  // Une étape peut revenir en deux tranches dans la même journée, coupées par une
  // pause : chacune doit savoir combien d'heures la précèdent.
  const cumulJour = {};

  // Aujourd'hui, ce qui compte c'est ce qui vient. Le passé de la journée se
  // replie : il est consultable, il n'occupe plus l'écran.
  let coupe = 0;
  if (depuis !== null) {
    const i = items.findIndex((x) => x.f > depuis);
    coupe = i < 0 ? items.length : i;
  }
  const passes = items.slice(0, coupe);
  const suite = items.slice(coupe);
  const vus = max > 0 ? suite.slice(0, max) : suite;
  const apres = max > 0 ? suite.slice(max) : [];

  const ligne = (x) => {
    const plage = `${enHeure(x.d)} – ${enHeure(x.f)}`;
    const dur = unH((x.f - x.d) / 60);
    if (x.type === "libre") {
      return `<div class="ligne libre"><span class="hh">${plage}</span>
        <span class="quoi">Libre · ${dur}</span></div>`;
    }
    if (x.type === "pause") {
      return `<div class="ligne pause"><span class="hh">${plage}</span>
        <span class="quoi">Pause</span></div>`;
    }
    if (x.type === "trav") {
      const e = x.bloc.etape;
      const bh = Math.round(((x.f - x.d) / 60) * 100) / 100;
      const part = Math.round((bh / e.h) * 100);
      // Cocher cette tranche ne vaut que pour elle : les heures cumulées des
      // tranches précédentes de la même étape, ce jour-là, disent si elle est faite.
      const avant = cumulJour[e.id] || 0;
      cumulJour[e.id] = avant + bh;
      const posees = Number((avance[e.id] || {})[cle]) || 0;
      const coche = posees >= avant + bh - 0.01;
      const fait = faitDe(e.id);
      // Un jour à venir n'a pas de case : on n'a pas encore fait le travail de demain,
      // et une case qui se décoche toute seule au redessin ne veut rien dire.
      const futur = cle > isoJour(new Date(NOW));
      // La ligne porte deux gestes qu'il ne faut pas confondre : cocher ce qui est
      // fait, et ouvrir le minuteur. Un <label> englobant volait le second.
      const mesure = mesureDe(e.id);
      return `<div class="ligne trav${x.bloc.retard ? " retard" : ""}${x.bloc.tard ? " tardif" : ""}${x.bloc.urgence ? " urgence" : ""}${coche ? " coche" : ""}${futur ? " avenir" : ""}" style="--c:${esc(e.g.c)}">
        <span class="hh">${plage}</span>
        ${futur ? "" : `<label class="zcoche" title="J'ai fait cette tranche">
          <input type="checkbox" class="cb" data-cb="${esc(e.id)}"
            data-bh="${bh}" data-jour="${esc(cle)}"${coche ? " checked" : ""}${canEdit ? "" : " disabled"}></label>`}
        <span class="quoi">
          <b>${esc(e.n)}</b> <em>${esc(e.row.n)}</em>
          ${compact ? "" : `<span class="part">${unH(bh)} sur ${unH(e.h)}${part < 100 ? ` · ${part} %` : ""}${
            fait > 0.01 && fait < e.h - 0.01 ? ` · déjà ${unH(fait)}` : ""}${
            mesure ? ` · <b class="fr">×${mesure.facteur.toFixed(2).replace(".", ",")}</b> pour toi` : ""}</span>`}
          ${x.bloc.urgence ? `<span class="lt">urgent et important</span>`
            : x.bloc.tard ? `<span class="lt">hors horaires</span>`
            : x.bloc.retard ? `<span class="lt">rattrapage</span>` : ""}
          ${e.row.url ? `<a href="${esc(e.row.url)}" target="_blank" rel="noopener">cours ↗</a>` : ""}
        </span>
        ${futur || !canEdit ? "" : `<button class="chrono" data-chrono="${esc(e.id)}"
          title="Lancer le minuteur sur cette étape" aria-label="Lancer le minuteur">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/>
            <path d="M12 9v4l2.5 2M9 2h6"/></svg></button>`}
      </div>`;
    }
    const e = x.ev;
    return `<div class="ligne ${x.type}"><span class="hh">${plage}</span>
      <span class="quoi"><b>${esc(e.titre || e.title || "")}</b>
        ${e.urgent ? `<span class="urg">urgent</span>` : ""}
        ${lienSur(e.lien) ? `<a href="${esc(lienSur(e.lien))}" target="_blank"
          rel="noopener noreferrer">ouvrir ↗</a>` : ""}
        ${canEdit ? `<button class="btn mini" data-del="${esc(e.id)}" title="Supprimer">✕</button>` : ""}
      </span></div>`;
  };

  const repli = (liste, mot) => liste.length
    ? `<details class="repli plie"><summary>${mot}</summary>
       <div class="frise">${liste.map(ligne).join("")}</div></details>` : "";
  return repli(passes, `${plural(passes.length, "moment")} déjà ${passes.length > 1 ? "passés" : "passé"}`)
    + (vus.length ? `<div class="frise">${vus.map(ligne).join("")}</div>`
                  : `<div class="empty">${b.repos ? "Jour de repos."
                                                  : "Plus rien de prévu aujourd'hui."}</div>`)
    + repli(apres, `La suite de la journée (${apres.length})`);
}

/** Le jour choisi dans le calendrier. */
function renderZone() {
  const d = calSel || new Date(NOW);
  const cle = isoJour(d);
  const b = bilanJour(plan.jours, cle);
  const auj = sameDay(d, new Date(NOW));
  let h = `<div class="dph">${fmtDL(d.getTime())}${auj ? " — aujourd'hui" : ""}</div>`;
  if (b) {
    const libres = creneauxTexte(b);
    h += `<div class="jlegende">
      ${b.repos && b.travail <= 0.01
        ? `<span class="repos-t"><b>Repos</b> — rien n'est posé ce jour-là</span>`
        : `<span><b class="mono">${unH(b.travail)}</b> de travail</span>`}
      ${b.occupe > 0 ? `<span class="occ-t"><b class="mono">${unH(b.occupe)}</b> d'événements</span>` : ""}
      ${b.tardif > 0 ? `<span class="tard-t"><b class="mono">${unH(b.tardif)}</b> hors horaires</span>` : ""}
      ${b.urgent > 0 ? `<span class="tard-t"><b class="mono">${unH(b.urgent)}</b> sur ton repos —
        urgent et important</span>` : ""}
      <span class="lib-t">Libre : ${libres.length ? libres.join(" · ") : "rien"}</span>
    </div>`;
  }
  h += `<div id="alerte"></div>` + friseHTML(cle);

  if (plan.manques.length) {
    const tot = totalManque(plan.manques);
    h += `<div class="soustitre">Ne rentre pas avant l'échéance</div>
      <div class="impossible"><b>${tot} h</b> sur ${plan.manques.length} étape${plan.manques.length > 1 ? "s" : ""}.</div>
      <div class="queue">` + plan.manques.slice(0, 4).map((m) => `
        <div class="qitem" style="--c:var(--late)"><span class="qbody">
          <span class="qtitle">${esc(m.etape.row.n)} · ${esc(m.etape.n)}</span>
          <span class="qmeta"><span class="lt">${m.h} h sans créneau</span>
            <span>échéance ${fmtD(m.ech)}</span></span></span>
          ${canEdit ? `<button class="btn" data-tard="${esc(m.etape.id)}">Plus tard</button>` : ""}
        </div>`).join("") + `</div>`;
  }
  $("daypanel").innerHTML = h;
}

/* ═════════ AJOUT D'UN ÉVÉNEMENT ═════════
   Un événement passe toujours avant le travail : la vie d'abord, le planning
   s'arrange. Il n'est refusé que dans un seul cas — quand des heures de cours
   ne retrouveraient de place nulle part, ni le jour même, ni le soir, ni les
   jours suivants. Ce refus-là s'affiche en plein écran. */
function nouvelEvenement() {
  return {
    id: "e" + Date.now().toString(36),
    titre: $("evT").value.trim(),
    date: $("evD").value,
    debut: $("evH").value,
    fin: $("evF").value,
    lien: lienSur($("evL").value.trim()),
    urgent: $("evU").checked,
    pause: $("evP").checked,
  };
}

/* ═════════ CE QUI SE RÉPÈTE ═════════
   Un stage de huit semaines, c'est quarante journées identiques. Les saisir une
   par une n'est pas une option, et les garder sous forme de règle obligerait
   chaque lecteur d'événements — le planificateur, la frise, le calendrier,
   l'export, les créneaux publiés — à connaître la règle. On écrit donc les
   journées en clair, reliées par une même `serie` : un seul geste les crée, un
   seul geste les efface, et rien d'autre dans l'application n'a à changer. */

/** Au-delà, ce n'est plus un engagement, c'est un remplissage. */
const SERIE_MAX = 250;

/** Les dates d'une répétition, bornes comprises. Rend null si le formulaire
 *  n'en demande pas, et une liste vide si elle n'a aucun jour. */
function datesSerie() {
  if (!$("evR") || !$("evR").checked) return null;
  const debut = $("evD").value, fin = ($("evRJ").value || "").trim();
  if (!debut || !fin || fin < debut) return [];
  const semaine = $("evRQ").value !== "tous";
  const out = [];
  const d = new Date(debut + "T00:00"), stop = new Date(fin + "T00:00").getTime();
  while (d.getTime() <= stop && out.length <= SERIE_MAX) {
    if (!semaine || (d.getDay() >= 1 && d.getDay() <= 5)) out.push(isoJour(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Le ou les événements que le formulaire décrit, prêts à être posés. */
function nouveauxEvenements() {
  const modele = nouvelEvenement();
  const dates = datesSerie();
  if (!dates) return [modele];
  const serie = "s" + Date.now().toString(36);
  return dates.map((date, i) => ({ ...modele, id: `${modele.id}-${i}`, date, serie }));
}

/** Combien de jours porte une série, et lesquels. */
const serieDe = (id) => events.filter((e) => e.serie && e.serie === id);

/** Le compteur sous la case « se répète », pour qu'on sache ce qu'on va poser. */
function majRepetition() {
  const on = $("evR") && $("evR").checked;
  const z = $("evRz"), q = $("evRQ"), n = $("evRn");
  if (!z) return;
  z.hidden = q.hidden = !on;
  if (!on) { n.textContent = ""; return; }
  const dates = datesSerie() || [];
  n.textContent = !dates.length
    ? "choisis une date de fin après la date de début"
    : dates.length > SERIE_MAX
      ? `plus de ${SERIE_MAX} jours : c'est trop long pour une seule série`
      : `${plural(dates.length, "journée")}, du ${fmtD(new Date(dates[0] + "T00:00"))}` +
        ` au ${fmtD(new Date(dates[dates.length - 1] + "T00:00"))}`;
}
function baseplan() {
  const cle = isoJour(new Date(NOW));
  return {
    etapes: ALL, done, evenements: events, capacites, repos, rattrapageRepos: reposSuspendu(), reports,
    plafonds: partJour && partJour.date === cle
      ? { [cle]: Math.max(0, partJour.h - heuresFaitesLe(cle)) } : {},
    maintenant: NOW, fin: FIN_ANNEE,
  };
}
const leJour = (d) => new Date(d + "T00:00").toLocaleDateString("fr-FR",
  { weekday: "long", day: "numeric", month: "long" });

/** Aperçu discret sous le calendrier, pendant qu'il remplit le formulaire. */
function verifier() {
  majRepetition();
  const zone = $("alerte");
  if (!zone) return null;
  const ev = nouvelEvenement();
  if (!ev.date || !ev.debut || !ev.fin) { zone.innerHTML = ""; return null; }
  if (duree(ev) <= 0) {
    zone.innerHTML = `<div class="impossible">L'heure de fin doit suivre l'heure de début.</div>`;
    return null;
  }
  const liste = nouveauxEvenements();
  if (!liste.length || liste.length > SERIE_MAX) { zone.innerHTML = ""; return null; }
  const t = testerAjout(baseplan(), liste);
  // Une série se juge sur son total, pas sur sa première journée.
  const quoi = t.jours > 1 ? `<b>${t.jours} journées</b>, ${unH(t.duree)} en tout : ` : "";
  zone.innerHTML = !t.possible
    ? `<div class="impossible"><b>${t.jours > 1 ? "Ça ne rentre pas" : "Journée pleine"}.</b>
        ${quoi}${t.supplement} h de cours n'auraient plus de place nulle part.</div>`
    : t.tardif >= 0.1
      ? `<div class="attention">Ça rentre, mais ${quoi}<b>${t.tardif} h</b> de travail passeraient
          en dehors de tes heures normales, le soir.</div>`
      : t.deplace > 0
        ? `<div class="ok-zone">Ça rentre. ${quoi}<b>${t.deplace} h</b> de travail se reportent sur les
            jours suivants, sans faire sauter d'échéance.</div>`
        : `<div class="ok-zone">Ça rentre. ${quoi || "Ce créneau "}ne croise aucun travail prévu.</div>`;
  return t;
}

function ajouter(force) {
  if (!canEdit) return;
  const ev = nouvelEvenement();
  if (!ev.titre || !ev.date) return;
  const lienBrut = $("evL").value.trim();
  if (lienBrut && !ev.lien) {
    dialogue({ ton: "warn", titre: "Ce lien n'est pas acceptable",
      corps: `<p>Seules les adresses commençant par <b>http://</b> ou <b>https://</b>
        sont acceptées. C'est ce qui empêche qu'un lien piégé s'exécute chez les
        gens qui consultent ton planning.</p>` });
    return;
  }
  if (duree(ev) <= 0) {
    dialogue({ titre: "Ces horaires ne tiennent pas debout",
      corps: `<p>L'heure de fin doit venir après l'heure de début.</p>` });
    return;
  }
  const liste = nouveauxEvenements();
  if (!liste.length) {
    dialogue({ titre: "Cette répétition n'a aucun jour",
      corps: `<p>La date de fin doit venir après la date de début, et la semaine doit
        contenir au moins un jour choisi.</p>` });
    return;
  }
  if (liste.length > SERIE_MAX) {
    dialogue({ titre: "C'est trop long pour une seule série",
      corps: `<p>Une série s'arrête à <b>${SERIE_MAX} journées</b>. Au-delà, ce n'est plus un
        engagement qu'on pose : c'est un emploi du temps qu'on remplit, et il vaut mieux le
        découper en plusieurs morceaux qu'on pourra retirer séparément.</p>` });
    return;
  }
  const t = testerAjout(baseplan(), liste);
  const combien = liste.length > 1 ? `« ${esc(ev.titre)} » sur ${plural(liste.length, "journée")}`
                                   : `« ${esc(ev.titre)} »`;

  // Le seul refus possible : plus une heure de libre, nulle part.
  if (!t.possible && !force) {
    const bl = t.bloquant;
    dialogue({
      titre: "Ce n'est pas possible",
      corps: `<p>Ton emploi du temps ${bl && bl.cle !== ev.date
          ? `du <b>${leJour(bl.cle)}</b>` : `du <b>${leJour(ev.date)}</b>`} remplit déjà
          toute la journée, et les jours suivants aussi.</p>
        <p><b>${t.supplement} h</b> de cours ne retrouveraient de place nulle part —
        ni dans tes heures de travail, ni le soir.</p>
        <p class="petit">Pour caler ${combien} quand même, il faut d'abord valider des
        étapes, élargir tes heures dans Réglages, ou repousser une échéance depuis le
        calendrier.</p>`,
      actions: [
        { texte: "J'ai compris", pri: true },
        { texte: "Ajouter quand même", faire: () => ajouter(true) },
      ],
    });
    return;
  }

  events.push(...liste);
  events.sort((a, b) => (a.date + (a.debut || "")).localeCompare(b.date + (b.debut || "")));
  log(liste.length > 1
    ? `a ajouté « ${ev.titre} » sur ${plural(liste.length, "journée")}, du ${leJour(liste[0].date)}`
      + ` au ${leJour(liste[liste.length - 1].date)}, de ${ev.debut} à ${ev.fin}`
    : `a ajouté « ${ev.titre} » le ${leJour(ev.date)} de ${ev.debut} à ${ev.fin}`);
  saveEvents();
  $("evT").value = ""; $("evL").value = "";
  $("evU").checked = false; $("evP").checked = false;
  $("evR").checked = false; $("evRJ").value = ""; majRepetition();
  const z = $("alerte"); if (z) z.innerHTML = "";
  calSel = new Date(ev.date + "T00:00");
  renderAll();

  // Prévenir quand ça devient trop : le travail chassé retombe le soir.
  if (!t.possible) {
    dialogue({ ton: "warn", titre: "Ajouté, mais tu perds des heures",
      corps: `<p><b>${t.supplement} h</b> de cours n'ont plus de place avant leur échéance.
        Elles apparaissent en rouge dans l'onglet Calendrier, avec un bouton pour repousser
        l'échéance.</p>` });
  } else if (t.tardif >= 0.1) {
    dialogue({ ton: "warn", titre: "C'est calé, mais ça déborde sur tes soirées",
      corps: `<p>« ${esc(ev.titre)} » est ajouté${t.deplace > 0
          ? ` et <b>${t.deplace} h</b> de travail se sont décalées` : ""}.</p>
        <p><b>${t.tardif} h</b> de cours se retrouvent en dehors de tes heures normales,
        après ${(capacites[new Date(ev.date + "T00:00").getDay()] || []).slice(-1)[0]?.[1] || "16:00"}.
        Les pauses sont conservées.</p>` });
  }
}

/* ═════════ CAPACITÉS ═════════ */
function renderCapacites() {
  const box = $("caps"); if (!box) return;
  const heuresDe = (j) => (capacites[j] || []).reduce((x, s2) => x + (enMin(s2[1]) - enMin(s2[0])) / 60, 0);
  // Les jours de repos ne comptent pas dans le total : c'est le nombre d'heures
  // sur lesquelles le planning peut vraiment compter qu'on veut lire ici.
  const total = [0,1,2,3,4,5,6].reduce((a, j) => a + (auRepos(j) ? 0 : heuresDe(j)), 0);
  const noms = NOMS_JOURS;
  box.innerHTML = [1,2,3,4,5,6,0].map((j) => {
    const txt = (capacites[j] || []).map((s2) => `${s2[0]}-${s2[1]}`).join(", ");
    const coche = repos.includes(j);
    const off = auRepos(j);
    const suspendu = coche && !off;
    const h = heuresDe(j);
    return `<div class="cap${off ? " off" : ""}${suspendu ? " suspendu" : ""}">
      <span class="jr">${noms[j]}</span>
      <label class="rep" title="Aucune heure de travail n'est posée ce jour-là">
        <input type="checkbox" data-repos="${j}"${coche ? " checked" : ""}${canEdit ? "" : " disabled"}>
        <span>repos</span></label>
      <input type="text" data-cap="${j}" value="${esc(txt)}" placeholder="09:00-12:00, 14:00-18:00"
        ${canEdit && !(off && !reposCond) ? "" : "disabled"}>
      <em>${off ? "repos" : suspendu ? (h ? `suspendu · ${h.toFixed(1).replace(".0","")} h` : "suspendu · 0 h")
        : h ? h.toFixed(1).replace(".0","") + " h" : "—"}</em>
    </div>`;
  }).join("") +
    `<label class="urgcase condrepos">
      <input type="checkbox" id="reposCond"${reposCond ? " checked" : ""}${canEdit ? "" : " disabled"}>
      <span>Pas de repos tant que je suis en retard</span></label>
    ${reposCond ? `<div class="petit">${reposSuspendu()
      ? `<b>Suspendu en ce moment</b> : ${plural(ALL.filter((s) => !estFait(s) && NOW > s.t1 && !estBloque(s.id)).length, "étape")}
         en retard. Tes jours de repos ne servent plus qu'à les rattraper, sur les plages
         écrites à côté${repos.some((j) => !(capacites[j] || []).length)
           ? " — <b>mets-y des heures</b>, sinon ils ne rattrapent rien" : ""}.
         Ils redeviennent des jours de repos dès que tu es à jour.`
      : `Tu es à jour : tes jours de repos s'appliquent.`}</div>` : ""}
    <div class="captot">Soit <b class="mono">${total.toFixed(1).replace(".0","")} h</b> déclarées
      par semaine — un peu moins une fois les pauses déduites : ${REGLES.pause} min après chaque
      ${REGLES.session / 60} h de travail, jamais négociables.
      <div class="petit">Ce qui n'y tient pas glisse sur des heures inhabituelles
      (jusqu'à ${JOURNEE[1]}), et seulement en rattrapage. Le reste de la journée
      ${JOURNEE[0]}–${JOURNEE[1]} apparaît comme temps libre pour ton entourage.</div>
      <div class="petit">Un jour coché <b>repos</b> — hors la règle ci-dessus — ne reçoit rien : ni travail, ni soirée de
      rattrapage. Une seule chose peut l'ouvrir, et jamais plus de ${URGENCE.max} h : une étape
      <b>à la fois urgente et importante</b> — un devoir noté dont l'échéance est passée ou
      tombe dans les ${URGENCE.jours} jours. Important mais pas urgent attend lundi.</div>
      <div class="petit">Pour éviter d'avoir un mois vide à côté d'un mois plein, une étape peut
      démarrer jusqu'à ${AVANCE_MAX / 7} semaines avant sa date prévue. Son échéance, elle, ne
      bouge pas.</div>
      ${canEdit ? `<button class="btn" id="capType">Revenir à la semaine type</button>` : ""}
    </div>`;
  const bt = $("capType");
  if (bt) bt.onclick = () => dialogue({
    ton: "warn", titre: "Revenir à la semaine type ?",
    corps: `<p>Lundi au vendredi 9 h – 12 h 15 et 13 h 15 – 16 h. Samedi et dimanche au repos.
      Tes plages et tes jours de repos actuels seront remplacés.</p>`,
    actions: [
      { texte: "Annuler", pri: true },
      { texte: "Remplacer", faire: () => {
          capacites = journeeType();
          repos = [...REPOS];
          log("a repris la semaine type 9 h – 16 h, week-end au repos");
          saveState(); renderAll();
        } },
    ],
  });
}

/** « 09:00-12:00, 14:00-18:00 » → plages. Ignore ce qui n'est pas lisible. */
function lirePlages(txt) {
  return String(txt).split(/[,;]/).map((p2) => {
    const m = p2.trim().match(/^(\d{1,2})[:h]?(\d{2})?\s*[-–à]\s*(\d{1,2})[:h]?(\d{2})?$/);
    if (!m) return null;
    const a = `${String(m[1]).padStart(2,"0")}:${m[2] || "00"}`;
    const b = `${String(m[3]).padStart(2,"0")}:${m[4] || "00"}`;
    return enMin(b) > enMin(a) ? [a, b] : null;
  }).filter(Boolean);
}

/* ═════════ DISPONIBILITÉS ═════════ */
let dureeCherchee = 3;

/** Densité du planning sur les `n` prochains jours.
 *  Les heures de rattrapage sont comptées à part : elles ne sont pas prises sur
 *  la capacité déclarée, donc les additionner donnerait des « 119 % pris ». */
function densite(n) {
  let cap = 0, trav = 0, tard = 0, i = 0;
  for (const j of plan.jours.values()) {
    if (i++ >= n) break;
    cap += j.cap;
    tard += j.tardif || 0;
    trav += Math.max(0, (j.travailPose || 0) - (j.tardif || 0));
  }
  return {
    cap, trav, tard,
    libre: Math.max(0, cap - trav),
    pc: cap ? Math.min(100, Math.round((trav / cap) * 100)) : 0,
  };
}

const joliJour = (t) => {
  const s = new Date(t).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function renderDispo() {
  const boxR = $("resume"), boxC = $("creneaux");
  if (!boxR || !boxC || !plan) return;
  boxC.innerHTML = `<p class="aide" style="padding:.6rem 0">Recherche des créneaux…</p>`;
  // on laisse le navigateur peindre : la recherche prend quelques centaines de ms
  setTimeout(() => {
    const { creneaux } = trouverCreneaux(baseplan(), dureeCherchee, { horizon: 45, max: 10 });
    const proche = densite(14), large = densite(56);
    const premier = creneaux[0];
    const dansJours = premier ? Math.round((premier.t - minuitLocal(NOW)) / DAY) : null;

    // Le titre répond à la question posée : quand peut-on caler quelque chose.
    let titre, couleur, phrase;
    if (!premier) {
      titre = "Aucun créneau"; couleur = "var(--late)";
      phrase = `Impossible de dégager <b>${dureeCherchee} h</b> dans les 45 prochains jours sans
        repousser une échéance.`;
    } else if (dansJours <= 2) {
      titre = dansJours === 0 ? "Aujourd'hui" : dansJours === 1 ? "Demain" : "Après-demain";
      couleur = "var(--ok)";
      phrase = `Il y a de la place tout de suite pour <b>${dureeCherchee} h</b>.`;
    } else {
      titre = joliJour(premier.t); couleur = dansJours > 14 ? "var(--warn)" : "var(--ok)";
      phrase = `Le premier créneau de <b>${dureeCherchee} h</b> tombe dans <b>${dansJours} jours</b>.`;
    }

    // Explique la forme du planning, pas seulement une moyenne.
    if (proche.pc >= 95) {
      phrase += ` Les <b>deux prochaines semaines sont pleines</b> : chaque heure déclarée est
        déjà prise${proche.tard >= 0.5 ? `, et <b>${Math.round(proche.tard)} h</b> de rattrapage
        débordent sur les soirées` : ""}. Ça se desserre ensuite — il reste
        <b>${Math.round(large.libre)} h</b> de marge sur huit semaines.`;
    } else if (proche.pc >= 80) {
      phrase += ` Les deux prochaines semaines sont <b>chargées à ${proche.pc} %</b>, avec
        <b>${Math.round(proche.libre)} h</b> de marge.`;
    } else {
      phrase += ` Les deux prochaines semaines sont <b>chargées à ${proche.pc} %</b> :
        <b>${Math.round(proche.libre)} h</b> de libre, il y a de quoi improviser.`;
    }

    const st = status();
    if (st.kind === "ahead") {
      phrase += ` Tu as <b>${st.days} jours d'avance</b>, et cette avance allège d'autant les
        jours qui viennent.`;
    } else if (st.kind === "late") {
      phrase += ` Tu as <b>${-st.days} jours de retard</b> : le rattrapage se répartit sur les
        jours à venir et les charge d'autant. Rattraper le retard libérera du temps.`;
    }

    boxR.innerHTML = `<div class="resume" style="--c:${couleur}">
      <div class="r" style="min-width:210px">
        <div class="k">Prochain créneau de ${dureeCherchee} h</div>
        <div class="v" style="color:${couleur};font-size:1.15rem">${titre}</div></div>
      <div class="r"><div class="k">14 prochains jours</div>
        <div class="v">${proche.pc} % pris</div></div>
      <div class="r"><div class="k">Marge · 8 sem.</div>
        <div class="v">${Math.round(large.libre)} h</div></div>
      <div class="phrase">${phrase}</div>
    </div>`;

    boxC.innerHTML = creneaux.length
      ? creneaux.map((c) => {
          const d = Math.round((c.t - minuitLocal(NOW)) / DAY);
          const quand = d === 0 ? "aujourd'hui" : d === 1 ? "demain" : `dans ${d} jours`;
          return `<div class="jourlibre">
            <span class="quand">${joliJour(c.t)}<em>${quand}</em></span>
            <span class="detail">Libre&nbsp;: ${c.plages.map((x) => `<b class="mono">${x}</b>`).join(" · ")}
              ${c.deplace > 0
                ? `<span class="dep">${c.deplace} h de travail se décaleraient sur les jours suivants</span>`
                : `<span class="dep">sans rien décaler</span>`}</span>
          </div>`;
        }).join("")
      : `<div class="aucun">
          Rien de libre pour <b>${dureeCherchee} h</b> d'ici 45 jours. Trois leviers :
          <b>prendre de l'avance</b> sur les étapes — chaque validation libère ses heures —,
          <b>augmenter la capacité</b> dans Réglages, ou <b>repousser une échéance</b> depuis
          la zone de tâche du calendrier.
        </div>`;
  }, 30);
}

/* ═════════ MON PROGRAMME ═════════
   Le référentiel CNED n'est qu'un modèle. Qui n'est pas en BTS CIEL déclare ses
   propres matières : le moteur ne demande qu'un volume d'heures et une période. */
function renderProgramme() {
  const box = $("progBox");
  if (!box) return;
  if (!canEdit) {
    box.innerHTML = `<p class="aide">${GROUPES.length
      ? `${GROUPES.length} matière${GROUPES.length > 1 ? "s" : ""}, ${Math.round(TOTAL_H)} h au total.`
      : "Aucun programme déclaré."}</p>`;
    return;
  }
  const perso = programme.modele === "perso";
  const siennes = programme.matieres.length;
  box.innerHTML = `
    <p class="aide">${perso
      ? `Ton programme, à ta main : <b>${siennes}</b> matière(s),
         <b>${Math.round(TOTAL_H)} h</b> au total.`
      : `Tu utilises le modèle <b>${esc(MODELES[programme.modele]?.nom || programme.modele)}</b> —
         ${Math.round(TOTAL_H)} h${siennes ? `, tes matières comprises` : ""}.</p>
       <p class="aide">Découpage et volumes sont relevés sur le CNED : chaque situation
         professionnelle et chaque séquence y porte une <b>durée indicative</b>, reprise ici
         telle quelle. Elle reste une moyenne — rends le programme modifiable pour l'ajuster
         à ton rythme.`}</p>
    ${perso ? "" : `<p class="aide"><b>Tes matières à toi s'ajoutent au modèle.</b> Un
       référentiel ne connaît ni les démarches, ni les dossiers à déposer, ni les rendez-vous
       à prendre — et ces heures-là sont pourtant à trouver dans les mêmes journées.</p>`}
    <div class="matieres" id="matieres"></div>
    <button class="btn pri" id="ajMatiere">Ajouter une matière</button>
    <div class="zbascule">
      ${perso ? "" : `<button class="btn" id="versPerso">Rendre ce programme modifiable</button>`}
      <button class="btn" id="autreModele">Repartir d'un autre modèle</button>
    </div>`;

  renderMatieres();

  const cu = $("copierUid");
  if (cu) cu.onclick = async () => {
    try { await navigator.clipboard.writeText(vue.uid); cu.classList.add("copie");
          setTimeout(() => cu.classList.remove("copie"), 1200); }
    catch { /* le presse-papiers peut être refusé : l'identifiant reste lisible */ }
  };

  const vp = $("versPerso");
  if (vp) vp.onclick = () => {
    // Le modèle figé devient une copie modifiable, sans rien perdre.
    programme = {
      modele: "perso",
      matieres: GROUPES.map((g) => ({
        id: g.id, nom: g.name, couleur: (g.c.match(/--(\w+)/) || [, "b1"])[1],
        etapes: g.rows.flatMap((r) => r.steps.map((st) => ({ id: st.id, n: st.n, h: st.h, s: r.s, e: r.e }))),
      })),
    };
    appliquerProgramme("a rendu son programme modifiable");
  };

  $("autreModele").onclick = () => dialogue({
    ton: "warn", titre: "Repartir d'un autre modèle ?",
    corps: `<p>Ton programme actuel sera remplacé. Les étapes déjà validées qui
        n'existent pas dans le nouveau modèle disparaîtront du suivi.</p>
      ${!perso && siennes ? `<p class="petit">Tes ${plural(siennes, "matière")} à toi
        ${siennes > 1 ? "sont gardées" : "est gardée"} : elles ne viennent pas du modèle.</p>` : ""}
      <div class="mchoix">${Object.values(MODELES).map((m) =>
        `<label class="modele"><input type="radio" name="mnew" value="${m.id}">
          <span><b>${esc(m.nom)}</b><em>${esc(m.resume)}</em></span></label>`).join("")}</div>`,
    actions: [
      { texte: "Annuler", pri: true },
      { texte: "Remplacer", faire: () => {
          const c = document.querySelector('input[name="mnew"]:checked');
          if (!c) return;
          const suivant = depuisModele(c.value);
          // Une matière à soi ne vient pas du modèle : changer de référentiel
          // n'a aucune raison de l'emporter avec lui.
          if (!perso && suivant.modele !== "perso") suivant.matieres = programme.matieres;
          programme = suivant;
          appliquerProgramme(`a repris le modèle « ${MODELES[c.value].nom} »`);
        } },
    ],
  });
}

function appliquerProgramme(texte) {
  chargerProgramme(programme);
  if (texte) log(texte);
  saveState();
  buildGantt(); buildAcc();
  renderAll(); renderProgramme();
}

/** La matière dépliée : celle qu'on vient d'ajouter, sinon la première. */
let matiereOuverte = null;

function renderMatieres() {
  const box = $("matieres");
  if (!box) return;
  box.innerHTML = programme.matieres.map((m, im) => {
    const total = m.etapes.reduce((a, e) => a + e.h, 0);
    const ouverte = matiereOuverte ? m.id === matiereOuverte : im === 0;
    return `<details class="mat"${ouverte ? " open" : ""}>
      <summary><i style="background:var(--${m.couleur})"></i>
        <b>${esc(m.nom)}</b>
        <span class="ct">${m.etapes.length} étape${m.etapes.length > 1 ? "s" : ""} · ${total} h</span>
      </summary>
      <div class="matcorps">
        <div class="ligne1">
          <input type="text" data-mnom="${im}" value="${esc(m.nom)}" maxlength="50" placeholder="Nom de la matière">
          <select data-mcoul="${im}">${COULEURS.map((c) =>
            `<option value="${c.id}"${c.id === m.couleur ? " selected" : ""}>${c.nom}</option>`).join("")}</select>
          <button class="btn danger mini" data-msuppr="${im}">Supprimer</button>
        </div>
        <table class="etapes"><tr><th>Étape</th><th>Heures</th><th>De</th><th>À</th>
          <th title="Important au sens d'Eisenhower : ce qui compte vraiment. Urgent et important, ça peut ouvrir un jour de repos.">Import.</th><th></th></tr>
        ${m.etapes.map((e, ie) => `<tr>
          <td><input type="text" data-en="${im}.${ie}" value="${esc(e.n)}" maxlength="70"></td>
          <td><input type="number" data-eh="${im}.${ie}" value="${e.h}" min="1" max="400" step="1"></td>
          <td><select data-es="${im}.${ie}">${QUINZAINES.map((q) =>
            `<option value="${q.q}"${q.q === e.s ? " selected" : ""}>${q.texte}</option>`).join("")}</select></td>
          <td><select data-ee="${im}.${ie}">${QUINZAINES.map((q) =>
            `<option value="${q.q + 1}"${q.q + 1 === e.e ? " selected" : ""}>${q.texte}</option>`).join("")}</select></td>
          <td class="cimp"><input type="checkbox" data-eimp="${im}.${ie}"${e.important ? " checked" : ""}
            title="Important : avec une échéance proche, cette étape peut prendre sur un jour de repos"></td>
          <td><button class="btn mini" data-esuppr="${im}.${ie}" title="Supprimer l'étape">✕</button></td>
        </tr>`).join("")}
        </table>
        <div class="petit">La case <b>Import.</b> est la moitié « importante » de la matrice
        d'Eisenhower. Cochée, et l'échéance passée ou à moins de ${URGENCE.jours} jours, l'étape
        devient la seule chose qui peut prendre sur un jour de repos — ${URGENCE.max} h au plus.</div>
        <button class="btn" data-eaj="${im}">Ajouter une étape</button>
      </div>
    </details>`;
  }).join("") || `<p class="aide muted">Aucune matière. Ajoute la première ci-dessous.</p>`;
  // On retient le pli choisi, sinon chaque frappe replierait la matière ouverte.
  box.querySelectorAll("details.mat").forEach((d, i) => (d.ontoggle = () => {
    if (d.open) matiereOuverte = programme.matieres[i] ? programme.matieres[i].id : null;
  }));
}

/** Un seul point d'entrée pour toutes les modifications du programme. */
function brancherProgramme() {
  document.addEventListener("input", (ev) => {
    if (!canEdit || !programme) return;
    const t = ev.target;
    const maj = (fn) => differer("programme", 600, () => { fn(); appliquerProgramme(); });
    if (t.dataset.mnom !== undefined) {
      const i = +t.dataset.mnom, v = t.value.trim();
      if (v) maj(() => { programme.matieres[i].nom = v; });
    } else if (t.dataset.en !== undefined) {
      const [i, j] = t.dataset.en.split(".").map(Number), v = t.value.trim();
      if (v) maj(() => { programme.matieres[i].etapes[j].n = v; });
    } else if (t.dataset.eh !== undefined) {
      const [i, j] = t.dataset.eh.split(".").map(Number), v = Math.max(1, Math.min(400, +t.value || 1));
      maj(() => { programme.matieres[i].etapes[j].h = v; });
    }
  });

  document.addEventListener("change", (ev) => {
    if (!canEdit || !programme) return;
    const t = ev.target;
    if (t.dataset.eimp !== undefined) {
      const [i, j] = t.dataset.eimp.split(".").map(Number);
      programme.matieres[i].etapes[j].important = t.checked;
      appliquerProgramme(t.checked
        ? `a marqué « ${programme.matieres[i].etapes[j].n} » comme importante`
        : `a retiré l'importance de « ${programme.matieres[i].etapes[j].n} »`);
    } else if (t.dataset.mcoul !== undefined) {
      programme.matieres[+t.dataset.mcoul].couleur = t.value;
      appliquerProgramme();
    } else if (t.dataset.es !== undefined || t.dataset.ee !== undefined) {
      const cle = t.dataset.es !== undefined ? "s" : "e";
      const [i, j] = (t.dataset.es ?? t.dataset.ee).split(".").map(Number);
      const et = programme.matieres[i].etapes[j];
      et[cle] = +t.value;
      if (et.e <= et.s) et[cle === "s" ? "e" : "s"] = cle === "s" ? et.s + 1 : et.e - 1;
      appliquerProgramme();
    }
  });

  document.addEventListener("click", (ev) => {
    if (!canEdit) return;
    const aj = ev.target.closest("#ajMatiere");
    if (aj) {
      if (!programme) return;
      const n = programme.matieres.length;
      const id = "m" + Date.now().toString(36);
      programme.matieres.push({
        id, nom: "Nouvelle matière",
        couleur: COULEURS[n % COULEURS.length].id,
        etapes: [{ id: "e" + Date.now().toString(36), n: "Première étape", h: 10, s: 0, e: 4 }],
      });
      matiereOuverte = id;          // on la déplie : c'est elle qu'on vient de créer
      appliquerProgramme("a ajouté une matière");
      return;
    }
    const ea = ev.target.closest("[data-eaj]");
    if (ea) {
      const m = programme.matieres[+ea.dataset.eaj];
      matiereOuverte = m.id;
      const d = m.etapes[m.etapes.length - 1];
      m.etapes.push({ id: "e" + Date.now().toString(36), n: "Nouvelle étape", h: 10,
                      s: d ? d.s : 0, e: d ? d.e : 4 });
      appliquerProgramme();
      return;
    }
    const es = ev.target.closest("[data-esuppr]");
    if (es) {
      const [i, j] = es.dataset.esuppr.split(".").map(Number);
      programme.matieres[i].etapes.splice(j, 1);
      appliquerProgramme();
      return;
    }
    const ms = ev.target.closest("[data-msuppr]");
    if (ms) {
      const i = +ms.dataset.msuppr, m = programme.matieres[i];
      dialogue({ ton: "warn", titre: `Supprimer « ${m.nom} » ?`,
        corps: `<p>Ses ${m.etapes.length} étape(s) et leur avancement disparaîtront du suivi.</p>`,
        actions: [{ texte: "Annuler", pri: true },
                  { texte: "Supprimer", faire: () => {
                      programme.matieres.splice(i, 1);
                      appliquerProgramme(`a supprimé la matière « ${m.nom} »`);
                    } }] });
    }
  });
}
brancherProgramme();

/* ═════════ LES PHOTOS DES FICHES ═════════
   Une page manuscrite photographiée pèse 200 ko : quelques dizaines rempliraient
   la mémoire du navigateur réservée au texte. Elles vont dans IndexedDB, faite
   pour ça, et la fiche ne garde que leur clé — « idb:… ». */

const BASE_PHOTOS = "repere-photos";
function basePhotos() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(BASE_PHOTOS, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("photos");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}
async function transaction(mode, faire) {
  const db = await basePhotos();
  return new Promise((ok, ko) => {
    const tx = db.transaction("photos", mode);
    const res = faire(tx.objectStore("photos"));
    tx.oncomplete = () => { db.close(); ok(res && "result" in res ? res.result : undefined); };
    tx.onerror = () => { db.close(); ko(tx.error); };
  });
}
async function rangerPhoto(blob) {
  const cle = `idb:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await transaction("readwrite", (st) => st.put(blob, cle));
  return cle;
}
const lirePhoto = (cle) => transaction("readonly", (st) => st.get(cle));
const oublierPhoto = (cle) => transaction("readwrite", (st) => st.delete(cle));

/** Clé → adresse affichable. Une photo de l'ancienne version (un chemin sur le
 *  serveur) n'a pas d'adresse : on la compte, on ne l'invente pas. */
const adressesVues = new Map();
async function adressesPhotos(cles) {
  const par = new Map();
  for (const c of cles) {
    if (!String(c).startsWith("idb:")) continue;
    if (!adressesVues.has(c)) {
      const b = await lirePhoto(c).catch(() => null);
      if (!b) continue;
      adressesVues.set(c, URL.createObjectURL(b));
    }
    par.set(c, adressesVues.get(c));
  }
  return par;
}

/* ═════════ DÉMARRAGE ═════════
   Plus rien à attendre : pas de session à vérifier, pas de base à interroger.
   On lit la copie du navigateur et on ouvre. */

function montrer(ecran) {
  ["chargement", "appli"].forEach((k) => {
    const e = $(k); if (e) e.hidden = k !== ecran;
  });
}

function routeDepart() {
  let dernier = null;
  try { dernier = sessionStorage.getItem("ciel.vue"); } catch {}
  if (location.hash.startsWith("#/") && VUES[lireAdresse()[0]]) return appliquerRoute();
  if (dernier && dernier.startsWith("#/")) {
    history.replaceState(null, "", dernier);
    return appliquerRoute();
  }
  aller("jour", null, { remplacer: true });
}

/* Par quoi commencer. La question ne se pose qu'une fois, à la première
   ouverture. */
function demanderModele() {
  // Posée à l'affichage, pas à la réponse : fermer la fenêtre d'un geste de
  // côté compte aussi comme une réponse. On ne redemande jamais.
  demarrageFait = true;
  saveState();
  dialogue({ ton: "info", titre: "Par quoi on commence ?",
    corps: `<div class="modeles">${Object.values(MODELES).map((m, i) => `
      <label class="modele${i === 0 ? " on" : ""}">
        <input type="radio" name="mdl" value="${esc(m.id)}"${i === 0 ? " checked" : ""}>
        <span><b>${esc(m.nom)}</b><em>${esc(m.resume)}</em></span></label>`).join("")}</div>
      <p class="aide">Tu pourras changer à tout moment dans <b>Moi → Mon travail</b>.</p>`,
    actions: [{ texte: "Plus tard" }, { texte: "C'est parti", pri: true, faire: () => {
      const c = document.querySelector('input[name="mdl"]:checked');
      if (!c) return;
      programme = depuisModele(c.value);
      chargerProgramme(programme);
      demarrageFait = true;
      log(`a démarré avec le modèle « ${MODELES[c.value].nom} »`);
      saveState(); buildGantt(); buildAcc(); renderAll();
    } }] });
}

function lancer() {
  tickClock();
  const local = lireLocal();
  // Le journal d'abord : appliquerEtat peut déjà enregistrer (un minuteur qui
  // reprend), et écrirait sinon un journal vide par-dessus le vrai.
  journal = local && Array.isArray(local.journal) ? local.journal : [];
  appliquerEtat(local ? local.data : {});
  montrer("appli");
  buildGantt(); buildAcc();
  routeDepart();
  $("evD").value = isoJour(new Date(NOW));
  renderAll();
  if (local && local.repris) {
    // Écrite tout de suite sous la nouvelle clé : la reprise ne se fait qu'une fois.
    saveState();
    dialogue({ ton: "info", titre: "Ton planning est là",
      corps: `<p>Repère ne passe plus par un serveur : tout reste sur cet appareil.
        Ce que tu avais fait ici a été repris tel quel.</p>
        <p>Pense à <b>Moi → Sauvegarde</b> de temps en temps : un fichier, c'est ce qui
        survit à un navigateur effacé ou à un téléphone perdu.</p>` });
  } else {
    setSync("ok", local ? "enregistré sur cet appareil" : "nouveau planning");
  }
  const neuf = !demarrageFait && !Object.keys(done).length
    && !events.length && !journal.length && !(programme.matieres || []).length;
  if (neuf) demanderModele();
}

/* Les saisies attendent un peu avant de s'écrire (une note qu'on tape, une plage
   horaire). Quitter la page ne doit pas les perdre : sur un téléphone, basculer
   d'application est le cas courant, et beforeunload ne s'y déclenche pas. */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") viderDifferes();
});
addEventListener("pagehide", () => { enFermeture = true; viderDifferes(); });
addEventListener("pageshow", () => { enFermeture = false; });

/* ═════════ SAUVEGARDE ═════════
   La mémoire du navigateur s'efface : « effacer les données du site », un
   nettoyage du téléphone, un navigateur changé. Le fichier, lui, reste. C'est
   aussi le seul pont entre deux appareils : on sauvegarde sur l'un, on
   recharge sur l'autre. */

const FORMAT = "repere-sauvegarde";

async function exporterSauvegarde() {
  const photos = {};
  const cles = Object.values(fiches).flatMap((f) => (f && f.p) || [])
    .filter((c) => String(c).startsWith("idb:"));
  for (const c of cles) {
    const b = await lirePhoto(c).catch(() => null);
    if (!b) continue;
    photos[c] = await new Promise((ok) => {
      const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b);
    });
  }
  const contenu = JSON.stringify({ format: FORMAT, version: 1, pris: new Date().toISOString(),
                                   data: etat(), journal, photos });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([contenu], { type: "application/json" }));
  a.download = `repere-${isoJour(new Date(NOW))}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  try { localStorage.setItem("repere.derniereSauvegarde", new Date().toISOString()); } catch {}
  log("a sauvegardé son planning dans un fichier");
  saveState(); renderSauvegarde();
}

function importerSauvegarde(fichier) {
  const r = new FileReader();
  r.onload = () => {
    let s = null;
    try { s = JSON.parse(String(r.result)); } catch {}
    if (!s || s.format !== FORMAT || !s.data || typeof s.data !== "object") {
      dialogue({ titre: "Ce fichier n'est pas une sauvegarde de Repère",
        corps: `<p>Choisis un fichier <b>repere-….json</b> créé par le bouton
          « Sauvegarder dans un fichier ».</p>` });
      return;
    }
    dialogue({ ton: "warn", titre: "Remplacer ton planning ?",
      corps: `<p>La sauvegarde du <b>${esc(fmtDL(Date.parse(s.pris) || NOW))}</b> va
        remplacer tout ce qui est sur cet appareil.</p>
        <p class="petit">Sauvegarde d'abord l'état actuel si tu veux pouvoir y revenir.</p>`,
      actions: [{ texte: "Annuler", pri: true }, { texte: "Remplacer", faire: async () => {
        for (const [c, url] of Object.entries(s.photos || {})) {
          // Des photos, et seulement des photos : pas de SVG, qui est un document.
          if (!String(c).startsWith("idb:")
              || !/^data:image\/(jpeg|png|webp);base64,/.test(String(url))) continue;
          const b = await (await fetch(url)).blob();
          await transaction("readwrite", (st) => st.put(b, c)).catch(() => {});
        }
        journal = Array.isArray(s.journal)
          ? s.journal.slice(0, 150).filter((j) => j && typeof j.text === "string") : [];
        appliquerEtat(s.data);
        log("a rechargé une sauvegarde");
        saveState(); buildGantt(); buildAcc(); renderAll();
      } }] });
  };
  r.readAsText(fichier);
}

function renderSauvegarde() {
  const box = $("sauvegardeBox"); if (!box) return;
  let derniere = null;
  try { derniere = localStorage.getItem("repere.derniereSauvegarde"); } catch {}
  const jours = derniere ? Math.floor((NOW - Date.parse(derniere)) / DAY) : null;
  box.innerHTML = `
    <p>Ton planning est enregistré <b>dans ce navigateur</b>, et nulle part ailleurs.
      Effacer les données du site, ou changer de téléphone, l'efface aussi.</p>
    <p class="${jours === null || jours > 7 ? "late" : "muted"}">${derniere
      ? `Dernière sauvegarde : ${esc(fmtDL(Date.parse(derniere)))}${jours > 7 ? ` — il y a ${plural(jours, "jour")}` : ""}.`
      : "Aucune sauvegarde dans un fichier pour l'instant."}</p>
    <div class="mact">
      <button class="btn pri" id="sauverFichier">Sauvegarder dans un fichier</button>
      <button class="btn" id="chargerFichier">Recharger une sauvegarde</button>
      <input type="file" id="fichierSauvegarde" accept="application/json,.json" hidden>
    </div>
    <p class="petit">Pour passer d'un appareil à l'autre : sauvegarde sur le premier,
      recharge sur le second. Le fichier contient aussi les photos de tes fiches.</p>`;
  $("sauverFichier").onclick = () => exporterSauvegarde().catch((e) =>
    dialogue({ titre: "La sauvegarde a échoué", corps: `<p>${esc(String(e.message || e))}</p>` }));
  $("chargerFichier").onclick = () => $("fichierSauvegarde").click();
  $("fichierSauvegarde").onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (f) importerSauvegarde(f);
  };
}

/* ═════════ ÉVÉNEMENTS D'INTERFACE ═════════ */
$("evf").addEventListener("submit", (e) => { e.preventDefault(); ajouter(false); });
["evD", "evH", "evF", "evR", "evRJ", "evRQ"].forEach((k) => {
  const el = $(k); if (el) el.addEventListener("change", verifier);
});

document.addEventListener("input", (e) => {
  const c = e.target.closest("input[data-cap]");
  if (c && canEdit) {
    differer("capacites:" + c.dataset.cap, 700, () => {
      capacites[c.dataset.cap] = lirePlages(c.value);
      log(`a modifié ses heures de travail du ${NOMS_JOURS[c.dataset.cap].toLowerCase()}`);
      saveState(); renderAll();
    });
  }
  const r = e.target.closest("input[data-repos]");
  if (r && canEdit) {
    const j = Number(r.dataset.repos);
    repos = r.checked ? [...new Set([...repos, j])].sort() : repos.filter((x) => x !== j);
    // La part du jour a été arrêtée sous l'ancien réglage ; elle ne veut plus
    // rien dire. Sans ça, rouvrir aujourd'hui le laissait vide jusqu'à minuit.
    partJour = null;
    log(r.checked ? `a mis son ${NOMS_JOURS[j].toLowerCase()} au repos`
                  : `a rouvert son ${NOMS_JOURS[j].toLowerCase()}`);
    saveState(); renderAll();
  }
  if (e.target.id === "reposCond" && canEdit) {
    reposCond = e.target.checked;
    partJour = null;
    log(reposCond ? "ne prend plus de repos tant qu'il est en retard"
                  : "reprend ses jours de repos sans condition");
    saveState(); renderAll();
  }
});
document.addEventListener("click", (e) => {
  const ici = e.target.closest("[data-ici]");
  if (ici) { demanderIci(ici.dataset.ici); return; }
  const d = e.target.closest("[data-del]");
  if (d && canEdit) {
    const ev = events.find((x) => x.id === d.dataset.del);
    const fratrie = ev && ev.serie ? serieDe(ev.serie) : [];
    // Retirer une journée d'un stage de huit semaines n'est pas retirer le
    // stage : on ne devine pas lequel des deux est voulu, on le demande.
    if (fratrie.length > 1) {
      const retirer = (liste, texte) => {
        const ids = new Set(liste.map((x) => x.id));
        events = events.filter((x) => !ids.has(x.id));
        log(texte); saveEvents(); renderAll();
      };
      dialogue({
        ton: "warn", titre: `Supprimer « ${esc(ev.titre || ev.title || "")} » ?`,
        corps: `<p>Cet événement fait partie d'une série de
          <b>${plural(fratrie.length, "journée")}</b>, du ${leJour(fratrie[0].date)} au
          ${leJour(fratrie[fratrie.length - 1].date)}.</p>`,
        actions: [
          { texte: "Annuler", pri: true },
          { texte: "Ce jour seulement",
            faire: () => retirer([ev], `a retiré « ${ev.titre || ev.title} » du ${leJour(ev.date)}`) },
          { texte: `Toute la série (${fratrie.length})`,
            faire: () => retirer(fratrie, `a supprimé la série « ${ev.titre || ev.title} »,`
              + ` ${plural(fratrie.length, "journée")}`) },
        ],
      });
      return;
    }
    events = events.filter((x) => x.id !== d.dataset.del);
    if (ev) log(`a supprimé « ${ev.titre || ev.title} »`);
    saveEvents(); renderAll(); return;
  }
  const r = e.target.closest("[data-tard]");
  if (r && canEdit) {
    const id = r.dataset.tard;
    const m = plan.manques.find((x) => x.etape.id === id);
    if (!m) return;
    const q = proposerReport(plan.jours, m.h, NOW);
    if (!q) {
      r.textContent = "Aucun créneau d'ici juin";
      r.disabled = true;
      return;
    }
    reports[id] = q;
    log(`a repoussé « ${m.etape.n} » au ${new Date(q + "T00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`);
    saveState(); renderAll();
  }
});
$("durees").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-h]"); if (!b) return;
  dureeCherchee = Number(b.dataset.h);
  document.querySelectorAll("#durees button").forEach((x) => x.classList.toggle("pri", x === b));
  renderDispo();
});
$("prevM").onclick = () => { calCur.setMonth(calCur.getMonth() - 1); renderCal(); };
$("nextM").onclick = () => { calCur.setMonth(calCur.getMonth() + 1); renderCal(); };
$("todayM").onclick = () => {
  const d = new Date(NOW);
  calCur = new Date(d.getFullYear(), d.getMonth(), 1); calSel = d; renderCal();
};
/* ═════════ NAVIGATION ═════════
   Cinq destinations en bas de l'écran, et une adresse par écran. Le bouton
   « précédent » du téléphone doit ramener à l'écran d'avant, pas quitter
   l'application : c'est pour ça que chaque vue s'inscrit dans l'historique. */

const VUES = {
  jour:     { panneau: "today",    titre: "Aujourd'hui" },
  planning: { panneau: "cal",      titre: "Planning", volets: ["cal", "dispo", "todo"] },
  moi:      { panneau: "regl",     titre: "Moi" },
  minuteur: { panneau: "minuteur", titre: "En cours", retour: "jour" },
  fiche:    { panneau: "fiche",    titre: "Ma fiche",  retour: "planning" },
};
const TITRES = { cal: "Calendrier", dispo: "Quand je suis libre", todo: "Étapes" };

let vueCourante = "jour", argCourant = null, sousPlanning = "cal";

function versAdresse(v, arg) {
  if (v === "planning") return `#/planning/${arg || sousPlanning}`;
  if (v === "minuteur" && arg) return `#/minuteur/${encodeURIComponent(arg)}`;
  if (v === "fiche" && arg) return `#/fiche/${encodeURIComponent(arg)}`;
  return `#/${v}`;
}

/** Va quelque part. Passe par l'adresse : l'historique suit tout seul. */
function aller(v, arg = null, { remplacer = false } = {}) {
  const a = versAdresse(v, arg);
  if (location.hash === a) return appliquerRoute();
  if (remplacer) history.replaceState(null, "", a); else history.pushState(null, "", a);
  appliquerRoute();
}

function lireAdresse() {
  const m = location.hash.replace(/^#\/?/, "").split("/");
  const v = m[0] || "";
  if (v === "planning") return ["planning", m[1] || sousPlanning];
  // Sans étape dans l'adresse, on reprend celle du minuteur en cours : revenir
  // sur l'application par un raccourci ne doit pas perdre la séance.
  if (v === "minuteur") return ["minuteur", m[1] ? decodeURIComponent(m[1])
                                                 : (minuteur && minuteur.etape) || null];
  if (v === "fiche") return ["fiche", m[1] ? decodeURIComponent(m[1]) : ficheOuverte];
  return [VUES[v] ? v : "jour", null];
}

function appliquerRoute() {
  const [v, arg] = lireAdresse();
  montrerVue(v, arg);
}

/** La hauteur réelle de l'en-tête : les panneaux collants s'y ajustent. */
function mesurerEnTete() {
  const b = document.querySelector(".barre");
  if (b) document.documentElement.style.setProperty("--entete", b.offsetHeight + "px");
}
addEventListener("resize", mesurerEnTete);

function montrerVue(v, arg) {
  const def = VUES[v] || VUES.jour;
  vueCourante = v; argCourant = arg;
  if (v === "planning") sousPlanning = VUES.planning.volets.includes(arg) ? arg : sousPlanning;
  const panneau = v === "planning" ? sousPlanning : def.panneau;

  document.querySelectorAll("section[data-panel]").forEach((sec) => {
    const on = sec.dataset.panel === panneau;
    sec.hidden = !on;
    if (on && !SOBRE.matches) {
      sec.classList.remove("entre"); void sec.offsetWidth; sec.classList.add("entre");
    }
  });
  // Le planning a besoin de place sur un écran large ; les réglages se lisent
  // mieux en colonne étroite.
  $("appli").toggleAttribute("data-large", v === "planning" || v === "jour");
  $("segPlanning").hidden = v !== "planning";
  document.querySelectorAll("#segPlanning button").forEach((b) =>
    b.setAttribute("aria-selected", b.dataset.seg === sousPlanning));

  document.querySelectorAll("#socle button").forEach((b) => {
    const on = b.dataset.vue === v;
    b.setAttribute("aria-current", on ? "page" : "false");
  });

  const rev = $("revenir");
  rev.hidden = !def.retour;
  rev.onclick = () => (history.length > 1 ? history.back() : aller(def.retour));

  // « enregistré » n'a de sens que sous le planning : ailleurs, le sous-titre
  // se tairait mieux que de commenter une page qu'il ne décrit pas.
  $("sousTitre").hidden = !["jour", "planning"].includes(v);
  const t = $("titreProfil");
  if (v === "planning") t.textContent = TITRES[sousPlanning];
  else t.textContent = def.titre;

  // Instantané : un défilement animé pendant que le contenu change laisse la
  // page à mi-chemin, et le panneau apparaît coupé par l'en-tête.
  scrollTo({ top: 0, behavior: "auto" });
  mesurerEnTete();
  try { sessionStorage.setItem("ciel.vue", location.hash); } catch {}
  peupler(v, arg);
}

function peupler(v, arg) {
  if (v === "planning") {
    if (sousPlanning === "cal") renderCal();
    if (sousPlanning === "dispo") renderDispo();
  }
  if (v === "moi") { renderCapacites(); renderProgramme(); renderSauvegarde(); }
  if (v === "minuteur") { renderMinuteur(); if (minuteur) battre(); }
  if (v === "fiche") renderFiche();
  if (v === "jour") renderEtapesBloquees();
}

addEventListener("hashchange", appliquerRoute);
addEventListener("popstate", appliquerRoute);

$("socle").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-vue]");
  if (b) aller(b.dataset.vue);
});

// Les interrupteurs segmentés : même geste partout.
document.addEventListener("click", (e) => {
  const b = e.target.closest(".segs button[data-seg]");
  if (!b) return;
  const barre = b.closest(".segs");
  barre.querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", x === b));
  if (barre.dataset.segs === "planning") return aller("planning", b.dataset.seg);
  const hote = barre.parentElement;
  hote.querySelectorAll(":scope > [data-vol]").forEach((z) => (z.hidden = z.dataset.vol !== b.dataset.seg));
});

document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-chrono]");
  if (c) { demarrerMinuteur(c.dataset.chrono, { pom: prefPom }); return; }
  const fi = e.target.closest("[data-fiche]");
  if (fi) { ouvrirFiche2(fi.dataset.fiche); return; }
  const db = e.target.closest("[data-debloque]");
  if (db) { basculerBlocage(db.dataset.debloque, false); return; }
  const fp = e.target.closest("[data-fph]");
  if (fp) { retirerPhotoFiche(fp.dataset.fph); return; }
  const m = e.target.closest("[data-min]");
  if (m) {
    const q = m.dataset.min;
    if (q === "demarrer") demarrerMinuteur(argCourant, { pom: prefPom });
    else if (q === "pause") basculerPause();
    else if (q === "arreter") finirSeance();
    else if (q === "phase") phaseSuivante();
    return;
  }
  const a = e.target.closest("[data-aller]");
  if (a) aller(a.dataset.aller);
});

document.addEventListener("input", (e) => {
  const n = e.target.closest("[data-note]");
  if (n) differer("note:" + n.dataset.note, 2500, () => noterBlocage(n.dataset.note, n.value));
});

document.addEventListener("change", (e) => {
  if (painting) return;
  const cb = e.target.closest("input[data-cb]");
  if (cb) {
    if (!canEdit) { cb.checked = !cb.checked; return; }
    const s = byId[cb.dataset.cb], on = cb.checked;
    if (!s) return;
    const item = cb.closest(".qitem") || cb.closest(".ligne.trav");
    // Une tranche de la journée porte ses heures ; ailleurs, la case vaut l'étape entière.
    const bh = parseFloat(cb.dataset.bh);
    const tranche = !isNaN(bh) && bh > 0;
    const appliquer = () => {
      if (tranche) {
        poserHeures(s, cb.dataset.jour, on ? bh : -bh);
        const f = faitDe(s.id);
        log(`${on ? "a posé" : "a retiré"} ${unH(bh)} sur ${s.row.n} · ${s.n}` +
            ` (${unH(f)} sur ${s.h} h)`);
      } else if (on) {
        // « J'ai fini cette étape » : on complète, sans effacer ce qui était déjà posé.
        poserHeures(s, isoJour(new Date(NOW)), resteDe(s));
        log(`a terminé : ${s.row.n} · ${s.n} (${s.h} h)`);
      } else {
        delete avance[s.id]; delete done[s.id];
        log(`a rouvert : ${s.row.n} · ${s.n} (${s.h} h)`);
      }
      saveProgress(); renderAll();
    };
    // Valider fait glisser la ligne dehors : on voit ce qu'on vient d'enlever.
    if (item && on && !tranche && !SOBRE.matches) {
      item.classList.add(item.classList.contains("qitem") ? "going" : "partie");
      setTimeout(appliquer, 260);
    } else appliquer();
    return;
  }
  const gr = e.target.closest("input[data-gr]");
  if (gr && canEdit) {
    const v = parseFloat(gr.value), s = byId[gr.dataset.gr];
    if (isNaN(v)) delete grades[gr.dataset.gr];
    else grades[gr.dataset.gr] = Math.max(0, Math.min(20, v));
    log(isNaN(v) ? `a effacé la note de ${s.n}` : `a saisi ${grades[gr.dataset.gr]}/20 — ${s.n}`);
    saveGrades(); renderGrades(); renderProjection();
  }
});

// L'horloge bat à la seconde ; le planning ne se recalcule qu'à la minute.
setInterval(() => { NOW = parisNow(); majHorloge(); }, 1000);
setInterval(() => { tickClock(); if (vue) renderAll(); }, 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { tickClock(); if (vue) renderAll(); }
});

/* Le service worker rend l'application ouvrable sans réseau. Son échec n'a
   aucune conséquence : on ne bloque jamais le démarrage dessus. */
if ("serviceWorker" in navigator && location.protocol === "https:") {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

lancer();
