# Hours App

Application web Node.js/Express pour suivre les heures de travail par mois, avec authentification locale, stockage SQLite et export CSV.

## Fonctionnalites

- Creation de compte et connexion via mot de passe.
- Saisie d'une journee de travail avec:
  date, heure d'arrivee, heure de depart, pause dejeuner et commentaire.
- Calcul automatique des heures travaillees.
- Calcul des ecarts par rapport a une cible journaliere de `7h00`.
- Affichage des totaux hebdomadaires et du total mensuel.
- Modification et suppression d'une journee existante.
- Export CSV du mois selectionne.
- Plusieurs themes visuels persistants en `localStorage`.
- Repli/deroulement de la zone de saisie et des semaines dans le tableau.

## Stack technique

- Node.js
- Express
- EJS
- SQLite via `better-sqlite3`
- CSS/JS statiques servis depuis `public/`

## Prerequis

- Node.js 20 ou plus recent recommande
- npm

## Installation

```bash
npm install
```

## Lancement en local

Le projet n'expose pas encore de script `npm start`. Le lancement se fait directement avec Node:

```bash
node server.js
```

Application disponible sur:

```text
http://localhost:3002
```

## Variables d'environnement

Variables supportees par l'application:

- `PORT`: port HTTP de l'application. Par defaut `3002`.
- `DB_PATH`: chemin du fichier SQLite principal. Par defaut `data/hours.db`.
- `NODE_ENV`: si egal a `production`, le cookie de session est marque `secure`.

Exemple PowerShell:

```powershell
$env:PORT="3002"
$env:DB_PATH="data/hours.db"
node server.js
```

## Donnees et stockage

L'application utilise SQLite avec deux niveaux de stockage:

- Base principale: utilisateurs et authentification dans `data/hours.db`.
- Bases utilisateur: une base SQLite distincte par utilisateur dans `data/users/`.

Au demarrage, l'application:

- cree automatiquement les dossiers necessaires dans `data/`
- applique le schema de base
- execute certaines migrations defensives sur les bases existantes

## Structure de base

### Table `users`

Contient:

- `username`
- `password_salt`
- `password_hash`
- `created_at`
- `updated_at`

### Table `work_entries`

Contient:

- `work_date`
- `arrival_time`
- `departure_time`
- `lunch_break_minutes`
- `worked_minutes`
- `comment_text`
- `created_at`
- `updated_at`

## Regles de gestion

- Une journee est identifiee par sa date.
- Le depart doit etre strictement apres l'arrivee.
- La pause dejeuner doit etre un entier positif ou nul.
- Le commentaire est limite a `1000` caracteres.
- Les heures travaillees sont calculees ainsi:

```text
worked_minutes = departure - arrival - lunch_break
```

- La cible journaliere est fixee a `7h00` (`420` minutes).
- Si le temps travaille depasse `7h00`, l'ecart est compte comme heures supplementaires.
- Si le temps travaille est inferieur a `7h00`, l'ecart est compte comme recuperation/manque.

## Export CSV

Route:

```text
GET /export.csv?month=YYYY-MM
```

Le fichier exporte contient notamment:

- date
- heure d'arrivee
- heure de depart
- pause
- commentaire
- temps travaille
- heures supplementaires
- temps de recuperation
- statut

Le separateur CSV est `;` et un BOM UTF-8 est ajoute pour une meilleure ouverture dans Excel.

## Authentification et session

- Les mots de passe sont derives avec `crypto.scryptSync`.
- Les sessions sont conservees en memoire dans le processus Node.js.
- Le cookie de session s'appelle `hours_session`.
- La duree de session est de `12 heures`.

Limite a connaitre:

- un redemarrage du serveur invalide les sessions en cours
- ce mecanisme convient pour un usage simple/local, pas pour une architecture multi-instance

## Docker

### Construire et lancer avec Docker Compose

```bash
docker compose up --build
```

L'application sera accessible sur:

```text
http://localhost:3002
```

Le volume Docker `hours_data` persiste les donnees SQLite.

## Arborescence utile

```text
.
|-- server.js            # serveur Express et routes
|-- db.js                # acces SQLite et gestion des bases utilisateur
|-- schema.sql           # schema principal
|-- views/               # templates EJS
|-- public/              # CSS, JS, images
|-- data/                # base locale SQLite
|-- Dockerfile
`-- docker-compose.yml
```

## Routes principales

- `GET /login`
- `POST /login`
- `GET /register`
- `POST /register`
- `POST /logout`
- `GET /`
- `POST /entries`
- `GET /entries/:workDate/edit`
- `POST /entries/:workDate/delete`
- `GET /export.csv`

## Limitations actuelles

- Pas de script `npm start` ni `npm test`.
- Pas de suite de tests automatisee.
- Sessions stockees uniquement en memoire.
- Application orientee usage mono-instance/local.

## Pistes d'amelioration

- Ajouter des scripts npm (`start`, `dev`, `test`).
- Ajouter des tests de validation metier et de routes.
- Persister les sessions en base ou via un store dedie.
- Ajouter une gestion des roles ou profils utilisateur.
- Ajouter des sauvegardes/export avancees.
