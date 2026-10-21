# SQLite vers PostgreSQL — exécution contrôlée

Le script `npm run migrate:postgres` lit la base SQLite configurée par `SQLITE_DB_PATH` (ou `data/hours.db`) et les bases utilisateur associées, puis écrit dans PostgreSQL via `DATABASE_URL`. Il ne faut l'exécuter qu'après une sauvegarde vérifiée et avec une source SQLite figée.

## TLS

La connexion réutilise `services/postgres-connection-options.js`. Le mode sans TLS est limité aux hôtes exacts `localhost`, `127.0.0.1`, `[::1]` et `host.docker.internal`, sans paramètre TLS explicite. Un nom contenant ces mots dans un autre hôte ne suffit pas. Toute destination distante exige un certificat vérifié (`rejectUnauthorized: true`). Pour une autorité privée, configurez `NODE_EXTRA_CA_CERTS` dans l'environnement du processus. Les options `ssl*` non prises en charge sont rejetées.

N'inscrivez pas d'identifiants dans les arguments de commande ou dans les journaux. Fournissez `DATABASE_URL` par le gestionnaire de secrets de l'environnement. `MIGRATION_SOURCE_ID` peut définir une identité stable non secrète de la source; à défaut, le chemin canonique SQLite est utilisé uniquement comme entrée de hachage et n'est pas journalisé. Conservez la même identité pour les relances d'une même migration.

## Atomicité et relance

Le schéma applicatif est préparé avant l'import. L'import des comptes, sessions, jetons mobiles, états persistés des chronomètres et données utilisateur, le registre de correspondance des IDs client et le marqueur de fin sont ensuite écrits dans une transaction PostgreSQL unique, verrouillée par identité de source. Les tables de jetons et de chronomètres sont facultatives dans une ancienne source SQLite. Une interruption avant validation annule les écritures; une relance recommence. Une migration déjà terminée avec la même identité est ignorée. Si un compte source existe déjà dans PostgreSQL sans marqueur correspondant, le script s'arrête sans écraser son mot de passe ni fusionner ses données.

Les IDs clients SQLite sont associés aux IDs PostgreSQL dans `hours_sqlite_client_id_map`; les lignes d'activité, salaires et références client du chronomètre utilisent cette correspondance. Cette migration est un import ponctuel : toute évolution de la source après un import validé n'est pas synchronisée. Ne changez pas l'identité pour contourner un conflit ou relancer sur une destination déjà alimentée.

## Vérification avant usage

Les tests de migration doivent utiliser des bases synthétiques isolées et un PostgreSQL de test dédié. Le script ne doit jamais être testé contre une base réelle. La transaction protège les écritures PostgreSQL, mais ne crée pas une transaction distribuée entre SQLite et PostgreSQL; la source doit rester immobile pendant l'import.
