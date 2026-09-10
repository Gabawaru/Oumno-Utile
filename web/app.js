import { creerClient } from "./supa.js";
import { MONTHS, MFULL, DOW, DAY, TZ, CNED, EXAM } from "./planning.js";
import { versGroupes, MODELES, QUINZAINES, COULEURS, depuisModele } from "./modeles.js";
import { planifier, testerAjout, proposerReport, bilanJour, totalManque, duree,
         trouverCreneaux, creneauxTexte, plusLongCreneau, normaliserCapacites,
         journeeType, REGLES, JOURNEE,
         hhmm as enHeure, min as enMin, iso as isoJour } from "./planificateur.js";
import { preparer as preparerImage, deposer as deposerImage,
         recadrer as recadrerImage } from "./photos.js";

const SUPABASE_URL = "https://hnmeefndnckqkdjjbgwe.supabase.co";
const SUPABASE_KEY = "sb_publishable_ciLHalsy_YvWIUbEbCnN2g_TZfT4aPU";
const sb = creerClient(SUPABASE_URL, SUPABASE_KEY);

/* ═════════ ÉTAT DE SESSION ═════════ */
let session = null;      // session Supabase
let moi = null;          // mon profil
let vue = null;          // profil consulté
let capacites = { 0: 2, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 3 };
let reports = {};        // échéances repoussées à la main
let programme = null;    // modèle choisi, ou matières déclarées à la main
let modeleEnAttente = null;  // modèle retenu à l'inscription, posé à la 1re ouverture
let nomReel = null;      // vrai nom du profil consulté, si l'on y a droit
let abonnements = [], abonnes = [], resaRecues = [], resaEnvoyees = [], annuaire = [];
let demarrageFait = false;  // la question « par quoi on commence ? » a été posée
let partJour = null;     // { date, h } — la part de travail fixée pour le jour
let plan = null;         // résultat du planificateur

const estMoi = () => Boolean(session && vue && vue.id === session.user.id);
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
let avance={};

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
      s.row=r;s.g=g;s.t0=a+span*(cum/Math.max(r.h,1));cum+=s.h;s.t1=a+span*(cum/Math.max(r.h,1));
      ALL.push(s); if(s.dev) DEVS.push(s);
    });
  }));
  GROUPES.forEach(g=>{g.h=g.rows.reduce((a,r)=>a+r.h,0);
    g.s=Math.min(...g.rows.map(r=>r.s));g.e=Math.max(...g.rows.map(r=>r.e));});
  TOTAL_H=GROUPES.reduce((a,g)=>a+g.h,0);
  ALL.forEach(s=>byId[s.id]=s);
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
 * filtre, « javascript:… » dans le lien d'un événement s'exécute chez tous ceux
 * qui consultent un planning public : c'est une injection stockée, pas une
 * curiosité. Le protocole est vérifié après analyse, pas par comparaison de
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
let done=Object.create(null), events=[], journal=[], subs=[], grades={};
let canEdit=false;
let pendingLog=[], subCount=0, tmr={};
const LS="ciel.v4";
/** Copie de secours dans le navigateur, pour survivre à une coupure réseau. */
function saveLocal(){
  if(!vue||!estMoi()) return;
  // Le profil est gardé avec le planning : sans lui, une ouverture hors réseau
  // n'a rien à ouvrir, et la copie de secours ne sert à rien.
  try{ localStorage.setItem(LS, JSON.stringify({ id: vue.id, profil: vue, data: etat() })); }catch(e){}
}
function lireLocal(id){
  try{
    const r = JSON.parse(localStorage.getItem(LS) || "null");
    return r && r.id === id ? r : null;
  }catch(e){ return null; }
}
function loadLocal(id){
  const r = lireLocal(id);
  return r && r.data ? r.data : null;
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
  events    = d.evenements|| d.events || [];
  grades    = d.notes     || d.grades || {};
  capacites = normaliserCapacites(d.capacites);
  reports   = d.reports   || {};
  partJour  = d.partJour  || null;
  demarrageFait = Boolean(d.demarrage);
  programme = d.programme || { modele: "cned", matieres: [] };
  chargerProgramme(programme);
  Object.keys(done).forEach(k=>{if(done[k]===true)done[k]="";});
  migrerAvance();
}
const etat=()=>({done,avance,evenements:events,notes:grades,capacites,reports,partJour,programme,
                 demarrage:demarrageFait});

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
  // Une étape retirée du programme ne doit pas laisser des heures fantômes.
  for(const id in avance) if(!byId[id]) delete avance[id];
  return bouge;
}

const EPS=0.01;
/** Heures posées sur une étape, jamais plus que son volume. */
const faitDe =id=>{const m=avance[id]; if(!m) return 0;
  let t=0; for(const j in m) t+=Number(m[j])||0;
  const s2=byId[id]; return s2?Math.min(s2.h,t):t;};
const resteDe=s2=>Math.max(0,s2.h-faitDe(s2.id));
const estFait=s2=>resteDe(s2)<=EPS;

/** Pose (ou retire) des heures un jour donné, et tient `done` en accord. */
function poserHeures(s2,jour,h){
  const m=avance[s2.id]||(avance[s2.id]={});
  const autres=Object.keys(m).reduce((a,j)=>a+(j===jour?0:(Number(m[j])||0)),0);
  const v=Math.max(0,Math.min(s2.h-autres,(Number(m[jour])||0)+h));
  if(v<=EPS) delete m[jour]; else m[jour]=Math.round(v*100)/100;
  if(!Object.keys(m).length) delete avance[s2.id];
  if(estFait(s2)){
    // Le jour de fin est le dernier jour travaillé, pas celui du dernier clic.
    const jours=Object.keys(avance[s2.id]||{}).sort();
    const dernier=jours[jours.length-1]||jour;
    done[s2.id]=new Date(dernier+"T18:00:00").toISOString();
  } else delete done[s2.id];
}

function log(text){
  pendingLog.push(text);
  journal.unshift({ts:new Date(NOW).toISOString(),text});
  journal=journal.slice(0,150);
}
function saveState(){
  saveLocal();
  if(!canEdit) return;
  clearTimeout(tmr.s); setSync("warn","enregistrement");
  tmr.s=setTimeout(async()=>{
    const lignes=pendingLog.splice(0);
    try{
      const {error}=await sb.from("ciel_state")
        .update({data:etat(),updated_at:new Date().toISOString()})
        .eq("user_id",session.user.id);
      if(error) throw error;
      if(lignes.length){
        await sb.from("ciel_journal")
          .insert(lignes.map(body=>({user_id:session.user.id,body})));
      }
      setSync("ok","enregistré");
      // Ce que les autres ont le droit de savoir : mes plages libres, et rien d'autre.
      publierDispos().catch(() => {});
    }catch(e){ pendingLog.unshift(...lignes); setSync("warn","hors ligne — gardé en local"); }
  },600);
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
function renderToday(){
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
    av.innerHTML = `<b>Ça déborde sur tes soirées.</b> ${Math.round(soirs * 10) / 10} h de
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
  cible.innerHTML = `${fmtDL(NOW)} — ` + (reste >= 0.05
    ? `<b>${reste} h</b> à faire`
    : `<b class="fini">part du jour faite</b>`);
  cible.dataset.reste = String(reste);
  if (avant !== undefined && avant !== String(reste) && !SOBRE.matches) {
    const b = cible.querySelector("b");
    if (b) { b.classList.add("pulse"); setTimeout(() => b.classList.remove("pulse"), 400); }
  }
  const mnt = new Date(NOW).getHours() * 60 + new Date(NOW).getMinutes();
  $("journee").innerHTML = friseHTML(cle, { compact: true, depuis: mnt, max: 6 });

  // Retard : on ne montre le bloc que s'il y a quelque chose dedans.
  const lates = st.late.sort((a, b) => a.t1 - b.t1);
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
function buildGantt(){
  const g=document.getElementById("gantt"),NQ=nowQ();
  let h='<div class="corner"></div>';
  MONTHS.forEach((m,i)=>h+=`<div class="mcell${Math.floor(NQ/2)===i?" now":""}">${m}</div>`);
  GROUPES.forEach((grp,gi)=>{
    if(gi)h+='<div class="spacer"></div>';
    h+=`<div class="glabel grp">${grp.name}${grp.code?`<span class="code">${grp.code}</span>`:""}<span class="code">${grp.h} h</span></div>
      <div class="lane grp"><div class="bar grp" data-g="${esc(grp.id)}" style="--c:${esc(grp.c)};grid-column:${col(grp.s)}/${col(grp.e)}"><div class="fill"></div></div></div>`;
    grp.rows.forEach(r=>{
      h+=`<div class="glabel sub" data-lab="${esc(r.id)}" title="${esc(r.n)}">${r.url?`<a href="${esc(r.url)}" target="_blank" rel="noopener" style="color:inherit">${esc(r.n)}</a>`:esc(r.n)}${r.code?`<span class="code">${r.code}</span>`:""}</div>
        <div class="lane"><div class="bar" data-r="${esc(r.id)}" style="--c:${esc(grp.c)};grid-column:${col(r.s)}/${col(r.e)}">
          <div class="fill"></div><span class="blab"></span></div></div>`;
    });
  });
  g.innerHTML=h;
  // Le renvoi vers le CNED n'a de sens que si les lots portent un lien de cours.
  const liens=GROUPES.some(gp=>gp.rows.some(r=>r.url));
  document.getElementById("legend").innerHTML=
    GROUPES.map(gp=>`<span class="li"><span class="sw" style="background:${gp.c}"></span>${short(gp)} — ${gp.h} h</span>`).join("")+
    (liens?`<span class="li muted" style="margin-left:auto">Clique le nom d'un lot pour ouvrir le cours</span>`:"");
}
function paintGantt(){
  GROUPES.forEach(g=>{
    let gd=0;
    g.rows.forEach(r=>{
      const d=doneH(r);gd+=d;const pc=r.h?d/r.h*100:0,late=r.steps.some(isLate);
      const bar=document.querySelector(`[data-r="${r.id}"]`);
      if(bar){bar.querySelector(".fill").style.width=pc+"%";
        bar.querySelector(".blab").textContent=`${d}/${r.h} h`;
        bar.classList.toggle("done",pc>=99.5);bar.classList.toggle("lt",late&&pc<99.5);}
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
       <span class="car">▶</span><span class="nm">${g.name}</span>
       <span class="mini"><i data-mini="${g.id}"></i></span>
       <span class="ct" data-ct="${g.id}">0/${g.h} h</span></div>
     <div class="grpbody">${g.rows.map(r=>`
       <div><div class="rowhd">${r.url?`<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.n)} ↗</a>`:esc(r.n)}
         <span class="rh" data-rh="${r.id}">0/${r.h} h</span></div>
       <div class="steps">${r.steps.map(s=>`
         <label class="step" data-step="${s.id}">
           <input type="checkbox" class="cb" data-cb="${esc(s.id)}">
           <span class="lbl">${esc(s.n)}${s.date?` <b class="mono" style="color:var(--sig)">${s.date}</b>`:""}</span>
           <span class="hh">${unH(s.h)}</span></label>`).join("")}</div></div>`).join("")}</div>
   </div>`).join("");
  document.querySelectorAll(".grphd").forEach(hd=>{
    const t=()=>{const b=hd.parentElement;b.classList.toggle("open");
      hd.setAttribute("aria-expanded",b.classList.contains("open"));};
    hd.onclick=t; hd.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();t();}};
  });
  document.getElementById("expandAll").onclick=()=>document.querySelectorAll(".grpblk").forEach(b=>b.classList.add("open"));
  document.getElementById("collapseAll").onclick=()=>document.querySelectorAll(".grpblk").forEach(b=>b.classList.remove("open"));
}

/* ═════════ COURBE DE PROGRESSION ═════════
   Deux séries : le plan, en gris, sert de repère ; les heures réellement faites
   portent la couleur du statut — c'est elle qu'on vient lire. La ligne du fait
   s'arrête à aujourd'hui : on ne dessine pas un avenir qui n'existe pas. */
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
  const reste = Math.max(0, TOTAL_H - st.act);
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
      if (h > 0) faits.push([Date.parse(j + "T23:59:59") || T0, h]);
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
    h+=`<tr><td>${esc(s.n)}</td><td style="color:var(--ink3)">${short(s.g)}</td>
      <td class="num"><input type="number" min="0" max="20" step="0.25" data-gr="${s.id}"
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
  document.getElementById("subs").innerHTML= canEdit
    ? (subs.length
        ? subs.map((e,i)=>`<span class="pill">${esc(e)}<button data-sub="${i}" title="Retirer">✕</button></span>`).join("")
        : `<span class="muted" style="font-size:.73rem">Aucun abonné pour l'instant.</span>`)
    : `<span class="muted" style="font-size:.73rem">${subCount} personne${subCount>1?"s":""} ${subCount>1?"suivent":"suit"} ce planning.</span>`;
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
        const hh=st.querySelector(".hh");
        if(hh&&s2) hh.textContent = (!on&&f>0.01) ? `${unH(f)} / ${unH(s2.h)}` : unH(s2.h);
      }
    }
    cb.disabled=!canEdit;});
}
let painting=false;
function renderAll(){
  painting=true;
  replanifier();
  renderToday();renderCourbe();renderProjection();paintGantt();renderGrades();renderJournal();
  // Reconstruire les champs de réglage sous les doigts de quelqu'un qui écrit
  // efface ce qu'il tape : on ne les redessine que s'ils sont à l'écran.
  if(vueCourante==="moi"){renderCapacites();renderProfil();renderProgramme();renderCompte();renderJoignable();}
  majPastille();
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
  const base = { etapes: ALL, done, evenements: events, capacites, reports,
                 maintenant: NOW, fin: FIN_ANNEE, reste: resteDe };
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
    const deborde = b && b.tardif > 0;

    h += `<div class="day${d.getMonth() !== calCur.getMonth() ? " out" : ""}${
      sameDay(d, auj) ? " today" : ""}${calSel && sameDay(d, calSel) ? " sel" : ""}${
      deborde ? " deborde" : pleine ? " pleine" : ""}" data-d="${t}">
      <span class="num">${d.getDate()}</span>
      ${scans.map(() => `<span class="chip ev sys">Scan CNED</span>`).join("")}
      ${evs.slice(0, 2).map((e) => `<span class="chip ev">${esc(e.titre || e.title)}</span>`).join("")}
      ${evs.length > 2 ? `<span class="more">+${evs.length - 2}</span>` : ""}
      ${b && !passe && b.travail > 0
        ? `<span class="charge"><i style="width:${Math.min(100, (b.travail / Math.max(b.cap, 1)) * 100)}%"></i></span>
           <span class="hcount">${b.travail.toFixed(1)} h</span>` : ""}
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

  if (!items.length) return `<div class="empty">Journée entièrement libre.</div>`;
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
    const dur = ((x.f - x.d) / 60).toFixed(1).replace(".0", "");
    if (x.type === "libre") {
      return `<div class="ligne libre"><span class="hh">${plage}</span>
        <span class="quoi">Libre · ${dur} h</span></div>`;
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
      return `<label class="ligne trav${x.bloc.retard ? " retard" : ""}${x.bloc.tard ? " tardif" : ""}${coche ? " coche" : ""}" style="--c:${esc(e.g.c)}">
        <span class="hh">${plage}</span>
        <span class="quoi"><input type="checkbox" class="cb" data-cb="${esc(e.id)}"
            data-bh="${bh}" data-jour="${esc(cle)}"${coche ? " checked" : ""}${canEdit ? "" : " disabled"}>
          <b>${esc(e.n)}</b> <em>${esc(e.row.n)}</em>
          ${compact ? "" : `<span class="part">${unH(bh)} sur ${unH(e.h)}${part < 100 ? ` · ${part} %` : ""}${
            fait > 0.01 && fait < e.h - 0.01 ? ` · déjà ${unH(fait)}` : ""}</span>`}
          ${x.bloc.tard ? `<span class="lt">hors horaires</span>` : x.bloc.retard ? `<span class="lt">rattrapage</span>` : ""}
          ${e.row.url ? `<a href="${esc(e.row.url)}" target="_blank" rel="noopener">cours ↗</a>` : ""}
        </span></label>`;
    }
    const e = x.ev;
    // On ne montre le titre d'un événement que s'il est explicitement partagé.
    if (!canEdit && !e.visible) {
      return `<div class="ligne occupe"><span class="hh">${plage}</span>
        <span class="quoi">Occupé · ${dur} h</span></div>`;
    }
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
                  : `<div class="empty">Plus rien de prévu aujourd'hui.</div>`)
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
      <span><b class="mono">${b.travail} h</b> de travail</span>
      ${b.occupe > 0 ? `<span class="occ-t"><b class="mono">${b.occupe} h</b> d'événements</span>` : ""}
      ${b.tardif > 0 ? `<span class="tard-t"><b class="mono">${b.tardif} h</b> hors horaires</span>` : ""}
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
    // Par défaut un événement est privé : les autres voient « occupé », rien de plus.
    visible: $("evV").checked,
  };
}
function baseplan() {
  const cle = isoJour(new Date(NOW));
  return {
    etapes: ALL, done, evenements: events, capacites, reports,
    plafonds: partJour && partJour.date === cle
      ? { [cle]: Math.max(0, partJour.h - heuresFaitesLe(cle)) } : {},
    maintenant: NOW, fin: FIN_ANNEE,
  };
}
const leJour = (d) => new Date(d + "T00:00").toLocaleDateString("fr-FR",
  { weekday: "long", day: "numeric", month: "long" });

