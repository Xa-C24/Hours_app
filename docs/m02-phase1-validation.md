# HOURS APP — M02 / Phase 1 — Validation technique
Date : 23 octobre 2026.

## 🔐 CONTRÔLE DE PÉRIMÈTRE

Projet : C:/Users/x.piedallu/Documents/Autre/AutreS/hours-app.
Intervention locale : lecture du code et création de tests, d’un garde-fou de cible et d’une procédure PowerShell. Les bases SQLite de tests sont temporaires et synthétiques. Les serveurs HTTP sont ouverts sur 127.0.0.1, ports éphémères.
Aucune connexion PostgreSQL/Neon n’a été ouverte. Aucun accès ni migration sur production, Backup_production_20261022_1536, Branch_Test_M02 ou l’ancienne Branch_Test. Aucun secret ni chaîne de connexion n’a été lu ou affiché.
La configuration d’un test distant est laissée à l’opérateur via saisie masquée. La vérification d’identité Neon utilise uniquement trois GET sur https://console.neon.tech/api/v2, puis autorise seulement le schéma de test créé sur l’endpoint Branch_Test vérifié.
Aucun commit, merge, push ou déploiement. M02 Phase 2 non commencée.

## 🔍 DIAGNOSTIC

**Phase 1 non validable en l’état.** Les tests initiaux passaient, mais les nouvelles vérifications reproduisent des violations de l’identité durable et un risque sur la récupération de compte.

État initial :
- Branche lot2/m02-user-id.
- HEAD M01 : 72239cda (affichage court initial : 72239cd).
- Six fichiers suivis modifiés : db-postgres.js, db-sqlite.js, schema.sql, scripts/migrate-sqlite-to-postgres.js, test/migration-safety.test.js, test/work-timer-storage.test.js.
- Trois fichiers non suivis : docs/user-id-phase1.md, migrations/002_user_id.sql, test/user-id-phase1.test.js.
- Les neuf fichiers de départ n’ont pas été corrigés ni écrasés pendant cette validation.

Résultats exécutés :

| Exécution | Réussis | Échoués | Ignorés | Total |
|---|---:|---:|---:|---:|
| Suite existante avant ajout des tests | 231 | 0 | 1 | 232 |
| Suite locale finale avec les tests de validation | 238 | 8 | 2 | 248 |
| Sélection HTTP hors bac à sable, procédure fournie | 36 | 0 | 0 | 36 |

La sélection HTTP recoupe la suite complète : ne pas additionner ces nombres.
Les deux tests ignorés sont les intégrations PostgreSQL réelles M01 et M02, faute de cible configurée. Les vérifications statiques SQL et les faux pilotes des tests existants ne valent pas exécution PostgreSQL.

PostgreSQL local : aucun postgres/psql disponible dans PATH. Docker est installé mais son daemon Linux n’est pas accessible. Aucune image n’a été téléchargée, aucun service démarré, aucune dépendance installée. Les variables de connexion de test et les identifiants Neon sont absents.

## ❌ PROBLÈMES REPRODUITS

### 1. 🔴 L’import SQLite → PostgreSQL réattribue les UUID existants

Source : scripts/migrate-sqlite-to-postgres.js, getTableColumns et migrateUsers.
getTableColumns renvoie des noms de colonnes (chaînes). La détection M02 fait pourtant .some(column => column.name === "user_id").
Elle renvoie toujours false. Le SELECT omet user_id ; crypto.randomUUID() crée ensuite une nouvelle identité.

Deux tests indépendants échouent :
- l’UUID source valide n’est pas transmis dans l’INSERT PostgreSQL ;
- un UUID source malformé n’est pas refusé : il est ignoré et remplacé.

Preuve : exécution de la fonction réelle migrateUsers dans un contexte de test, SQLite en mémoire et capture des paramètres de l’INSERT. Aucun PostgreSQL simulé n’est présenté comme une preuve d’exécution SQL. Le défaut survient avant le pilote PostgreSQL.
Impact : violation directe de la permanence de l’identité lors du changement d’adaptateur. Les relations actuelles username peuvent rester cohérentes, mais l’identité M02 ne l’est pas.

