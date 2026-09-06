// Referentiel du BTS CIEL 2e annee, releve sur eformation.cned.fr.
// Volumes horaires, situations professionnelles, sequences et evaluations
// tels qu'ils apparaissent dans les pages « Suivez le guide ».

const MONTHS=["Sept","Oct","Nov","Déc","Janv","Fév","Mars","Avr","Mai","Juin"];
const MFULL=["janvier","février","mars","avril","mai","juin","juillet","août",
             "septembre","octobre","novembre","décembre"];
const DOW=["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
const DAY=864e5, TZ="Europe/Paris";
const CNED="https://eformation.cned.fr/course/view.php?id=";
const EXAM=new Date(2027,4,1);           // début estimé de la session 2027

const m3=h=>[["m1","Mission 1",Math.round(h*.36)],["m2","Mission 2",Math.round(h*.34)],
             ["m3","Mission 3",h-Math.round(h*.36)-Math.round(h*.34)]];
const sp=(id,n,h,s,e,u)=>({id,n,s,e,u,steps:m3(h).map(([k,l,hh])=>({id:id+"."+k,n:l,h:hh}))});

const GROUPS=[
 {id:"b1",name:"Bloc 1 — Étude et conception de réseaux",code:"3-0115",c:"var(--b1)",cid:21596,rows:[
   {id:"b1.a1",n:"Activité 1 · Installation et qualification 2.0",s:6,e:9,u:3,steps:[
     {id:"b1.a1.em",n:"Entrée en matière",h:2},{id:"b1.a1.sy",n:"Synthèse d'activité",h:4}]},
   sp("b1.sp6","SP 6 · Évolution et sécurisation d'un SI",41,6,9,4),
   sp("b1.sp7","SP 7 · Gestion d'une base de données",23,9,11,5),
   sp("b1.sp8","SP 8 · Analyse de risque OléoProduct",26,11,13,6),
   {id:"b1.a2",n:"Activité 2 · Accompagnement du client 2.0",s:13,e:17,u:8,steps:[
     {id:"b1.a2.em",n:"Entrée en matière",h:2},{id:"b1.a2.sy",n:"Synthèse d'activité",h:4}]},
   sp("b1.sp9","SP 9 · Projet borne de fluides",22,13,15,9),
   sp("b1.sp10","SP 10 · Audit et sécurisation",26,15,17,10),
   {id:"b1.ev",n:"Évaluations du bloc",s:11,e:18,u:23,steps:[
     {id:"b1.ev.1",n:"Évaluation 1 — auto, 45 min",h:1,dev:1},
     {id:"b1.ev.2",n:"Évaluation 2 — auto, 1 h 30",h:2,dev:1},
     {id:"b1.ev.3",n:"Devoir 3 — personnalisé, 2 h",h:2,dev:1},
     {id:"b1.ev.4",n:"Devoir 4 — personnalisé",h:2,dev:1},
     {id:"b1.ev.5",n:"Évaluation 5 — auto, 45 min",h:1,dev:1},
     {id:"b1.ev.6",n:"Évaluation 6 — auto, 1 h 30",h:2,dev:1},
     {id:"b1.ev.7",n:"Devoir 7 — personnalisé",h:2,dev:1},
     {id:"b1.ev.8",n:"Devoir 8 — personnalisé",h:2,dev:1}]},
 ]},
 {id:"phy",name:"Sciences physiques — Séquences 13 → 21",code:"3-0115",c:"var(--phy)",cid:21596,rows:[
   {id:"phy.a",n:"Séq. 13–14 · Lignes de transmission, fibre",s:6,e:9,u:13,steps:[
     {id:"phy.s13",n:"Séq. 13 · Les lignes de transmission",h:10},
     {id:"phy.s14",n:"Séq. 14 · La fibre optique",h:10}]},
   {id:"phy.b",n:"Séq. 15–16 · Mesure, système bouclé",s:9,e:12,u:15,steps:[
     {id:"phy.s15",n:"Séq. 15 · Chaîne de mesure, actionneurs",h:10},
     {id:"phy.s16",n:"Séq. 16 · Performance d'un système bouclé",h:10}]},
   {id:"phy.c",n:"Séq. 17–18 · Traitement numérique",s:12,e:15,u:17,steps:[
     {id:"phy.s17",n:"Séq. 17 · Traitement numérique",h:10},
     {id:"phy.s18",n:"Séq. 18 · Chaîne de transmission",h:10}]},
   {id:"phy.d",n:"Séq. 19–21 · Bande de base, porteuse, antennes",s:14,e:17,u:19,steps:[
     {id:"phy.s19",n:"Séq. 19 · Transmission en bande de base",h:10},
     {id:"phy.s20",n:"Séq. 20 · Transmission par fréquence porteuse",h:10},
     {id:"phy.s21",n:"Séq. 21 · Les antennes",h:10}]},
 ]},
 {id:"b2",name:"Bloc 2 — Exploitation et maintenance",code:"3-0215",c:"var(--b2)",cid:21597,rows:[
   {id:"b2.a1",n:"Activité 1 · Exploitation et MCO 2.0",s:0,e:2,u:3,steps:[
     {id:"b2.a1.em",n:"Entrée en matière",h:2},{id:"b2.a1.sy",n:"Synthèse d'activité",h:4}]},
   sp("b2.sp6","SP 6 · Objets connectés en entreprise",41,0,2,4),
   sp("b2.sp7","SP 7 · Gestion des incidents",41,6,9,5),
   sp("b2.sp8","SP 8 · Sécurité avancée avec Stormshield",41,9,12,6),
   {id:"b2.a2",n:"Activité 2 · Gestion de projet et d'équipe",s:12,e:18,u:8,steps:[
     {id:"b2.a2.em",n:"Entrée en matière",h:2},{id:"b2.a2.sy",n:"Synthèse d'activité",h:4}]},
   sp("b2.sp9","SP 9 · Outils collaboratifs dans le Cloud",46,12,16,9),
   sp("b2.sp10","SP 10 · Gestion de projet, tests unitaires",41,16,18,10),
   {id:"b2.ev",n:"Évaluations du bloc",s:9,e:18,u:13,steps:[
     {id:"b2.ev.1",n:"Évaluation 1 — auto, 45 min",h:1,dev:1},
     {id:"b2.ev.2",n:"Devoir 2 — personnalisé, 4 h",h:4,dev:1},
     {id:"b2.ev.3",n:"Évaluation 3 — auto, 1 h",h:1,dev:1},
     {id:"b2.ev.4",n:"Devoir 4 — ouvert le 15/11",h:4,dev:1,date:"15/11"}]},
 ]},
 {id:"b3",name:"Bloc 3 — Valorisation donnée & cybersécurité",code:"3-0315",c:"var(--b3)",cid:21598,rows:[
   {id:"b3.a1",n:"Activité 1 · Valorisation de la donnée 2.0",s:0,e:2,u:3,steps:[
     {id:"b3.a1.em",n:"Entrée en matière",h:2},{id:"b3.a1.sy",n:"Synthèse d'activité",h:4}]},
   sp("b3.sp6","SP 6 · Superviser une infrastructure Cloud",51,0,2,4),
   {id:"b3.a2",n:"Activité 2 · Développement de solutions logicielles",s:6,e:13,u:6,steps:[
     {id:"b3.a2.em",n:"Entrée en matière",h:2},{id:"b3.a2.sy",n:"Synthèse d'activité",h:4}]},
   sp("b3.sp7","SP 7 · Score gaming platform",40,6,9,7),
   sp("b3.sp8","SP 8 · Smart city, zones de chaleur",42,9,13,8),
   {id:"b3.a3",n:"Activité 3 · Conduite de projet",s:12,e:17,u:10,steps:[
     {id:"b3.a3.em",n:"Entrée en matière",h:2},{id:"b3.a3.sy",n:"Synthèse d'activité",h:4}]},
   sp("b3.sp9","SP 9 · Contrôle d'accès à un local industriel",80,12,17,11),
   {id:"b3.ev",n:"Évaluations du bloc",s:9,e:18,u:14,steps:[
     {id:"b3.ev.1",n:"Évaluation 1 — auto, 45 min",h:1,dev:1},
     {id:"b3.ev.2",n:"Devoir 2 — personnalisé, 2 h",h:2,dev:1,date:"30/11"},
     {id:"b3.ev.3",n:"Évaluation 3 — auto, 1 h",h:1,dev:1},
     {id:"b3.ev.4",n:"Devoir 4 — personnalisé, 3 h",h:3,dev:1,date:"30/11"}]},
 ]},
 {id:"gen",name:"Enseignement général",code:"",c:"var(--gen)",rows:[
   {id:"gen.ma",n:"Mathématiques · M8 → M13",s:0,e:12,code:"3-1215",cid:21599,u:3,steps:[
     {id:"ma.em",n:"Entrée en matière",h:2},
     {id:"ma.m8",n:"M8 · Équations différentielles du 1er ordre",h:10},
     {id:"ma.m9",n:"M9 · Suites numériques",h:9},
     {id:"ma.m10",n:"M10 · Transformation en Z",h:10},
     {id:"ma.m11",n:"M11 · Transformée de Fourier discrète",h:10},
     {id:"ma.m12",n:"M12 · Probabilités 2",h:9},
     {id:"ma.m13",n:"M13 · Logiciels de traitement de données",h:10},
     {id:"ma.ev1",n:"Évaluation 1 — auto, 2 h 15",h:2,dev:1},
     {id:"ma.ev3",n:"Évaluation 3 — auto, 1 h 40",h:2,dev:1},
     {id:"ma.ev5",n:"Devoir 5 — oral, RDV professeur",h:3,dev:1}]},
   {id:"gen.cg",n:"Culture G · « Le vrai du faux »",s:0,e:16,code:"3-0187",cid:557,u:3,steps:[
     {id:"cg.q",n:"Quiz d'entrée sur le thème",h:1},
     {id:"cg.t1",n:"Thème · Activités 1 à 4",h:22},
     {id:"cg.e1",n:"L'épreuve en question · Activités 1 et 2",h:12},
     {id:"cg.t2",n:"Thème · Activités 5 à 7",h:20},
     {id:"cg.e2",n:"L'épreuve en question · Activité 3",h:12},
     {id:"cg.ev2",n:"Évaluation 2 — écrite",h:3,dev:1},
     {id:"cg.ev4",n:"Évaluation 4 — écrite, entraînement",h:4,dev:1}]},
   {id:"gen.an",n:"Anglais · devoirs 1 et 2",s:6,e:14,code:"3-AN85",cid:3273,u:2,steps:[
     {id:"an.c",n:"Parcourir la rubrique Cours",h:12},
     {id:"an.e",n:"Entraînements en autocorrection",h:14},
     {id:"an.d1",n:"Devoir 1 — écrit + audio (exige le stage)",h:6,dev:1},
     {id:"an.rdv",n:"Réserver le créneau correcteur du devoir 2",h:1,dev:1},
     {id:"an.d2",n:"Devoir 2 — oral par téléphone",h:7,dev:1}]},
 ]},
 {id:"stg",name:"Expérience en milieu professionnel",code:"3-ST14",c:"var(--stg)",cid:19099,rows:[
   {id:"stg.r",n:"Recherche et validation du stage",s:0,e:2,u:5,steps:[
     {id:"stg.fr",n:"Lire la feuille de route",h:1},
     {id:"stg.e1",n:"Étape 1 · Trouver son stage",h:14},
     {id:"stg.e2",n:"Étape 2 · Faire valider son départ",h:3}]},
   {id:"stg.f",n:"Stage en entreprise · 6 à 8 semaines",s:2,e:6,u:7,steps:[
     {id:"stg.e3",n:"Étape 3 · Réaliser son stage",h:6},
     {id:"stg.e4",n:"Étape 4 · Faire attester la fin de stage",h:2},
     {id:"stg.val",n:"Valoriser son expérience (notes pour E6)",h:6}]},
 ]},
 {id:"exa",name:"Préparation aux épreuves",code:"",c:"var(--exa)",rows:[
   {id:"exa.e6",n:"E6 · Valorisation du stage — oral 1 h",s:10,e:17,code:"3-E615",cid:21602,u:2,steps:[
     {id:"e6.d",n:"Le dossier à construire",h:16},
     {id:"e6.p",n:"Posture et techniques",h:6},
     {id:"e6.pr",n:"Entraînement à la présentation",h:9},
     {id:"e6.q",n:"Entraînement au questionnement du jury",h:9}]},
   {id:"exa.e4",n:"E4 · Étude d'un système — écrit 6 h",s:15,e:19,code:"3-E415",cid:21600,u:2,steps:[
     {id:"e4.s",n:"Stratégie pour réussir",h:3},
     {id:"e4.ai",n:"Annale informatique 2025 + corrigé",h:8},
     {id:"e4.ap",n:"Annale sciences physiques 2025 + corrigé",h:5},
     {id:"e4.d1",n:"Devoir n°1 — Domaine professionnel",h:8,dev:1},
     {id:"e4.d2",n:"Devoir n°2 — Sciences physiques",h:6,dev:1}]},
   {id:"exa.e5",n:"E5 · Analyse de dossier — oral",s:16,e:19,code:"3-E515",cid:21601,u:2,steps:[
     {id:"e5.p",n:"Préparation à l'épreuve orale",h:8},
     {id:"e5.d",n:"Analyse du dossier — production 4 h",h:8,dev:1},
     {id:"e5.rdv",n:"Prendre RDV et déposer 5 j avant",h:1,dev:1}]},
 ]},
];


export { MONTHS, MFULL, DOW, DAY, TZ, CNED, EXAM, GROUPS };