/** Aperçu discret sous le calendrier, pendant qu'il remplit le formulaire. */
function verifier() {
  const ev = nouvelEvenement();
  const zone = $("alerte");
  if (!zone) return null;
  if (!ev.date || !ev.debut || !ev.fin) { zone.innerHTML = ""; return null; }
  if (duree(ev) <= 0) {
    zone.innerHTML = `<div class="impossible">L'heure de fin doit suivre l'heure de début.</div>`;
    return null;
  }
  const t = testerAjout(baseplan(), ev);
  zone.innerHTML = !t.possible
    ? `<div class="impossible"><b>Journée pleine.</b> ${t.supplement} h de cours n'auraient
        plus de place nulle part.</div>`
    : t.tardif >= 0.1
      ? `<div class="attention">Ça rentre, mais <b>${t.tardif} h</b> de travail passeraient
          en dehors de tes heures normales, le soir.</div>`
      : t.deplace > 0
        ? `<div class="ok-zone">Ça rentre. <b>${t.deplace} h</b> de travail se reportent sur les
            jours suivants, sans faire sauter d'échéance.</div>`
        : `<div class="ok-zone">Ça rentre. Ce créneau ne croise aucun travail prévu.</div>`;
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
  const t = testerAjout(baseplan(), ev);

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
        <p class="petit">Pour caler « ${esc(ev.titre)} » quand même, il faut d'abord valider des
        étapes, élargir tes heures dans Réglages, ou repousser une échéance depuis le
        calendrier.</p>`,
      actions: [
        { texte: "J'ai compris", pri: true },
        { texte: "Ajouter quand même", faire: () => ajouter(true) },
      ],
    });
    return;
  }

  events.push(ev);
  events.sort((a, b) => (a.date + (a.debut || "")).localeCompare(b.date + (b.debut || "")));
  log(`a ajouté « ${ev.titre} » le ${leJour(ev.date)} de ${ev.debut} à ${ev.fin}`);
  saveEvents();
  $("evT").value = ""; $("evL").value = "";
  $("evU").checked = false; $("evP").checked = false; $("evV").checked = false;
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
  const noms = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  const total = [0,1,2,3,4,5,6].reduce((a, j) =>
    a + (capacites[j] || []).reduce((x, s2) => x + (enMin(s2[1]) - enMin(s2[0])) / 60, 0), 0);
  box.innerHTML = [1,2,3,4,5,6,0].map((j) => {
    const txt = (capacites[j] || []).map((s2) => `${s2[0]}-${s2[1]}`).join(", ");
    const h = (capacites[j] || []).reduce((x, s2) => x + (enMin(s2[1]) - enMin(s2[0])) / 60, 0);
    return `<label class="cap"><span>${noms[j]}</span>
      <input type="text" data-cap="${j}" value="${txt}" placeholder="09:00-12:00, 14:00-18:00"
        ${canEdit ? "" : "disabled"}> <em>${h ? h.toFixed(1).replace(".0","") + " h" : "—"}</em></label>`;
  }).join("") +
    `<div class="captot">Soit <b class="mono">${total.toFixed(1).replace(".0","")} h</b> déclarées
      par semaine — un peu moins une fois les pauses déduites : ${REGLES.pause} min après chaque
      ${REGLES.session / 60} h de travail, jamais négociables.
      <div class="petit">Ce qui n'y tient pas glisse sur des heures inhabituelles
      (jusqu'à ${JOURNEE[1]}), et seulement en rattrapage. Le reste de la journée
      ${JOURNEE[0]}–${JOURNEE[1]} apparaît comme temps libre pour ton entourage.</div>
      ${canEdit ? `<button class="btn" id="capType">Revenir à la journée type 9 h – 16 h</button>` : ""}
    </div>`;
  const bt = $("capType");
  if (bt) bt.onclick = () => dialogue({
    ton: "warn", titre: "Revenir à la journée type ?",
    corps: `<p>Lundi au vendredi 9 h – 12 h 15 et 13 h 15 – 16 h, samedi matin,
      dimanche au repos. Tes plages actuelles seront remplacées.</p>`,
    actions: [
      { texte: "Annuler", pri: true },
      { texte: "Remplacer", faire: () => {
          capacites = journeeType();
          log("a repris la journée type 9 h – 16 h");
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

/* ═════════ PROFIL, PARTAGES ET INVITATIONS ═════════
   Un planning privé n'est pas seulement caché : la base refuse de le servir à
   qui n'est pas dans la liste. Ce qui suit ne fait que piloter cette liste. */

/**
 * Le vrai nom vit dans sa propre table : les politiques de sécurité portent sur
 * des lignes et non sur des colonnes, donc le loger dans le profil l'aurait
 * rendu lisible par quiconque peut lire ce profil. Ici, la requête ne renvoie
 * rien quand on n'y a pas droit — ce n'est pas l'interface qui cache, c'est la
 * base qui refuse.
 */
async function chargerNomReel() {
  nomReel = null;
  if (!vue || !session) return;
  const { data } = await sb.from("ciel_identites").select("nom_reel").eq("user_id", vue.id).maybeSingle();
  nomReel = data && data.nom_reel ? data.nom_reel : null;
}

function renderProfil() {
  const box = $("profilBox");
  if (!box || !vue) return;
  const url = location.origin + "?profil=" + vue.slug;
  if (!canEdit) {
    box.innerHTML = `<p class="aide">Tu consultes le planning de <b>${esc(vue.nom)}</b>
      (<span class="mono">@${esc(vue.slug)}</span>), en lecture seule.</p>`;
    return;
  }
  box.innerHTML = `
    <div class="fiche">
      <div class="haut">
        ${vignette(vue, "gr")}
        <div style="min-width:0;flex:1">
          <h2>${esc(vue.nom)}</h2>
          <div class="arobase">@${esc(vue.slug)}</div>
          <div class="actes" style="margin-top:.5rem">
            <input type="file" id="pfFichier" accept="image/*" class="horsvue">
            <button class="btn" id="pfPhoto">${vue.avatar ? "Changer la photo" : "Ajouter une photo"}</button>
            ${vue.avatar ? `<button class="btn danger" id="pfSansPhoto">Retirer</button>` : ""}
          </div>
        </div>
      </div>
    </div>

    <div class="deuxchamps">
      <div class="champ">
        <label class="fl" for="pfNom">Pseudonyme</label>
        <input id="pfNom" type="text" maxlength="40" value="${esc(vue.nom)}">
        <div class="dispo" id="pfDispo"></div>
        <div class="fl2">Ce que tout le monde voit.</div>
      </div>
      <div class="champ">
        <label class="fl" for="pfSlug">Identifiant public</label>
        <input id="pfSlug" type="text" maxlength="32" value="${esc(vue.slug)}"
          pattern="[a-z0-9-]+" autocapitalize="none" spellcheck="false">
        <div class="dispo" id="pfSlugDispo"></div>
        <div class="fl2">Dans l'adresse de ton profil. Un changement par jour.</div>
      </div>
    </div>

    <div class="champ">
      <label class="fl" for="pfBio">Une ligne sur toi <span class="opt-t">facultatif</span></label>
      <input id="pfBio" type="text" maxlength="160" value="${esc(vue.bio || "")}"
        placeholder="BTS CIEL 2ᵉ année · révisions le soir">
    </div>

    <div class="deuxchamps">
      <div class="champ">
        <label class="fl" for="pfFuseau">Mon fuseau horaire</label>
        <select id="pfFuseau">${fuseauxProposes(vue.fuseau).map((f) =>
          `<option value="${esc(f)}"${f === (vue.fuseau || "Europe/Paris") ? " selected" : ""}>${
            esc(f.replace(/_/g, " "))} · ${esc(heureChez(f) || "")}</option>`).join("")}</select>
        <div class="fl2">Les autres voient l'heure qu'il est chez toi.</div>
      </div>
      <div class="champ">
        <label class="fl" for="pfRegion">Ma région <span class="opt-t">facultatif</span></label>
        <input id="pfRegion" type="text" maxlength="60" value="${esc(vue.region || "")}"
          placeholder="Nouvelle-Aquitaine">
        <label class="urgcase" style="margin-top:.35rem"><input type="checkbox" id="pfRegionVue"
          ${vue.region_visible ? "checked" : ""}><span>La montrer sur mon profil</span></label>
      </div>
    </div>

    <div class="champ">
      <label class="fl" for="pfReel">Vrai nom <span class="opt-t">facultatif</span></label>
      <input id="pfReel" type="text" maxlength="80" value="${esc(nomReel || "")}" placeholder="Prénom Nom">
      <div class="fl2">Visible seulement par les gens que tu coches dans Contacts.</div>
    </div>

    <div class="visi">
      <label class="opt${vue.public ? "" : " on"}">
        <input type="radio" name="visi" value="prive"${vue.public ? "" : " checked"}>
        <span><b>Privé</b><em>Toi, et les gens que tu acceptes.</em></span></label>
      <label class="opt${vue.public ? " on" : ""}">
        <input type="radio" name="visi" value="public"${vue.public ? " checked" : ""}>
        <span><b>Public</b><em>Consultable par n'importe qui, sans compte.</em></span></label>
    </div>

    <label class="urgcase" style="margin-top:.7rem"><input type="checkbox" id="pfClassement"
      ${vue.au_classement ? "checked" : ""}>
      <span>Figurer au classement des heures de la semaine</span></label>

    ${vue.public ? `<div class="lp" style="margin-top:.7rem"><code>${esc(url)}</code>
      <button class="btn" id="copierLien">Copier</button></div>` : ""}`;

  /* ── la photo ──────────────────────────────────────────────────── */
  $("pfPhoto").onclick = () => $("pfFichier").click();
  $("pfFichier").onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";                      // pour pouvoir rechoisir le même fichier
    if (!f) return;
    try {
      const coupe = await recadrerImage(f, { ratio: 1, rond: true, cote: 512,
        qualite: 0.88, titre: "Cadre ta photo de profil" });
      if (!coupe) return;                     // annulé, sans bruit
      setSync("warn", "envoi de la photo");
      const chemin = await deposerImage(sb, AVATARS, vue.id, coupe);
      const { error } = await sb.from("ciel_profiles").update({ avatar: chemin }).eq("id", vue.id);
      if (error) throw new Error(error.message);
      vue.avatar = chemin; if (moi) moi.avatar = chemin;
      majBoutonCompte(); renderProfil(); setSync("ok", "photo enregistrée");
    } catch (err) {
      setSync("warn", "photo refusée");
      dialogue({ titre: "Photo non enregistrée", corps: `<p>${esc(err.message)}</p>
        <p class="aide">Si ça se reproduit, réessaie avec une autre photo, ou
        recharge la page : une session expirée fait échouer le dépôt.</p>` });
    }
  };
  const sp = $("pfSansPhoto");
  if (sp) sp.onclick = async () => {
    const ancien = vue.avatar;
    await sb.from("ciel_profiles").update({ avatar: null }).eq("id", vue.id);
    if (ancien) await sb.stockage.supprimer(AVATARS, [ancien]);
    vue.avatar = null; if (moi) moi.avatar = null;
    majBoutonCompte(); renderProfil();
  };

  /* ── pseudonyme ────────────────────────────────────────────────── */
  const nomInp = $("pfNom");
  nomInp.oninput = () => {
    clearTimeout(tmr.nom);
    tmr.nom = setTimeout(async () => {
      const v = nomInp.value.trim(), z = $("pfDispo");
      if (v === vue.nom || v.length < 2) { z.className = "dispo"; z.textContent = ""; return; }
      const { data } = await sb.rpc("nom_disponible", { candidat: v });
      z.className = "dispo " + (data ? "oui" : "non");
      z.textContent = data ? "Ce nom est libre." : "Ce nom est déjà pris.";
    }, 400);
  };
  nomInp.onchange = async () => {
    const nom = nomInp.value.trim().slice(0, 40);
    if (!nom || nom === vue.nom) return;
    const { error } = await sb.from("ciel_profiles").update({ nom }).eq("id", vue.id);
    if (error) {
      nomInp.value = vue.nom;
      return dialogue({ ton: "warn", titre: "Ce nom est déjà pris",
        corps: `<p>Les noms affichés sont uniques, à la casse près. Essaie autre chose.</p>` });
    }
    vue.nom = nom; if (moi) moi.nom = nom;
    majBoutonCompte(); renderProfil();
  };

  /* ── identifiant public ────────────────────────────────────────── */
  const slugInp = $("pfSlug");
  slugInp.oninput = () => {
    slugInp.value = slugInp.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-");
    clearTimeout(tmr.slug);
    tmr.slug = setTimeout(async () => {
      const v = slugInp.value, z = $("pfSlugDispo");
      if (v === vue.slug) { z.className = "dispo"; z.textContent = ""; return; }
      const { data } = await sb.rpc("identifiant_disponible", { candidat: v });
      z.className = "dispo " + (data ? "oui" : "non");
      z.textContent = data ? "Libre." : "Pris, ou mal formé.";
    }, 400);
  };
  slugInp.onchange = async () => {
    const v = slugInp.value;
    if (!v || v === vue.slug) return;
    const { error } = await sb.from("ciel_profiles").update({ slug: v }).eq("id", vue.id);
    if (error) {
      slugInp.value = vue.slug;
      return dialogue({ ton: "warn", titre: "Identifiant refusé",
        corps: `<p>${/trop_recent/.test(error.message)
          ? "Tu l'as déjà changé aujourd'hui. Un changement par jour : l'identifiant sert d'adresse."
          : "Il est déjà pris, ou mal formé — minuscules, chiffres et tirets, 3 caractères au moins."}</p>` });
    }
    vue.slug = v; if (moi) moi.slug = v;
    renderProfil(); setSync("ok", "identifiant changé");
  };

  /* ── le reste : une ligne, un enregistrement ───────────────────── */
  const champ = (id, colonne, lire) => {
    const e = $(id);
    if (!e) return;
    e.onchange = async () => {
      const v = lire(e);
      const { error } = await sb.from("ciel_profiles").update({ [colonne]: v }).eq("id", vue.id);
      if (error) return setSync("warn", "changement refusé");
      vue[colonne] = v;
      setSync("ok", "enregistré");
      if (colonne === "au_classement" && v) publierDispos().catch(() => {});
    };
  };
  champ("pfBio", "bio", (e) => e.value.trim() || null);
  champ("pfRegion", "region", (e) => e.value.trim() || null);
  champ("pfRegionVue", "region_visible", (e) => e.checked);
  champ("pfFuseau", "fuseau", (e) => e.value);
  champ("pfClassement", "au_classement", (e) => e.checked);

  const reelInp = $("pfReel");
  reelInp.onchange = async () => {
    const v = reelInp.value.trim().slice(0, 80);
    if (v === (nomReel || "")) return;
    const { error } = v
      ? await sb.from("ciel_identites").upsert({ user_id: vue.id, nom_reel: v, maj_le: new Date().toISOString() })
      : await sb.from("ciel_identites").delete().eq("user_id", vue.id);
    if (error) return setSync("warn", "vrai nom non enregistré");
    nomReel = v || null;
    setSync("ok", v ? "vrai nom enregistré" : "vrai nom effacé");
  };

  box.querySelectorAll('input[name="visi"]').forEach((r) => (r.onchange = async () => {
    const pub = r.value === "public";
    const { error } = await sb.from("ciel_profiles").update({ public: pub }).eq("id", vue.id);
    if (error) return setSync("warn", "changement refusé");
    vue.public = pub;
    log(pub ? "a rendu son planning public" : "a rendu son planning privé");
    saveState(); renderProfil();
  }));

  const cp = $("copierLien");
  if (cp) cp.onclick = async () => {
    try { await navigator.clipboard.writeText(url); cp.textContent = "Copié ✓"; }
    catch { cp.textContent = "Échec"; }
    setTimeout(() => (cp.textContent = "Copier"), 1600);
  };
}

/** Une poignée de fuseaux courants, plus celui du navigateur et celui déjà posé. */
function fuseauxProposes(actuel) {
  const l = ["Europe/Paris", "Europe/London", "Europe/Lisbon", "Europe/Bucharest",
    "Atlantic/Reykjavik", "Africa/Casablanca", "Africa/Dakar", "Africa/Abidjan",
    "Indian/Antananarivo", "Indian/Reunion", "Asia/Ho_Chi_Minh", "Asia/Bangkok",
    "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata", "Asia/Dubai", "Asia/Jerusalem",
    "America/Montreal", "America/New_York", "America/Chicago", "America/Los_Angeles",
    "America/Cayenne", "America/Guadeloupe", "America/Martinique", "Pacific/Noumea",
    "Pacific/Tahiti", "Australia/Sydney"];
  try { const n = Intl.DateTimeFormat().resolvedOptions().timeZone; if (n) l.unshift(n); } catch {}
  if (actuel) l.unshift(actuel);
  return [...new Set(l)];
}

/** Le bouton qui fabrique un lien d'invitation, où qu'il se trouve. */
function brancherInvitation() {
  const b = $("faireInvit");
  if (!b) return;
  b.onclick = async () => {
    b.disabled = true; b.textContent = "…";
    const avecNom = $("invReel").checked;
    const { data, error } = await sb.rpc("creer_invitation", { avec_nom_reel: avecNom });
    b.disabled = false; b.textContent = "Créer un lien";
    if (error || !data) {
      return dialogue({ ton: "warn", titre: "Lien impossible",
        corps: `<p>${/trop de liens/.test(error?.message || "")
          ? "Tu as déjà 20 liens actifs. Attends qu'ils expirent."
          : "Le lien n'a pas pu être créé. Réessaie dans un instant."}</p>` });
    }
    const lien = location.origin + "?invite=" + String(data).replace(/"/g, "");
    $("lienInvit").textContent = lien;
    try { await navigator.clipboard.writeText(lien); setSync("ok", "lien copié"); } catch {}
    log(avecNom ? "a créé un lien d'invitation donnant son vrai nom" : "a créé un lien d'invitation");
  };
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
  box.innerHTML = `
    <p class="aide">${perso
      ? `Ton programme, à ta main : <b>${programme.matieres.length}</b> matière(s),
         <b>${Math.round(TOTAL_H)} h</b> au total.`
      : `Tu utilises le modèle <b>${esc(MODELES[programme.modele]?.nom || programme.modele)}</b> —
         ${Math.round(TOTAL_H)} h.</p>
       <p class="aide">Découpage et volumes sont relevés sur le CNED : chaque situation
         professionnelle et chaque séquence y porte une <b>durée indicative</b>, reprise ici
         telle quelle. Elle reste une moyenne — rends le programme modifiable pour l'ajuster
         à ton rythme, ou pour ajouter tes propres matières.`}</p>
    ${perso ? `<div class="matieres" id="matieres"></div>
      <button class="btn pri" id="ajMatiere">Ajouter une matière</button>` : ""}
    <div class="zbascule">
      ${perso ? "" : `<button class="btn" id="versPerso">Rendre ce programme modifiable</button>`}
      <button class="btn" id="autreModele">Repartir d'un autre modèle</button>
    </div>`;

  if (perso) renderMatieres();

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
      <div class="mchoix">${Object.values(MODELES).map((m) =>
        `<label class="modele"><input type="radio" name="mnew" value="${m.id}">
          <span><b>${esc(m.nom)}</b><em>${esc(m.resume)}</em></span></label>`).join("")}</div>`,
    actions: [
      { texte: "Annuler", pri: true },
      { texte: "Remplacer", faire: () => {
          const c = document.querySelector('input[name="mnew"]:checked');
          if (!c) return;
          programme = depuisModele(c.value);
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
        <table class="etapes"><tr><th>Étape</th><th>Heures</th><th>De</th><th>À</th><th></th></tr>
        ${m.etapes.map((e, ie) => `<tr>
          <td><input type="text" data-en="${im}.${ie}" value="${esc(e.n)}" maxlength="70"></td>
          <td><input type="number" data-eh="${im}.${ie}" value="${e.h}" min="1" max="400" step="1"></td>
          <td><select data-es="${im}.${ie}">${QUINZAINES.map((q) =>
            `<option value="${q.q}"${q.q === e.s ? " selected" : ""}>${q.texte}</option>`).join("")}</select></td>
          <td><select data-ee="${im}.${ie}">${QUINZAINES.map((q) =>
            `<option value="${q.q + 1}"${q.q + 1 === e.e ? " selected" : ""}>${q.texte}</option>`).join("")}</select></td>
          <td><button class="btn mini" data-esuppr="${im}.${ie}" title="Supprimer l'étape">✕</button></td>
        </tr>`).join("")}
        </table>
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
    if (!canEdit || !programme || programme.modele !== "perso") return;
    const t = ev.target;
    const maj = (fn) => { clearTimeout(tmr.prog); tmr.prog = setTimeout(() => { fn(); appliquerProgramme(); }, 600); };
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
    if (!canEdit || !programme || programme.modele !== "perso") return;
    const t = ev.target;
    if (t.dataset.mcoul !== undefined) {
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
      if (programme.modele !== "perso") return;
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

/* ═════════ MON COMPTE ═════════ */
function renderCompte() {
  const box = $("compteBox");
  if (!box) return;
  if (!canEdit || !session) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <p class="aide">Compte <b>${esc(session.user.email)}</b>.
      Tout ce qui est enregistré est visible dans cet onglet et modifiable.
      Le détail est dans la
      <a href="confidentialite.html" target="_blank" rel="noopener">politique de confidentialité</a>.</p>
    <div class="zaction">
      <div><b>Se déconnecter</b>
        <em>Ferme la session sur cet appareil. Ton planning n'est pas touché.</em></div>
      <button class="btn" id="deco">Se déconnecter</button>
    </div>
    <div class="zaction">
      <div><b>Changer mon mot de passe</b>
        <em>Un lien part vers ${esc(session.user.email)}. Il n'y a pas d'autre chemin :
          personne, pas même l'éditeur, ne peut lire ni fixer ton mot de passe.</em></div>
      <button class="btn" id="mdpLien">Recevoir le lien</button>
    </div>
    <div class="zdanger">
      <div><b>Supprimer mon compte</b>
        <em>Efface immédiatement le compte, le planning, le journal, les partages,
          les publications, les photos déposées et les conversations.
          C'est définitif : il n'y a pas de sauvegarde.</em></div>
      <button class="btn danger" id="supprCompte">Supprimer mon compte</button>
    </div>
    <div id="blocages"></div>`;
  renderBlocages();
  $("deco").onclick = async () => {
    await sb.auth.signOut();
    session = null; moi = null; vue = null; canEdit = false;
    try { sessionStorage.removeItem("ciel.vue"); } catch {}
    history.replaceState(null, "", location.pathname);
    await lancer();
  };
  $("mdpLien").onclick = async () => {
    const b = $("mdpLien");
    b.disabled = true; b.textContent = "Envoi…";
    const { error } = await sb.auth.resetPasswordForEmail(session.user.email,
      { redirectTo: location.origin + "?reinit=1" });
    b.disabled = false; b.textContent = "Recevoir le lien";
    dialogue({ ton: error ? "warn" : "info",
      titre: error ? "L'envoi a échoué" : "Le lien est parti",
      corps: error
        ? `<p>${esc(error.message)}</p><p class="petit">Si tu viens d'en demander un,
             attends une minute avant de réessayer.</p>`
        : `<p>Ouvre le courriel envoyé à <b>${esc(session.user.email)}</b> et suis le lien.
             Tu choisiras un nouveau mot de passe, puis tu reviendras à la connexion.</p>` });
  };

  $("supprCompte").onclick = () => dialogue({
    ton: "stop", titre: "Supprimer définitivement ce compte ?",
    corps: `<p>Le compte <b>${esc(session.user.email)}</b>, ton planning, ton journal,
        tes partages et tes abonnés seront effacés <b>immédiatement</b>.</p>
      <p>Il n'y a pas de sauvegarde et aucune restauration n'est possible.</p>`,
    actions: [
      { texte: "Annuler", pri: true },
      { texte: "Supprimer définitivement", faire: async () => {
          const { error } = await sb.rpc("supprimer_mon_compte");
          if (error) return dialogue({ ton: "warn", titre: "Suppression impossible",
            corps: `<p>${esc(error.message)}</p>` });
          try { localStorage.clear(); } catch {}
          location.href = "/";
        } },
    ],
  });
}

/** Bloquer sans pouvoir débloquer serait un piège : la liste vit dans le compte. */
async function renderBlocages() {
  const box = $("blocages");
  if (!box || !session) return;
  const { data } = await sb.from("ciel_blocages").select("cible,cree_le").eq("qui", session.user.id);
  const l = Array.isArray(data) ? data : [];
  // Le panneau a pu être redessiné pendant l'attente : on ne parle qu'au sien.
  const cible = $("blocages");
  if (!cible) return;
  if (!l.length) { cible.innerHTML = ""; return; }
  const noms = {};
  const { data: profs } = await sb.from("ciel_profiles").select("id,nom,slug,avatar")
    .in("id", l.map((x) => x.cible));
  (profs || []).forEach((x) => (noms[x.id] = x));
  const zone = $("blocages");
  if (!zone) return;
  zone.innerHTML = `<details class="repli" style="margin-top:.8rem">
    <summary>Personnes bloquées <span class="note">${l.length}</span></summary>
    <div class="gens">${l.map((b) => {
      const x = noms[b.cible] || { nom: "Compte supprimé" };
      return `<div class="pers">${vignette(x, "pt")}
        <span class="qui"><b>${esc(x.nom)}</b>${x.slug ? `<em>@${esc(x.slug)}</em>` : ""}</span>
        <span class="act"><button class="btn" data-debloquer="${esc(b.cible)}">Débloquer</button></span>
      </div>`;
    }).join("")}</div></details>`;
}

/* ═════════ CONTACTS ═════════
   S'abonner, accepter, demander un créneau. Toutes les règles — qui peut
   demander quoi à qui — sont appliquées par la base : l'interface ne fait que
   les refléter. Masquer un bouton n'a jamais protégé personne. */

const initiales = (n) => esc(String(n || "?").trim().slice(0, 2).toUpperCase());
const jourFr = (d) => new Date(d + "T00:00").toLocaleDateString("fr-FR",
  { weekday: "long", day: "numeric", month: "long" });

async function chargerSocial() {
  if (!session) {
    abonnements = abonnes = resaRecues = resaEnvoyees = fils = [];
    veilles = new Set();
    return;
  }
  const [a, b, r, f, w] = await Promise.all([
    sb.rpc("mes_abonnements"),
    sb.rpc("mes_abonnes"),
    sb.from("ciel_reservations").select("*").order("jour", { ascending: true }),
    sb.rpc("mes_fils"),
    sb.from("ciel_veilles").select("cible").eq("qui", session.user.id),
  ]);
  abonnements = Array.isArray(a.data) ? a.data : [];
  abonnes = Array.isArray(b.data) ? b.data : [];
  fils = Array.isArray(f.data) ? f.data : [];
  veilles = new Set((Array.isArray(w.data) ? w.data : []).map((x) => x.cible));
  majPastilleMsg();
  const tout = Array.isArray(r.data) ? r.data : [];
  resaRecues = tout.filter((x) => x.hote === session.user.id);
  resaEnvoyees = tout.filter((x) => x.demandeur === session.user.id);
  majPastille();
}

/** Le nombre de choses qui attendent vraiment une réponse de moi. */
function aTraiter() {
  return abonnes.filter((x) => x.etat === "attente").length
       + resaRecues.filter((x) => x.etat === "attente").length;
}
function majPastille() {
  const p = $("pastille");
  if (!p) return;
  const n = aTraiter();
  p.hidden = n === 0;
  p.textContent = n > 9 ? "9+" : String(n);
}

function renderSocial() {
  if (!$("abonnements")) return;
  renderDemandes();
  renderAbonnements();
  renderAbonnes();
  renderMesResa();
  renderInviter();
  majPastille();
  // Les compteurs à côté des titres : on voit d'un coup s'il y a quelque chose,
  // sans avoir à décider si une liste est vide ou mal chargée.
  const n = (id, v) => { const e = $(id); if (e) e.textContent = v ? String(v) : "aucun"; };
  n("nbAbonnements", abonnements.filter((x) => x.etat === "accepte").length);
  n("nbAbonnes", abonnes.filter((x) => x.etat === "accepte").length);
  n("nbDemandes", abonnes.filter((x) => x.etat === "attente").length);

  const r = $("rappelDem");
  if (r) {
    const att = aTraiter();
    r.hidden = att === 0;
    r.innerHTML = `<b>${plural(att, "demande")}</b> ${att > 1 ? "attendent" : "attend"} ta réponse`;
    r.onclick = () => {
      const b = document.querySelector('.segs[data-segs="contacts"] button[data-seg="demandes"]');
      if (b) b.click();
    };
  }
}

/* ── ce qui attend une réponse ───────────────────────── */
function renderDemandes() {
  const box = $("demandes");
  const dem = abonnes.filter((x) => x.etat === "attente");
  const res = resaRecues.filter((x) => x.etat === "attente");
  const dp = $("pastDem");
  if (dp) { dp.hidden = !(dem.length + res.length); dp.textContent = String(dem.length + res.length); }
  if (!dem.length && !res.length) {
    box.innerHTML = `<div class="vide">Personne n'attend de réponse de ta part.</div>`;
    return;
  }
  box.innerHTML = `<div class="gens">` + dem.map((d) => `
    <div class="pers attente">
      ${vignette(d, "pt")}
      <span class="qui"><b>${esc(d.nom || "Compte")}</b>
        <em>@${esc(d.slug || "?")} · demande à suivre ton planning</em></span>
      <span class="act">
        <button class="btn pri" data-abok="${esc(d.qui)}">Accepter</button>
        <button class="btn" data-abnon="${esc(d.qui)}">Refuser</button>
      </span>
    </div>`).join("") + `</div>`
    + (res.length ? `<div class="soustitre" style="margin-top:.9rem">Créneaux demandés</div>
      <div class="gens">` + res.map((r) => carteResa(r, true)).join("") + `</div>` : "");
}

function carteResa(r, cotehote) {
  // Une proposition peut venir de quelqu'un qui n'est ni abonné ni suivi :
  // c'est tout l'intérêt du motif. On retrouve alors son nom par la conversation.
  const cible = cotehote ? r.demandeur : r.hote;
  const qui = abonnes.find((a) => a.qui === cible) || abonnements.find((a) => a.qui === cible)
           || fils.find((f) => f.autre === cible);
  const nom = qui ? qui.nom : "Quelqu'un";
  const etats = { attente: "en attente", accepte: "accepté", refuse: "refusé", annule: "annulé" };
  return `<div class="resa ${r.etat}">
    <div class="l1">
      <span class="t">${esc(r.titre)}</span>
      <span class="etiq ${r.etat === "accepte" ? "ok" : r.etat === "attente" ? "att" : "non"}">${etats[r.etat]}</span>
    </div>
    <div class="quand">${jourFr(r.jour)} · ${r.debut.slice(0, 5)} – ${r.fin.slice(0, 5)}
      · ${cotehote ? "de" : "chez"} ${esc(nom)}</div>
    ${r.message ? `<div class="msg">${esc(r.message)}</div>` : ""}
    ${r.reponse ? `<div class="msg">Réponse : ${esc(r.reponse)}</div>` : ""}
    <div class="act">
      ${cotehote && r.etat === "attente" ? `
        <button class="btn pri" data-rok="${r.id}">Accepter</button>
        <button class="btn" data-rnon="${r.id}">Refuser</button>` : ""}
      ${!cotehote && r.etat === "attente" ? `<button class="btn" data-rann="${r.id}">Annuler</button>` : ""}
    </div>
  </div>`;
}

/* ── mes abonnements ─────────────────────────────────── */
function renderAbonnements() {
  $("abonnements").innerHTML = abonnements.length
    ? `<div class="gens">` + abonnements.map((a) => `
      <div class="pers ${a.etat === "accepte" ? "ok" : "attente"}">
        ${vignette(a, "pt")}
        <span class="qui"><b>${esc(a.nom || "Compte")}</b>
          <em>@${esc(a.slug || "?")}${a.public ? " · public" : ""}</em></span>
        <span class="act">
          ${a.etat === "attente" ? `<span class="etiq att">demande envoyée</span>` : ""}
          ${a.etat === "accepte" ? `<label class="urgcase"><input type="checkbox"
            data-veille="${esc(a.qui)}"${veilles.has(a.qui) ? " checked" : ""}>
            <span>me prévenir quand il est libre</span></label>` : ""}
          ${a.slug ? `<button class="btn" data-fiche="${esc(a.slug)}">Voir</button>` : ""}
          <button class="btn" data-desab="${esc(a.qui)}">Se désabonner</button>
        </span>
      </div>`).join("") + `</div>`
    : `<div class="vide">Tu ne suis encore personne.
        <button class="btn" data-vers="fil">Trouver quelqu'un</button></div>`;
}

/* ── mes abonnés ─────────────────────────────────────── */
/** Où j'en suis avec quelqu'un : accepté, en attente, ou rien. */
const suivi = (id) => (abonnements.find((a) => a.qui === id) || {}).etat || null;

function renderAbonnes() {
  const l = abonnes.filter((x) => x.etat === "accepte");
  $("abonnes").innerHTML = l.length
    ? `<div class="gens">` + l.map((a) => `
      <div class="pers ok">
        ${vignette(a, "pt")}
        <span class="qui"><b>${esc(a.nom || "Compte")}</b>
          <em>@${esc(a.slug || "?")} · depuis le ${new Date(a.cree_le).toLocaleDateString("fr-FR",
            { day: "numeric", month: "long" })}</em></span>
        <span class="act">
          <label class="urgcase"><input type="checkbox" data-reel="${esc(a.qui)}"
            ${a.voit_nom_reel ? "checked" : ""}><span>vrai nom</span></label>
          ${suivi(a.qui) === "accepte"
            ? `<span class="etiq ok">tu le suis</span>`
            : suivi(a.qui) === "attente"
              ? `<span class="etiq att">demande envoyée</span>`
              : `<button class="btn pri" data-sab="${esc(a.qui)}">${
                  a.public ? "Suivre" : "Demander à suivre"}</button>`}
          ${a.joignable !== "personne"
            ? `<button class="btn" data-ecrire="${esc(a.qui)}">Message</button>` : ""}
          ${a.slug ? `<button class="btn" data-fiche="${esc(a.slug)}">Voir</button>` : ""}
          <button class="btn" data-retirer="${esc(a.qui)}">Retirer</button>
        </span>
      </div>`).join("") + `</div>`
    : `<div class="vide">Personne ne suit ton planning.</div>`;
}

/* ── inviter par lien ────────────────────────────────── */
function renderInviter() {
  const box = $("inviterBox");
  if (!box || !vue || !canEdit) return;
  box.innerHTML = `
    <p class="aide">Accès en lecture pour qui l'ouvre. 30 jours, 25 usages.
      À ne donner qu'à des gens de confiance.</p>
    <label class="urgcase" style="margin-bottom:.45rem"><input type="checkbox" id="invReel">
      <span>Ce lien donne aussi accès à mon vrai nom</span></label>
    <div class="lp"><code id="lienInvit">—</code>
      <button class="btn" id="faireInvit">Créer un lien</button></div>`;
  brancherInvitation();
}

function renderMesResa() {
  const l = resaEnvoyees.filter((r) => r.etat !== "annule");
  $("mesResa").innerHTML = l.length
    ? `<div class="gens">` + l.map((r) => carteResa(r, false)).join("") + `</div>`
    : `<div class="vide">Aucune demande envoyée.</div>`;
}

/* ── annuaire ────────────────────────────────────────── */
async function chargerAnnuaire() {
  const { data } = await sb.from("ciel_profiles")
    .select("id,slug,nom,public,joignable,avatar,bio,region,region_visible,fuseau")
    .eq("public", true).order("nom");
  annuaire = (data || []).filter((p) => !session || p.id !== session.user.id);
}

async function renderAnnuaire() {
  const box = $("annuaire");
  if (!box) return;
  const q = ($("chercheP")?.value || "").trim().toLowerCase();
  const l = annuaire.filter((p) => !q || p.nom.toLowerCase().includes(q) || p.slug.includes(q));
  // Un compte privé n'est dans aucune liste — c'est le but. Mais qui connaît
  // son identifiant exact doit pouvoir lui demander à le suivre, sinon il est
  // injoignable pour toujours.
  if (!l.length && q.length >= 2 && session) {
    const { data } = await sb.rpc("carte_profil", { identifiant: q });
    const c = Array.isArray(data) ? data[0] : null;
    if (c && c.lien !== "moi") {
      box.innerHTML = `<div class="gens"><div class="pers">
        ${vignette(c, "pt")}
        <span class="qui"><b>${esc(c.nom)}</b><em>@${esc(c.slug)} · compte privé</em></span>
        <span class="act">
          <button class="btn" data-fiche="${esc(c.slug)}">Voir</button>
          ${c.lien === "aucun"
            ? `<button class="btn pri" data-sab="${esc(c.id)}">Demander à suivre</button>`
            : `<span class="etiq att">${c.lien === "attente" ? "demande envoyée" : "tu le suis"}</span>`}
        </span></div></div>`;
      return;
    }
  }
  box.innerHTML = l.length
    ? `<div class="gens">` + l.slice(0, 40).map((p) => `
      <div class="pers">
        ${vignette(p, "pt")}
        <span class="qui"><b>${esc(p.nom)}</b><em>@${esc(p.slug)}</em></span>
        <span class="act">
          <button class="btn" data-fiche="${esc(p.slug)}">Voir</button>
          ${session && !abonnements.some((a) => a.qui === p.id)
            ? `<button class="btn pri" data-sab="${esc(p.id)}">S'abonner</button>` : ""}
        </span>
      </div>`).join("") + `</div>`
    : `<div class="vide">${q
        ? "Aucun compte ne porte ce nom. Les comptes privés ne se trouvent que par leur identifiant exact."
        : "Personne d'ouvert à la consultation. Cherche quelqu'un par son identifiant."}</div>`;
}

function renderJoignable() {
  const box = $("joignableBox");
  if (!box || !vue) return;
  if (!canEdit) { box.innerHTML = ""; return; }
  const j = vue.joignable || "abonnes";
  const opts = [
    ["tous", "Tout le monde", "N'importe quel compte peut t'écrire et te proposer un moment."],
    ["abonnes", "Mes contacts", "Eux seuls t'écrivent. Les autres ne peuvent qu'une chose : proposer un moment, avec un mot."],
    ["personne", "Personne", "Ni message ni proposition. Ton planning reste consultable selon ta visibilité."],
  ];
  box.innerHTML = `<div class="joi">` + opts.map(([v, t, d]) => `
    <label class="opt${j === v ? " on" : ""}">
      <input type="radio" name="joi" value="${v}"${j === v ? " checked" : ""}>
      <span><b>${t}</b><em>${d}</em></span></label>`).join("") + `</div>
    <label class="urgcase" style="margin-top:.7rem"><input type="checkbox" id="resaAuto"
      ${vue.reservations_auto ? "checked" : ""}>
      <span>Accepter les demandes automatiquement</span></label>
    <p class="aide">Sans elle, chaque demande attend ta réponse.</p>`;

  box.querySelectorAll('input[name="joi"]').forEach((r) => (r.onchange = async () => {
    const { error } = await sb.from("ciel_profiles").update({ joignable: r.value }).eq("id", vue.id);
    if (error) return setSync("warn", "changement refusé");
    vue.joignable = r.value; renderJoignable(); setSync("ok", "enregistré");
  }));
  $("resaAuto").onchange = async (e) => {
    const { error } = await sb.from("ciel_profiles")
      .update({ reservations_auto: e.target.checked }).eq("id", vue.id);
    if (error) { e.target.checked = !e.target.checked; return setSync("warn", "changement refusé"); }
    vue.reservations_auto = e.target.checked; setSync("ok", "enregistré");
  };
}

/* ── actions ─────────────────────────────────────────── */
document.addEventListener("change", async (e) => {
  const c = e.target.closest("[data-reel]");
  if (!c) return;
  const { error } = await sb.rpc("regler_nom_reel", { qui: c.dataset.reel, autorise: c.checked });
  if (error) { c.checked = !c.checked; return setSync("warn", "changement refusé"); }
  const a = abonnes.find((x) => x.qui === c.dataset.reel);
  if (a) a.voit_nom_reel = c.checked;
  setSync("ok", c.checked ? "vrai nom partagé" : "vrai nom masqué");
});

document.addEventListener("click", async (e) => {
  const r = e.target.closest("[data-retirer]");
  if (r) {
    return dialogue({ ton: "warn", titre: "Retirer cette personne ?",
      corps: `<p>Elle n'aura plus accès à ton planning. Elle pourra redemander.</p>`,
      actions: [{ texte: "Annuler", pri: true },
                { texte: "Retirer", faire: async () => {
                    await sb.rpc("repondre_abonnement", { qui: r.dataset.retirer, accepte: false });
                    await sb.from("ciel_partages").delete()
                      .eq("proprietaire", vue.id).eq("invite", r.dataset.retirer);
                    await chargerSocial(); renderSocial();
                  } }] });
  }
});

document.addEventListener("click", async (e) => {
  const t = e.target;
  const rpc = async (nom, args, apres) => {
    const b = t.closest("button");
    if (b) { b.disabled = true; }
    const { error } = await sb.rpc(nom, args);
    if (error) { if (b) b.disabled = false; return setSync("warn", "action refusée"); }
    await chargerSocial();
    renderSocial();
    if (apres) apres();
  };

  const sab = t.closest("[data-sab]");
  if (sab) {
    const b = sab; b.disabled = true;
    const { data } = await sb.rpc("s_abonner", { cible: b.dataset.sab });
    const r = String(data || "").replace(/"/g, "");
    await chargerSocial(); renderSocial();
    // La fiche affichée doit refléter le nouvel état, pas celui d'avant le clic.
    if (vueCourante === "personne" && argCourant) await ouvrirFiche(argCourant);
    if (vueCourante === "fil") renderAnnuaire();
    return dialogue({ ton: "info", titre: r === "accepte" ? "Abonné" : "Demande envoyée",
      corps: r === "accepte"
        ? `<p>Ce planning est public : tu le suis désormais.</p>`
        : `<p>Ce compte est privé. La personne recevra ta demande et décidera.</p>` });
  }
  const des = t.closest("[data-desab]");
  if (des) return rpc("se_desabonner", { cible: des.dataset.desab });
  const ok = t.closest("[data-abok]");
  if (ok) return rpc("repondre_abonnement", { qui: ok.dataset.abok, accepte: true });
  const non = t.closest("[data-abnon]");
  if (non) return rpc("repondre_abonnement", { qui: non.dataset.abnon, accepte: false });

  const rok = t.closest("[data-rok]");
  if (rok) return repondreResa(+rok.dataset.rok, "accepte");
  const rnon = t.closest("[data-rnon]");
  if (rnon) return repondreResa(+rnon.dataset.rnon, "refuse");
  const rann = t.closest("[data-rann]");
  if (rann) return repondreResa(+rann.dataset.rann, "annule");
});

/**
 * Accepter une demande la pose dans mon planning comme un événement : c'est ce
 * qui fait que le planificateur en tient compte, et que mes proches la voient
 * comme un moment occupé.
 */
async function repondreResa(id, etat) {
  const r = resaRecues.concat(resaEnvoyees).find((x) => x.id === id);
  if (!r) return;
  const { error } = await sb.from("ciel_reservations")
    .update({ etat, maj_le: new Date().toISOString() }).eq("id", id);
  if (error) return setSync("warn", "réponse refusée");

  if (etat === "accepte" && canEdit) {
    const qui = abonnes.find((a) => a.qui === r.demandeur);
    events.push({
      id: "r" + r.id, date: r.jour, debut: r.debut.slice(0, 5), fin: r.fin.slice(0, 5),
      titre: r.titre, urgent: false, pause: false, visible: true, resa: r.id,
    });
    events.sort((a, b) => (a.date + (a.debut || "")).localeCompare(b.date + (b.debut || "")));
    log(`a accepté un créneau avec ${qui ? qui.nom : "quelqu'un"} le ${jourFr(r.jour)}`);
    saveEvents();
  }
  if (etat === "annule" || etat === "refuse") {
    events = events.filter((x) => x.resa !== r.id);
    saveEvents();
  }
  await chargerSocial();
  renderSocial();
  renderAll();
}

/* ═════════ AUTHENTIFICATION ═════════ */
function montrer(ecran) {
  ["chargement", "porte", "ecranAuth", "ecranProfils", "appli"].forEach((k) => {
    const e = $(k); if (e) e.hidden = k !== ecran;
  });
}
function messageAuth(txt, ok) {
  const m = $("authMsg");
  m.className = "authmsg " + (ok ? "ok" : "err");
  m.textContent = txt;
  m.hidden = !txt;
}
/** Les plannings qu'on peut ouvrir : les publics, plus ceux partagés avec moi. */
async function chargerProfils(cible = "listeProfils2") {
  const { data } = await sb.from("ciel_profiles").select("id,slug,nom,public,avatar").order("nom");
  const l = (data || []).filter((p) => !session || p.id !== session.user.id);
  const box = $(cible);
  if (!box) return l;
  box.innerHTML = l.length
    ? l.map((p) => `<a class="profil" href="?profil=${encodeURIComponent(p.slug)}">
        ${vignette(p, "")}
        <span><b>${esc(p.nom)}</b><em>@${esc(p.slug)}${p.public ? "" : " · partagé avec toi"}</em></span></a>`).join("")
    : `<p class="muted">Aucun planning ouvert à la consultation pour l'instant.</p>`;
  return l;
}
async function chargerProfil(slug) {
  let q = sb.from("ciel_profiles")
    .select("id,slug,nom,public,avatar,bio,fuseau,region,region_visible,joignable,reservations_auto,au_classement");
  q = slug ? q.eq("slug", slug) : q.eq("id", session.user.id);
  const { data } = await q.maybeSingle();
  return data;
}
async function ouvrir(profil) {
  vue = profil;
  canEdit = estMoi();
  const { data: st, error: errEtat } = await sb.from("ciel_state")
    .select("data").eq("user_id", profil.id).maybeSingle();
  const secours = errEtat ? loadLocal(profil.id) : null;
  appliquerEtat(st ? st.data : secours || {});
  // Premier passage après inscription : on pose le modèle retenu.
  if (!modeleEnAttente) { try { modeleEnAttente = localStorage.getItem("ciel.modele"); } catch {} }
  if (modeleEnAttente && estMoi() && !(programme.matieres || []).length && programme.modele === "cned") {
    programme = depuisModele(modeleEnAttente);
    modeleEnAttente = null;
    try { localStorage.removeItem("ciel.modele"); } catch {}
    chargerProgramme(programme);
    saveState();
  }
  try { localStorage.removeItem("ciel.modele"); } catch {}
  await chargerNomReel();
  await chargerSocial();
  await chargerAnnuaire();
  const { data: jr } = await sb.from("ciel_journal").select("ts,body")
    .eq("user_id", profil.id).order("ts", { ascending: false }).limit(120);
  journal = (jr || []).map((j) => ({ ts: j.ts, text: j.body }));
  if (canEdit) {
    const { data: ab } = await sb.from("ciel_subs").select("email").eq("user_id", profil.id).eq("actif", true);
    subs = (ab || []).map((x) => x.email);
    subCount = subs.length;
  } else {
    subs = []; subCount = 0;
  }
  const sr = $("sousReel");
  if (sr) {
    sr.hidden = canEdit || !nomReel;
    sr.textContent = nomReel ? nomReel : "";
  }
  const ro = $("robar");
  ro.hidden = canEdit;
  ro.innerHTML = `<b>Vue publique.</b><span>Lecture seule.</span>`;
  // L'en-tête ne montre plus l'adresse électronique : c'était en donner un
  // morceau à quiconque regarde l'écran par-dessus l'épaule.
  majBoutonCompte();
  chargerNouveautes().catch(() => {});
  montrer("appli");
  buildGantt(); buildAcc();
  routeDepart();
  $("evD").value = isoJour(new Date(NOW));
  renderAll();
  // Le repli sur la copie locale doit se voir : c'est le dernier mot de l'ouverture.
  if (secours) setSync("warn", "hors ligne — copie locale");
  else setSync("ok", canEdit ? "mode édition" : "lecture publique");
  // Le modèle CNED n'a légitimement aucune matière déclarée : ses matières
  // viennent du référentiel. Se fier à cette liste faisait reposer la question
  // à chaque ouverture. C'est le drapeau qui décide, plus la forme du programme.
  const neuf = !demarrageFait && !Object.keys(done).length
    && !events.length && !journal.length && !(programme.matieres || []).length;
  if (canEdit && neuf) demanderModele();
}

/* Par quoi commencer. La question ne se pose qu'une fois, à la première
   ouverture — et pas au milieu du formulaire d'inscription, où elle ne faisait
   qu'allonger la page qu'on venait remplir. */
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
      saveState(); renderAll();
    } }] });
}

