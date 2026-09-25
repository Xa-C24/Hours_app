# Hours App

Application de suivi du temps de travail par utilisateur, client et période de paie : interface web responsive, saisie manuelle, chronomètre partagé, calendrier et exports CSV, Excel et PDF.

Documentation alignée sur le code local au **25 septembre 2026**. Une fonctionnalité implémentée n’est pas nécessairement déployée ou vérifiée en production.

## Installation et démarrage

Environnement des dernières vérifications : **Node.js 24.15.0** et npm. La CLI Capacitor 8 exige Node.js 22 minimum ; utiliser une version compatible avec les dépendances verrouillées dans `package-lock.json`.

```powershell
npm ci
npm start
```

`npm ci` télécharge les dépendances et nécessite un accès au registre npm. Sans `DATABASE_URL`, et hors mode production, le stockage utilisé est SQLite.

Adresse par défaut : [http://localhost:3000/login](http://localhost:3000/login). Le serveur écoute sur `0.0.0.0` ; son accessibilité depuis d’autres machines dépend du réseau et du pare-feu.

| Commande | Fonction |
|---|---|
| `npm start` | Démarrage de `server.js` |
| `npm run dev` | Démarrage avec surveillance des fichiers |
| `npm test` | Suite de tests `node --test` |
| `npm run migrate:postgres` | Migration SQLite vers PostgreSQL ; lire les limites ci-dessous avant utilisation |

## Fonctionnalités

- Comptes utilisateurs, connexion, déconnexion et récupération du mot de passe par code.
- Plusieurs clients : création, modification, archivage, restauration et suppression.
- Journées avec arrivée, départ, pause et commentaire ; correction des journées existantes.
- Bureau, télétravail, congés, RTT, arrêt et jours fériés ; combinaisons matin/après-midi.
- Chronomètre partagé : démarrage, pause, reprise et arrêt.
- Brouillons locaux et récupération des derniers horaires du chronomètre.
- Tableau de bord, calendrier, synthèses hebdomadaires, archives et réglages.
- Objectif quotidien configurable, heures supplémentaires et écarts au temps attendu.
- Salaire par client et période de paie.
- Exports CSV, Excel et PDF.
- Styles Premium, Robot, Sega (`retro`) et Moyen Âge (`medieval`), distincts des thèmes de couleur.
- Navigation mobile Accueil / Saisie / Agenda / Archives / Réglages, avant les vues de contenu et au-dessus de la période de paie dans l’agenda.
- Manifeste PWA, service worker et client mobile séparé préparé avec Capacitor.

## Parcours de saisie

1. Se connecter et sélectionner un client.
2. Dans **Saisie**, choisir la date et le type de journée.
3. Utiliser le chronomètre ou **Saisie manuelle / correction**.
4. Enregistrer et attendre la confirmation.
5. Vérifier la journée dans **Agenda**, puis la corriger si nécessaire.

Un brouillon local n’est pas une sauvegarde serveur. Un chronomètre arrêté n’est pas, à lui seul, la preuve qu’une journée est enregistrée.

### Chronomètre partagé

Le serveur conserve un suivi par utilisateur, associé à un client et une date. Il horodate les nouvelles actions.

- La fermeture ou le rechargement d’un onglet ne supprime pas le suivi serveur.
- Les onglets visibles relisent l’état toutes les **5 secondes** et au retour au premier plan.
- Chaque écriture compare un numéro de version. Une action concurrente périmée reçoit un conflit `409` et l’état courant.
- Démarrer, mettre en pause ou arrêter nécessite une connexion. Aucune action hors ligne n’est rejouée automatiquement.
- **Terminer** arrête le suivi puis soumet le formulaire si les horaires sont compatibles. Les validations et confirmations de remplacement restent applicables.
- Les horaires arrêtés restent récupérables après une réponse perdue ou un échec d’enregistrement, jusqu’au prochain démarrage confirmé.
- Un ancien suivi en `sessionStorage` peut être récupéré explicitement si aucun suivi serveur n’existe. Garder l’ancien onglet ouvert jusqu’à cette récupération.
- Un passage à minuit nécessite une correction manuelle : le modèle de journée exige arrivée et départ à la même date.

Le chronomètre utilise la session web ; son API n’est pas intégrée à l’authentification Bearer du client Capacitor.

Voir [la documentation du chronomètre](docs/work-timer.md) pour la mise en service, le stockage et le retour arrière.

### Brouillons et confirmation

Les brouillons sont stockés sur l’appareil, séparément par utilisateur, client et date. Le formulaire déclenche leur sauvegarde avant l’envoi ; il signale une indisponibilité du stockage.

L’envoi ne marque plus immédiatement la journée comme enregistrée. Le message de succès compare les données soumises aux données renvoyées par le serveur. Une entrée serveur existante est prioritaire lors de la restauration des brouillons.

## Règles de gestion

| Règle | Comportement |
|---|---|
| Identité d’une journée | Une entrée par utilisateur, client et date |
| Période de paie | Du 15 du mois précédent au 14 du mois sélectionné inclus |
| Exemple | `2026-10` = 15 septembre–14 octobre 2026 |
| Temps travaillé | Départ − arrivée − pause, en minutes |
| Horaires | `HH:MM` ; départ strictement après l’arrivée, sans passage à minuit |
| Pause | Entier positif ou nul ; ne peut pas rendre la durée travaillée négative |
| Commentaire | 1 000 caractères maximum |
| Objectif quotidien | 7 h par défaut, configurable |
| Demi-journée travaillée | Objectif ajusté à la fraction travaillée ; pause forcée à zéro pour une fraction de 0,5 |
| Absence complète | Pas d’heures travaillées |

Les indicateurs d’heures supplémentaires et de récupération suivent les règles de l’application. Ils ne constituent pas un moteur complet de paie ou de règles conventionnelles.

## Architecture

Node.js, Express 5 et EJS pour le serveur et les pages ; JavaScript et CSS pour l’interface ; `better-sqlite3` ou `pg` pour le stockage ; ExcelJS et PDFKit pour les exports.

```text
server.js                     Serveur web, authentification et routes métier
db.js                         Sélection de l’adaptateur de stockage
db-sqlite.js                  SQLite : authentification et bases utilisateur
db-postgres.js                PostgreSQL
settings.js                   Valeurs par défaut et validation des réglages
routes/api-v1.js              API mobile
routes/work-timer.js           API du chronomètre web
services/                     Validation métier et configuration PostgreSQL
views/                        Templates EJS
public/                       Styles, scripts, PWA et ressources web
mobile/                       Client distinct servi sous /mobile/
ios/                          Projet iOS Capacitor
scripts/                      Migration
test/                         Tests automatisés
docs/work-timer.md            Exploitation du chronomètre
excel-export.js               Exports Excel
pdf-export.js                 Exports PDF
```

Les adaptateurs contiennent les initialisations de schéma exécutées. Un fichier SQL isolé ne décrit pas nécessairement tout le schéma courant.

## Configuration

| Variable | Usage | Défaut ou contrainte |
|---|---|---|
| `PORT` | Port HTTP | `3000` dans `server.js` |
| `NODE_ENV` | Mode d’exécution | `production` impose PostgreSQL et les cookies sécurisés |
| `DATABASE_URL` | Connexion PostgreSQL | Prioritaire sur SQLite ; obligatoire en production |
| `DB_PATH` | Base SQLite principale | `data/hours.db`, uniquement en mode SQLite |
| `SQLITE_DB_PATH` | Source du script de migration | `data/hours.db` ; distinct de `DB_PATH` |
| `NODE_EXTRA_CA_CERTS` | Autorité de certification additionnelle pour Node.js | Facultatif, notamment pour un certificat PostgreSQL privé |

Exemple local sans secret :

```powershell
$env:NODE_ENV = "development"
$env:PORT = "3002"
$env:DB_PATH = "data/hours.db"
npm start
```

Dans cet exemple, ouvrir [http://localhost:3002/login](http://localhost:3002/login). Si `DATABASE_URL` est déjà définie, elle reste prioritaire.

`npm start` ne charge pas automatiquement un fichier `.env`. Fournir les variables par l’environnement d’exécution. Ne pas conserver une chaîne de connexion réelle dans le dépôt, une URL partagée ou l’historique du terminal.

### Connexion PostgreSQL

L’adaptateur applicatif vérifie les certificats TLS des hôtes distants. Les noms locaux explicitement reconnus peuvent utiliser une connexion sans TLS ; une option TLS explicite active la vérification. Les options désactivant cette vérification sont rejetées.

Cette protection ne s’applique pas encore au script de migration, qui possède sa propre configuration.

## Stockage et sauvegarde

### SQLite

- Base principale : utilisateurs, sessions, jetons mobiles et chronomètres.
- Bases utilisateur : fichiers distincts dans le sous-dossier `users/`, à côté de la base principale ; clients, journées, salaires et réglages.
- Création des tables et migrations défensives lors du chargement de l’adaptateur.

Une sauvegarde complète doit inclure la base principale **et** les bases utilisateur. SQLite utilise WAL : employer une procédure de sauvegarde cohérente, ou arrêter les écritures avant copie. Copier seulement un `.db` pendant des écritures ne garantit pas une sauvegarde complète.

### PostgreSQL

La base est sélectionnée par `DATABASE_URL`. Les données métier sont délimitées par utilisateur et client. L’initialisation du schéma intervient à la première utilisation de l’adaptateur.

### Tables principales

| Table | Contenu |
|---|---|
| `users` | Comptes, dérivés de mots de passe et codes de récupération |
| `sessions` | Sessions web persistantes et expiration |
| `mobile_auth_tokens` | Empreintes des jetons mobiles, expiration et révocation |
| `clients` | Entreprises, coordonnées, logos et archivage |
| `work_entries` | Journées, types, horaires, pauses et commentaires |
| `pay_period_salaries` | Salaires par période et client |
| `settings` | Réglages utilisateur |
| `work_timers` | Utilisateur, version et état JSON du chronomètre |

Sauvegarder avant changement de version et vérifier la restauration. Aucun dispositif de sauvegarde externe n’est configuré par ce README.

## Authentification et sécurité

- Mots de passe dérivés avec `crypto.scryptSync` et sel.
- Sessions web en base, valables **12 heures** : un redémarrage du processus ne les efface pas à lui seul.
- Cookie `hours_session` : `HttpOnly`, `SameSite=Lax`, `Secure` en production.
- Protection CSRF des POST web, y compris les actions du chronomètre.
- Limitation des tentatives de connexion, inscription et récupération. Les compteurs sont en mémoire du processus, sans partage entre instances.
- Jetons mobiles Bearer valables **30 jours** ; seule leur empreinte est conservée en base, avec possibilité de révocation.
- Contrôle d’accès aux clients et données selon l’utilisateur connecté.

En production, utiliser HTTPS et vérifier le proxy : Express utilise `trust proxy = 1`. Ces mécanismes présents dans le code ne remplacent pas un audit de sécurité complet.

## Routes utiles

| Route | Fonction |
|---|---|
| `GET /healthz` | Santé applicative et accès au stockage |
| `GET/POST /login`, `/register`, `/forgot-password` | Authentification et récupération |
| `POST /logout` | Déconnexion web |
| `GET /` | Interface web |
| `POST /clients` | Création de client |
| `POST /clients/:clientId/update` | Modification du client |
| `POST /clients/:clientId/archive`, `/clients/:clientId/restore`, `/clients/:clientId/delete` | Archivage, restauration et suppression |
| `POST /entries` | Création ou correction d’une journée |
| `GET /entries/:workDate/edit` | Ouverture en correction |
| `POST /entries/:workDate/delete` | Suppression d’une journée |
| `GET /api/entries/by-date`, `/api/entries/month` | Chargement des journées |
| `GET/POST /api/settings`, `POST /api/settings/reset` | Réglages |
| `POST /pay-period-salary` | Salaire de la période |
| `GET/POST /work-timer` | État et actions du chronomètre |
| `GET /export.csv`, `/export.xlsx`, `/export.pdf` | Exports |

Les routes métier nécessitent une session. Les paramètres restent soumis aux contrôles du serveur.

### Exports

Exemple : `/export.xlsx?month=2026-10&clientId=1`.

- CSV : période sélectionnée, séparateur `;`, BOM UTF-8 pour Excel.
- Excel et PDF : période sélectionnée ou historique avec `mode=history`.
- Excel/PDF exigent un client explicite et accessible.

Les exports peuvent contenir des données personnelles et salariales : les conserver dans le périmètre autorisé.

### API mobile et Capacitor

L’API `/api/v1` propose `GET /health`, `POST /auth/login`, `POST /auth/logout`, `GET /me`, `GET /clients` et `GET /calendar`.

Les routes protégées utilisent une session web ou un jeton Bearer selon leur usage. `/work-timer` demeure une API web distincte.

Le client `mobile/` utilise une URL distante configurée dans `mobile/js/config.js` en contexte natif et l’origine courante dans le navigateur. Vérifier la destination avant un essai natif avec des données réelles. Capacitor utilise `mobile/` comme `webDir`. La compilation iOS demande l’outillage Apple approprié ; la présence du projet ne signifie pas qu’une version a été publiée.

## PWA et hors ligne

Le service worker met en cache une liste explicite de ressources statiques, pas les pages authentifiées ni les réponses métier.

Les brouillons locaux ne constituent pas une synchronisation hors ligne complète. Enregistrement, chargement des données serveur et actions du chronomètre nécessitent une connexion. Lors d’une mise à jour statique, contrôler la version du cache et la mise à jour du service worker.

## Migration SQLite vers PostgreSQL

Le script `scripts/migrate-sqlite-to-postgres.js` lit SQLite en lecture seule et écrit dans PostgreSQL. Il reprend utilisateurs, sessions, clients, journées, salaires et réglages.

**Ne pas le lancer tel quel sur une destination distante sensible :**

- Il utilise encore `rejectUnauthorized: false` pour TLS distant : le certificat n’est pas vérifié.
- Il ne migre pas actuellement `work_timers` ni `mobile_auth_tokens`.
- La création des clients n’est pas idempotente : une relance peut créer des doublons.
- Il n’existe pas de transaction globale unique couvrant toute la migration.

Avant utilisation : corriger TLS, organiser la reprise des données manquantes, sauvegarder source et destination, puis tester sur une destination isolée. La commande est `npm run migrate:postgres`, avec `SQLITE_DB_PATH` et `DATABASE_URL` fournis de manière sécurisée. Cette documentation ne valide pas une migration en production.

## Docker : configuration à remettre en cohérence

Les fichiers existent, mais **la configuration actuelle ne fournit pas un démarrage fonctionnel complet** :

- Le Dockerfile fixe `NODE_ENV=production`, tandis que Compose ne fournit pas `DATABASE_URL`, obligatoire dans ce mode.
- Le Dockerfile ne copie pas notamment `routes/`, `services/` et `mobile/`, nécessaires aux fonctionnalités actuelles.
- L’image utilise Node.js 20 ; les dernières vérifications locales utilisent Node.js 24.15.0.

Le port prévu est `3002` et le volume `hours_data` est monté sur `/app/data`. Ne pas considérer `docker compose up --build` comme une procédure validée avant correction et essais. Ces fichiers n’ont pas été modifiés lors de cette mise à jour documentaire.

## Tests et limites de validation

```powershell
npm test
```

Dernière exécution vérifiée avant cette mise à jour documentaire : **152 tests réussis**, aucun échec. Ce résultat est daté et ne garantit pas les modifications futures.

La couverture comprend les calculs de journées et demi-journées, périodes et synthèses, exports, brouillons, API mobile, protections de cache, ainsi que transitions, conflits, droits d’accès et pertes de réponse du chronomètre.

Le chronomètre est testé avec SQLite réel en mémoire et des scénarios API isolés. **PostgreSQL réel et le rendu sur téléphone restent à vérifier avant déploiement.** La dernière tentative de navigateur automatisé a échoué au démarrage avec une erreur GPU : les tests ne constituent pas une validation visuelle de bout en bout.

## Avant mise en service

1. Vérifier la base cible, sauvegarder et disposer d’un retour arrière.
2. Résoudre les limites Docker ou migration si ces outils sont utilisés.
3. Exécuter les tests avec les dépendances verrouillées.
4. Vérifier HTTPS, sessions, CSRF et isolation entre deux comptes.
5. Sur téléphone, parcourir les cinq vues dans chaque style.
6. Tester le chrono dans deux onglets : pause, fermeture, reprise, arrêt, erreur réseau et correction.
7. Confirmer la journée dans le calendrier et vérifier un export.

La synchronisation du chrono ne garantit pas toute la cohérence d’un déploiement multi-instance. Les autres écritures concurrentes, les compteurs de tentatives, les sauvegardes et l’exploitation restent à valider dans l’environnement cible.
