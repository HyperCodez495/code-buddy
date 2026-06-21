# Les panneaux (onglets du dock)

Cette page recense **tous** les panneaux exposés par Cowork, l'application desktop Electron de Code Buddy. Le point d'entrée canonique est la barre latérale de navigation, définie une fois dans `src/renderer/components/ShellNavigation.tsx`.

> **À propos du nom « onglets du dock »** — il ne s'agit pas d'onglets façon navigateur. C'est une **barre latérale gauche toujours déployée** (libellés et en-têtes de groupe visibles par défaut ; voir le commentaire `ShellNavigation.tsx:435` et les commits récents « left menu expanded by default »). Chaque bouton ouvre un panneau, une boîte de dialogue ou un overlay.

## Deux types d'entrées (à ne pas confondre)

Les boutons de la barre latérale ne sont pas homogènes. Il en existe **deux familles**, et c'est volontaire :

| Type | Mécanisme | Fichier cité |
|---|---|---|
| **Panneau à drapeau propre** | Possède un flag de store `show*` (ex. `showFleetPanel`) et ouvre un panneau / dialogue / overlay autonome | Son propre composant |
| **Raccourci vers un onglet Settings** | Appelle `openSettingsTab('clé')` — n'ouvre **pas** un panneau distinct, mais l'onglet correspondant de `SettingsPanel.tsx` | `SettingsPanel.tsx` (onglet `'clé'`) |

Dans les tableaux ci-dessous, la colonne **Fichier** reflète cette distinction. La colonne **Statut** vaut `Stable` ou `Expérimental` : `Expérimental` correspond exactement aux entrées marquées `(exp)` dans la spécification produit — rien n'est inventé, rien n'est sur-vendu.

---

## Groupe WORK (Travail)

Le cœur de l'expérience. La **Work surface** (« surface de travail ») n'est pas un panneau distinct : c'est la vue principale rendue par `ChatView.tsx`. Le bouton `Work surface` y revient (`setShowSettings(false)`), `New task` réinitialise la session active. Il n'y a donc **pas** de bouton « Chat » séparé — le chat *est* la surface de travail.

| Panneau | Rôle | Fichier | Statut |
|---|---|---|---|
| Work surface | Revient à la surface principale (le chat) | `ChatView.tsx` | Stable |
| New task | Démarre une nouvelle tâche / session vierge | (action `ShellNavigation.tsx`, vide la session) | Stable |
| Global Search | Recherche transverse : sessions, messages, mémoire, connaissances, fichiers | `GlobalSearchDialog.tsx` (boîte de dialogue) | Stable |
| Focus view | Vue concentrée sur une session unique, navigation clavier | `FocusView.tsx` | Expérimental |
| Bookmarks | Marque-pages de messages / sessions | `BookmarksPanel.tsx` | Stable |

---

## Groupe AGENTS & FLEET (Agents & flotte)

Lancement d'équipes multi-agents et observation de la flotte de pairs Code Buddy.

| Panneau | Rôle | Fichier | Statut |
|---|---|---|---|
| Orchestrator launcher | Lance une équipe multi-agents (orchestrateur) | `OrchestratorLauncher.tsx` | Expérimental |
| Agent Team | Coordination d'une équipe d'agents | `TeamPanel.tsx` | Expérimental |
| Fleet Command Center | Centre de commande de la flotte (santé, pairs, coûts, sagas) | `FleetCommandCenter.tsx` | Stable |
| Fleet peer events | Flux brut des événements des pairs de la flotte | `FleetPanel.tsx` | Stable |
| Autonomy | Pilotage de la boucle autonome (daemon, board) | `AutonomyPanel.tsx` (monté via `DockWorkspace.tsx`, lazy) | Stable |
| Paired devices | Appareils appairés (SSH / ADB / local) | `DevicePanel.tsx` | Expérimental |

---

## Groupe AUTOMATION (Automatisation)

Les quatre entrées suivantes sont des **raccourcis vers Settings** (elles ouvrent un onglet de `SettingsPanel.tsx`), pas des panneaux autonomes.

| Panneau | Rôle | Fichier | Statut |
|---|---|---|---|
| Workflows (DAG) | Éditeur visuel de workflows en graphe acyclique (DAG) | `SettingsPanel.tsx` (onglet `'workflows'`) → `settings/SettingsWorkflows.tsx` → `WorkflowEditor.tsx` | Stable |
| Research / Flow launcher | Lance une recherche large ou un flow `plan → execute → synthesize` | `LiveLauncherPanel.tsx` | Expérimental |
| Mission Board | Tableau de missions | `MissionBoardPanel.tsx` | Expérimental |
| Desktop Snapshot | Capture de l'état du bureau | `DesktopSnapshotPanel.tsx` | Expérimental |
| Schedules | Planification cron de tâches récurrentes | `SettingsPanel.tsx` (onglet `'schedule'`) → `settings/SettingsSchedule.tsx` | Stable |
| Hooks & triggers | Hooks et déclencheurs d'événements | `SettingsPanel.tsx` (onglet `'hooks'`) → `settings/SettingsHooks.tsx` | Stable |
| Custom commands | Commandes personnalisées (slash) | `SettingsPanel.tsx` (onglet `'customCommands'`) → `settings/SettingsCustomCommands.tsx` | Stable |

---

## Groupe COMPANION (Compagnon)