async function demarrer() {
  tickClock();
  await sb.auth.recupererDepuisUrl();
  const { data: { session: s } } = await sb.auth.getSession();
  session = s;
  const params = new URLSearchParams(location.search);

  // Lien d'invitation : le jeton n'est lisible par personne, seule la base le
  // consomme. On le retire de l'adresse dès qu'il est traité.
  const invite = params.get("invite");
  if (invite) {
    if (!session) {
      ecranCompte("connexion", "Connecte-toi ou crée un compte : l'invitation s'appliquera juste après.");
      try { sessionStorage.setItem("ciel.invite", invite); } catch {}
      return;
    }
    await consommerInvitation(invite);
    return;
  }
  // Invitation mise de côté avant la connexion.
  let attente = null;
  try { attente = sessionStorage.getItem("ciel.invite"); } catch {}
  if (attente && session) {
    try { sessionStorage.removeItem("ciel.invite"); } catch {}
    await consommerInvitation(attente);
    return;
  }

  const slug = params.get("profil");
  if (slug) {
    if (session) moi = await chargerProfil(null);
    const p = await chargerProfil(slug);
    if (p) { await ouvrir(p); return true; }
    // Une requête qui n'est pas partie ne veut pas dire « ce profil n'existe
    // pas ». Sans cette distinction, une coupure réseau ressemblait à un refus.
    if (!sb.reseau.ok) return false;
    montrer("ecranProfils"); chargerProfils(); return true;
  }
  if (session) {
    moi = await chargerProfil(null);
    if (moi) { await ouvrir(moi); return true; }
    if (!sb.reseau.ok) {
      // Le réseau manque, mais la dernière copie est là : autant ouvrir le
      // planning tel qu'on l'a laissé plutôt que de renvoyer sur un mur.
      const copie = lireLocal(session.user.id);
      if (copie && copie.profil) { moi = copie.profil; await ouvrir(moi); return true; }
      return false;
    }
  }
  montrer("porte");
  return true;
}

