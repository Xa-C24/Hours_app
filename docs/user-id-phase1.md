# M02 phase 1 — Identifiant de compte permanent

Cette phase ajoute `users.user_id` sans changer les relations par `username`, les
sessions, les routes, les fichiers SQLite par utilisateur ou les contraintes M01.
La version interne 2 des protections SQLite ne désigne pas M02 phase 2.

## Format et conservation

L'identifiant est un UUID au format texte hexadécimal 8-4-4-4-12, exactement 36
caractères ASCII. Le contrôle accepte la casse des UUID historiques, sans la
normaliser. Un UUID déjà attribué n'est jamais régénéré ni corrigé automatiquement.
Les valeurs vides, invalides et les collisions selon la casse bloquent la migration.

PostgreSQL utilise le type natif UUID, NOT NULL, un défaut gen_random_uuid(), une
contrainte unique et un trigger d'immutabilité. PostgreSQL 13 minimum est requis.
Le texte retourné par PostgreSQL peut être en minuscules : la valeur UUID reste
identique. Un contrôle préalable refuse une colonne existante d'un autre type.

SQLite conserve user_id TEXT. Le helper services/user-identity-sqlite.js exécute
l'ajout de colonne, les vérifications, les protections et le remplissage des seuls
NULL dans une transaction immédiate. Il vérifie le résultat avant COMMIT :
mêmes comptes, UUID existants inchangés, UUID valides et uniques.

Les protections SQLite comprennent :
- index unique complet sur user_id COLLATE NOCASE ;
- garde de format à l'insertion et à la mise à jour (type, longueur texte et
  octets, séparateurs, caractères hexadécimaux ; rejet des suffixes NUL) ;
- immutabilité des UUID non NULL, avec comparaison BINARY même si la colonne
  historique utilise NOCASE ;
- interdiction de remplacer un compte avec INSERT OR REPLACE ;
- marqueur de version et contrôle des définitions réelles dans sqlite_schema
  et les PRAGMA index_list/index_xinfo.

Les définitions originales connues de la première phase 1 peuvent être mises à
niveau transactionnellement. Une définition inconnue n'est pas écrasée. Sur un
schéma marqué, un index manquant ou dégradé, un marqueur incorrect, un trigger
d'immutabilité, de mise à jour ou de remplacement absent provoque un refus.
L'absence de la seule garde d'insertion est l'exception de rollback décrite
ci-dessous. Ce contrôle ne constitue pas une protection contre un administrateur
capable d'altérer librement le schéma et le marqueur.

## Import SQLite vers PostgreSQL

Le script ouvre la source SQLite en lecture seule et inspecte ses noms de colonnes.
- Colonne user_id présente : chaque compte doit avoir un UUID valide et unique ;
  NULL ou valeur invalide entraîne un refus avant les INSERT.
- Colonne absente : génération uniquement pour une vraie source pré-M02 sans
  marqueur, index ou trigger d'identité M02 reconnaissable. Si ces traces existent,
  l'import refuse la source incomplète. Ne pas supprimer colonne/protections pour
  contourner ce contrôle ; après suppression de toutes les traces, l'historique
  ne peut pas être deviné par le script.
- La cible est contrôlée pour les conflits de username ET de UUID avant import.
  Une collision ou une erreur d'import entraîne ROLLBACK ; le suivi M01 rend la
  relance d'un import terminé inopérante pour la même identité de source.
- recovery_code_expires_at_ms est copié exactement, y compris zéro et NULL.
  Une expiration non entière sûre est refusée. Une source ancienne sans colonne
  reste explicitement NULL : aucune date arbitraire n'est inventée. Le comportement
  historique des codes sans expiration n'est pas modifié par cette phase.

Les mappings clients, heures, salaires, préférences, sessions et chronomètres M01
restent en place. Aucun transfert de propriété vers user_id n'est commencé.

## Rollback temporaire et reprise

Procédure à faire valider séparément pour la base concernée ; aucun rollback de
données réelles n'est exécuté par ces corrections.

1. Arrêter les écritures de l'application et effectuer une sauvegarde cohérente
   vérifiée (API SQLite backup, ou arrêt complet tenant compte de WAL/SHM).
2. Garder la colonne, tous les UUID, l'index, le marqueur et les protections.
   Ne jamais restaurer une sauvegarde ancienne par-dessus les données courantes
   sans réconciliation : cela perdrait les comptes et données créés depuis.
3. Pour une ancienne version SQLite qui omet user_id, enlever uniquement la garde
   d'insertion, hors exécution concurrente de M02 :
   `DROP TRIGGER IF EXISTS users_user_id_insert_guard;`
   Garder les autres triggers et l'index. Les nouveaux comptes de l'ancienne
   application restent temporairement NULL ; les UUID existants restent immuables.
4. Arrêter l'ancienne version, refaire une sauvegarde cohérente, puis redémarrer
   la version corrigée M02. Elle valide les protections, attribue une seule fois
   un UUID aux NULL et rétablit la garde d'insertion dans la même transaction.
5. Vérifier absence de NULL, unicité selon la casse et conservation de la
   correspondance compte/UUID ; vérifier aussi sessions et données M01 avant
   réouverture. Un second démarrage doit conserver exactement ces UUID.
6. En cas d'erreur : aucune réparation automatique des valeurs attribuées ou des
   protections inconnues. Arrêter, conserver la base et faire valider une
   remédiation précise. Une interruption de la transaction d'identité se relance
   sans changement d'un UUID déjà validé.

PostgreSQL : conserver colonne, valeur par défaut, NOT NULL, contrainte et trigger ;
l'ancien code peut omettre user_id grâce au défaut. Ne pas retirer ces protections.
La destruction de la colonne UUID n'est pas un rollback pris en charge.

## Validation locale sûre

Depuis la racine du projet dans PowerShell :

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\scripts\test-m02-validation.ps1 -Mode Local
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\scripts\test-m02-validation.ps1 -Mode Http
```

Le lanceur neutralise les variables de bases distantes, crée un répertoire
tmp/m02-validation-<guid>, affecte DB_PATH et SQLITE_DB_PATH à sa base synthétique
et restaure les variables à la sortie. Les fixtures sont conservées dans tmp.
Ne pas lancer simplement node --test en supposant NODE_ENV=test suffisant :
certains tests importent le serveur et ouvrent sinon data/hours.db.

Ces tests ne prouvent pas l'exécution PostgreSQL native. Toute intervention
PostgreSQL distante, y compris sur Branch_Test, exige une validation distincte.
production, Backup_production et Branch_Test_M02 sont exclus.
