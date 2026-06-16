# Code Buddy – Feuille de route Système Autonome (Autonomous Agent System)

**Objectif principal** : Transformer Code Buddy + Cowork en un **système autonome complet** capable de prendre en charge des tâches complexes de bout en bout, de travailler de manière proactive et indépendante, et de permettre un suivi complet (lancement, progression, traces, approbations) directement depuis l’interface Cowork.

Le but est d’avoir un « employé IA personnel » qui :
- Reçoit des missions complexes (via chat Cowork, CLI, hooks, ou même messaging futur)
- Les décompose, planifie et exécute de manière autonome
- Utilise les bridges existants (Workflow, SubAgent, Fleet, Presence, Hooks...)
- Rend compte en temps réel dans Cowork (UI dédiée Mission Board / Task Tracker)
- Apprend et s’améliore (meta-skills, mémoire persistante)
- Fonctionne de façon proactive (heartbeat + monitoring)

Ce document est une liste approfondie et priorisée des améliorations nécessaires. Il peut servir de base pour des tickets GitHub, des prompts pour Claude Code / Code Buddy lui-même, ou pour des agents qui implémentent ces features.

**Date de création** : 7 juin 2026
**Statut** : Proposition détaillée – prête à être implémentée par le système lui-même ou par toi.

---

## 1. Vision globale du système autonome

Un **Mission Orchestrator** central (basé sur les bridges existants WorkflowBridge + SubAgentBridge + FleetBridge) qui :
- Accepte des tâches complexes en langage naturel ou via formulaire Cowork
- Crée automatiquement un DAG de sous-tâches (workflow visuel)
- Assigne les sous-tâches à des sub-agents ou au Fleet (multi-LLM)
- Exécute de manière long-running avec checkpoints et reprise sur erreur
- Surveille proactivement (heartbeat par mission)
- Met à jour une UI « Mission Board » dans Cowork en temps réel
- Demande des approbations humaines seulement quand nécessaire (via PermissionDialog existant)
- Écrit tout dans la mémoire persistante (.codebuddy/ + SQLite)
- Peut s’auto-améliorer (créer/améliorer des skills ou des workflows types)

Intégration parfaite avec l’existant :
- Utilise déjà WorkflowBridge, SubAgentBridge, FleetBridge, HooksBridge, PresenceBridge
- S’appuie sur le CodeBuddyEngineRunner
- Rendu dans Cowork via ServerEvent streaming

---

## 2. Améliorations prioritaires (Phases)

### Phase 1 – Fondations Autonomie & Suivi (2-4 semaines – haute priorité)

**2.1 Mission / Task Intake System**
- Nouveau namespace IPC `mission` ou extension de `workflow`
- UI dans Cowork : panneau « Nouvelle Mission » ou chat spécial `/mission "décris ta tâche complexe"`
- Parsing + décomposition automatique via LLM (prompt structuré + Tree-of-Thought ou MCTS existant)
- Création automatique d’un workflow DAG visuel (réutilise WorkflowBridge)
- Support de tâches longues (heures/jours) avec persistance d’état

**2.2 Mission Board UI dans Cowork (suivi en temps réel)**
- Nouvelle vue / composant `MissionBoard.tsx` ou extension de TracePanel / WorkflowEditor
- Liste des missions actives + historique
- Pour chaque mission :
  - Statut (Planning / Running / Waiting Approval / Paused / Completed / Failed)
  - Progression (0-100% ou par étape)
  - Sous-tâches / DAG interactif (clic pour détails)
  - Traces live (réutilise ServerEvent `trace.*` et `workflow.event`)
  - Logs, coûts, tokens
  - Boutons : Pause, Resume, Cancel, Request Human Input, View Full Trace
- Notifications push dans Cowork (via notification namespace existant)
- Intégration avec Presence (caméra pour « l’agent est en train de travailler » visuel)

Statut d'implémentation (2026-06-07) :
- Première surface renderer dédiée livrée via `MissionBoardPanel.tsx`, ouverte depuis le rail Cowork.
- Le panneau consomme les bridges existants `companion.missions.*`, affiche les colonnes `open`, `in_progress`, `done`, `dismissed`, et prépare la prochaine mission en `dryRun`.
- Reste à ajouter l'orchestrateur long-running, les événements live de progression, les coûts/tokens par mission et les contrôles Pause/Resume/Cancel.

**2.3 Heartbeat & Proactivity par Mission**
- Extension du heartbeat existant du core pour les missions
- Chaque mission a son propre `HEARTBEAT.md` ou section dans la mémoire
- Scheduler configurable (toutes les 15min / 1h / custom) qui réveille l’orchestrateur
- L’agent peut :
  - Vérifier l’avancement
  - Envoyer des updates proactives dans Cowork ou via canaux
  - Détecter blocages et proposer des solutions ou demander de l’aide
  - Exécuter des tâches de fond (nettoyage, recherche, etc.)

**2.4 Checkpointing & Reprise sur erreur long-running**
- Persistance d’état de mission (SQLite + fichiers JSON dans `~/.codebuddy/missions/`)
- Points de reprise automatiques après crash / redémarrage Cowork
- Auto-repair via middlewares existants + nouveaux hooks

### Phase 2 – Exécution Autonome Avancée (1-2 mois)