Correction nécessaire : détecter correctement la colonne dans la liste de noms, sélectionner le UUID existant, valider chaque valeur et ne générer que pour les comptes qui n’ont jamais reçu d’UUID. Ne pas réattribuer silencieusement les valeurs invalides.

### 2. 🔴 L’import perd l’expiration des codes de récupération

L’INSERT de migrateUsers ne transmet pas recovery_code_expires_at_ms. Ce champ était déjà omis dans HEAD M01 ; ce n’est pas une régression introduite exclusivement par M02.
server.js considère une expiration NULL/absente comme un ancien code non expiré. La perte d’expiration peut donc permettre à un code précédemment expiré d’être de nouveau accepté si ses autres éléments de vérification sont conservés.

Preuves :
- nouveau test de la fonction réelle : le paramètre d’expiration est absent ;
- analyse du contrôle d’expiration dans server.js ;
- comparaison avec HEAD pour distinguer l’antériorité.
Le scénario complet sur un serveur PostgreSQL n’a pas été exécuté.

Correction nécessaire : conserver l’expiration à la lecture, au transfert et à l’insertion, vérifier la colonne cible dans le schéma d’import, et tester les codes déjà expirés après migration. Ne pas modifier arbitrairement l’expiration des anciens comptes sans politique validée.
Aucune donnée réelle n’a été examinée : aucune exposition ou exploitation en production n’est affirmée.

### 3. 🟠 Le trigger SQLite accepte certains UUID malformés

users_user_id_insert_guard contrôle la longueur, les quatre positions de tiret et les caractères hexadécimaux après suppression des tirets, mais pas le nombre exact de chiffres/tirets.
La valeur synthétique 00000000-0000-0000-0000-00000000000- est acceptée en INSERT SQL, puis refusée au prochain démarrage par le contrôle JavaScript plus strict.
Impact : invariant non garanti et risque de blocage du démarrage sur une valeur déjà admise.

Correction nécessaire : faire correspondre strictement la validation SQL au format UUID attendu, y compris 32 chiffres hexadécimaux et exactement les séparateurs prévus, à l’insertion et lors d’une première attribution autorisée.

### 4. 🟠 SQLite accepte deux représentations du même UUID selon la casse

L’index unique actuel compare le TEXT avec sa collation binaire. Un UUID minuscule et sa version majuscule peuvent coexister. PostgreSQL UUID les considère comme la même identité.
Impact : unicité logique non garantie et collision lors de l’import PostgreSQL.

Correction nécessaire : détecter les doublons après normalisation pour comparaison et imposer une unicité cohérente entre adaptateurs, sans modifier les identifiants déjà attribués. Arrêter sur collision ; ne pas réattribuer automatiquement un autre UUID.

### 5. 🟠 Un index partiel homonyme peut contourner l’unicité

Le démarrage vérifie unique et le nom de colonne, mais pas l’indicateur partial ni toute la sémantique de l’index.
Un index users_user_id_unique_idx sur user_id avec WHERE id > 100 est accepté ; il n’empêche pas les doublons des comptes hors filtre.

Correction nécessaire : refuser une définition inattendue ou recréer une garantie connue dans une transaction après préflight. Contrôler le caractère non partiel et la collation/expression, pas uniquement le nom.

### 6. 🟠 Un ancien trigger homonyme inopérant est conservé

CREATE TRIGGER IF NOT EXISTS ne garantit pas la définition du trigger déjà présent. Le test installe un trigger users_user_id_immutable qui ne fait que SELECT 1 ; le démarrage l’accepte et un UPDATE du UUID réussit.

Correction nécessaire : vérifier la définition effective des deux triggers ou refuser la dérive de schéma. Ne pas considérer l’existence du nom comme une preuve d’immutabilité.

### 7. 🟠 Le rollback documenté peut empêcher le retour à M02

La procédure propose de supprimer seulement le trigger d’insertion pour faire tourner une ancienne version, en conservant le trigger d’immutabilité.
Cette ancienne version peut créer un compte user_id=NULL. Au redémarrage M02, le backfill essaie NULL → UUID ; le trigger d’immutabilité conservé le refuse.

