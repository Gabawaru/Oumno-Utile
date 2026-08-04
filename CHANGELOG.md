# Journal des modifications

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

## [1.0.0] — 2026-08-04

Première version complète.

### Ajouté
- Cœur métier : calcul monétaire en centimes entiers, TVA conforme EN 16931
  (par taux, sur la somme des bases), franchise en base.
- Générateur **Factur-X** (XML CII / EN 16931) pour factures et avoirs.
- Moteur **PDF from scratch** : writer PDF, parseur TrueType, profil ICC sRGB
  généré, métadonnées XMP PDF/A-3 + schéma d'extension Factur-X, pièce jointe
  `factur-x.xml` (AFRelationship /Data).
- Mise en page A4 : en-tête émetteur, encadré client, tableau paginé, ventilation
  de TVA, mentions légales françaises, cadre de signature pour les devis.
- Base **SQLite native** (`node:sqlite`) avec migrations versionnées.
- API REST : réglages, clients, catalogue, documents (devis / factures / avoirs),
  paiements, statistiques, exports CSV et sauvegarde.
- Cycle de vie des documents avec numérotation légale séquentielle et
  inaltérabilité après émission.
- Conversion devis → facture, création d'avoir, duplication.
- Suivi des règlements (complets / partiels) et passage automatique en « payée ».
- Interface web (SPA vanilla) en français : connexion/création, tableau de bord,
  éditeur de documents, clients, catalogue, paramètres.
- Authentification scrypt, sessions hachées, protection anti-CSRF, anti
  force-brute.
- Suite de tests `node:test` (calcul, Factur-X, PDF, API bout-en-bout).
- Jeu de données de démonstration (`npm run demo`).
- Documentation : README et `docs/CONFORMITE.md`.
