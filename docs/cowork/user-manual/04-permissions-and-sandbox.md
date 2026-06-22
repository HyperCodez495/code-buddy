# 4. Permissions & sandbox

Cowork est conçu pour laisser un agent IA agir sur votre machine **en toute sécurité**. Deux systèmes
s'en chargent : les **modes/règles de permission** (ce que l'agent peut faire) et la **sandbox** (où
il s'exécute).

## 4.1 Modes de permission

Un sélecteur dans la barre de titre règle ce que l'agent peut faire avant de demander. Il y a
**cinq modes** :

| Mode | Comportement | Quand l'utiliser |
|---|---|---|
| **Default** | Demande avant les éditions et les commandes | Base sûre ; vous approuvez chaque action sensible |
| **Accept edits** | Auto-approuve les éditions de fichiers ; demande encore pour les commandes | Vous faites confiance à l'agent pour modifier les fichiers |
| **Plan mode** | Lecture seule ; l'agent explore mais ne modifie rien | Investigation sans aucun risque |
| **Don't ask** | Auto-approuve tout | Automatisation répétitive et de confiance |
| **Full auto** | Aucune restriction | Exécution sans limite — à utiliser avec prudence |

Le mode persiste entre les sessions. Commencez en **Default** et montez délibérément.

> _[capture : sélecteur de mode de permission]_

> Le **mode YOLO** est un interrupteur séparé qui saute les confirmations pour des runs rapides et
> sans intervention. Traitez-le comme *Full auto* : seulement sur du code et des dossiers que vous
> acceptez de laisser l'agent modifier librement.

## 4.2 Le dialogue de permission & l'assistant de règles

Quand une approbation est requise, le dialogue montre l'**outil**, ses **entrées** et un indicateur
de **risque** ; pour les actions GUI/computer-use, il peut afficher une capture et la cible. Au-delà
d'Autoriser / Refuser / Toujours autoriser, un **assistant de règles** propose une règle *cadrée*
(ex. autoriser `Bash(npm *)` plutôt que tout bash) que vous pouvez éditer et enregistrer avant de
décider. C'est la façon sûre de réduire les demandes sans tout ouvrir.

## 4.3 Règles de permission

**Réglages → Permission rules** est l'endroit où vivent les politiques allow/deny.

- **Syntaxe :** `Outil` (toutes les utilisations) ou `Outil(motif)` — ex. `Read`, `Bash(git *)`,
  `Edit(src/**)`, `Bash(rm -rf *)`.
- **Deux listes :** une liste **allow** (auto-approuve) et une liste **deny** (auto-refuse).
- **Scopes :** les règles sont groupées en *site* (origines web), *app/target* (surfaces UI /
  computer-use), ou *generic* (outils, chemins, commandes).
- **Ordre de décision :** deny est vérifié d'abord, puis allow, sinon l'agent **demande**.
- **Testeur dry-run :** tapez un outil + un argument (ex. `Bash npm install`) pour voir si les règles
  actuelles donneraient ALLOW / ASK / DENY, et quelle règle correspond.

Exemples :

```
Allow :  Read · Bash(npm *) · Bash(git *) · Edit(src/**)
Deny  :  Bash(rm -rf *) · Edit(.env*)
```

> _[capture : Réglages → Permission rules avec le testeur dry-run]_

## 4.4 La sandbox

Les commandes des outils s'exécutent dans un **environnement isolé** pour que l'agent ne touche pas à
votre système au sens large.

| Niveau | Plateforme | Ce que ça fait |
|---|---|---|
| **Path guard** | Toutes | Les opérations fichier sont confinées au dossier de travail choisi |
| **WSL2** | Windows | Les commandes tournent dans une distro Linux isolée ; l'espace de travail est synchronisé |
| **Lima** | macOS | Les commandes tournent dans une VM Linux ; l'espace de travail est synchronisé |
| **Natif** | Linux / sans VM | Exécution directe sur l'hôte, bornée par le path guard |

La **configuration** est dans **Réglages → Sandbox** : plateforme et mode détectés, présence des
outils requis (Node, Python, pip), et boutons pour installer les runtimes manquants ou démarrer la
VM.

- **Windows :** installez WSL2 (`wsl --install`) une fois ; Cowork le détecte automatiquement.
- **macOS :** installez Lima (`brew install lima`) ; puis initialisez-le depuis l'onglet Sandbox.
- **Linux / sans VM :** Cowork retombe sur l'exécution native avec le path guard.

> _[capture : Réglages → Sandbox]_

## 4.5 Ce que l'agent voit et ne voit pas

- **Voit :** les fichiers dans le dossier de travail, les outils CLI disponibles dans la sandbox, et
  (si vous l'autorisez) le réseau et les surfaces computer-use.
- **Ne voit pas (par défaut) :** les fichiers hors du dossier de travail, vos secrets dans le home
  (clés SSH/cloud), et les commandes privilégiées — une élévation demande un mot de passe seulement
  si c'est réellement nécessaire.
