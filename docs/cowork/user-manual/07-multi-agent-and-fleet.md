# 7. Multi-agent & fleet

Cowork peut faire tourner plusieurs agents à la fois — en local comme **sous-agents** et **teams**,
ou entre machines comme une **fleet** — et suivre le travail sur un **tableau Kanban**.

## 7.1 Sous-agents

Une tâche complexe peut engendrer des agents auxiliaires en parallèle (explorer, coder, reviewer,
tester…). L'onglet **Sous-agents** du panneau de contexte, et le **tableau de bord des sous-agents**
(`Cmd/Ctrl+Maj+A`), montrent le rôle de chacun, son statut (en cours / en attente / terminé /
erreur), son étape courante et sa sortie. Dépliez un agent pour lire sa sortie, lui envoyer une
entrée, ou l'arrêter.

> _[capture : tableau de bord des sous-agents]_

## 7.2 L'orchestrator

L'**orchestrator** (`Cmd/Ctrl+Maj+M`, ou le bouton « sparkles ») lance une team vers un objectif.
Vous choisissez une **stratégie** :

| Stratégie | Fonctionnement |
|---|---|
| **Parallel** | Tous les membres travaillent en même temps ; les résultats sont agrégés |
| **Sequential** | L'un après l'autre ; la sortie de chacun nourrit le suivant |
| **Hierarchical** | Un orchestrateur délègue des sous-tâches ; des reviewers vérifient |
| **Peer review** | Le coder écrit, le reviewer audite, le tester valide (gates explicites) |
| **Iterative** | La team boucle jusqu'au consensus ou un nombre max de tours |

Réglez l'**objectif** (pré-rempli depuis votre dernier message) et le **nombre max de tours**, puis
démarrez. La progression s'affiche dans les vues sous-agents et le chat.

> _[capture : lanceur d'orchestrator]_

## 7.3 Teams

Le panneau **Team** est un tableau d'observabilité d'une team en cours : son objectif, ses membres et
rôles, une liste de tâches partagée, et une boîte aux lettres des messages inter-agents. Démarrez ou
arrêtez une team, ajoutez ou retirez des membres, et suivez le statut de chacun.

## 7.4 Fleet — des agents entre machines

Une **fleet** relie plusieurs instances de Code Buddy sur votre réseau **Tailscale** pour qu'elles
s'observent et appellent leurs modèles respectifs (par exemple piloter un Ollama local sur une autre
machine, gratuitement).

- **Panneau Fleet** — ajoutez un peer par son URL WebSocket + clé API (la clé a besoin des scopes
  fleet), suivez le statut des peers (connecting → connected → authenticated), et lisez un flux
  d'événements en direct (débuts/fins d'outils, progression de workflow, spawns de sous-agents,
  présence, compaction).
- **Fleet Command Center** — un hub à trois volets : les peers à gauche, un **dispatcher** d'objectif
  au centre, et le détail des sagas à droite. Dispatchez un objectif sur les peers/providers et
  suivez-le. Des bandeaux d'utilisation et de coût résument la charge et la dépense sur la fleet.

> _[capture : Fleet Command Center]_

## 7.5 Le tableau Kanban unifié

Le **tableau Kanban** est un tableau de tâches persistant pour l'espace de travail (la fonction phare
du build `fleet-unified-kanban`). Ouvrez-le depuis le Control center ou la palette de commandes.

- **Tableaux :** basculez entre des tableaux nommés ou créez-en un ; chacun affiche son nombre de
  cartes.
- **Colonnes :** **To do**, **In progress**, **Blocked**, **Done**.
- **Cartes :** un titre et une **priorité** (low / medium / high / urgent), avec compteurs de
  **commentaires** et de **liens**, et une **raison de blocage** quand bloquée.
- **Actions** (par carte) : compléter, bloquer/débloquer (avec une raison), commenter, lier (URL ou
  une autre carte), et archiver. Ajoutez une carte depuis la ligne du haut (titre + priorité +
  **Add**).

Dans le Fleet Command Center, un **saga board** montre les jobs de la fleet dans le même style kanban
(pending → running → done), avec une vue de détail et les résultats finaux par saga.

> _[capture : tableau Kanban]_

## 7.6 Missions & swarms

Pour des objectifs persistants de plus longue haleine, il existe des tableaux de plus haut niveau —
un **mission board** (un backlog de missions companion) et un **swarm coordinator** (orchestration de
plusieurs groupes d'agents). À utiliser quand une seule session ne suffit pas à porter le travail.
