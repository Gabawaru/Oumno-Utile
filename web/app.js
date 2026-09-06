import { creerClient } from "./supa.js";
import { MONTHS, MFULL, DOW, DAY, TZ, CNED, EXAM, GROUPS } from "./planning.js";
import { planifier, testerAjout, proposerReport, bilanJour, totalManque, duree,
         trouverCreneaux, creneauxTexte, plusLongCreneau, normaliserCapacites,
         hhmm as enHeure, min as enMin, iso as isoJour } from "./planificateur.js";

const SUPABASE_URL = "https://hnmeefndnckqkdjjbgwe.supabase.co";
const SUPABASE_KEY = "sb_publishable_ciLHalsy_YvWIUbEbCnN2g_TZfT4aPU";
const sb = creerClient(SUPABASE_URL, SUPABASE_KEY);

/* ═════════ ÉTAT DE SESSION ═════════ */
let session = null;      // session Supabase
let moi = null;          // mon profil
let vue = null;          // profil consulté
let capacites = { 0: 2, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 3 };
let reports = {};        // échéances repoussées à la main
let plan = null;         // résultat du planificateur

const estMoi = () => Boolean(session && vue && vue.id === session.user.id);
const $ = (id) => document.getElementById(id);


/* ═════════ CONSTANTES ═════════ */
const Y0=2026,M0=8;
const qStart=q=>new Date(Y0,M0+Math.floor(q/2),q%2?16:1);
const qEnd  =q=>q%2?new Date(Y0,M0+Math.floor(q/2)+1,1):new Date(Y0,M0+Math.floor(q/2),16);
const T0=qStart(0).getTime(),T1=qEnd(19).getTime();

const ALL=[],DEVS=[];
GROUPS.forEach(g=>g.rows.forEach(r=>{
  r.g=g; r.h=r.steps.reduce((a,s)=>a+s.h,0);
  r.cid=r.cid||g.cid;
  r.url=r.cid?CNED+r.cid+(r.u?"&section="+r.u:""):null;
  const a=qStart(r.s).getTime(),b=qEnd(r.e-1).getTime(),span=b-a;
  let cum=0;
  r.steps.forEach(s=>{
    s.row=r;s.g=g;s.t0=a+span*(cum/r.h);cum+=s.h;s.t1=a+span*(cum/r.h);
    ALL.push(s); if(s.dev) DEVS.push(s);
  });
}));
GROUPS.forEach(g=>{g.h=g.rows.reduce((a,r)=>a+r.h,0);
  g.s=Math.min(...g.rows.map(r=>r.s));g.e=Math.max(...g.rows.map(r=>r.e));});
const TOTAL_H=GROUPS.reduce((a,g)=>a+g.h,0);
const byId={}; ALL.forEach(s=>byId[s.id]=s);

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
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function tickClock(){
  NOW=parisNow(); const d=new Date(NOW);
  document.getElementById("cdate").textContent=
    d.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  document.getElementById("ctime").textContent=hhmm(NOW)+" Paris";
  document.getElementById("cdN").textContent=Math.max(0,Math.ceil((EXAM-NOW)/DAY));
}
const nowQ=()=>{const d=new Date(NOW);
  return Math.max(0,Math.min(19,(d.getFullYear()-Y0)*24+(d.getMonth()-M0)*2+(d.getDate()>15?1:0)));};

/* ═════════ ÉTAT ═════════ */
let done=Object.create(null), events=[], journal=[], subs=[], grades={};
let canEdit=false;
let pendingLog=[], subCount=0, tmr={};
const LS="ciel.v4";
function saveLocal(){ if(!vue||!estMoi()) return;
  try{localStorage.setItem(LS,JSON.stringify(etat));}catch(e){} }
function loadLocal(){ try{const r=JSON.parse(localStorage.getItem(LS)||"null");
  if(r) appliquerEtat(r);}catch(e){} }
function setSync(k,t){const d=document.getElementById("sdot");
  if(d) d.className="dot"+(k?" "+k:"");
  const s=document.getElementById("stxt"); if(s) s.textContent=t;}

function appliquerEtat(d){
  d=d||{};
  done      = d.done      || {};
  events    = d.evenements|| d.events || [];
  grades    = d.notes     || d.grades || {};
  capacites = normaliserCapacites(d.capacites);
  reports   = d.reports   || {};
  Object.keys(done).forEach(k=>{if(done[k]===true)done[k]="";});
}
const etat=()=>({done,evenements:events,notes:grades,capacites,reports});

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
    }catch(e){ pendingLog.unshift(...lignes); setSync("warn","hors ligne — gardé en local"); }
  },600);
}
const saveProgress=saveState, saveEvents=saveState, saveGrades=saveState;
function saveSubs(){}