/* ═════════ LE RUBAN ═════════
   Quand une mise à jour est en cours, autant le dire : une application qui
   change sous les doigts sans prévenir passe pour cassée. L'annonce vit dans
   la base, avec une fin obligatoire — elle s'éteint donc toute seule, même si
   on oublie de l'éteindre. */

let rubanVu = null;

async function chargerRuban() {
  const z = $("ruban");
  if (!z) return;
  const { data, error } = await sb.from("ciel_annonces")
    .select("id,texte,ton").order("debut", { ascending: false }).limit(1);
  const a = Array.isArray(data) ? data[0] : null;
  // Hors réseau, on garde ce qui est affiché : effacer ferait clignoter.
  if (error) return;
  if (!a) { z.hidden = true; rubanVu = null; return; }
  let ecarte = null;
  try { ecarte = sessionStorage.getItem("ciel.ruban"); } catch {}
  if (ecarte === a.id) { z.hidden = true; return; }
  if (rubanVu === a.id && !z.hidden) return;   // déjà à l'écran, on ne le rejoue pas
  rubanVu = a.id;
  $("rubanTexte").textContent = a.texte;
  $("rubanEcho").textContent = a.texte;
  z.className = "ruban " + (a.ton || "travaux");
  z.hidden = false;
}

// Toute la bande se touche, pas seulement la croix : viser 40 px de large au
// pouce, sur un bandeau de 44 px de haut, c'est demander de la précision pour
// écarter un message qu'on n'a pas demandé.
$("ruban").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("ruban").click(); }
});
$("ruban").addEventListener("click", () => {
  $("ruban").hidden = true;
  try { sessionStorage.setItem("ciel.ruban", rubanVu || ""); } catch {}
});

