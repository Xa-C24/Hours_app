# Commandes utiles

Ce fichier regroupe des commandes PowerShell utiles a executer depuis la racine du projet `hours-app`.

## Lister les comptes

Afficher les comptes sous forme de tableau :

```powershell
@'
const Database = require("better-sqlite3");
const db = new Database("data/hours.db", { readonly: true });
const rows = db.prepare("SELECT username FROM users ORDER BY username COLLATE NOCASE ASC").all();
console.table(rows);
'@ | node
```

Afficher seulement les noms, un par ligne :

```powershell
@'
const Database = require("better-sqlite3");
const db = new Database("data/hours.db", { readonly: true });
const rows = db.prepare("SELECT username FROM users ORDER BY username COLLATE NOCASE ASC").all();
for (const row of rows) {
  console.log(row.username);
}
'@ | node
```

## Reinitialiser le mot de passe d'un compte

Exemple pour mettre le mot de passe `xatest` au compte `xatest` :

```powershell
@'
const crypto = require("crypto");
const Database = require("better-sqlite3");
const db = new Database("data/hours.db");
const username = "xatest";
const password = "xatest";
const saltHex = crypto.randomBytes(16).toString("hex");
const hashHex = crypto.scryptSync(password, saltHex, 64).toString("hex");
db.prepare("UPDATE users SET password_salt = ?, password_hash = ? WHERE username = ?").run(saltHex, hashHex, username);
console.log(`Mot de passe mis a jour pour ${username}`);
'@ | node
```

## Attribuer un code de recuperation

Exemple pour mettre le code `123456` au compte `xatest` :

```powershell
@'
const crypto = require("crypto");
const Database = require("better-sqlite3");
const db = new Database("data/hours.db");
const username = "xatest";
const recoveryCode = "123456";
const saltHex = crypto.randomBytes(16).toString("hex");
const hashHex = crypto.scryptSync(recoveryCode, saltHex, 64).toString("hex");
db.prepare("UPDATE users SET recovery_code_salt = ?, recovery_code_hash = ? WHERE username = ?").run(saltHex, hashHex, username);
console.log(`Code de recuperation mis a jour pour ${username}`);
'@ | node
```

## Supprimer un compte de `hours.db`

Exemple pour supprimer le compte `Jlo` et ses sessions :

```powershell
@'
const Database = require("better-sqlite3");
const db = new Database("data/hours.db");
db.prepare("DELETE FROM sessions WHERE username = ?").run("Jlo");
db.prepare("DELETE FROM users WHERE username = ?").run("Jlo");
console.log("Compte supprime de hours.db");
'@ | node
```

## Supprimer la base utilisateur associee

Chaque base dans `data/users/` est nommee avec le hash SHA-256 du nom utilisateur.

Exemple pour supprimer la base utilisateur de `Jlo` :

```powershell
@'
const fs = require("fs");
const crypto = require("crypto");

const username = "Jlo";
const hash = crypto.createHash("sha256").update(username).digest("hex");
const base = `data/users/${hash}.db`;

for (const file of [base, `${base}-wal`, `${base}-shm`]) {
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    console.log(`Supprime: ${file}`);
  }
}
'@ | node
```

## Supprimer completement un compte

Supprime le compte de `hours.db`, ses sessions et sa base utilisateur.

Exemple pour `Jlo` :

```powershell
@'
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const username = "Jlo";
const db = new Database("data/hours.db");

db.prepare("DELETE FROM sessions WHERE username = ?").run(username);
db.prepare("DELETE FROM users WHERE username = ?").run(username);
db.close();

const hash = crypto.createHash("sha256").update(username).digest("hex");
const base = `data/users/${hash}.db`;

for (const file of [base, `${base}-wal`, `${base}-shm`]) {
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    console.log(`Supprime: ${file}`);
  }
}

console.log(`Suppression terminee pour ${username}`);
'@ | node
```

## Arreter le serveur Node si un fichier SQLite est verrouille

Utile si Windows refuse la suppression d'un fichier `.db`, `.db-wal` ou `.db-shm`.

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
```

## Notes

- Lance ces commandes depuis le dossier racine du projet.
- Ferme les onglets `.db`, `.db-wal` et `.db-shm` dans VS Code avant de supprimer un compte.
- Si un fichier SQLite est verrouille, arrete aussi le serveur Node avant de reessayer.