/* ═════════ CALCULS ═════════ */
const doneH=r=>r.steps.reduce((a,s)=>a+(done[s.id]?s.h:0),0);
const actualH=()=>ALL.reduce((a,s)=>a+(done[s.id]?s.h:0),0);
const isLate=s=>!done[s.id]&&NOW>s.t1;
const lateDays=s=>Math.floor((NOW-s.t1)/DAY);
function pace(){
  const ts=Object.values(done).map(v=>Date.parse(v)).filter(v=>v>0);
  if(!ts.length) return 0;
  const el=Math.max(NOW-Math.min(...ts),14*DAY), win=Math.min(28*DAY,el), since=NOW-win;
  let h=0; for(const s of ALL){const t=Date.parse(done[s.id]); if(t>0&&t>=since)h+=s.h;}
  return h/(win/(7*DAY));
}
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
  const st=status(),p=pace(),proj=p>0?Math.ceil((TOTAL_H-st.act)/p):null;
  const hero=document.getElementById("hero");
  hero.style.setProperty("--hc",COL[st.kind]);
  document.getElementById("hbig").textContent=st.word+(st.detail?" "+st.detail:"");
  document.getElementById("hsub").innerHTML= st.kind==="ontime"
    ? `Tu es au niveau prévu pour aujourd'hui — <b>${Math.round(st.act)} h</b> validées sur les <b>${Math.round(st.exp)} h</b> attendues.`
    : st.kind==="ahead"
      ? `Le plan n'atteint ton niveau que le <b>${fmtDL(st.eq)}</b>. Tu as <b>${st.gap} h</b> d'avance.`
      : `Le plan prévoyait ce niveau le <b>${fmtDL(st.eq)}</b>. Il te manque <b>${-st.gap} h</b> pour revenir sur la courbe.`;
  document.getElementById("gfill").style.width=st.pct+"%";
  const gm=document.getElementById("gmark");
  gm.style.left=`calc(${st.expPct}% - 1px)`; gm.title=`Attendu aujourd'hui : ${Math.round(st.exp)} h`;
  document.getElementById("hnums").innerHTML=`
   <div class="hn"><div class="k">Validé</div><div class="v">${Math.round(st.act)} h</div></div>
   <div class="hn"><div class="k">Attendu</div><div class="v">${Math.round(st.exp)} h</div></div>
   <div class="hn"><div class="k">Écart</div><div class="v ${st.gap<0?"late":"ok"}">${st.gap>0?"+":""}${st.gap} h</div></div>
   <div class="hn"><div class="k">Avancement</div><div class="v">${Math.round(st.pct)} %</div></div>
   <div class="hn"><div class="k">En retard</div><div class="v ${st.late.length?"late":"ok"}">${st.late.length}</div></div>
   <div class="hn"><div class="k">Rythme</div><div class="v">${p?p.toFixed(1):"—"} h/sem</div></div>
   <div class="hn"><div class="k">Reste</div><div class="v">${Math.round(TOTAL_H-st.act)} h</div></div>
   <div class="hn"><div class="k">Fin projetée</div><div class="v">${proj?plural(proj,"sem"):"—"}</div></div>`;

  const pend=ALL.filter(s=>!done[s.id]&&s.t0<=NOW+30*DAY).sort((a,b)=>(a.t1-b.t1)||(b.h-a.h)).slice(0,7);
  document.getElementById("queue").innerHTML=pend.length
    ? pend.map((s,i)=>qRow(s,i+1)).join("") : `<div class="empty">✓ Rien d'ouvert dans les 30 prochains jours</div>`;
  const lates=st.late.sort((a,b)=>a.t1-b.t1);
  document.getElementById("lateq").innerHTML=lates.length
    ? lates.slice(0,10).map(s=>qRow(s,null)).join("")+
      (lates.length>10?`<div class="empty muted">+ ${lates.length-10} autres</div>`:"")
    : `<div class="empty">✓ Aucune étape en retard</div>`;
  document.getElementById("lateNote").textContent=
    lates.length?`${lates.length} étape${lates.length>1?"s":""} dont l'échéance est passée`:"";
}
function qRow(s,rank){
  const lt=isLate(s),soon=!lt&&s.t1-NOW<7*DAY;
  const dis=canEdit?"":" disabled";
  return `<label class="qitem" style="--c:${s.g.c}">
    ${rank?`<span class="rank">${rank}</span>`:""}
    <input type="checkbox" class="cb" data-cb="${s.id}"${dis}>
    <span class="qbody"><span class="qtitle">${esc(s.row.n)} · ${esc(s.n)}</span>
    <span class="qmeta"><span class="grp">${short(s.g)}</span><span>${s.h} h</span>
      <span>échéance ${fmtD(s.t1)}</span>
      ${lt?`<span class="lt">retard ${plural(lateDays(s),"jour")}</span>`:""}
      ${soon?`<span class="so">bientôt</span>`:""}
      ${s.date?`<span class="lt">ouvre le ${s.date}</span>`:""}
      ${s.row.url?`<a href="${s.row.url}" target="_blank" rel="noopener">cours ↗</a>`:""}
    </span></span></label>`;
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
  GROUPS.forEach((grp,gi)=>{
    if(gi)h+='<div class="spacer"></div>';
    h+=`<div class="glabel grp">${grp.name}${grp.code?`<span class="code">${grp.code}</span>`:""}<span class="code">${grp.h} h</span></div>
      <div class="lane grp"><div class="bar grp" data-g="${grp.id}" style="--c:${grp.c};grid-column:${col(grp.s)}/${col(grp.e)}"><div class="fill"></div></div></div>`;
    grp.rows.forEach(r=>{
      h+=`<div class="glabel sub" data-lab="${r.id}" title="${esc(r.n)}">${r.url?`<a href="${r.url}" target="_blank" rel="noopener" style="color:inherit">${esc(r.n)}</a>`:esc(r.n)}${r.code?`<span class="code">${r.code}</span>`:""}</div>
        <div class="lane"><div class="bar" data-r="${r.id}" style="--c:${grp.c};grid-column:${col(r.s)}/${col(r.e)}">
          <div class="fill"></div><span class="blab"></span></div></div>`;
    });
  });
  g.innerHTML=h;
  document.getElementById("legend").innerHTML=
    GROUPS.map(gp=>`<span class="li"><span class="sw" style="background:${gp.c}"></span>${short(gp)} — ${gp.h} h</span>`).join("")+
    `<span class="li" style="margin-left:auto" class="muted">Clique le nom d'un lot pour ouvrir le cours sur eformation.cned.fr</span>`;
}
function paintGantt(){
  GROUPS.forEach(g=>{
    let gd=0;
    g.rows.forEach(r=>{
      const d=doneH(r);gd+=d;const pc=r.h?d/r.h*100:0,late=r.steps.some(isLate);
      const bar=document.querySelector(`[data-r="${r.id}"]`);
      if(bar){bar.querySelector(".fill").style.width=pc+"%";
        bar.querySelector(".blab").textContent=`${d}/${r.h} h`;
        bar.classList.toggle("done",pc>=99.5);bar.classList.toggle("lt",late&&pc<99.5);}
      const lab=document.querySelector(`[data-lab="${r.id}"]`);
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
  document.getElementById("acc").innerHTML=GROUPS.map(g=>`
   <div class="grpblk" style="--c:${g.c}">
     <div class="grphd" role="button" tabindex="0" aria-expanded="false">
       <span class="car">▶</span><span class="nm">${g.name}</span>
       <span class="mini"><i data-mini="${g.id}"></i></span>
       <span class="ct" data-ct="${g.id}">0/${g.h} h</span></div>
     <div class="grpbody">${g.rows.map(r=>`
       <div><div class="rowhd">${r.url?`<a href="${r.url}" target="_blank" rel="noopener">${esc(r.n)} ↗</a>`:esc(r.n)}
         <span class="rh" data-rh="${r.id}">0/${r.h} h</span></div>
       <div class="steps">${r.steps.map(s=>`
         <label class="step" data-step="${s.id}">
           <input type="checkbox" class="cb" data-cb="${s.id}">
           <span class="lbl">${esc(s.n)}${s.date?` <b class="mono" style="color:var(--sig)">${s.date}</b>`:""}</span>
           <span class="hh">${s.h} h</span></label>`).join("")}</div></div>`).join("")}</div>
   </div>`).join("");
  document.querySelectorAll(".grphd").forEach(hd=>{
    const t=()=>{const b=hd.parentElement;b.classList.toggle("open");
      hd.setAttribute("aria-expanded",b.classList.contains("open"));};
    hd.onclick=t; hd.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();t();}};
  });
  document.getElementById("expandAll").onclick=()=>document.querySelectorAll(".grpblk").forEach(b=>b.classList.add("open"));
  document.getElementById("collapseAll").onclick=()=>document.querySelectorAll(".grpblk").forEach(b=>b.classList.remove("open"));
}

/* ═════════ COURBE ═════════ */
function renderCurve(){
  const W=900,H=330,L=52,Rr=14,Tp=16,B=34,iw=W-L-Rr,ih=H-Tp-B;
  const x=t=>L+iw*(t-T0)/(T1-T0), y=v=>Tp+ih*(1-v/TOTAL_H);
  let plan="";for(let i=0;i<=120;i++){const t=T0+(T1-T0)*i/120;
    plan+=(i?"L":"M")+x(t).toFixed(1)+" "+y(planned(t)).toFixed(1);}
  const ev=ALL.filter(s=>done[s.id]).map(s=>({t:Date.parse(done[s.id])||T0,h:s.h})).sort((a,b)=>a.t-b.t);
  let real="M"+x(T0).toFixed(1)+" "+y(0).toFixed(1),cum=0,lastT=T0;
  ev.forEach(e=>{real+="L"+x(e.t).toFixed(1)+" "+y(cum).toFixed(1);cum+=e.h;
    real+="L"+x(e.t).toFixed(1)+" "+y(cum).toFixed(1);lastT=e.t;});
  real+="L"+x(Math.max(NOW,lastT)).toFixed(1)+" "+y(cum).toFixed(1);
  const p=pace();let proj="";
  if(p>0&&cum<TOTAL_H){const end=Math.min(NOW+(TOTAL_H-cum)/p*7*DAY,T1);
    proj=`M${x(NOW).toFixed(1)} ${y(cum).toFixed(1)}L${x(end).toFixed(1)} ${y(Math.min(cum+p*(end-NOW)/(7*DAY),TOTAL_H)).toFixed(1)}`;}
  let grid="",lbl="";
  for(let v=0;v<=TOTAL_H;v+=200){
    grid+=`<line x1="${L}" y1="${y(v)}" x2="${W-Rr}" y2="${y(v)}" stroke="var(--rule2)" stroke-width="1" fill="none"/>`;
    lbl+=`<text x="${L-7}" y="${y(v)+3.5}" text-anchor="end" font-size="10" fill="var(--ink3)" font-family="IBM Plex Mono,monospace">${v}</text>`;}
  for(let m=0;m<10;m++){const t=new Date(Y0,M0+m,1).getTime();
    lbl+=`<text x="${x(t)}" y="${H-13}" text-anchor="middle" font-size="10" fill="var(--ink3)" font-family="IBM Plex Mono,monospace">${MONTHS[m]}</text>`;}
  document.getElementById("chartbox").innerHTML=`
   <svg class="curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Heures cumulées : plan prévu contre progression réelle">
     ${grid}${lbl}
     <line x1="${x(NOW)}" y1="${Tp}" x2="${x(NOW)}" y2="${Tp+ih}" stroke="var(--sig)" stroke-width="1.5" fill="none"/>
     <text x="${x(NOW)+4}" y="${Tp+11}" font-size="10" fill="var(--sig)" font-family="IBM Plex Mono,monospace">aujourd'hui</text>
     <path d="${plan}" fill="none" stroke="var(--ink3)" stroke-width="2" stroke-dasharray="6 4"/>
     ${proj?`<path d="${proj}" fill="none" stroke="var(--ahead)" stroke-width="2" stroke-dasharray="2 3"/>`:""}
     <path d="${real}" fill="none" stroke="var(--ok)" stroke-width="2.5" stroke-linejoin="round"/>
     <circle cx="${x(Math.max(NOW,lastT))}" cy="${y(cum)}" r="4" fill="var(--ok)"/>
     <text x="${L}" y="${Tp-4}" font-size="10" fill="var(--ink3)" font-family="IBM Plex Mono,monospace">heures cumulées — objectif ${TOTAL_H} h</text>
   </svg>`;
  const st=status();
  document.getElementById("curveNote").innerHTML=
    `Rythme réel <b class="mono">${p?p.toFixed(1):"0"} h/sem</b> · plan <b class="mono">${(TOTAL_H/43).toFixed(1)} h/sem</b>`+
    (st.kind!=="ontime"?` · <b style="color:${COL[st.kind]}">${st.word} ${st.detail}</b>`:"");
}

/* ═════════ MATRICE ═════════ */
function classify(s){
  const urgent=s.t0<=NOW+14*DAY||isLate(s)||!!s.date;
  const important=s.h>=8||!!s.dev||s.g.id==="b3";
  return urgent?(important?1:3):(important?2:4);
}
function mlabel(s){
  const ctx=/^(Mission|Entrée en matière|Synthèse)/.test(s.n)
    ? s.row.n.replace(/^(SP \d+|Activité \d+) · /,"$1 ")+" · ":"";
  return `<b>${short(s.g)}</b> ${ctx}${esc(s.n)} — <span class="h">${s.h} h</span>`+
    (isLate(s)?` <b class="mono" style="color:var(--late)">retard ${lateDays(s)} j</b>`:"");
}
const STATIC4=["Refaire les quiz d'entrée déjà réussis",
 "Parcourir la « Boîte à outils » sans objectif précis",
 "Remettre au propre des prises de notes déjà lisibles",
 "Forum entre élèves hors question bloquante — le tuteur répond sous 48 h"];
function renderMx(){
  const b={1:[],2:[],3:[],4:[]};
  ALL.filter(s=>!done[s.id]).forEach(s=>b[classify(s)].push(s));
  [1,2,3,4].forEach(k=>b[k].sort((x,y)=>(x.t1-y.t1)||(y.h-x.h)));
  [1,2,3].forEach(k=>{
    const l=b[k],sh=l.slice(0,6),ex=l.length-sh.length;
    document.getElementById("n"+k).textContent=l.length;
    document.getElementById("q"+k).innerHTML=l.length
      ? sh.map(s=>`<li>${mlabel(s)}</li>`).join("")+(ex>0?`<li class="muted">+ ${ex} autre${ex>1?"s":""}</li>`:"")
      : `<div class="empty">✓ Rien en attente ici</div>`;});
  const q4=b[4];
  document.getElementById("n4").textContent=q4.length+STATIC4.length;
  document.getElementById("q4").innerHTML=STATIC4.map(t=>`<li>${t}</li>`).join("")+
    q4.slice(0,3).map(s=>`<li>${mlabel(s)}</li>`).join("")+
    (q4.length>3?`<li class="muted">+ ${q4.length-3} étapes non prioritaires</li>`:"");
  const nb=ALL.filter(s=>done[s.id]).length;
  document.getElementById("mxnote").innerHTML=
    `Recalculée à l'heure de Paris · <b class="mono" style="color:var(--ok)">${nb}</b> sortie${nb>1?"s":""} de la matrice`;
}

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
  document.getElementById("tnJ").textContent=journal.length||"";
  document.getElementById("jNote").textContent=
    journal.length?`${journal.length} entrée${journal.length>1?"s":""} — la plus récente en haut`:"";
  document.getElementById("jlist").innerHTML=journal.length
    ? journal.slice(0,80).map(j=>`<div class="jrow" style="--c:var(--evt)">
        <span class="jt">${new Date(j.ts).toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit"})} ${hhmm(Date.parse(j.ts))}</span>
        <span>${esc(j.text)}</span></div>`).join("")
    : `<div class="empty muted">Rien encore. Chaque action de Gabriel s'inscrira ici.</div>`;
  document.getElementById("subs").innerHTML= canEdit
    ? (subs.length
        ? subs.map((e,i)=>`<span class="pill">${esc(e)}<button data-sub="${i}" title="Retirer">✕</button></span>`).join("")
        : `<span class="muted" style="font-size:.73rem">Aucun abonné pour l'instant.</span>`)
    : `<span class="muted" style="font-size:.73rem">${subCount} personne${subCount>1?"s":""} ${subCount>1?"suivent":"suit"} ce planning.</span>`;
}
function makeDigest(){
  const st=status();
  const since=NOW-7*DAY;
  const recent=journal.filter(j=>Date.parse(j.ts)>=since);
  const L=[];
  L.push(`Point hebdomadaire — BTS CIEL 2A (Gabriel)`);
  L.push(new Date(NOW).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}));
  L.push("");
  L.push(`Statut : ${st.word}${st.detail?" "+st.detail:""}`);
  L.push(`Avancement : ${Math.round(st.act)} h sur ${TOTAL_H} h (${Math.round(st.pct)} %)`);
  L.push(`Rythme : ${pace().toFixed(1)} h par semaine`);
  L.push(`Étapes en retard : ${st.late.length}`);
  L.push(`Jours avant la session 2027 : ${Math.max(0,Math.ceil((EXAM-NOW)/DAY))}`);
  L.push("");
  L.push(recent.length?`Changements des 7 derniers jours (${recent.length}) :`:"Aucun changement cette semaine.");
  recent.slice(0,25).forEach(j=>L.push("  · "+new Date(j.ts).toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit"})+" — "+j.text));
  const next=ALL.filter(s=>!done[s.id]&&s.t0<=NOW+14*DAY).sort((a,b)=>a.t1-b.t1).slice(0,5);
  if(next.length){L.push("");L.push("À venir :");
    next.forEach(s=>L.push(`  · ${s.row.n} · ${s.n} — ${s.h} h, échéance ${fmtD(s.t1)}`));}
  return L.join("\n");
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
    const on=!!done[cb.dataset.cb];cb.checked=on;
    const st=cb.closest(".step");
    if(st){st.classList.toggle("on",on);st.classList.toggle("lt",isLate(byId[cb.dataset.cb]));}
    cb.disabled=!canEdit;});
}
let painting=false;
function renderAll(){
  painting=true;
  replanifier();
  renderToday();paintGantt();renderMx();renderGrades();renderJournal();
  renderCapacites();renderProfil();
  if(!document.querySelector('[data-panel="cal"]').hidden) renderCal();
  if(!document.querySelector('[data-panel="curve"]').hidden) renderCurve();
  syncChecks();applyMode();
  const nd=ALL.filter(s=>done[s.id]).length;
  document.getElementById("tnTodo").textContent=ALL.length-nd;
  painting=false;
}
/* Les gestionnaires d'interface sont définis plus bas, avec le planificateur. */
document.getElementById("mkDigest").onclick=()=>{
  const txt=makeDigest();
  document.getElementById("digest").value=txt;
  document.getElementById("mailDigest").href=
    "mailto:?bcc="+encodeURIComponent(subs.join(","))+
    "&subject="+encodeURIComponent("Point hebdomadaire — BTS CIEL 2A")+
    "&body="+encodeURIComponent(txt);
};
document.getElementById("cpDigest").onclick=async()=>{
  const ta=document.getElementById("digest");
  if(!ta.value) ta.value=makeDigest();
  try{await navigator.clipboard.writeText(ta.value);
    document.getElementById("cpDigest").textContent="Copié ✓";
    setTimeout(()=>document.getElementById("cpDigest").textContent="Copier",1600);}
  catch(err){ta.select();}
};