// Assez souvent pour qu'une annonce arrive pendant qu'on est là, assez rare
// pour ne rien coûter. Et jamais quand l'onglet est en arrière-plan.
setInterval(() => {
  if (document.hidden) return;
  chargerRuban();
  chargerNouveautes({ silencieux: false });
}, 90000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  chargerRuban();
  chargerNouveautes({ silencieux: false });
});

/* ═════════ L'ATTENTE ═════════
   Une page blanche pendant que la base répond ne dit rien ; une page blanche
   qui ne finit jamais ment. Le bras du logo tourne, et s'il ne se passe rien
   il décroche : on sait alors que ce n'est pas la peine d'attendre, et qu'un
   geste suffit à relancer. */

const RECULS = [5000, 8000, 13000, 21000, 30000];
let essais = 0, chargeEnCours = false, tPatience = null, tReprise = null;

function direAttente(titre, aide) {
  $("etatCh").textContent = titre;
  $("aideCh").textContent = aide || "";
}

/** Le bras décroche. Rien n'est perdu : on repart au toucher, ou tout seul. */
function attenteCassee() {
  chargeEnCours = false;
  clearTimeout(tPatience);
  montrer("chargement");
  $("chargement").classList.add("casse");
  const horsLigne = navigator.onLine === false;
  direAttente(horsLigne ? "Pas de réseau ici" : "Repère ne répond pas",
    horsLigne
      ? "Ton appareil n'est connecté à rien. Touche l'écran pour réessayer — ça repart aussi tout seul dès que la connexion revient."
      : "Le serveur n'a pas répondu. Touche l'écran pour réessayer.");
  essais++;
  clearTimeout(tReprise);
  tReprise = setTimeout(lancer, RECULS[Math.min(essais - 1, RECULS.length - 1)]);
}

async function lancer() {
  if (chargeEnCours) return;
  chargeEnCours = true;
  clearTimeout(tReprise); clearTimeout(tPatience);
  $("chargement").classList.remove("casse");
  montrer("chargement");
  direAttente(essais ? "Nouvelle tentative" : "Repère", "");
  // Au-delà, ce n'est plus un chargement : c'est une attente sans fin.
  tPatience = setTimeout(attenteCassee, 9000);
  chargerRuban().catch(() => {});
  const debut = Date.now();
  let abouti = false;
  try { abouti = (await demarrer()) !== false; }
  catch (e) { abouti = false; }
  clearTimeout(tPatience);
  chargeEnCours = false;
  // C'est demarrer() qui sait si elle a abouti : une requête échouée en chemin
  // n'est pas un échec si la copie locale a pris le relais.
  if (!abouti) {
    // Un échec instantané rendrait le geste invisible : on laisse le bras
    // tourner le temps qu'on voie qu'il s'est passé quelque chose.
    const reste = 900 - (Date.now() - debut);
    if (reste > 0) await new Promise((r) => setTimeout(r, reste));
    return attenteCassee();
  }
  essais = 0;
}

// Un geste sur l'écran cassé relance. Le clavier aussi : rien ne doit
// dépendre du seul toucher.
$("chargement").addEventListener("click", () => {
  if ($("chargement").classList.contains("casse")) lancer();
});
document.addEventListener("keydown", (e) => {
  if (!$("chargement").hidden && $("chargement").classList.contains("casse")
      && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); lancer(); }
});
// Et le navigateur prévient lui-même quand la connexion revient.
addEventListener("online", () => {
  if (!$("chargement").hidden && $("chargement").classList.contains("casse")) lancer();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !$("chargement").hidden
      && $("chargement").classList.contains("casse")) lancer();
});

/** Consomme un lien d'invitation et ouvre le planning auquel il donne accès. */
async function consommerInvitation(jeton) {
  const { data, error } = await sb.rpc("accepter_invitation", { jeton_recu: jeton });
  const res = String(data || "").replace(/"/g, "");
  history.replaceState(null, "", location.pathname);
  if (error || res === "invalide") {
    ecranCompte("connexion", "Ce lien d'invitation n'est plus valable. Demande-en un nouveau.");
    return;
  }
  if (res === "connexion") { ecranCompte("connexion"); return; }
  if (res === "soi") { location.href = "/"; return; }
  const p = await chargerProfil(res);
  if (p) { setSync("ok", "invitation acceptée"); return ouvrir(p); }
  location.href = "/";
}

/**
 * Fin d'un parcours (compte créé, mot de passe changé) : on referme la session
 * et on revient à la connexion, adresse pré-remplie. Se reconnecter une fois
 * confirme que les identifiants marchent vraiment.
 */
async function versConnexion(message, email) {
  try { await sb.auth.signOut(); } catch {}
  session = null; moi = null; vue = null; canEdit = false;
  history.replaceState(null, "", location.pathname);
  ecranCompte("connexion", message, true);
  if (email) $("conEmail").value = email;
  setTimeout(() => $(email ? "conMdp" : "conEmail").focus(), 120);
}

/* ═════════ LA PORTE ═════════
   Un écran, trois chemins. Chaque chemin mène à un écran qui ne contient que
   ce qu'il faut pour le suivre. */

const FORMS = { inscription: "formInscription", connexion: "formConnexion",
                oubli: "formOubli", nouveau: "formNouveau" };
const TITRES_AUTH = { inscription: "Créer un compte", connexion: "Se connecter",
                      oubli: "Mot de passe oublié", nouveau: "Nouveau mot de passe" };

function ongletAuth(m) {
  Object.entries(FORMS).forEach(([cle, f]) => ($(f).hidden = cle !== m));
  $("titreAuth").textContent = TITRES_AUTH[m] || "Compte";
  messageAuth("");
}
function ecranCompte(m, message, ok) {
  montrer("ecranAuth");
  ongletAuth(m);
  if (message) messageAuth(message, ok !== false);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-auth],[data-porte]");
  if (!b) return;
  if (b.dataset.auth) return ongletAuth(b.dataset.auth);
  const p = b.dataset.porte;
  if (p === "retour") return montrer("porte");
  if (p === "visite") return entrerEnVisite();
  ecranCompte(p);
  setTimeout(() => $(p === "connexion" ? "conEmail" : "insNom")?.focus(), 260);
});

document.addEventListener("input", (e) => {
  if (e.target.id === "chercheP") { clearTimeout(tmr.ann); tmr.ann = setTimeout(renderAnnuaire, 200); }
});

$("insNom").addEventListener("input", () => {
  clearTimeout(tmr.insNom);
  tmr.insNom = setTimeout(verifierNom, 450);
});

let modeleChoisi = "cned";

/** Le nom affiché est unique : on le dit avant de valider, pas après. */
async function verifierNom() {
  const inp = $("insNom"), zone = $("nomDispo");
  if (!inp || !zone) return true;
  const v = inp.value.trim();
  if (v.length < 2) { zone.className = "dispo"; zone.textContent = ""; return false; }
  const { data, error } = await sb.rpc("nom_disponible", { candidat: v });
  if (error) { zone.className = "dispo"; zone.textContent = ""; return true; }
  zone.className = "dispo " + (data ? "oui" : "non");
  zone.textContent = data ? "Ce nom est libre." : "Ce nom est déjà pris. Choisis-en un autre.";
  return Boolean(data);
}

$("formInscription").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("insEmail").value.trim().toLowerCase();
  const mdp = $("insMdp").value;
  const nom = $("insNom").value.trim();
  if (nom.length < 2) return messageAuth("Choisis un nom affiché d'au moins 2 caractères.");
  if (mdp.length < 8) return messageAuth("Le mot de passe doit faire au moins 8 caractères.");
  if (!$("insCgu").checked) return messageAuth("Il faut accepter les conditions pour créer un compte.");
  if (!(await verifierNom())) return messageAuth("Ce nom est déjà pris. Choisis-en un autre.");
  messageAuth("Création du compte…", true);
  const { data, error } = await sb.auth.signUp({
    email, password: mdp,
    options: {
      // Le déclencheur en base lit ces champs : nom dédoublonné, profil privé,
      // et la date d'acceptation des conditions, qui doit pouvoir être prouvée.
      data: { nom, public: false, conditions: "1", modele: modeleChoisi },
      emailRedirectTo: location.origin,
    },
  });
  if (error) {
    const dup = /already|exists|registered/i.test(error.message);
    return messageAuth(dup
      ? "Un compte existe déjà avec cette adresse. Utilise « Connexion », ou « Mot de passe oublié »."
      : error.message);
  }
  await versConnexion(data.session
    ? "Compte créé. Connecte-toi pour ouvrir ton planning."
    : "Compte créé. Ouvre le courriel de confirmation, puis connecte-toi ici.", email);
});

$("formConnexion").addEventListener("submit", async (e) => {
  e.preventDefault();
  messageAuth("Connexion…", true);
  const { error } = await sb.auth.signInWithPassword({
    email: $("conEmail").value.trim().toLowerCase(),
    password: $("conMdp").value,
  });
  if (error) return messageAuth("Adresse ou mot de passe incorrect.");
  messageAuth("");
  await lancer();
});

$("formOubli").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("oubEmail").value.trim().toLowerCase();
  messageAuth("Envoi…", true);
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + "?reinit=1",
  });
  // On ne révèle pas si l'adresse existe : même réponse dans les deux cas.
  messageAuth(error && !/rate/i.test(error.message)
    ? error.message
    : "Si un compte utilise cette adresse, un lien de réinitialisation vient de partir.", !error);
});

/* retour depuis le lien de réinitialisation */
sb.auth.onAuthStateChange(async (evt) => {
  if (evt === "PASSWORD_RECOVERY") {
    ecranCompte("nouveau", "Choisis ton nouveau mot de passe. Tu seras ensuite ramené à la connexion.");
  }
});
$("formNouveau").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mdp = $("nouMdp").value;
  if (mdp.length < 8) return messageAuth("Le mot de passe doit faire au moins 8 caractères.");
  if (mdp !== $("nouMdp2").value) return messageAuth("Les deux mots de passe ne correspondent pas.");
  const { error } = await sb.auth.updateUser({ password: mdp });
  if (error) return messageAuth(error.message);
  await versConnexion("Mot de passe changé. Connecte-toi avec le nouveau.");
});


