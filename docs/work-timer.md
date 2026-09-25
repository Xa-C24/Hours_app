# Chronomètre partagé

Le navigateur lit et modifie `/work-timer` sur le serveur de l’application. Les requêtes utilisent la session existante ; les écritures POST exigent le jeton CSRF. Le serveur détermine l’utilisateur, contrôle l’accès au client et horodate les actions. Ces réponses ne sont pas mises en cache.

La table `work_timers` contient une ligne par utilisateur : `username`, `version`, `state_json`. Elle est créée par l’initialisation habituelle de SQLite (base d’authentification) ou PostgreSQL. Chaque écriture compare la version attendue dans la requête SQL ; un conflit renvoie HTTP 409 et l’état courant. Aucune table de journées n’est modifiée par cette API.

Les onglets visibles relisent l’état toutes les cinq secondes et au retour au premier plan. Démarrer, mettre en pause et arrêter nécessitent une connexion. Le temps continue de s’écouler sur le serveur quand l’onglet est fermé. Une réponse perdue n’entraîne pas de répétition automatique de l’action ni d’enregistrement automatique de la journée.

Après arrêt, les horaires restent récupérables jusqu’au prochain démarrage confirmé. L’enregistrement d’une journée utilise toujours le formulaire existant, sa validation et sa confirmation de remplacement. Un suivi passant minuit nécessite une correction manuelle : le modèle de journée actuel exige arrivée et départ à la même date.

Un ancien suivi en sessionStorage n’est pas importé automatiquement : un bouton propose sa récupération si aucun suivi serveur n’existe. Ne pas fermer l’ancien onglet avant cette récupération. Les anciens suivis ne sont pas fusionnés.

## Mise en service

Cette modification de code ne constitue pas un déploiement. Avant le démarrage de la nouvelle version sur l’environnement cible, sauvegarder la base selon la procédure habituelle. L’ajout de table est non destructif et ne réécrit aucune journée existante. Vérifier la reprise dans deux onglets avec un compte de test, puis le parcours arrêt → sauvegarde → calendrier.

Pour revenir au code précédent, conserver la nouvelle table et ses données ; les anciens écrans ne liront plus ces suivis. Récupérer les horaires en cours avant le retour arrière. Ne pas supprimer la table pour revenir en arrière.

## Validation

Les tests couvrent les transitions, conflits concurrents, contrôles d’accès, CSRF, reprise et perte de réponse. Le stockage SQLite est testé en mémoire avec le pilote réel. PostgreSQL et le rendu sur téléphone doivent être vérifiés sur un environnement de test avant déploiement ; aucun accès à une base de production n’est requis par les tests ajoutés.
