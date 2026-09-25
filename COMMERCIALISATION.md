# Préparation de l’offre mensuelle — indépendants

État au 24 septembre 2026 : préparation locale, aucune activation de paiement ni mise en production. Cible confirmée : un abonnement par personne ; les clients suivis ne sont pas les titulaires de l’abonnement. Aucun tarif ni prestataire de paiement choisi.

## Lot réalisé : premières protections

- Brouillons du formulaire séparés par compte authentifié, client et date. Les anciennes clés sans propriétaire restent présentes mais ne sont pas reprises automatiquement. Cette séparation évite les collisions applicatives ; elle ne chiffre pas le stockage du navigateur et ne protège pas contre une personne ayant accès au profil navigateur.
- PostgreSQL distant : certificat vérifié ; détection des hôtes locaux par nom exact et non recherche dans toute la chaîne de connexion. Les options TLS incompatibles sont refusées sans afficher les identifiants. Pour une autorité privée, configurer NODE_EXTRA_CA_CERTS au lancement de Node. Connexion réelle non testée.
- Le choix de PostgreSQL ne charge plus SQLite et n’initialise plus ses fichiers.
- Tests : séparation de deux comptes, anciens brouillons, TLS distant, faux localhost, options TLS interdites, sélection exclusive de l’adaptateur.

## Bloquants avant commercialisation

| Priorité | Travail | Preuve attendue |
| --- | --- | --- |
| Critique | Audit complet de l’isolation comptes/API/exports/paramètres et caches navigateur | Deux comptes de test ne peuvent jamais lire ou modifier les données de l’autre, même avec un identifiant forgé |
| Critique | Sauvegarde et restauration de la base de production | Restauration sur une base isolée et comparaison des comptes, clients et journées ; objectifs de perte et délai de reprise définis |
| Critique | Fiabiliser le pointage | Suivi persistant côté serveur, reprise après fermeture, concurrence entre onglets/appareils, changements de date et fuseau ; aujourd’hui suivi limité à l’onglet |
| Critique | Vérifier le TLS avec l’hébergement retenu | Connexion authentifiée avec certificat vérifié ; aucun contournement en cas d’échec |
| Dette technique | Protection contre les tentatives de connexion | Limites par adresse et compte, nettoyage et stockage adapté au nombre d’instances ; compteur actuel en mémoire du processus |
| Dette technique | Validation responsive et parcours de bout en bout | Inscription, pointage, correction, export sur téléphone et ordinateur ; vérification visuelle Robot encore incomplète |

## Abonnement mensuel à construire

1. Définir une offre unique par personne : fonctionnalités incluses, prix, essai éventuel et règles à l’expiration. Ne pas fixer ces choix implicitement dans le code.
2. Rattacher l’abonnement à l’identifiant stable du compte, jamais au nom d’un client suivi ni à un état du navigateur.
3. Enregistrer côté serveur : identifiants externes de client et d’abonnement, statut, fin de période et résiliation programmée. Stocker les événements reçus avec un identifiant unique.
4. N’activer l’accès payé qu’après notification de paiement vérifiée côté serveur. Une page de retour « succès » ne prouve pas le paiement. Tester doublons, événements en retard et événements hors ordre.
5. Prévoir les parcours essai, abonnement actif, impayé, résiliation et réactivation. Décision à valider : conserver lecture/export après expiration tout en bloquant de nouvelles saisies. Ne jamais supprimer les heures automatiquement lors d’un impayé.
6. Préparer une page Compte et abonnement : état réel, prochaine échéance, gestion et résiliation via le prestataire retenu. Aucun numéro de carte stocké dans l’application.
7. Tester en environnement de paiement de test avant toute activation réelle, avec autorisation précise du prestataire et de la destination réseau.

## Mise sur le marché

- Préparer présentation de l’offre, aide, contact support et démonstration sur données fictives.
- Faire valider les documents contractuels, la confidentialité et les règles de conservation adaptés à l’activité et au marché visés. Ce document ne constitue pas une validation juridique.
- Documenter supervision, procédure d’incident, mise à jour et retour arrière.
- Pilote avec quelques utilisateurs explicitement invités après levée des bloquants ; collecte de retours autorisée et limitée.

## Limites de cet audit

Inspection ciblée du code uniquement : pas de lecture de données métier, pas de connexion aux bases, pas d’audit exhaustif des routes, pas de mesure de charge, pas de vérification de l’infrastructure distante. La présence de protections CSRF, de hachage des mots de passe et de filtres par utilisateur ne prouve pas à elle seule la sécurité de l’ensemble.