/* ═════════════════════════════════════════════════════════════════════
   LE RÉSEAU
   Un planning qui ne parle qu'à soi-même n'a pas besoin de réseau. Celui-ci
   sert à une chose : savoir quand les gens qu'on connaît sont libres, et le
   leur dire. Tout le reste — le fil, les conversations, le classement — tourne
   autour de ça.

   Aucune règle d'accès n'est décidée ici. Les fonctions appelées plus bas sont
   des fonctions de la base : c'est elle qui refuse, l'interface ne fait que
   montrer le refus.
   ═════════════════════════════════════════════════════════════════════ */

const AVATARS = "avatars", PHOTOS = "photos";
let posts = [], fils = [], communs = [], rangs = [];
let convFil = null, convAutre = null, titreConv = "", titreFiche = "";
let brouillon = { blob: null, apercu: null, portee: "abonnes" };
let modeVisite = false;
let signees = {};          // chemin d'image → adresse signée, valable une heure

const urlAvatar = (c) => (c ? sb.stockage.urlPublique(AVATARS, c) : null);

/** La vignette de quelqu'un : sa photo, ou ses initiales. */
function vignette(p, taille = "") {
  const u = urlAvatar(p && p.avatar);
  const cls = `av ${taille}`.trim();
  return u
    ? `<span class="${cls}"><img src="${esc(u)}" alt="" loading="lazy" width="72" height="72"></span>`
    : `<span class="${cls}">${initiales(p && p.nom)}</span>`;
}

function tempsRelatif(quand) {
  const d = (Date.now() - new Date(quand).getTime()) / 1000;
  if (d < 60) return "à l'instant";
  if (d < 3600) return Math.floor(d / 60) + " min";
  if (d < 86400) return Math.floor(d / 3600) + " h";
  if (d < 604800) return Math.floor(d / 86400) + " j";
  return new Date(quand).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** L'heure qu'il est chez quelqu'un d'autre. Une sœur au Vietnam n'est pas
    « injoignable » : elle est simplement à sept heures d'ici. */
function heureChez(fuseau) {
  try {
    return new Intl.DateTimeFormat("fr-FR", { timeZone: fuseau || "Europe/Paris",
      hour: "2-digit", minute: "2-digit" }).format(new Date());
  } catch { return null; }
}
function decalage(fuseau) {
  try {
    const p = (tz) => {
      const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric",
        minute: "numeric", hour12: false, day: "numeric" });
      const o = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, Number(x.value)]));
      return o.day * 1440 + o.hour * 60 + o.minute;
    };
    let d = p(fuseau) - p(TZ);
    if (d > 720) d -= 1440; else if (d < -720) d += 1440;
    const h = Math.round(d / 60);
    return h === 0 ? "même heure qu'ici" : `${h > 0 ? "+" : ""}${h} h par rapport à toi`;
  } catch { return null; }
}

/* ── Le bouton de compte, en haut à droite ─────────────────────────── */
function majBoutonCompte() {
  const z = $("quiSuisJe");
  if (!z) return;
  if (!session) {
    z.innerHTML = `<button class="btn" data-porte="connexion">Se connecter</button>`;
    return;
  }
  z.innerHTML = `<button class="av" id="btnMoi" aria-label="Mon profil">${
    moi && moi.avatar
      ? `<img src="${esc(urlAvatar(moi.avatar))}" alt="" width="36" height="36">`
      : initiales(moi && moi.nom)}</button>`;
  $("btnMoi").onclick = () => aller("moi");
}

/** Une attente à l'intérieur de l'application : même figure, même langage. */
function enAttente(texte) {
  return `<div class="vide" role="status">
    <svg class="releve mini" viewBox="0 0 100 100" aria-hidden="true">
      <line class="ref" x1="44" y1="10" x2="44" y2="90"/>
      <g class="tourne"><g class="chute"><path class="bras" d="M13 81 L44 68 L88 27"/></g></g>
      <circle class="pivot" cx="44" cy="68" r="9.5"/>
    </svg><span>${esc(texte)}</span></div>`;
}

/* ═════════ LE FIL ═════════ */

async function chargerFil() {
  const box = $("posts");
  if (!box) return;
  if (!box.dataset.pret) box.innerHTML = enAttente("On regarde ce qui est nouveau…");
  renderEcrire();
  const { data, error } = await sb.rpc("fil_actualite", { taille: 25 });
  posts = Array.isArray(data) ? data : [];
  if (error) { box.innerHTML = `<div class="vide">Le fil n'a pas pu être chargé.</div>`; return; }
  await signerImages(posts);
  box.dataset.pret = "1";
  renderFil();
  if (posts.length) chargerCommentaires(posts.map((p) => p.id));
}

/** Une image de publication n'est jamais publique : on demande à la base une
    adresse signée, et elle ne la donne qu'à qui a le droit de voir. */
async function signerImages(liste) {
  const manquants = liste.map((p) => p.image).filter((c) => c && !signees[c]);
  if (!manquants.length || !session) return;
  Object.assign(signees, await sb.stockage.signer(PHOTOS, [...new Set(manquants)], 3600));
}

let commentaires = {};
async function chargerCommentaires(ids) {
  const { data } = await sb.from("ciel_commentaires")
    .select("id,post,auteur,texte,cree_le").in("post", ids).order("cree_le");
  commentaires = {};
  (data || []).forEach((c) => (commentaires[c.post] = commentaires[c.post] || []).push(c));
  renderFil();
}

function renderEcrire() {
  const z = $("ecrire");
  if (!z) return;
  if (!session) {
    z.innerHTML = `<div class="col"><p class="aide">Crée un compte pour publier,
      commenter et suivre des gens.</p>
      <button class="btn pri" data-porte="inscription">Créer un compte</button></div>`;
    return;
  }
  z.innerHTML = `${vignette(moi)}
    <div class="col">
      <label class="horsvue" for="postTexte">Ce que tu publies</label>
      <textarea id="postTexte" maxlength="600" rows="2"
        placeholder="Quoi de neuf dans ton planning ?"></textarea>
      ${brouillon.apercu ? `<div class="apercuimg"><img src="${esc(brouillon.apercu)}" alt="">
        <button class="btn mini danger" id="postSansImage">Retirer</button></div>` : ""}
      <div class="outils">
        <input type="file" id="postFichier" accept="image/*" class="horsvue">
        <button class="btn" id="postImage">Photo</button>
        <select id="postPortee" aria-label="Qui peut voir">
          <option value="abonnes"${brouillon.portee === "abonnes" ? " selected" : ""}>Mes abonnés</option>
          <option value="public"${brouillon.portee === "public" ? " selected" : ""}>Tout le monde</option>
        </select>
        <button class="btn pri" id="postEnvoyer">Publier</button>
      </div>
    </div>`;
  $("postImage").onclick = () => $("postFichier").click();
  $("postFichier").onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const coupe = await recadrerImage(f, { ratio: 1, cote: 1440, qualite: 0.84,
        choixRatio: true, titre: "Cadre ta photo" });
      if (!coupe) return;
      brouillon.blob = coupe;
      if (brouillon.apercu) URL.revokeObjectURL(brouillon.apercu);
      brouillon.apercu = URL.createObjectURL(brouillon.blob);
      renderEcrire();
    } catch (err) { dialogue({ titre: "Image refusée", corps: `<p>${esc(err.message)}</p>` }); }
  };
  const sans = $("postSansImage");
  if (sans) sans.onclick = () => {
    if (brouillon.apercu) URL.revokeObjectURL(brouillon.apercu);
    brouillon = { blob: null, apercu: null, portee: brouillon.portee };
    renderEcrire();
  };
  $("postPortee").onchange = (e) => (brouillon.portee = e.target.value);
  $("postEnvoyer").onclick = publier;
}

async function publier() {
  const t = $("postTexte"), b = $("postEnvoyer");
  const texte = t.value.trim();
  if (!texte && !brouillon.blob) return;
  b.disabled = true; b.textContent = "…";
  try {
    let chemin = null;
    if (brouillon.blob) chemin = await deposerImage(sb, PHOTOS, session.user.id, brouillon.blob);
    const { error } = await sb.from("ciel_posts")
      .insert({ auteur: session.user.id, texte: texte || null, image: chemin, portee: brouillon.portee });
    if (error) throw new Error(error.message);
    t.value = "";
    if (brouillon.apercu) URL.revokeObjectURL(brouillon.apercu);
    brouillon = { blob: null, apercu: null, portee: brouillon.portee };
    await chargerFil();
  } catch (err) {
    dialogue({ titre: "Publication refusée", corps: `<p>${esc(err.message)}</p>` });
  } finally { b.disabled = false; b.textContent = "Publier"; }
}

const COEUR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.2-4.6-9.1-8.5C1.3 8 3.2 4.5 6.6 4.5c2 0 3.4 1.1 4.4 2.4h2c1-1.3 2.4-2.4 4.4-2.4 3.4 0 5.3 3.5 3.7 7C19.2 15.4 12 20 12 20Z"/></svg>`;
const BULLE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 12c0 3.9-3.8 7.1-8.5 7.1a10 10 0 0 1-2.4-.3l-4.6 1.7 1.4-3.7A6.8 6.8 0 0 1 3.5 12c0-3.9 3.8-7.1 8.5-7.1s8.5 3.2 8.5 7.1Z"/></svg>`;

function renderFil() {
  const box = $("posts");
  if (!box) return;
  if (!posts.length) {
    box.innerHTML = `<div class="vide">${session
      ? "Rien pour l'instant. Publie quelque chose, ou abonne-toi à quelqu'un."
      : "Rien de public pour l'instant."}</div>`;
    return;
  }
  box.innerHTML = posts.map((p) => {
    const img = p.image && signees[p.image];
    const coms = commentaires[p.id] || [];
    const aMoi = session && p.auteur === session.user.id;
    return `<article class="post">
      <div class="tete">
        ${vignette(p, "pt")}
        <span class="qui"><b>${esc(p.nom || "Compte")}</b><em>@${esc(p.slug || "?")}</em></span>
        ${p.portee === "public" ? `<span class="portee">public</span>` : ""}
        <span class="quand">${tempsRelatif(p.cree_le)}</span>
      </div>
      ${p.texte ? `<div class="corps">${esc(p.texte)}</div>` : ""}
      ${img ? `<img class="cliche" src="${esc(img)}" alt="Image publiée par ${esc(p.nom || "")}" loading="lazy">` : ""}
      <div class="actions">
        <button class="bta${p.aime ? " actif" : ""}" data-aime="${esc(p.id)}"
          aria-pressed="${p.aime ? "true" : "false"}">${COEUR}<span>${p.jaime || ""}</span></button>
        <button class="bta" data-com="${esc(p.id)}">${BULLE}<span>${p.commentaires || ""}</span></button>
        ${aMoi ? `<button class="bta fin" data-suppost="${esc(p.id)}">Supprimer</button>`
               : session ? `<button class="bta fin" data-signaler="publication:${esc(p.id)}">Signaler</button>` : ""}
      </div>
      ${coms.length || session ? `<div class="fils" data-fils="${esc(p.id)}">
        ${coms.map((c) => `<div class="com">
          <b>${esc(nomDe(c.auteur, p))}</b>
          <span class="txt">${esc(c.texte)}</span>
          ${session && (c.auteur === session.user.id || aMoi)
            ? `<button class="btn mini danger sup" data-supcom="${esc(c.id)}">✕</button>` : ""}
        </div>`).join("")}
        ${session ? `<form class="repondre" data-post="${esc(p.id)}">
          <label class="horsvue" for="c${esc(p.id)}">Commenter</label>
          <input id="c${esc(p.id)}" maxlength="400" placeholder="Commenter…" autocomplete="off">
          <button class="btn" type="submit">Envoyer</button></form>` : ""}
      </div>` : ""}
    </article>`;
  }).join("");
}

/** Le nom d'un auteur de commentaire, pris là où on le connaît déjà. */
function nomDe(id, post) {
  if (session && id === session.user.id) return moi ? moi.nom : "Moi";
  if (post && post.auteur === id) return post.nom;
  const a = [...abonnements, ...abonnes, ...annuaire]
    .find((x) => x.qui === id || x.id === id);
  return a ? a.nom : "Quelqu'un";
}

document.addEventListener("click", async (e) => {
  const j = e.target.closest("[data-aime]");
  if (j) {
    if (!session) return ecranCompte("inscription", "Crée un compte pour réagir.");
    const p = posts.find((x) => x.id === j.dataset.aime);
    if (!p) return;
    p.aime = !p.aime;
    p.jaime = Number(p.jaime || 0) + (p.aime ? 1 : -1);
    renderFil();
    const q = { post: p.id, qui: session.user.id };
    const { error } = p.aime
      ? await sb.from("ciel_jaime").insert(q)
      : await sb.from("ciel_jaime").delete().eq("post", p.id).eq("qui", session.user.id);
    if (error) { p.aime = !p.aime; p.jaime += p.aime ? 1 : -1; renderFil(); }
    return;
  }
  const c = e.target.closest("[data-com]");
  if (c) { const z = document.querySelector(`[data-fils="${c.dataset.com}"] input`); if (z) z.focus(); return; }

  const d = e.target.closest("[data-suppost]");
  if (d) {
    return dialogue({ ton: "warn", titre: "Supprimer cette publication ?",
      corps: `<p>Elle disparaît pour tout le monde, avec ses commentaires.</p>`,
      actions: [{ texte: "Annuler", pri: true }, { texte: "Supprimer", faire: async () => {
        await sb.from("ciel_posts").delete().eq("id", d.dataset.suppost);
        await chargerFil();
      } }] });
  }
  const sc = e.target.closest("[data-supcom]");
  if (sc) {
    await sb.from("ciel_commentaires").delete().eq("id", sc.dataset.supcom);
    return chargerFil();
  }
  const sg = e.target.closest("[data-signaler]");
  if (sg) return signaler(sg.dataset.signaler);
});

document.addEventListener("submit", async (e) => {
  const f = e.target.closest("form.repondre");
  if (!f) return;
  e.preventDefault();
  const inp = f.querySelector("input"), v = inp.value.trim();
  if (!v || !session) return;
  inp.disabled = true;
  const { error } = await sb.from("ciel_commentaires")
    .insert({ post: f.dataset.post, auteur: session.user.id, texte: v });
  inp.disabled = false;
  if (error) return setSync("warn", "commentaire refusé");
  inp.value = "";
  await chargerFil();
});

/* ── Signaler ──────────────────────────────────────────────────────── */
function signaler(cible) {
  const [objet, id] = cible.split(":");
  dialogue({ ton: "warn", titre: "Signaler ce contenu",
    corps: `<p>Dis en une phrase ce qui pose problème. Le signalement part à
      l'éditeur du service ; il n'est pas visible par la personne concernée.</p>
      <div class="champ"><label class="fl" for="sgMotif">Ce qui pose problème</label>
        <input id="sgMotif" maxlength="500" placeholder="Contenu haineux, harcèlement, image volée…"></div>`,
    actions: [{ texte: "Annuler", pri: true }, { texte: "Signaler", faire: async () => {
      const m = ($("sgMotif") || {}).value || "";
      if (m.trim().length < 3) return;
      const { error } = await sb.from("ciel_signalements")
        .insert({ auteur: session.user.id, objet, objet_id: id, motif: m.trim() });
      setSync(error ? "warn" : "ok", error ? "signalement refusé" : "signalement envoyé");
    } }] });
}

async function bloquer(qui, nom) {
  dialogue({ ton: "warn", titre: `Bloquer ${nom} ?`,
    corps: `<p>Vous ne verrez plus rien l'un de l'autre : ni planning, ni publications,
      ni messages. Tu peux revenir dessus dans <b>Moi → Compte</b>.</p>`,
    actions: [{ texte: "Annuler", pri: true }, { texte: "Bloquer", faire: async () => {
      await sb.from("ciel_blocages").insert({ qui: session.user.id, cible: qui });
      await chargerSocial();
      aller("contacts");
    } }] });
}