/* ═════════ PLANIFICATEUR ═════════ */
const FIN_ANNEE = new Date(2027, 5, 30).getTime();

function replanifier() {
  plan = planifier({
    etapes: ALL, done, evenements: events, capacites, reports,
    maintenant: NOW, fin: FIN_ANNEE,
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
    const pleine = b && b.cap > 0 && b.libre <= 0.01;
    const deborde = b && b.surcharge > 0;

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

/* ═════════ ZONE DE TÂCHE D'UN JOUR ═════════ */
function renderZone() {
  const d = calSel || new Date(NOW);
  const t = minuitLocal(d.getTime()), cle = isoJour(d);
  const b = bilanJour(plan.jours, cle);
  const auj = sameDay(d, new Date(NOW));
  const scans = scanOn(t, t + DAY);

  let h = `<div class="dph">${fmtDL(t)}${auj ? " — aujourd'hui" : ""}</div>`;

  if (b) {
    const libres = creneauxTexte(b);
    h += `<div class="jlegende">
      <span><b class="mono">${b.travail} h</b> de travail placé</span>
      ${b.occupe > 0 ? `<span class="occ-t"><b class="mono">${b.occupe} h</b> d'événements</span>` : ""}
      ${b.perdu > 0 ? `<span class="plein-t">${b.perdu} h de travail déplacées ailleurs</span>` : ""}
      <span class="lib-t">Libre : ${libres.length ? libres.join(" · ") : "rien"}</span>
    </div>`;
  }

  h += `<div id="alerte"></div>`;

  // Frise de la journée : événements, travail, temps libre, dans l'ordre.
  if (b) {
    const items = [
      ...b.evenements.map((e) => ({ d: e.plage[0], f: e.plage[1], type: e.urgent ? "urgent" : "ev", ev: e })),
      ...b.blocs.map((x) => ({ d: x.debut, f: x.fin, type: "trav", bloc: x })),
      ...(b.creneaux || []).filter((s2) => s2[1] - s2[0] >= 30).map((s2) => ({ d: s2[0], f: s2[1], type: "libre" })),
    ].sort((x, y) => x.d - y.d);

    h += `<div class="soustitre">La journée, heure par heure</div><div class="frise">`;
    if (scans.length) {
      h += `<div class="ligne sys"><span class="hh">09:00</span>
        <span class="quoi"><b>Rafraîchir le scan CNED</b>
        <a href="https://eformation.cned.fr/my/courses.php" target="_blank" rel="noopener">ouvrir ↗</a></span></div>`;
    }
    h += items.map((x) => {
      const plage = `${enHeure(x.d)} – ${enHeure(x.f)}`;
      const dur = ((x.f - x.d) / 60).toFixed(1).replace(".0", "");
      if (x.type === "libre") {
        return `<div class="ligne libre"><span class="hh">${plage}</span>
          <span class="quoi">Libre · ${dur} h</span></div>`;
      }
      if (x.type === "trav") {
        const e = x.bloc.etape;
        const part = Math.round(((x.f - x.d) / 60 / e.h) * 100);
        return `<label class="ligne trav${x.bloc.retard ? " retard" : ""}" style="--c:${e.g.c}">
          <span class="hh">${plage}</span>
          <span class="quoi"><input type="checkbox" class="cb" data-cb="${e.id}"${canEdit ? "" : " disabled"}>
            <b>${esc(e.n)}</b> <em>${esc(e.row.n)}</em>
            <span class="part">${dur} h sur ${e.h} h${part < 100 ? ` · ${part} % de l'étape` : ""}</span>
            ${x.bloc.retard ? `<span class="lt">rattrapage</span>` : ""}
            ${e.row.url ? `<a href="${e.row.url}" target="_blank" rel="noopener">cours ↗</a>` : ""}
          </span></label>`;
      }
      const e = x.ev;
      return `<div class="ligne ${x.type}"><span class="hh">${plage}</span>
        <span class="quoi"><b>${esc(e.titre || e.title)}</b>
          ${e.urgent ? `<span class="urg">urgent</span>` : ""}
          ${e.lien ? `<a href="${esc(e.lien)}" target="_blank" rel="noopener">ouvrir ↗</a>` : ""}
          ${canEdit ? `<button class="btn mini" data-del="${e.id}">✕</button>` : ""}
        </span></div>`;
    }).join("");
    h += `</div>`;
  }

  if (plan.manques.length) {
    const tot = totalManque(plan.manques);
    h += `<div class="soustitre">Ne rentre pas dans le planning</div>
      <div class="impossible"><b>${tot} h</b> sur ${plan.manques.length} étape${plan.manques.length > 1 ? "s" : ""}
        ne trouvent pas de place avant leur échéance.</div>
      <div class="queue">` + plan.manques.slice(0, 5).map((m) => `
        <div class="qitem" style="--c:var(--late)"><span class="qbody">
          <span class="qtitle">${esc(m.etape.row.n)} · ${esc(m.etape.n)}</span>
          <span class="qmeta"><span class="lt">${m.h} h sans créneau</span>
            <span>échéance ${fmtD(m.ech)}</span></span></span>
          ${canEdit ? `<button class="btn" data-tard="${m.etape.id}">Remettre à plus tard</button>` : ""}
        </div>`).join("") + `</div>`;
  }

  $("daypanel").innerHTML = h;
}

/* ═════════ AJOUT D'UN ÉVÉNEMENT ═════════ */
function nouvelEvenement() {
  return {
    id: "e" + Date.now().toString(36),
    titre: $("evT").value.trim(),
    date: $("evD").value,
    debut: $("evH").value,
    fin: $("evF").value,
    lien: $("evL").value.trim(),
    urgent: $("evU").checked,
  };
}
function baseplan() {
  return { etapes: ALL, done, evenements: events, capacites, reports, maintenant: NOW, fin: FIN_ANNEE };
}
function verifier() {
  const ev = nouvelEvenement();
  const zone = $("alerte");
  if (!ev.date || !ev.debut || !ev.fin || !zone) return null;
  const d = duree(ev);
  if (d <= 0) {
    zone.innerHTML = `<div class="impossible">L'heure de fin doit suivre l'heure de début.</div>`;
    return null;
  }
  const t = testerAjout(baseplan(), ev);
  zone.innerHTML = t.possible
    ? `<div class="ok-zone">Ça rentre. ${t.deplace > 0
        ? `<b>${t.deplace} h</b> de travail se reportent sur les jours suivants, sans faire sauter d'échéance.`
        : `Ce créneau ne croise aucun travail prévu.`}</div>`
    : `<div class="impossible">
        <b>Ça ne rentre pas.</b> ${t.deplace > 0 ? `<b>${t.deplace} h</b> de travail seraient chassées de ce jour, ` : ""}
        et <b>${t.supplement} h</b> ne retrouveraient de place nulle part avant leur échéance
        (${t.manqueApres} h au total).
        <div class="zbtn"><button class="btn" id="forcer">Ajouter quand même et décaler</button></div>
      </div>`;
  const f = $("forcer");
  if (f) f.onclick = () => ajouter(true);
  return t;
}
function ajouter(force) {
  if (!canEdit) return;
  const ev = nouvelEvenement();
  if (!ev.titre || !ev.date || duree(ev) <= 0) return;
  const t = testerAjout(baseplan(), ev);
  if (!t.possible && !force) { verifier(); return; }
  events.push(ev);
  events.sort((a, b) => (a.date + (a.debut || "")).localeCompare(b.date + (b.debut || "")));
  log(`a ajouté « ${ev.titre} » le ${new Date(ev.date + "T00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} de ${ev.debut} à ${ev.fin}`);
  saveEvents();
  $("evT").value = ""; $("evL").value = "";
  const z = $("alerte"); if (z) z.innerHTML = "";
  calSel = new Date(ev.date + "T00:00");
  renderAll();
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
    `<div class="captot">Soit <b class="mono">${total.toFixed(1).replace(".0","")} h</b> de travail par semaine.
      Le reste de la journée (${"08:00"}–${"22:00"}) apparaît comme temps libre pour ton entourage.</div>`;
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

/** Densité du planning sur les `n` prochains jours. */
function densite(n) {
  let cap = 0, trav = 0, i = 0;
  for (const j of plan.jours.values()) {
    if (i++ >= n) break;
    cap += j.cap;
    trav += j.travailPose || 0;
  }
  return { cap, trav, libre: Math.max(0, cap - trav), pc: cap ? Math.round((trav / cap) * 100) : 0 };
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
        déjà prise. Ça se desserre ensuite — il reste <b>${Math.round(large.libre)} h</b> de marge
        sur huit semaines.`;
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

/* ═════════ PROFIL : NOM ET VISIBILITÉ ═════════ */
function renderProfil() {
  const box = $("profilBox");
  if (!box || !vue) return;
  const url = location.origin + "?profil=" + vue.slug;
  if (!canEdit) {
    box.innerHTML = `<p class="aide">Tu consultes le planning de <b>${esc(vue.nom)}</b>
      (<span class="mono">@${esc(vue.slug)}</span>), partagé publiquement.</p>`;
    return;
  }
  box.innerHTML = `
    <div class="champ" style="max-width:320px;margin-bottom:.6rem">
      <label class="fl" for="pfNom">Nom affiché</label>
      <input id="pfNom" type="text" maxlength="40" value="${esc(vue.nom)}">
    </div>
    <div class="visi">
      <label class="opt${vue.public ? " on" : ""}">
        <input type="radio" name="visi" value="public"${vue.public ? " checked" : ""}>
        <span><b>Public</b><em>N'importe qui peut consulter ton planning, sans compte.
          Ton profil apparaît sur la page d'accueil.</em></span></label>
      <label class="opt${vue.public ? "" : " on"}">
        <input type="radio" name="visi" value="prive"${vue.public ? "" : " checked"}>
        <span><b>Privé</b><em>Toi seul y as accès. Le profil disparaît de la page
          d'accueil et le lien direct ne montre plus rien.</em></span></label>
    </div>
    ${vue.public ? `<div class="lienpartage">
      <span class="fl">Lien à partager</span>
      <div class="lp"><code>${esc(url)}</code>
        <button class="btn" id="copierLien">Copier</button></div>
    </div>` : ""}`;

  $("pfNom").onchange = async (e) => {
    const nom = e.target.value.trim().slice(0, 40);
    if (!nom || nom === vue.nom) return;
    const { error } = await sb.from("ciel_profiles").update({ nom }).eq("id", vue.id);
    if (!error) { vue.nom = nom; $("titreProfil").textContent = "Mon planning"; renderProfil(); }
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

/* ═════════ AUTHENTIFICATION ═════════ */
function montrer(ecran) {
  ["ecranAuth", "ecranProfils", "appli"].forEach((k) => { const e = $(k); if (e) e.hidden = k !== ecran; });
}
function messageAuth(txt, ok) {
  const m = $("authMsg");
  m.className = "authmsg " + (ok ? "ok" : "err");
  m.textContent = txt;
  m.hidden = !txt;
}
async function chargerProfils() {
  const { data } = await sb.from("ciel_profiles").select("id,slug,nom,public").eq("public", true).order("nom");
  const l = data || [];
  $("listeProfils").innerHTML = l.length
    ? l.map((p) => `<a class="profil" href="?profil=${encodeURIComponent(p.slug)}">
        <span class="pav">${esc(p.nom.slice(0, 2).toUpperCase())}</span>
        <span><b>${esc(p.nom)}</b><em>@${esc(p.slug)}</em></span></a>`).join("")
    : `<p class="muted">Aucun planning public pour l'instant.</p>`;
}
async function chargerProfil(slug) {
  let q = sb.from("ciel_profiles").select("id,slug,nom,public");
  q = slug ? q.eq("slug", slug) : q.eq("id", session.user.id);
  const { data } = await q.maybeSingle();
  return data;
}
async function ouvrir(profil) {
  vue = profil;
  canEdit = estMoi();
  const { data: st } = await sb.from("ciel_state").select("data").eq("user_id", profil.id).maybeSingle();
  appliquerEtat(st ? st.data : {});
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
  $("titreProfil").textContent = canEdit ? "Mon planning" : "Planning de " + profil.nom;
  $("robar").hidden = canEdit;
  $("quiSuisJe").innerHTML = session
    ? `<span class="moi">${esc(session.user.email)}</span><button class="btn" id="deco">Se déconnecter</button>`
    : `<a class="btn" href="?">Se connecter</a>`;
  const dd = $("deco");
  if (dd) dd.onclick = async () => {
    await sb.auth.signOut();
    session = null; moi = null; vue = null; canEdit = false;
    history.replaceState(null, "", location.pathname);
    await demarrer();
  };
  montrer("appli");
  buildGantt(); buildAcc();
  $("evD").value = isoJour(new Date(NOW));
  renderAll();
  setSync("ok", canEdit ? "mode édition" : "lecture publique");
}

async function demarrer() {
  tickClock();
  await sb.auth.recupererDepuisUrl();
  const { data: { session: s } } = await sb.auth.getSession();
  session = s;
  const slug = new URLSearchParams(location.search).get("profil");
  if (slug) {
    const p = await chargerProfil(slug);
    if (p) return ouvrir(p);
    montrer("ecranProfils"); chargerProfils(); return;
  }
  if (session) {
    moi = await chargerProfil(null);
    if (moi) return ouvrir(moi);
  }
  montrer("ecranAuth");
  chargerProfils();
}

/* onglets d'authentification */
document.querySelectorAll("[data-auth]").forEach((b) => b.addEventListener("click", () => {
  const m = b.dataset.auth;
  document.querySelectorAll("[data-auth]").forEach((x) => x.setAttribute("aria-selected", x === b));
  ["formConnexion", "formInscription", "formOubli"].forEach((f, i) =>
    ($(f).hidden = ["connexion", "inscription", "oubli"][i] !== m));
  messageAuth("");
}));

$("formInscription").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("insEmail").value.trim().toLowerCase();
  const mdp = $("insMdp").value;
  const nom = $("insNom").value.trim();
  if (mdp.length < 8) return messageAuth("Le mot de passe doit faire au moins 8 caractères.");
  messageAuth("Création du compte…", true);
  const { data, error } = await sb.auth.signUp({
    email, password: mdp,
    options: { data: { nom: nom || email.split("@")[0] }, emailRedirectTo: location.origin },
  });
  if (error) {
    const dup = /already|exists|registered/i.test(error.message);
    return messageAuth(dup
      ? "Un compte existe déjà avec cette adresse. Utilise « Connexion », ou « Mot de passe oublié »."
      : error.message);
  }
  if (data.session) { messageAuth(""); await demarrer(); return; }
  messageAuth("Compte créé. Ouvre le courriel de confirmation pour activer ton accès.", true);
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
  await demarrer();
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
    montrer("ecranAuth");
    document.querySelector('[data-auth="nouveau"]')?.click();
    $("formConnexion").hidden = true; $("formInscription").hidden = true; $("formOubli").hidden = true;
    $("formNouveau").hidden = false;
    messageAuth("Choisis ton nouveau mot de passe.", true);
  }
});
$("formNouveau").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mdp = $("nouMdp").value;
  if (mdp.length < 8) return messageAuth("Au moins 8 caractères.");
  const { error } = await sb.auth.updateUser({ password: mdp });
  if (error) return messageAuth(error.message);
  messageAuth("Mot de passe changé.", true);
  setTimeout(() => (location.href = "?"), 900);
});

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
$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]"); if (!b) return;
  document.querySelectorAll("#tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
  document.querySelectorAll("section[data-panel]").forEach((s) => (s.hidden = s.dataset.panel !== b.dataset.tab));
  if (b.dataset.tab === "cal") renderCal();
  if (b.dataset.tab === "curve") renderCurve();
  if (b.dataset.tab === "regl") { renderCapacites(); renderProfil(); }
  if (b.dataset.tab === "dispo") renderDispo();
});
document.addEventListener("change", (e) => {
  if (painting) return;
  const cb = e.target.closest("input[data-cb]");
  if (cb) {
    if (!canEdit) { cb.checked = !cb.checked; return; }
    const s = byId[cb.dataset.cb], on = cb.checked;
    const item = cb.closest(".qitem");
    const appliquer = () => {
      if (on) done[s.id] = new Date(NOW).toISOString(); else delete done[s.id];
      log(`${on ? "a terminé" : "a rouvert"} : ${s.row.n} · ${s.n} (${s.h} h)`);
      saveProgress(); renderAll();
    };
    if (item && on) { item.classList.add("going"); setTimeout(appliquer, 260); } else appliquer();
    return;
  }
  const gr = e.target.closest("input[data-gr]");
  if (gr && canEdit) {
    const v = parseFloat(gr.value), s = byId[gr.dataset.gr];
    if (isNaN(v)) delete grades[gr.dataset.gr];
    else grades[gr.dataset.gr] = Math.max(0, Math.min(20, v));
    log(isNaN(v) ? `a effacé la note de ${s.n}` : `a saisi ${grades[gr.dataset.gr]}/20 — ${s.n}`);
    saveGrades(); renderGrades();
  }
});

setInterval(() => { tickClock(); if (vue) renderAll(); }, 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { tickClock(); if (vue) renderAll(); }
});

demarrer();