**2.5 Multi-Agent Orchestration pour Missions Complexes**
- Renforcement de SubAgentBridge + TeamBridge + FleetBridge
- Création automatique d’équipes d’agents spécialisés (ex. : Researcher, Coder, Reviewer, Executor, Communicator)
- Handoff protocol clair + mémoire partagée entre sub-agents
- Parallel execution quand possible (via orchestrator existant)

**2.6 Meta-Skills & Auto-Amélioration**
- Système de skills Markdown (comme OpenClaw) + registry
- L’agent peut créer, modifier, tester et versionner ses propres skills/workflows via conversation ou heartbeat
- Skill-creator amélioré (déjà partiellement là) intégré au processus de mission
- Auto-génération de templates de missions récurrentes (ex. : « revue de code hebdo », « analyse concurrentielle »)

**2.7 Approbations & Human-in-the-Loop Intelligent**
- Extension du PermissionDialog existant
- Règles configurables par type de mission (low-risk = auto, high-risk = ask)
- Possibilité de « delegate with constraints » (l’agent propose un plan et exécute seulement les parties approuvées)

**2.8 Intégration Messaging & Canaux (pour input/output autonome)**
- Ajout d’adapters WhatsApp / Telegram / Discord (via bridges ou nouveau Gateway)
- L’agent peut recevoir des missions via chat et rendre compte directement
- Complète le Cowork desktop (pas remplacer)

### Phase 3 – Expérience Utilisateur & Écosystème (continu)

**2.9 UI/UX Mission-Centric dans Cowork**
- Dashboard principal orienté « Missions & Progrès » (au lieu de simple chat)
- Vue kanban ou liste des missions
- Intégration avec les workflows visuels existants
- Historique complet + recherche + export
- Thème « Agent au travail » avec animations subtiles (basé sur presence)

**2.10 Mémoire & Contexte Long-Term pour Missions**
- Standardisation des fichiers mémoire (SOUL.md, MISSION.md, PROGRESS.md, etc.)
- Recherche vectorielle + sémantique sur l’historique des missions
- Partage de contexte entre missions liées

**2.11 Monitoring, Coûts & Sécurité**
- Dashboard coûts par mission (extension costDashboard existant)
- Alertes sur dépassement budget/tokens
- Audit trail complet de chaque action
- Sandbox renforcé par mission (niveaux de permission par type de tâche)

**2.12 Self-Hosting & Scalabilité**
- Possibilité de lancer plusieurs instances Cowork / Fleet peers
- Synchronisation via Tailscale ou MCP
- Mode « headless mission runner » (sans UI mais avec suivi distant)

---

## 3. Implémentation suggérée (comment le système peut se charger lui-même)

1. Créer ce fichier comme base de connaissance.
2. Utiliser `/mission` ou un prompt structuré dans Cowork pour demander au système d’implémenter une phase ou une feature spécifique.
3. Le Mission Orchestrator (une fois Phase 1 en place) peut :
   - Lire ce roadmap
   - Choisir la prochaine tâche prioritaire
   - Créer un workflow de développement
   - Assigner à des sub-agents (un pour le code, un pour les tests, un pour la doc)
   - Exécuter, tester, itérer
   - Rendre compte dans la Mission Board
4. Intégrer avec les hooks existants pour des triggers automatiques (ex. : nouveau commit → mission de revue).

**Prompt exemple pour lancer une tâche autonome** :
```
Crée et implémente la feature "Mission Board UI" décrite dans docs/AUTONOMOUS-SYSTEM-ROADMAP.md.
Décompose en sous-tâches, utilise les bridges existants, crée les composants React nécessaires, assure le streaming des événements, et teste.
Suit le processus complet et tiens-moi informé via les traces et la Mission Board.
```

---

## 4. Bénéfices attendus

- Gain de temps massif sur les tâches répétitives ou complexes
- Suivi transparent et contrôle (tu restes aux commandes via Cowork)
- Proactivité réelle (l’agent travaille même quand tu n’es pas là)
- Auto-amélioration continue du système
- Positionnement unique vs OpenClaw : plus sécurisé, plus orienté dev/coding, intégré desktop + CLI + Fleet, avec vision locale
- Base pour le projet long-terme « Claude et Patrice » (robot + companion)

---

## 5. Prochaines étapes immédiates recommandées

1. Valider ce document et l’ajuster si besoin.
2. Implémenter Phase 1.1 + 1.2 (Mission Intake + Mission Board basique) – cela permet déjà de suivre des tâches complexes.
3. Ajouter le heartbeat par mission.
4. Utiliser le système pour implémenter les phases suivantes (bootstrap).
5. Ajouter des démos vidéo et mettre à jour le README principal.

---

**Ce fichier est conçu pour être lu et utilisé par le système lui-même.**
Tu peux maintenant dire à Code Buddy / Cowork : « Lis docs/AUTONOMOUS-SYSTEM-ROADMAP.md et commence à implémenter la Phase 1 en créant une Mission Board. »

Le système prendra la tâche en charge, la décomposera, travaillera dessus, et te tiendra informé dans l’interface Cowork.

C’est le début d’un vrai système autonome qui travaille pour toi. ❤️

---

*Document généré avec amour et analyse approfondie par Grok (Ara) pour Patrice.*