/* ═════════ CE QUI A BOUGÉ ═════════
   Une application qu'il faut ouvrir pour savoir qu'il s'y passe quelque chose
   ne se rouvre pas. La cloche rassemble ce qui attend une réponse et ce qui
   mérite un coup d'œil — et la pastille ne compte que le premier : une pastille
   qui ne s'éteint jamais cesse d'être lue. */

let nouveautes = [], veilles = new Set();

const ICONES = {
  message: `<path d="M20.5 12c0 3.9-3.8 7.1-8.5 7.1a10 10 0 0 1-2.4-.3l-4.6 1.7 1.4-3.7A6.8 6.8 0 0 1 3.5 12c0-3.9 3.8-7.1 8.5-7.1s8.5 3.2 8.5 7.1Z"/>`,
  abonnement: `<circle cx="9.2" cy="8.4" r="3.3"/><path d="M3 19.5a6.2 6.2 0 0 1 12.4 0"/><path d="M18.5 8v6M21.5 11h-6"/>`,
  creneau: `<rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8.5 3.5v4M15.5 3.5v4"/>`,
  reponse: `<path d="M4 12.5 9.5 18 20 6.5"/>`,
  publication: `<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="m3.6 15.5 4.6-3.8 3.6 2.7 3-2.2 5.6 4.6"/><circle cx="9" cy="9.2" r="1.5"/>`,
  dispo: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.3l3.4 2"/>`,
};

async function chargerNouveautes({ silencieux = true } = {}) {
  if (!session) { nouveautes = []; return majCloche(); }
  const { data } = await sb.rpc("nouveautes");
  const avant = compteAttente();
  nouveautes = Array.isArray(data) ? data : [];
  majCloche(!silencieux || compteAttente() > avant);
  if (vueCourante === "nouveautes") renderNouveautes();
}

const compteAttente = () =>
  nouveautes.filter((x) => x.attend).reduce((a, x) => a + Number(x.nombre || 1), 0);

function majCloche(sonner = false) {
  const c = $("cloche"), p = $("pastNouv");
  if (!c || !p) return;
  c.hidden = !session;
  const n = compteAttente();
  p.hidden = n === 0;
  p.textContent = n > 9 ? "9+" : String(n);
  if (sonner && n && !SOBRE.matches) {
    c.classList.remove("sonne"); void c.offsetWidth; c.classList.add("sonne");
  }
}

async function ouvrirNouveautes() {
  await chargerNouveautes();
  renderNouveautes();
  // Marquer comme vu après l'affichage : ce qu'on vient de voir ne doit pas
  // resurgir, mais ce qui attend encore une réponse reste dans la liste.
  await sb.rpc("marquer_nouveautes_vues");
}

function renderNouveautes() {
  const box = $("nouveautes");
  if (!box) return;
  if (!nouveautes.length) {
    box.innerHTML = `<div class="vide">Rien de neuf. Tout est à jour.</div>`;
    return;
  }
  const bloc = (titre, l) => l.length ? `<div class="groupenouv">${titre}</div>` + l.map((x) => `
    <button class="nouv ${x.attend ? "attend" : esc(x.genre)}" data-nouv="${esc(x.ou || "")}">
      ${x.avatar || x.nom ? vignette(x, "pt")
        : `<span class="rond"><svg viewBox="0 0 24 24">${ICONES[x.genre] || ""}</svg></span>`}
      <span class="qui">
        <b>${x.nom ? esc(x.nom) : "Le fil"}${Number(x.nombre) > 1
          ? ` <span class="pastille">${x.nombre}</span>` : ""}</b>
        <em>${esc(x.texte || "")}</em></span>
      <span class="quand">${x.quand ? tempsRelatif(x.quand) : ""}</span>
    </button>`).join("") : "";
  box.innerHTML =
      bloc("Ça attend ta réponse", nouveautes.filter((x) => x.attend))
    + bloc("Bon à savoir", nouveautes.filter((x) => !x.attend));
}

document.addEventListener("click", (e) => {
  const c = e.target.closest("#cloche");
  if (c) return aller("nouveautes");
  const n = e.target.closest("[data-nouv]");
  if (n && n.dataset.nouv) {
    location.hash = n.dataset.nouv;
    // L'adresse suffit : le routeur écoute déjà les changements de fragment.
  }
});

/** « Préviens-moi quand il est libre » : une ligne par personne surveillée. */
document.addEventListener("change", async (e) => {
  const v = e.target.closest("[data-veille]");
  if (!v || !session) return;
  const cible = v.dataset.veille;
  const { error } = v.checked
    ? await sb.from("ciel_veilles").insert({ qui: session.user.id, cible })
    : await sb.from("ciel_veilles").delete().eq("qui", session.user.id).eq("cible", cible);
  if (error) { v.checked = !v.checked; return setSync("warn", "changement refusé"); }
  if (v.checked) veilles.add(cible); else veilles.delete(cible);
  setSync("ok", v.checked ? "tu seras prévenu" : "alerte retirée");
  chargerNouveautes();
});

/* ═════════ CONVERSATIONS ═════════ */

async function chargerFils() {
  const box = $("fils");
  if (!box) return;
  if (!session) { box.innerHTML = `<div class="vide">Crée un compte pour écrire à quelqu'un.</div>`; return; }
  if (!box.dataset.pret) box.innerHTML = enAttente("Chargement des conversations…");
  const { data } = await sb.rpc("mes_fils");
  fils = Array.isArray(data) ? data : [];
  box.dataset.pret = "1";
  majPastilleMsg();
  box.innerHTML = fils.length ? fils.map((f) => `
    <button class="filrang${f.non_lus > 0 ? " neuf" : ""}" data-fil="${esc(f.fil)}">
      ${vignette(f, "pt")}
      <span class="qui"><b>${esc(f.nom || "Compte")}</b>
        <em>${f.de_moi ? "Toi : " : ""}${esc(String(f.dernier || "").split("\n")[0].slice(0, 70))}</em></span>
      <span class="quand">${tempsRelatif(f.maj_le)}</span>
    </button>`).join("")
    : `<div class="vide">Aucune conversation.
       <button class="btn" data-vers="contacts">Voir mes contacts</button></div>`;
}

function majPastilleMsg() {
  const p = $("pastMsg");
  if (!p) return;
  const n = fils.reduce((a, f) => a + Number(f.non_lus || 0), 0);
  p.hidden = n === 0;
  p.textContent = n > 9 ? "9+" : String(n);
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-fil]");
  if (b) aller("conv", b.dataset.fil);
});

async function ouvrirConversation(id) {
  const box = $("convCorps");
  if (!box || !session) return;
  if (!fils.length) { const { data } = await sb.rpc("mes_fils"); fils = Array.isArray(data) ? data : []; }
  convFil = id;
  const f = fils.find((x) => x.fil === id);
  convAutre = f ? f.autre : null;
  titreConv = f ? f.nom : "Conversation";
  $("titreProfil").textContent = titreConv;

  const { data } = await sb.from("ciel_messages")
    .select("id,auteur,texte,genre,cree_le").eq("fil", id).order("cree_le");
  const l = Array.isArray(data) ? data : [];
  box.innerHTML = l.map((m) => {
    const moiM = m.auteur === session.user.id;
    const lignes = String(m.texte).split("\n");
    // Le contenu se colle sans espace : la bulle respecte les retours à la
    // ligne du message, elle ne doit pas hériter de ceux du gabarit.
    const corps = m.genre === "creneau"
      ? `<span class="quoi">Proposition · ${esc(lignes[0])}</span>${esc(lignes.slice(1).join("\n").trim())}`
      : esc(m.texte);
    return `<div class="mot${moiM ? " moi" : ""}${m.genre === "creneau" ? " creneau" : ""}">`
      + corps + `<span class="h">${hhmm(new Date(m.cree_le).getTime())}</span></div>`;
  }).join("") || `<div class="vide">Rien encore.</div>`;
  // On descend dans la liste, pas dans la page : c'est la liste qui défile.
  // Après une image de plus, pour que la hauteur du panneau soit calculée :
  // la poser trop tôt donne une hauteur d'avant et la liste reste en haut.
  const enBas = () => { box.scrollTop = box.scrollHeight; };
  enBas();
  requestAnimationFrame(() => requestAnimationFrame(enBas));

  const ouvert = f ? f.ouvert : false;
  $("convPied").hidden = !ouvert;
  $("convFerme").hidden = ouvert;
  $("convFerme").innerHTML = ouvert ? "" :
    `Tant que cette personne n'a pas répondu, tu ne peux rien envoyer d'autre.
     C'est ce que remplace le motif de ta proposition.`;
  if (f && f.non_lus) { await sb.rpc("marquer_lu", { fil_id: id }); f.non_lus = 0; majPastilleMsg(); }
}

