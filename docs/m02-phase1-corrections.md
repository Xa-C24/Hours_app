# M02 phase 1 — Rapport des corrections bloquantes

Date : 23 octobre 2026. Projet : Hours App.
Branche vérifiée au départ : lot2/m02-user-id ; HEAD : 72239cda.
Le travail Phase 1 déjà présent et non commité a été conservé.

## Diagnostic et limite impérative

Les huit régressions de la validation précédente passent avec le code corrigé.
La validation finale isolée est verte : 264 tests, 262 réussis, 0 échec, 2 ignorés.
Les deux tests ignorés concernent l'exécution PostgreSQL réelle M01 et M02.
Les tests HTTP sur localhost : 36 réussis, 0 échec, 0 ignoré.

Ces résultats ne valident ni un environnement distant, ni l'état de la base
locale data/hours.db. Un incident de périmètre a été constaté pendant ce travail
et reste non résolu ; voir ci-dessous.

## Incident de périmètre — base SQLite locale par défaut

Les premiers passages de la suite utilisaient le lanceur existant, qui supprimait
DB_PATH. Douze tests du calendrier importent directement server.js et donc
l'adaptateur SQLite : ils ouvraient ainsi implicitement data/hours.db.

Les premières exécutions ont pu exécuter l'initialisation et les migrations sur
cette base. Un contrôle ultérieur strictement en lecture seule a confirmé quatre
comptes et la présence du marqueur hours_user_identity_schema introduit pendant
les corrections. La nature réelle ou synthétique de ces comptes n'a pas été
établie. Il n'existe pas d'instantané antérieur permettant de prouver quels UUID,
valeurs ou objets de schéma ont changé. Je ne peux donc pas garantir le respect
de l'exigence « aucune modification des données réelles » pour ces passages.

Après durcissement des définitions de triggers, ces douze tests ont échoué avec
« unexpected identity trigger definition ». Un lancement isolé du fichier de
test a reproduit ces douze échecs avant identification de la cause. Ce refus
peut aussi bloquer l'application si elle utilise actuellement cette base par
défaut ; elle n'a pas été réparée ni effacée.

Confinement réalisé :
- arrêt des exécutions utilisant le chemin par défaut ;
- lanceur corrigé : nouveau répertoire tmp/m02-validation-<guid> à chaque passage,
  DB_PATH ET SQLITE_DB_PATH explicites, variables distantes neutralisées ;
- base data/hours.db conservée en l'état ; pas de tentative de réattribuer des UUID
  ni d'accepter silencieusement ses protections intermédiaires ;
- validations finales effectuées sur des bases synthétiques neuves.

Une intervention distincte doit être validée pour comparer cette base à une
sauvegarde existante et qualifier précisément l'impact. Aucun retour arrière
automatique ne serait sûr sans état antérieur. Ne pas supprimer le marqueur ou
les protections pour forcer le démarrage.

## Les huit corrections

| Échec constaté | Correction | Preuve locale |
|---|---|---|
| Colonne SQLite détectée comme objet plutôt que nom | Recherche par includes dans la liste des noms | Test original de conservation UUID réussi |
| UUID source invalide ignoré | Refus explicite des UUID invalides ; NULL inattendu refusé | Test original UUID invalide + nouveaux cas limites réussis |
| Expiration de récupération perdue | Colonne cible ajoutée et valeur bindée explicitement | Test original expiration + zéro/NULL réussis |
| UUID avec tiret supplémentaire accepté | Type TEXT, 36 caractères et 36 octets ASCII, séparateurs et hex stricts | Test original du tiret supplémentaire réussi |
| UUID dupliqués selon la casse | Index unique complet COLLATE NOCASE + préflight | Test original casse et collisions historiques réussis |
| Index partiel portant le bon nom accepté | Contrôle unicité, partialité, clés, tri et collation réels | Test original index partiel réussi |
| Trigger vide portant le bon nom accepté | Comparaison des définitions réelles connues | Test original no-op + altération des littéraux réussis |
| Reprise après rollback bloquée | NULL vers UUID permis une seule fois ; UUID attribués immuables | Test original rollback + plusieurs comptes et relances réussis |

Aucun des tests initiaux en échec n'a été désactivé ou assoupli.

## Garanties supplémentaires

- Transaction immédiate pour ajout user_id, contrôles, backfill, index, triggers
  et marqueur SQLite. Erreur ou interruption : ROLLBACK, puis reprise testée.
- Détection d'un UPDATE ignoré par un autre trigger via vérification finale.
- Comparaison BINARY des UUID lors d'une mise à jour : une colonne historique
  NOCASE ne permet pas une mutation de casse.
- Rejet des suffixes NUL et fin de ligne, sans normaliser les UUID historiques.
- Garde INSERT OR REPLACE pour empêcher une suppression/réinsertion de compte
  contournant l'immutabilité. Le diagnostic d'un username déjà utilisé reste
  compatible avec le gestionnaire d'inscription existant.
- Définitions SQL vérifiées sans modifier la casse des littéraux.
- Index/triggers manquants ou incorrects refusés sur schéma marqué ; seules les
  définitions V1 originales reconnues peuvent être mises à niveau.