Preuve : séquence complète reproduite sur fichier synthétique. Le UUID déjà attribué reste intact, mais l’initialisation échoue.

Correction nécessaire : définir et tester une première attribution contrôlée pour les anciennes lignes NULL, tout en interdisant la modification des UUID déjà attribués. Traiter aussi la validation du nouveau UUID et la transaction de remise en place des protections. Ne pas conseiller un rollback qui n’a pas passé ce scénario.

## Ce qui fonctionne déjà, avec limites

- Backfill SQLite normal : les UUID déjà valides sont conservés et les NULL sont remplis.
- Malformations historiques détectées au démarrage et doublons strictement identiques : arrêt avec rollback des attributions de la transaction.
- Interruption du backfill SQLite reproduite : rollback des IDs générés, relance possible, puis stabilité à la réexécution.
- La colonne SQLite est ajoutée avant la transaction de backfill : un échec peut laisser la colonne nullable, ce qui n’est pas un remplacement d’identité mais doit être documenté.
- Avec les triggers attendus, l’UPDATE d’un UUID SQLite existant est refusé.
- Les tests HTTP, sessions, authentification, isolation entre utilisateurs, sauvegardes et chronomètres existants passent localement.
- PostgreSQL : le code prévoit une transaction, un verrou exclusif, un backfill limité aux NULL, une contrainte unique, NOT NULL et un trigger IS DISTINCT FROM. Ce sont des garanties de conception, pas une validation sur un moteur réel dans cette intervention.
- Les relations M01 restent basées sur username ; la migration M02 ne les convertit pas. Les régressions locales passent ; leur exécution PostgreSQL réelle reste à faire.

## ⚠️ RISQUES RÉSIDUELS POSTGRESQL À VÉRIFIER

- Une colonne historique user_id d’un autre type n’est pas explicitement refusée par ADD COLUMN IF NOT EXISTS. Le test réel ajoute un cas TEXT avec contenu invalide : il doit échouer proprement, sans modifier les valeurs. Ce cas n’a pas été exécuté ici.
- La logique M02 est recopiée dans la migration SQL, l’initialisation de l’adaptateur et le script d’import ; une correction doit couvrir ces trois chemins et le schéma de référence.
- L’initialisation PostgreSQL nécessite des droits DDL et un verrou ACCESS EXCLUSIVE. L’impact des verrous et la séparation du rôle de migration du rôle applicatif doivent être validés avant déploiement.
- Un propriétaire de schéma peut supprimer les protections ; les triggers ne remplacent pas une politique de privilèges adaptée.
- L’import doit être validé transactionnellement, y compris les métadonnées d’authentification, pas seulement les UUID ou les nombres de lignes.

## 🛠️ PROCÉDURE POWERSHELL

Depuis le projet, sans changer de branche :

~~~powershell
Set-Location 'C:\Users\x.piedallu\Documents\Autre\AutreS\hours-app'
.\scripts\test-m02-validation.ps1 -Mode Http
.\scripts\test-m02-validation.ps1 -Mode Local
~~~

La procédure HTTP a réellement été exécutée : 36 réussites. Local retourne actuellement un code non nul à cause des huit défauts reproduits. Les tests ne sont ni ignorés ni adaptés pour rendre le bilan artificiellement vert.
Le script retire pour ses processus de test les variables de connexion ambiantes puis les restaure ; aucune configuration persistante n’est modifiée. Il n’affaiblit pas la politique d’exécution PowerShell. S’il doit être signé dans votre environnement, utiliser la procédure IT de signature.

### Exécuter PostgreSQL sur la branche synthétique Neon Branch_Test

Ne pas utiliser Branch_Test_M02, production ou une sauvegarde. Ne pas lancer migrate:postgres ou l’application pour cette vérification.
Préparer une URL directe neondb de Branch_Test (pas de pooler), l’ID du projet App_Hours, l’ID de Branch_Test et une clé API capable de lire les métadonnées de ce projet/branche/endpoint.