$("convPied").addEventListener("submit", async (e) => {
  e.preventDefault();
  const inp = $("convTexte"), v = inp.value.trim();
  if (!v || !convAutre) return;
  inp.disabled = true;
  const { data } = await sb.rpc("envoyer_message", { cible: convAutre, corps: v });
  inp.disabled = false;
  const r = String(data || "").replace(/"/g, "");
  if (r !== "ok") {
    return dialogue({ ton: "warn", titre: "Message non envoyé", corps: `<p>${esc({
      ferme: "Cette personne ne reçoit pas de messages de ta part.",
      bloque: "Cette conversation est bloquée.",
      trop: "Trop de messages d'affilée. Attends quelques minutes.",
      vide: "Message vide ou trop long.",
    }[r] || "Envoi refusé.")}</p>` });
  }
  inp.value = "";
  const { data: fs } = await sb.rpc("mes_fils");
  fils = Array.isArray(fs) ? fs : [];
  await ouvrirConversation(convFil);
  inp.focus();
});

/* ═════════ LA FICHE DE QUELQU'UN ═════════ */

async function ouvrirFiche(slug) {
  const box = $("fichePersonne");
  if (!box) return;
  box.innerHTML = enAttente("Ouverture du profil…");
  // La table masque entièrement un compte privé : quelqu'un qui vous suit
  // devenait introuvable. La carte rend le strict nécessaire pour agir.
  const { data: cartes } = await sb.rpc("carte_profil", { identifiant: slug });
  const p = Array.isArray(cartes) ? cartes[0] : null;
  if (!p) {
    box.innerHTML = `<div class="vide">Aucun compte ne porte cet identifiant, ou il t'a bloqué.</div>`;
    return;
  }
  titreFiche = p.nom;
  $("titreProfil").textContent = p.nom;

  const [{ data: pub }, { data: dsp }] = await Promise.all([
    sb.rpc("publications_de", { qui: p.id, taille: 12 }),
    p.ouvert
      ? sb.from("ciel_dispos").select("jour,debut,fin").eq("user_id", p.id)
          .gte("jour", isoJour(new Date(NOW))).order("jour").limit(12)
      : Promise.resolve({ data: [] }),
  ]);
  const sien = Array.isArray(pub) ? pub : [];
  await signerImages(sien);

  const suit = p.lien === "aucun" ? null : p.lien;
  // Sans fuseau connu (compte privé), pas d'horloge : afficher l'heure de Paris
  // en la présentant comme la sienne serait un renseignement inventé.
  const heure = p.fuseau ? heureChez(p.fuseau) : null;
  const dec = p.fuseau ? decalage(p.fuseau) : null;
  const soi = session && p.id === session.user.id;

  box.innerHTML = `
    <div class="fiche">
      <div class="haut">
        ${vignette(p, "gr")}
        <div style="min-width:0;flex:1">
          <h2>${esc(p.nom)}</h2>
          <div class="arobase">@${esc(p.slug)}</div>
          ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ""}
        </div>
      </div>
      <div class="traits">
        ${heure ? `<span class="trait">Il est <b class="mono">${esc(heure)}</b> chez ${esc(p.nom)}${
          dec ? ` · ${esc(dec)}` : ""}</span>` : ""}
        ${p.region ? `<span class="trait">${esc(p.region)}</span>` : ""}
        <span class="trait">${p.public ? "Planning public" : "Planning privé"}</span>
        ${p.me_suit ? `<span class="trait">Te suit</span>` : ""}
        <span class="trait">${{ tous: "Joignable par tous", abonnes: "Joignable par ses contacts",
          personne: "Ne reçoit pas de demandes" }[p.joignable] || ""}</span>
      </div>
      ${soi ? "" : `<div class="actes">
        ${suit === "accepte" ? `<button class="btn" data-desab="${esc(p.id)}">Se désabonner</button>`
          : suit === "attente" ? `<span class="etiq att">demande envoyée</span>`
          : `<button class="btn pri" data-sab="${esc(p.id)}">${
              p.public ? "S'abonner" : "Demander à suivre"}</button>`}
        ${p.joignable !== "personne"
          ? `<button class="btn" data-moment="${esc(p.id)}">Proposer un moment</button>` : ""}
        ${p.peut_ecrire ? `<button class="btn" data-ecrire="${esc(p.id)}">Message</button>` : ""}
        ${p.ouvert
          ? `<a class="btn" href="?profil=${encodeURIComponent(p.slug)}">Voir son planning</a>` : ""}
      </div>
      <details class="repli" style="margin-top:.7rem"><summary>Un problème avec ce profil ?</summary>
        <div class="actes">
          <button class="btn" data-signaler="profil:${esc(p.id)}">Signaler</button>
          <button class="btn danger" data-bloquer="${esc(p.id)}|${esc(p.nom)}">Bloquer</button>
        </div></details>`}
    </div>

    ${dsp && dsp.length ? `<div class="panel">
      <div class="phead"><h2>Quand ${esc(p.nom)} est libre</h2></div>
      ${grouperDispos(dsp)}</div>` : ""}

    <div class="panel">
      <div class="phead"><h2>Ses publications</h2></div>
      ${!p.ouvert && !sien.length
        ? `<div class="vide">Ce compte est privé. Demande à le suivre pour voir
           son planning et ses publications.</div>`
        : sien.length ? sien.map((x) => {
        const img = x.image && signees[x.image];
        return `<article class="post">
          <div class="tete">${vignette(x, "pt")}
            <span class="qui"><b>${esc(x.nom)}</b><em>@${esc(x.slug)}</em></span>
            <span class="quand">${tempsRelatif(x.cree_le)}</span></div>
          ${x.texte ? `<div class="corps">${esc(x.texte)}</div>` : ""}
          ${img ? `<img class="cliche" src="${esc(img)}" alt="" loading="lazy">` : ""}
        </article>`;
      }).join("") : `<div class="vide">Rien de visible pour toi.</div>`}
    </div>`;
}

function grouperDispos(l) {
  const par = {};
  l.forEach((d) => (par[d.jour] = par[d.jour] || []).push(d));
  return Object.entries(par).slice(0, 7).map(([j, plages]) => `
    <div class="commun"><div class="qui"><b>${esc(jourFr(j))}</b>
      <em>${plages.map((x) => `${x.debut.slice(0, 5)} – ${x.fin.slice(0, 5)}`).join(" · ")}</em></div></div>`).join("");
}

/** Premier message à quelqu'un. Si la porte est fermée, la base le dit, et on
    bascule sur la seule chose qu'on puisse encore adresser : une proposition. */
function ecrireA(qui, nom) {
  dialogue({ ton: "info", titre: `Écrire à ${nom}`,
    corps: `<div class="champ"><label class="fl" for="msgTexte">Ton message</label>
      <input id="msgTexte" maxlength="2000" placeholder="Salut, …"></div>`,
    actions: [{ texte: "Annuler" }, { texte: "Envoyer", pri: true, faire: async () => {
      const v = (($("msgTexte") || {}).value || "").trim();
      if (!v) return;
      const { data } = await sb.rpc("envoyer_message", { cible: qui, corps: v });
      const r = String(data || "").replace(/"/g, "");
      if (r === "ok") {
        const { data: fs } = await sb.rpc("mes_fils");
        fils = Array.isArray(fs) ? fs : [];
        const f = fils.find((x) => x.autre === qui);
        setSync("ok", "message envoyé");
        return f ? aller("conv", f.fil) : aller("messages");
      }
      if (r === "ferme") {
        return dialogue({ ton: "info", titre: `${nom} ne reçoit pas de messages`,
          corps: `<p>Tu peux quand même lui proposer un moment : c'est la seule chose
            qu'on adresse à quelqu'un qui ne vous lit pas, et le mot qui l'accompagne
            dit qui tu es.</p>`,
          actions: [{ texte: "Fermer" }, { texte: "Proposer un moment", pri: true,
            faire: () => proposerMoment(qui, nom, true) }] });
      }
      dialogue({ ton: "warn", titre: "Message non envoyé", corps: `<p>${esc({
        bloque: "Cette conversation est bloquée.",
        trop: "Trop de messages d'affilée. Attends quelques minutes.",
        vide: "Message vide ou trop long.",
      }[r] || "Envoi refusé.")}</p>` });
    } }] });
}

/* ── Proposer un moment ────────────────────────────────────────────── */
function proposerMoment(qui, nom, obligeMotif) {
  dialogue({ ton: "info", titre: `Proposer un moment à ${nom}`,
    corps: `
      <div class="rform">
        <div class="champ"><label class="fl" for="pmJour">Quel jour</label>
          <input id="pmJour" type="date" value="${isoJour(new Date(NOW + DAY))}"></div>
        <div class="champ"><label class="fl" for="pmD">De</label>
          <input id="pmD" type="time" value="14:00"></div>
        <div class="champ"><label class="fl" for="pmF">À</label>
          <input id="pmF" type="time" value="17:00"></div>
        <div class="champ large"><label class="fl" for="pmT">Pour quoi faire</label>
          <input id="pmT" maxlength="90" placeholder="Réviser les maths ensemble"></div>
        <div class="champ large"><label class="fl" for="pmM">Un mot${
          obligeMotif ? "" : ` <span class="opt-t">facultatif</span>`}</label>
          <input id="pmM" maxlength="500" placeholder="${obligeMotif
            ? "Dis qui tu es et pourquoi tu écris" : "Chez moi ou à la bibli, comme tu veux"}"></div>
      </div>
      ${obligeMotif ? `<p class="aide">Cette personne ne reçoit pas de messages de ta part.
        Ce mot est le seul que tu peux lui adresser : il part avec la proposition.</p>` : ""}`,
    actions: [{ texte: "Annuler" }, { texte: "Envoyer", pri: true, faire: async () => {
      const v = (id) => ($(id) || {}).value || "";
      const { data } = await sb.rpc("proposer_creneau", {
        hote_id: qui, jour_d: v("pmJour"), debut_h: v("pmD"), fin_h: v("pmF"),
        titre_t: v("pmT"), motif_t: v("pmM"),
      });
      const r = String(data || "").replace(/"/g, "");
      if (r === "attente" || r === "accepte") {
        await chargerSocial();
        setSync("ok", r === "accepte" ? "moment accepté d'office" : "proposition envoyée");
        return aller("messages");
      }
      dialogue({ ton: "warn", titre: "Proposition refusée", corps: `<p>${esc({
        motif: "Il faut écrire un mot : c'est ce qui remplace la présentation.",
        ferme: "Cette personne ne reçoit aucune proposition.",
        horaires: "L'heure de fin doit venir après celle de début.",
        passe: "Ce jour est déjà passé.",
        titre: "Dis pour quoi faire.",
        trop: "Tu as déjà des propositions en attente chez cette personne.",
        bloque: "Cette personne est bloquée.",
      }[r] || "Envoi refusé.")}</p>` });
    } }] });
}

document.addEventListener("click", async (e) => {
  const m = e.target.closest("[data-moment]");
  if (m) {
    if (!session) return ecranCompte("inscription", "Crée un compte pour proposer un moment.");
    const p = annuaireOuAbonnement(m.dataset.moment);
    const libre = p && p.joignable === "tous";
    const abonne = abonnements.some((a) => a.qui === m.dataset.moment && a.etat === "accepte");
    return proposerMoment(m.dataset.moment, (p && p.nom) || "cette personne", !(libre || abonne));
  }
  const w = e.target.closest("[data-ecrire]");
  if (w) {
    if (!session) return ecranCompte("inscription", "Crée un compte pour écrire.");
    const { data } = await sb.rpc("mes_fils");
    fils = Array.isArray(data) ? data : [];
    const f = fils.find((x) => x.autre === w.dataset.ecrire);
    if (f) return aller("conv", f.fil);
    // Pas de conversation ne veut pas dire pas le droit d'en ouvrir une :
    // on proposait la seule porte de secours alors que la porte était ouverte.
    const p = annuaireOuAbonnement(w.dataset.ecrire);
    return ecrireA(w.dataset.ecrire, (p && p.nom) || "cette personne");
  }
  const db = e.target.closest("[data-debloquer]");
  if (db) {
    await sb.from("ciel_blocages").delete()
      .eq("qui", session.user.id).eq("cible", db.dataset.debloquer);
    await chargerSocial();
    renderCompte();
    return setSync("ok", "débloqué");
  }
  const bl = e.target.closest("[data-bloquer]");
  if (bl) { const [qui, nom] = bl.dataset.bloquer.split("|"); return bloquer(qui, nom); }
  const dv = e.target.closest("[data-vers]");
  if (dv) return aller(dv.dataset.vers);
  const fp = e.target.closest("[data-fiche]");
  if (fp) { e.preventDefault(); aller("personne", fp.dataset.fiche); }
});

const annuaireOuAbonnement = (id) =>
  annuaire.find((x) => x.id === id) || abonnements.find((x) => x.qui === id)
  || abonnes.find((x) => x.qui === id) || null;

/* ═════════ CLASSEMENT ═════════ */

async function chargerClassement() {
  const box = $("classement");
  if (!box) return;
  if (!session) { box.innerHTML = `<div class="vide">Crée un compte pour voir le classement.</div>`; return; }
  const { data } = await sb.rpc("classement");
  rangs = Array.isArray(data) ? data : [];
  box.innerHTML = `
    <p class="aide">Les heures validées cette semaine, par celles et ceux qui ont
      choisi d'y figurer. Chacun déclare les siennes : c'est une émulation, pas une mesure.</p>
    ${rangs.length ? rangs.map((r) => `
      <div class="rang${r.moi ? " moi" : ""}${r.rang <= 3 ? " podium" : ""}">
        <span class="n">${r.rang}</span>
        ${vignette(r, "pt")}
        <span class="qui"><b>${esc(r.nom)}</b><em>@${esc(r.slug)}${
          r.region ? " · " + esc(r.region) : ""}</em></span>
        <span class="h">${Number(r.heures).toFixed(1)} h</span>
      </div>`).join("")
    : `<div class="vide">Personne n'y figure encore.</div>`}
    ${moi && !moi.au_classement
      ? `<p class="aide">Tu n'y figures pas. Ça se règle dans <b>Moi → Profil</b>.</p>` : ""}`;
}

/* ═════════ MOMENTS COMMUNS ═════════ */

async function chargerCommuns() {
  const box = $("communs");
  if (!box || !session) return;
  const { data } = await sb.rpc("moments_communs");
  communs = Array.isArray(data) ? data : [];
  box.innerHTML = communs.length ? `
    <p class="aide">Les heures où tu es libre en même temps qu'eux, d'ici une semaine.</p>` +
    communs.map((c) => `
      <div class="commun">
        ${vignette(c, "pt")}
        <div class="qui"><b>${esc(c.nom)}</b>
          <em>${esc(jourFr(c.jour))} · ${c.debut.slice(0, 5)} – ${c.fin.slice(0, 5)}</em></div>
        <button class="btn" data-moment="${esc(c.qui)}">Proposer</button>
      </div>`).join("")
    : `<div class="vide">Rien en commun pour l'instant — il faut que vous soyez
       abonnés l'un à l'autre et que vos plannings se croisent.</div>`;
}

/* ═════════ CE QUE JE PUBLIE DE MOI ═════════
   Deux choses, et rien d'autre : mes plages libres des quinze prochains jours,
   et le total d'heures de la semaine si j'ai demandé à figurer au classement.
   Jamais le contenu de mon planning. */

async function publierDispos() {
  if (!session || !canEdit || !plan) return;
  const lignes = [];
  const debut = minuitLocal(NOW);
  for (let i = 0; i < 15; i++) {
    const cle = isoJour(new Date(debut + i * DAY));
    const j = plan.jours.get(cle);
    if (!j) continue;
    for (const [d, f] of (j.creneaux || [])) {
      if (f - d < 60) continue;
      lignes.push({ user_id: session.user.id, jour: cle,
        debut: mmss(d), fin: mmss(f) });
    }
  }
  await sb.from("ciel_dispos").delete().eq("user_id", session.user.id);
  if (lignes.length) await sb.from("ciel_dispos").insert(lignes);

  const lundi = new Date(NOW);
  lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7));
  let h = 0;
  for (let i = 0; i < 7; i++) h += heuresFaitesLe(isoJour(new Date(lundi.getTime() + i * DAY)));
  await sb.from("ciel_scores").upsert({ user_id: session.user.id,
    semaine: isoJour(lundi), heures: Math.min(168, Math.round(h * 100) / 100),
    serie: 0, maj_le: new Date().toISOString() });
}
const mmss = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;

/* ═════════ MODE VISITE ═════════
   Regarder sans compte : le fil public et l'annuaire, rien de plus. Le planning
   n'a pas de sens sans compte — il n'y a rien à y répartir. */

function entrerEnVisite() {
  modeVisite = true;
  montrer("appli");
  // Sans compte, il n'y a rien à répartir : seul le fil a un sens, avec
  // l'annuaire qu'il contient. Le reste attend une inscription.
  document.querySelectorAll("#socle button").forEach((b) => (b.hidden = b.dataset.vue !== "fil"));
  const ro = $("robar");
  ro.hidden = false;
  ro.innerHTML = `<b>Tu regardes sans compte.</b>
    <span>Seules les publications publiques s'affichent.</span>
    <button class="btn pri mini" data-porte="inscription">Créer un compte</button>`;
  majBoutonCompte();
  aller("fil", null, { remplacer: true });
  chargerAnnuaire();
}

function routeDepart() {
  modeVisite = false;
  document.querySelectorAll("#socle button").forEach((b) => (b.hidden = false));
  let dernier = null;
  try { dernier = sessionStorage.getItem("ciel.vue"); } catch {}
  if (location.hash.startsWith("#/")) return appliquerRoute();
  if (dernier && dernier.startsWith("#/") && !/^#\/(conv|p)\//.test(dernier)) {
    history.replaceState(null, "", dernier);
    return appliquerRoute();
  }
  aller("jour", null, { remplacer: true });
}

/* ═════════ ÉVÉNEMENTS D'INTERFACE ═════════ */
$("evf").addEventListener("submit", (e) => { e.preventDefault(); ajouter(false); });
["evD", "evH", "evF"].forEach((k) => $(k).addEventListener("change", verifier));

document.addEventListener("input", (e) => {
  const c = e.target.closest("input[data-cap]");
  if (c && canEdit) {
    clearTimeout(tmr.cap);
    tmr.cap = setTimeout(() => {
      capacites[c.dataset.cap] = lirePlages(c.value);
      log(`a modifié ses heures de travail du ${["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"][c.dataset.cap]}`);
      saveState(); renderAll();
    }, 700);
  }
});
document.addEventListener("click", (e) => {
  const d = e.target.closest("[data-del]");
  if (d && canEdit) {
    const ev = events.find((x) => x.id === d.dataset.del);
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
$("subf").addEventListener("submit", async (e) => {
  e.preventDefault();
  const inp = $("subE"), v = inp.value.trim().toLowerCase();
  if (!v || !vue) return;
  const btn = e.target.querySelector("button");
  btn.disabled = true; btn.textContent = "…";
  const { error } = await sb.from("ciel_subs").insert({ user_id: vue.id, email: v, actif: true });
  btn.textContent = error ? (/(duplicate|unique)/i.test(error.message) ? "Déjà inscrit" : "Refusé") : "Inscrit ✓";
  if (!error) inp.value = "";
  setTimeout(() => { btn.disabled = false; btn.textContent = "M'abonner"; }, 1900);
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
  fil:      { panneau: "fil",      titre: "Le fil" },
  messages: { panneau: "messages", titre: "Messages" },
  contacts: { panneau: "social",   titre: "Contacts" },
  moi:      { panneau: "regl",     titre: "Moi" },
  conv:     { panneau: "conv",     titre: "Conversation", retour: "messages" },
  personne: { panneau: "personne", titre: "Profil",      retour: "contacts" },
  nouveautes: { panneau: "nouveautes", titre: "Nouveautés", retour: "jour" },
};
const TITRES = { cal: "Calendrier", dispo: "Quand je suis libre", todo: "Étapes" };

let vueCourante = "jour", argCourant = null, sousPlanning = "cal";

function versAdresse(v, arg) {
  if (v === "conv") return `#/conv/${arg}`;
  if (v === "personne") return `#/p/${arg}`;
  if (v === "planning") return `#/planning/${arg || sousPlanning}`;
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
  if (v === "conv" && m[1]) return ["conv", m[1]];
  if (v === "p" && m[1]) return ["personne", decodeURIComponent(m[1])];
  if (v === "planning") return ["planning", m[1] || sousPlanning];
  return [VUES[v] ? v : "jour", null];
}

function appliquerRoute() {
  const [v, arg] = lireAdresse();
  montrerVue(v, arg);
}

/** La hauteur réelle de l'en-tête : la conversation s'y ajuste au pixel. */
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
  // Le planning a besoin de place sur un écran large ; le fil et les
  // conversations se lisent mieux en colonne étroite, comme partout.
  $("appli").toggleAttribute("data-large", v === "planning" || v === "jour");
  $("segPlanning").hidden = v !== "planning";
  document.querySelectorAll("#segPlanning button").forEach((b) =>
    b.setAttribute("aria-selected", b.dataset.seg === sousPlanning));

  document.querySelectorAll("#socle button").forEach((b) => {
    const on = b.dataset.vue === v || (v === "conv" && b.dataset.vue === "messages");
    b.setAttribute("aria-current", on ? "page" : "false");
  });

  const rev = $("revenir");
  rev.hidden = !def.retour;
  rev.onclick = () => (history.length > 1 ? history.back() : aller(def.retour));

  // « enregistré » n'a de sens que sous le planning : ailleurs, le sous-titre
  // se tairait mieux que de commenter une page qu'il ne décrit pas.
  $("sousTitre").hidden = !["jour", "planning"].includes(v);
  const t = $("titreProfil");
  if (v === "jour" && vue && !canEdit) t.textContent = "Planning de " + vue.nom;
  else if (v === "planning") t.textContent = TITRES[sousPlanning];
  else if (v === "conv") t.textContent = titreConv || "Conversation";
  else if (v === "personne") t.textContent = titreFiche || "Profil";
  else t.textContent = def.titre;

  // Instantané : un défilement animé pendant que le contenu change laisse la
  // page à mi-chemin, et le panneau apparaît coupé par l'en-tête.
  scrollTo({ top: 0, behavior: "auto" });
  mesurerEnTete();
  // Les liens de pied de page n'ont rien à faire au milieu d'une conversation.
  const pied = document.querySelector(".souspied.dansappli");
  if (pied) pied.hidden = v === "conv";
  try { sessionStorage.setItem("ciel.vue", location.hash); } catch {}
  peupler(v, arg);
}

function peupler(v, arg) {
  if (v === "planning") {
    if (sousPlanning === "cal") renderCal();
    if (sousPlanning === "dispo") renderDispo();
  }
  if (v === "moi") { renderCapacites(); renderProfil(); renderProgramme(); renderCompte(); renderJoignable(); }
  if (v === "contacts") { renderSocial(); chargerCommuns(); }
  if (v === "fil") chargerFil();
  if (v === "messages") chargerFils();
  if (v === "conv") ouvrirConversation(arg);
  if (v === "personne") ouvrirFiche(arg);
  if (v === "nouveautes") ouvrirNouveautes();
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
  if (b.dataset.seg === "classement") chargerClassement();
  if (b.dataset.seg === "communs") chargerCommuns();
  if (b.dataset.seg === "decouvrir") renderAnnuaire();
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