- Exception de rollback documentée : l'absence du seul trigger d'insertion est
  autorisée au démarrage corrigé, qui le rétablit transactionnellement.
- Import : conflit username ou UUID en cible détecté avant insertion ; ROLLBACK.
- Import pré-M02 sans colonne autorisé seulement en l'absence de traces M02
  reconnaissables ; une source M02 avec NULL doit d'abord reprendre sa migration.
- Fermeture de la connexion SQLite si l'initialisation d'identité échoue.
- Contrôle du type natif UUID PostgreSQL dans les trois chemins de migration.
  Une erreur d'édition des délimiteurs DO $$ a été détectée et corrigée pendant
  cette intervention ; un test compare maintenant le SQL réellement émis par
  l'adaptateur et l'importeur à la migration autonome et vérifie l'ordre de refus.
  Cette preuve reste une simulation du serveur PostgreSQL.

## Fichiers modifiés par ces corrections

| Fichier | Rôle |
|---|---|
| db-sqlite.js | Appel du helper et fermeture sur erreur |
| services/user-identity-sqlite.js (nouveau) | Migration transactionnelle et protections réelles SQLite |
| scripts/migrate-sqlite-to-postgres.js | Détection des colonnes, UUID, conflits et expiration |
| db-postgres.js | Préflight du type UUID |
| migrations/002_user_id.sql | Même préflight du type UUID |
| scripts/test-m02-validation.ps1 | Isolation effective des chemins SQLite des tests |
| test/user-id-corrections.test.js (nouveau) | 16 tests supplémentaires de cas limites |
| docs/user-id-phase1.md | Procédure de rollback/reprise et validation locale sûre |
| docs/m02-phase1-corrections.md (nouveau) | Présent rapport |

Autres changements Phase 1 déjà présents à l'arrivée : schema.sql,
test/migration-safety.test.js, test/work-timer-storage.test.js, ainsi que les
fichiers de validation précédents. Ils ne représentent pas des modifications
nouvelles apportées pour contourner les tests pendant ces corrections.
Les copies de récupération de sources créées pendant l'intervention restent
sous tmp/m02-corrections-* et tmp/m02-postgres-before-* ; aucune sauvegarde de
la base locale par défaut n'a été créée ni restaurée.

## Tests et résultats exacts

Les résultats ci-dessous sont ceux du code final. Les tests HTTP sont inclus dans
la suite globale et aussi relancés séparément ; ne pas additionner ces nombres.

| Exécution | Total | Réussis | Échecs | Ignorés |
|---|---:|---:|---:|---:|
| Suite locale finale, lanceur isolé | 264 | 262 | 0 | 2 |
| HTTP final sur localhost, lanceur isolé | 36 | 36 | 0 | 0 |
| Groupe M02 ciblé (audit, import, identité, corrections) | 30 | 30 | 0 | 0 |

Le groupe ciblé à 30 tests a précédé l'ajout du dernier cas de littéral SQL :
le fichier de corrections contient finalement 16 tests, tous repris dans la
suite finale à 264 tests.

Historique utile : un passage intermédiaire avait 12 échecs calendrier et
248 réussites sur 262 tests (2 ignorés) à cause de l'ouverture implicite de
data/hours.db. Une incompatibilité de résolution du helper dans le test de
stockage des chronomètres a également été corrigée côté code, sans modifier
ce test. Ces échecs ne sont pas masqués : leurs causes et la limite concernant
la base locale sont conservées dans ce rapport.

Les tests locaux couvrent M01 : isolation SQLite, contrats PostgreSQL simulés,
mappings et transactions de migration, conservation clients/heures/salaires,
préférences, chronomètres, sessions et restauration de comptes.
Aucune preuve d'exécution native PostgreSQL n'est revendiquée.

Commandes PowerShell depuis la racine du projet :

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\scripts\test-m02-validation.ps1 -Mode Local
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\scripts\test-m02-validation.ps1 -Mode Http
```

## Risques résiduels et suite à valider

1. **Incident local non résolu** : data/hours.db a été ouverte implicitement,
   contient quatre comptes et le nouveau marqueur ; impact antérieur inconnu.
   Préserver la base et les sauvegardes existantes avant toute investigation
   ou réparation explicitement autorisée.
2. **PostgreSQL réel non vérifié** : les intégrations M01/M02 restent ignorées.
   Faire valider séparément une exécution sur cible synthétique isolée ;
   aucune intervention sur production, Backup_production ou Branch_Test_M02.
3. **Historique incomplet impossible à deviner** : après suppression manuelle de
   la colonne ET de toutes les traces M02, une source paraît pré-M02. Ne jamais
   faire ce type de rollback destructif.
4. **Codes historiques sans expiration** : NULL existant est conservé ; la
   politique fonctionnelle des codes legacy n'est pas changée par M02.
5. **Rollback SQLite limité** : anciens comptes conservent leur UUID ; les comptes
   créés par l'ancienne version restent NULL jusqu'à la reprise contrôlée M02.
   Ne pas laisser les deux versions écrire simultanément.

Aucun accès PostgreSQL distant n'a été effectué par ces corrections. Aucun
commit, merge, push ou déploiement. Phase 2 non commencée.
Arrêt après les corrections et tests locaux ; toute suite attend la validation.
