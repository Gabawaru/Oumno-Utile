# Conformité normative et réglementaire

Ce document décrit précisément **ce que Facturier met en œuvre**, les normes
visées, et surtout les **limites** à connaître avant d'utiliser le logiciel en
production. Il est écrit pour être honnête : un outil de facturation touche à des
obligations légales, et mieux vaut savoir exactement où l'on se situe.

## 1. Format Factur-X / EN 16931

Chaque **facture** et **avoir** émis produit un PDF/A-3 contenant le fichier
`factur-x.xml`, au format **UN/CEFACT CII** (Cross-Industry Invoice), suivant la
sémantique **EN 16931-1**.

Éléments générés :

| Élément EN 16931 | Mise en œuvre |
|---|---|
| Identifiant de spécification (BT-24) | `urn:cen.eu:en16931:2017` |
| Numéro de facture (BT-1) | numéro séquentiel figé |
| Type de document (BT-3) | `380` (facture) / `381` (avoir), UNTDID 1001 |
| Date d'émission (BT-2) | format 102 `AAAAMMJJ` |
| Vendeur / acheteur (BG-4 / BG-7) | nom, adresse, SIREN (schemeID 0002), TVA (schemeID VA) |
| Ventilation de TVA (BG-23) | par catégorie et par taux, base + montant |
| Catégorie de TVA (BT-118) | `S` (standard/réduit), `Z` (taux zéro), `E` (exonéré) |
| Motif d'exonération (BT-120) | mention art. 293 B du CGI en franchise |
| Moyen de paiement (BT-81) | UNTDID 4461, IBAN/BIC si renseignés |
| Références (BT-13, BT-25) | bon de commande, facture d'origine (avoir) |
| Totaux (BG-22) | HT, base taxable, TVA, TTC, acompte, net à payer |
| Unités (BT-130) | codes UN/ECE Rec 20 (`HUR`, `DAY`, `MON`, `C62`…) |

**Profil visé : EN 16931 (« EN16931 »)**, le profil « socle » de Factur-X qui
porte l'intégralité des mentions obligatoires.

### Ce qui n'est pas (encore) couvert
- Les **remises / charges au niveau document** (BG-20 / BG-21) ne sont pas
  modélisées : on utilise des lignes à montant négatif, ce qui reste valide mais
  moins riche sémantiquement.
- Pas de gestion multi-devises réelle (l'EUR est utilisé partout).
- Le XML n'est **pas validé** contre les schémas XSD / règles Schematron
  officiels au moment de l'émission. La structure est conforme à la
  spécification, mais une **validation externe** (p. ex. l'outil de la FNFE-MPE
  ou un validateur EN 16931) est recommandée avant un usage réel.

## 2. PDF/A-3

Le PDF est construit pour respecter les exigences structurelles de **PDF/A-3B** :

- version PDF 1.7 ;
- **toutes les polices embarquées** (TrueType `FontFile2`, encodage WinAnsi) ;
- **OutputIntent** `GTS_PDFA1` avec **profil ICC sRGB embarqué** ;
- **métadonnées XMP** non compressées, avec `pdfaid:part=3` / `conformance=B`,
  cohérentes avec le dictionnaire `Info` ;
- **schéma d'extension Factur-X** déclaré dans le XMP (obligatoire en PDF/A pour
  tout schéma non standard) ;
- pièce jointe `factur-x.xml` avec `AFRelationship /Data`, référencée par `/AF`
  au niveau du catalogue et via `/Names /EmbeddedFiles` ;
- identifiant de fichier `/ID` dans le trailer ;
- aucune fonctionnalité interdite (pas de chiffrement, pas de JavaScript, pas de
  contenu externe).

Ces points sont **vérifiés automatiquement** par la suite de tests
(`test/pdf.test.js`) et par un contrôle structurel avec `pypdf`.

### Limite importante
La conformité PDF/A-3 **complète** (niveau atteint par un validateur comme
veraPDF) exige de nombreuses règles fines. Facturier couvre les exigences
structurelles majeures, mais **n'a pas été certifié par veraPDF** dans cet
environnement. Avant un déploiement où la conformité PDF/A stricte est
contractuelle, faites passer un échantillon dans **veraPDF** et le
**validateur Factur-X** de la FNFE-MPE.

## 3. Mentions légales françaises

Générées automatiquement selon le contexte :

- **Identité de l'émetteur** : dénomination, forme juridique, SIREN/SIRET, code
  APE, adresse — sur chaque page.
- **Franchise en base de TVA** : « TVA non applicable, art. 293 B du CGI »
  (paramétrable), portée sur le document et dans le XML (catégorie E).
- **Pénalités de retard** (art. L441-10 du Code de commerce) et **indemnité
  forfaitaire de 40 €** pour frais de recouvrement (art. D441-5).
- **Escompte** (mention configurable).
- **Devis** : gratuité, cadre « Bon pour accord » avec date et signature.
- **Numérotation** : séquentielle, chronologique, **sans rupture**, attribuée à
  l'émission dans la même transaction que le changement de statut. Les documents
  émis sont **inaltérables** ; une correction se fait par **avoir**.

### À compléter selon votre situation
Certaines mentions dépendent de votre cas particulier et doivent être vérifiées :
adhésion à un **centre de gestion agréé**, **assurance professionnelle**
obligatoire pour certaines activités (bâtiment…), **TVA sur les débits**,
autoliquidation, ventes intracommunautaires, etc. Les champs de paramétrage et la
mention libre en pied de page permettent de les ajouter.

## 4. Intégrité et piste d'audit

- Les factures émises ne peuvent être ni modifiées ni supprimées via l'API.
- Une facture ne peut être **annulée** que par l'émission d'un **avoir**.
- Une table `audit_log` conserve les événements clés (émission, changement de
  statut, modification des paramètres).
- Les compteurs de numérotation sont par type de document et par année.

Cette approche répond à l'esprit des obligations d'**inaltérabilité** et de
**conservation**. Elle ne constitue pas à elle seule une conformité au dispositif
« logiciel de caisse » (art. 286 I-3° bis du CGI), qui vise un périmètre distinct
et peut exiger une **attestation ou certification** de l'éditeur.

## 5. Sécurité des données

- Mot de passe haché **scrypt** (sel aléatoire, comparaison à temps constant).
- Sessions opaques stockées **hachées** (SHA-256), cookie `HttpOnly` +
  `SameSite=Strict`, `Secure` derrière un proxy HTTPS.
- Protection **anti-CSRF** (en-tête `X-Requested-With` exigé sur les mutations,
  en complément de `SameSite`).
- **Limitation** des tentatives de connexion (anti force-brute).
- Données stockées **localement** en SQLite ; sauvegarde exportable à tout moment.

À votre charge : le **chiffrement du disque**, les **sauvegardes** régulières et
hors-site, et la mise derrière **TLS** si le service est exposé.

## Résumé

Facturier vise sérieusement la conformité Factur-X / EN 16931 / PDF/A-3 et les
mentions légales françaises, avec des garde-fous d'inaltérabilité. Pour un usage
**commercial en production**, il reste deux étapes de diligence recommandées :

1. **Valider** un échantillon de factures avec veraPDF et le validateur
   Factur-X officiel.
2. **Faire vérifier** par un expert-comptable que les mentions correspondent à
   votre régime précis.