La couche perceptive / présence du « buddy ». Le panneau Companion s'appuie sur le système sensoriel (voix, vision, présence) ; voir `src/sensory/`. Les canaux de livraison incluent des stubs in-process pour certains transports (cohérent avec le statut expérimental).

| Panneau | Rôle | Fichier | Statut |
|---|---|---|---|
| Buddy companion | Présence du compagnon : vision, audition, écran, self-state, journal sensoriel | `CompanionPanel.tsx` | Stable |
| Delivery channels | Canaux de livraison (notifications / messageries) | `ChannelsPanel.tsx` | Expérimental |
| Mobile supervision | Supervision depuis mobile | `MobileSupervisionPanel.tsx` | Expérimental |

---

## Groupe INSIGHTS (Observabilité & apprentissage)

| Panneau | Rôle | Fichier | Statut |
|---|---|---|---|
| Activity | Flux d'activité de l'agent | `ActivityFeed.tsx` | Stable |
| Session insights | Statistiques et insights de session | `SessionInsightsPanel.tsx` | Stable |
| Test runner | Lanceur de tests | `TestRunnerPanel.tsx` | Stable |
| Lesson candidates | Leçons candidates issues de l'auto-amélioration | `LessonCandidatePanel.tsx` | Expérimental |
| User model | Modèle de l'utilisateur (préférences apprises) | `UserModelPanel.tsx` | Expérimental |
| Spec backlog | Backlog de spécifications | `SpecPanel.tsx` | Expérimental |
| Reasoning traces | Visualiseur des traces de raisonnement (ToT / MCTS) | `ReasoningTraceViewer.tsx` (monté via `DockWorkspace.tsx`, lazy) | Stable |
| Memory | Éditeur / navigateur de la mémoire persistante | `MemoryPanel.tsx` | Stable |

---

## Groupe SYSTEM (Système)

Les raccourcis Settings (API, Connectors, Permission rules, Plugins) ouvrent les onglets correspondants de `SettingsPanel.tsx`.

| Panneau | Rôle | Fichier | Statut |
|---|---|---|---|
| Agent identity | Identité de l'agent | `IdentityPanel.tsx` | Expérimental |
| Settings | Panneau de réglages global (onglets) | `SettingsPanel.tsx` | Stable |
| API Settings | Configuration des providers / clés API | `SettingsPanel.tsx` (onglet `'api'`) → `settings/SettingsAPI.tsx` | Stable |
| MCP Connectors | Connecteurs MCP (serveurs d'outils) | `SettingsPanel.tsx` (onglet `'connectors'`) → `settings/SettingsConnectors.tsx` | Stable |
| Permission rules | Règles de permission déclaratives | `SettingsPanel.tsx` (onglet `'rules'`) → `settings/SettingsPermissionRules.tsx` | Stable |
| Skills | Gestionnaire de skills (installées + candidates) | `skills-manager-page.tsx` (`SkillsManagerWrapper`) | Stable |
| Plugins | Gestionnaire de plugins | `SettingsPanel.tsx` (onglet `'plugins'`) → `settings/SettingsPlugins.tsx` | Stable |

---

## Panneaux secondaires (hors barre latérale)

Ces panneaux ne sont **pas** des entrées de la barre latérale. Ils vivent dans le dock contextuel droit (`ContextPanel.tsx`) ou sont rendus directement par `App.tsx`. La plupart sont **imbriqués** dans `ContextPanel.tsx`, qui est le dock contextuel de droite.

| Panneau | Rôle | Fichier | Hôte / montage |
|---|---|---|---|
| Context | Dock contextuel droit : artefacts, checkpoints, diffs, git | `ContextPanel.tsx` | Rendu par `App.tsx` |
| Artifacts | Liste / aperçu des artefacts produits | `ArtifactPanel.tsx` | Rendu par `App.tsx:573` ; liste inline aussi dans `ContextPanel.tsx` |
| Checkpoints | Timeline des checkpoints + comparaison | `CheckpointPanel.tsx` | Imbriqué dans `ContextPanel.tsx` |
| Git status | État Git du workspace | `GitStatusPanel.tsx` | Imbriqué dans `ContextPanel.tsx` |
| Diff viewer | Visualiseur de diffs (fichiers, checkpoints, tool-use) | `DiffViewer.tsx` | Imbriqué dans `ContextPanel.tsx` (et `message/ToolUseBlock.tsx`) |

---

## Notes d'honnêteté

- **Solide (Stable)** : surface de travail / chat, Global Search, Bookmarks, Fleet Command Center & peer events, Autonomy, Activity, Session insights, Test runner, Reasoning traces, Memory, et l'ensemble des onglets Settings (API, Connectors, Permission rules, Plugins, Workflows DAG, Schedules, Hooks, Custom commands), Skills, Companion.
- **Expérimental** : Focus view, Orchestrator launcher, Agent Team, Paired devices, Research / Flow launcher, Mission Board, Desktop Snapshot, Delivery channels (certains transports = stubs in-process), Mobile supervision, Lesson candidates, User model, Spec backlog, Agent identity.
- **Vérification** : tous les libellés, identifiants d'action et flags `show*` proviennent de `ShellNavigation.tsx` ; les routages d'onglets (`openSettingsTab`) et les composants de contenu ont été vérifiés dans `SettingsPanel.tsx` et `src/renderer/components/settings/` ; les montages des panneaux à drapeau ont été vérifiés dans `App.tsx` et `DockWorkspace.tsx`.