~~~powershell
.\scripts\test-m02-validation.ps1 -Mode Postgres -Target neon-branch-test
~~~

La connexion et la clé API sont demandées avec saisie masquée ; ne pas les mettre dans la commande, un fichier suivi ou le chat.
Le test contrôle via GET l’identité App_Hours / Branch_Test et que l’hôte de l’URL est bien l’endpoint read_write de cette branche AVANT toute connexion PostgreSQL. Les branches protégées, poolers et paramètres permettant de remplacer hôte/base/options sont refusés. TLS reste vérifié.
Après connexion, une prélecture contrôle le nom de base et la version PostgreSQL >= 13. Seuls des schémas au nom aléatoire m02_uuid_<32 caractères hexadécimaux> créés par l’exécution sont utilisés. search_path est fixé sur ce schéma et pg_catalog, sans fallback public. Les tables publiques et leurs données ne sont pas lues ni modifiées.
Au plus sept schémas sont créés séquentiellement puis supprimés avec leurs seules fixtures dans les blocs finally. Une interruption forcée de Node peut laisser un schéma de test ; vérifier son nom, son propriétaire et l’absence de test actif avant tout nettoyage manuel. Ne pas faire de suppression globale par préfixe.

Le banc prévoit :
- backfill historique, génération automatique et conservation des UUID ;
- unicité, valeurs invalides/NULL, immutabilité, réexécution ;
- doublons historiques et absence de modification partielle ;
- arrêt réel d’une connexion avant COMMIT puis relance ;
- initialisation réelle db-postgres et ensurePgSchema ;
- import SQLite réel, interruption/reprise, UUID, remappage des mêmes IDs clients de deux comptes, heures, salaires, réglages, sessions et chronomètres ;
- conservation de l’expiration de récupération ;
- maintien des FK M01 et refus des relations inter-utilisateurs.

Ce banc a passé son contrôle de syntaxe et son mode sans cible (ignoré explicitement). Son comportement PostgreSQL ne peut être déclaré validé avant l’exécution ci-dessus ; des échecs sont attendus sur les défauts actuellement reproduits.

### PostgreSQL local synthétique, si disponible ultérieurement

Une base dédiée vide doit avoir un nom hours_m02_test_<suffixe> et un hôte strictement localhost/127.0.0.1/::1. Ne pas désigner une base existante de travail ou de production.

~~~powershell
.\scripts\test-m02-validation.ps1 -Mode Postgres -Target local-synthetic
~~~

L’URL reste saisie de façon masquée. Aucune installation PostgreSQL ni création de base n’est déclenchée par ce script ; il crée uniquement ses schémas sur la cible synthétique explicitement choisie.

## FICHIERS AJOUTÉS PAR CETTE VALIDATION

- scripts/m02-test-target.js : garde-fou de cible avant connexion.
- scripts/test-m02-validation.ps1 : exécution locale/HTTP/PostgreSQL avec secrets masqués.
- test/user-id-adversarial.test.js : huit scénarios SQLite, cinq défauts reproduits.
- test/user-id-import-contract.test.js : trois défauts reproduits avec la fonction d’import réelle.
- test/user-id-test-target.test.js : quatre tests des restrictions de cible, sans réseau.
- test/user-id-postgres.integration.test.js : intégration PostgreSQL réelle, inactive sans configuration dédiée.
- docs/m02-phase1-validation.md : ce rapport.

Les neuf fichiers initiaux non commités restent en place ; aucun code métier ni migration n’a été corrigé par cette validation.

## 🧠 AMÉLIORATION ET SUITE SOUMISE À VALIDATION

Priorité : corriger l’import UUID et l’expiration, puis les invariants SQLite et le rollback. Aligner ensuite les trois chemins PostgreSQL et exécuter le banc réel sur la seule cible synthétique.
La réutilisation d’une logique de migration unique, avec préflight de type/définitions et suivi des versions, réduirait les divergences.
Ne pas démarrer M02 Phase 2 ni valider le déploiement de cette phase sur la base du seul ancien bilan vert.

Arrêt après ce rapport ; corrections et poursuite soumises à validation.

