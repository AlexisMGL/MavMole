# MavMole demo

MavMole relaye des flux MAVLink binaires depuis Mission Planner vers un ou plusieurs navigateurs et affiche un dashboard de télémétrie personnalisable.

## Architecture

~~~
Mission Planner / SITL
        │ WebSocket local
        ▼
Navigateur Mole ──┐
Navigateur Mole ──┼── wss://<service>/ws ──► Tunnel nommé ──► Viewers Molehill
Navigateur Mole ──┘                           public ou privé
~~~

- chaque tunnel possède un nom et un ID serveur éphémère ;
- un tunnel public fonctionne sans mot de passe et apparaît dans la liste publique ;
- un tunnel privé exige le même nom et le même mot de passe côté Mole et Molehill et n’est jamais listé ;
- plusieurs Moles et plusieurs viewers peuvent partager le même tunnel ;
- les tunnels, identifiants et dérivés de mots de passe restent uniquement en mémoire et disparaissent quand le dernier client part ;
- aucune télémétrie n’est enregistrée sur disque.

## Fonctionnalités

- autoconnection locale à Mission Planner sans activer le forwarding ;
- bouton unique **Connect + forward** ;
- création d’un tunnel ou ajout d’une Mole à un tunnel existant ;
- authentification privée avec mot de passe dérivé par scrypt et comparaison en temps constant ;
- limitation des tentatives d’authentification ;
- isolation stricte des trames entre tunnels ;
- enveloppe binaire légère de 8 octets pour identifier chaque Mole sans modifier la trame MAVLink ;
- carte Molehill multi-aéronefs avec fond satellite Esri ;
- trajectoire client des trois dernières minutes, échantillonnée à une seconde et progressivement estompée ;
- sélection de la Mole qui alimente le dashboard détaillé ;
- notification interne lorsqu’une nouvelle Mole commence réellement à envoyer du MAVLink, avec disparition après cinq secondes ;
- compteurs de tunnels, Moles actives et viewers ;
- widgets Position, airspeed, AGL, batterie, GNSS, Misc et températures ESC ;
- widgets personnalisés Valeur, courbe temporelle et jauge depuis les champs numériques MAVLink ;
- import et export JSON du dashboard ;
- courant batterie affiché en valeur absolue.

## Lancer en local

Node.js 22 est requis.

~~~powershell
npm install
npm test
npm start
~~~

Ouvrir ensuite :

- http://localhost:3000/mole?mode=create pour créer un tunnel ;
- http://localhost:3000/mole?mode=join pour ajouter une autre Mole ;
- http://localhost:3000/dig pour ouvrir un viewer.

Le tunnel **public** sans mot de passe conserve le parcours de démonstration en un clic.

### Tester sans Mission Planner

~~~powershell
npm run fake-source
~~~

Utiliser ensuite ws://127.0.0.1:5863 sur la page Mole.

## Sécurité et chiffrement

En production HTTPS, le navigateur utilise automatiquement wss://. TLS chiffre la télémétrie, le nom du tunnel et le mot de passe pendant le transport sans imposer de chiffrement/déchiffrement JavaScript par trame. Ajouter une seconde couche cryptographique applicative aurait un coût CPU et de latence sans bénéfice utile tant que le serveur doit relayer les données.

Le serveur ajoute également :

- une Content Security Policy ;
- une validation Same-Origin des connexions WebSocket navigateur ;
- HSTS en production ;
- nosniff, interdiction d’iframe et politique de permissions restrictive ;
- une limite de taille WebSocket ;
- aucune compression WebSocket, afin d’éviter CPU et latence inutiles ;
- une route statique limitée aux icônes réellement utilisées.

**ALLOWED_ORIGINS** peut contenir une liste d’origines supplémentaires séparées par des virgules si un frontend est hébergé sur un autre domaine.

### Visibilité du code

Le code serveur situé dans **server/** n’est jamais servi par Express. Les fichiers de travail présents dans **assets/source**, les bannières et les autres ressources non utilisées ne sont plus exposés non plus.

Le JavaScript exécuté dans un navigateur reste nécessairement téléchargeable et inspectable. La minification peut compliquer sa lecture, mais ne constitue pas une protection commerciale ou de sécurité. Les secrets, règles d’autorisation, comptes et futures fonctions payantes doivent donc rester côté serveur.

Sur Render, la commande de build minifie JavaScript et CSS sans générer de source maps. Les fichiers lisibles de **public/** restent utilisés en développement, tandis que la production sert **dist/**. Pour une future offre commerciale, le dépôt contenant les sources devra également rester privé.

## Déploiement Render

**render.yaml** configure Node.js 22, le mode production, le health check /healthz et le démarrage du service.

~~~powershell
git push
~~~

Render termine TLS en frontal et transmet le protocole d’origine au service, ce qui permet à l’interface d’indiquer si le tunnel utilise bien TLS.

Les sessions sont actuellement stockées en mémoire. Il faut conserver une seule instance Render pour cette démo. Un déploiement multi-instance demandera un registre partagé et un bus de messages, par exemple Redis.

## Endpoints

- GET /healthz : état technique et compteurs du relais ;
- GET /api/stats : nombre global de tunnels, Moles et viewers ;
- GET /api/streams : tunnels publics uniquement ;
- GET /mole : source Mission Planner ;
- GET /dig : viewer Molehill ;
- GET /ws?role=mole|digger : connexion WebSocket, suivie d’un message d’authentification tunnel.join.

## Limites de la démo

- pas encore de comptes, paiement, quota persistant ou récupération de mot de passe ;
- tunnels perdus au redémarrage du service ;
- historique de trajectoire construit dans le navigateur à partir du moment où le viewer se connecte ;
- TLS protège le transport, mais le service relais voit nécessairement les trames qu’il distribue ;
- l’accès WebSocket local depuis une page HTTPS dépend toujours des permissions réseau local du navigateur.
