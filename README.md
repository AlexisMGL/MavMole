# MavMole V1

Prototype minimal pour relayer un flux MAVLink binaire depuis Mission Planner vers un second navigateur, sans parser ni modifier les paquets.

## Ce que fait cette V1

```text
Mission Planner / SITL
        │ ws://127.0.0.1:56781/websocket/raw
        ▼
Navigateur Mole
        │ wss://<service>/ws?role=mole
        ▼
MavMole sur Render
        │ wss://<service>/ws?role=digger
        ▼
Navigateur Digger
```

- un seul Mole et un seul Digger à la fois ;
- relais uniquement dans le sens Mole → Digger ;
- trames WebSocket binaires retransmises byte-for-byte ;
- aucune base de données, aucun compte et aucun stockage ;
- compteurs de trames, volume et débit dans les pages ;
- logs détaillés dans la console du navigateur (F12 → Console) et sur le serveur ;
- le dernier paquet reçu est affiché en hexadécimal côté Digger, sans décodage MAVLink.

Quand un second client prend le même rôle, il remplace le premier. L’ancienne connexion reçoit le code de fermeture `4001`.

## Lancer en local

Il faut Node.js 22 et npm.

```powershell
npm install
npm test
npm start
```

Ouvrir ensuite :

- `http://localhost:3000/dig` dans le navigateur Digger et cliquer sur **Connect** ;
- `http://localhost:3000/mole` sur le PC de Mission Planner et cliquer sur **Connect and forward**.

L’état technique du service est disponible sur `http://localhost:3000/healthz`.

### Tester sans Mission Planner

Dans un second terminal :

```powershell
npm run fake-source
```

Entrer `ws://127.0.0.1:5863` sur la page Mole. Cette source envoie dix fausses trames binaires par seconde. Elles ne sont pas des paquets MAVLink valides : elles servent uniquement à vérifier le transport de bout en bout.

## Tester avec Mission Planner et SITL

1. Démarrer une simulation SITL dans Mission Planner et attendre que la télémétrie arrive.
2. Ouvrir les outils de développement du navigateur avec F12, onglet **Console**.
3. Ouvrir la page Digger et cliquer sur **Connect**.
4. Ouvrir la page Mole sur le PC qui exécute Mission Planner.
5. Utiliser `ws://127.0.0.1:56781/websocket/raw`, puis cliquer sur **Connect and forward**.
6. Vérifier que les deux connexions sont vertes et que les compteurs des deux pages augmentent.

Le code actuel de Mission Planner expose son flux WebSocket brut sur le port `56781`, au chemin `/websocket/raw` ([source Mission Planner](https://github.com/ArduPilot/MissionPlanner/blob/master/Utilities/httpserver.cs)). Si ton installation ou un plugin expose déjà `ws://127.0.0.1:5863`, remplace simplement l’URL dans le champ : elle n’est pas codée en dur.

### Si la connexion locale échoue depuis Render

Une page Render est en HTTPS alors que Mission Planner fournit un WebSocket local non chiffré en `ws://`. Chrome protège désormais l’accès d’un site public aux adresses locales/loopback et peut demander l’autorisation d’accéder au réseau local ([documentation Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access)).

À vérifier dans cet ordre :

1. accepter la demande d’accès au réseau local affichée par Chrome ;
2. vérifier dans F12 → Console le message exact du navigateur ;
3. ouvrir `http://127.0.0.1:56781/` directement pour confirmer que le serveur Mission Planner écoute ;
4. tester la même page MavMole en local sur `http://localhost:3000/mole` pour distinguer un problème Mission Planner d’un blocage HTTPS/LNA ;
5. essayer `ws://127.0.0.1:5863` si c’est le port réellement configuré dans ton environnement.

Ce test navigateur est le principal risque technique du prototype zéro-installation. Le relais Render n’essaie jamais de joindre `127.0.0.1` lui-même.

## Publier le dépôt sur GitHub

Le dépôt local est déjà initialisé sur la branche `main`. Créer un dépôt GitHub vide nommé `mavmole` (sans README, `.gitignore` ni licence), puis exécuter :

```powershell
git remote add origin https://github.com/AlexisMGL/mavmole.git
git push -u origin main
```

La CI GitHub exécute automatiquement `npm ci` puis `npm test` à chaque push et pull request.

## Héberger sur Render

Le fichier `render.yaml` décrit un unique Web Service Node.js gratuit. Il sert le frontend, le WebSocket `/ws` et le health check `/healthz`.

1. Pousser le dépôt sur GitHub.
2. Se connecter au [tableau de bord Render](https://dashboard.render.com/).
3. Choisir **New → Blueprint**.
4. Connecter GitHub et sélectionner le dépôt `mavmole`.
5. Vérifier que Render détecte `render.yaml`, puis appliquer le Blueprint.
6. Attendre le build (`npm ci`) et le démarrage (`npm start`).
7. Ouvrir l’URL `https://mavmole.onrender.com` attribuée par Render — le sous-domaine exact peut différer si ce nom est déjà pris.

Render termine TLS et les pages choisissent automatiquement `wss://` en production. Le serveur écoute bien la variable `PORT` fournie par Render. La configuration suit la [spécification officielle des Blueprints](https://render.com/docs/blueprint-spec) et la [documentation WebSocket Render](https://render.com/docs/websocket).

Les services Free s’endorment après 15 minutes sans trafic HTTP entrant ni message WebSocket entrant et peuvent mettre environ une minute à redémarrer. Render précise aussi que l’offre Free est destinée aux tests, pas à la production ([limites Free officielles](https://render.com/docs/free)).

## Limites et sécurité

Cette V1 est volontairement publique et sans authentification : toute personne connaissant l’URL peut prendre le rôle Mole ou Digger. Ne pas l’utiliser avec une télémétrie sensible ou pour commander un véhicule réel.

Avant une utilisation réelle, il faudra au minimum ajouter des Molehill IDs aléatoires, une authentification, plusieurs viewers, des limites de débit et une politique d’origine. Le déploiement doit rester sur une seule instance tant que les sessions sont stockées en mémoire.
