# Rapport d'Audit Complet : Collaboration et Autonomie des Agents

**Date :** 2026-05-26
**Projet :** Code Buddy + Cowork Electron GUI + Fleet Multi-AI Hub
**Workspace :** `D:/CascadeProjects/grok-cli-weekend`
**Auteur :** Antigravity AI Coding Assistant

---

## 1. Introduction et Objectif de l'Audit

Cet audit a pour but d'analyser en profondeur les mécanismes actuels d'**autonomie** et de **collaboration multi-agents** au sein du projet Code Buddy.

L'objectif ultime est de permettre à des agents spécialisés de collaborer de façon autonome et transparente tout en gardant une supervision humaine sécurisée. Nous comparons ici notre infrastructure avec les solutions leaders du marché et formulons des propositions de modifications concrètes et immédiatement applicables.

---

## 2. Architecture Multi-Agents Actuelle de Code Buddy

L'infrastructure d'agents de Code Buddy s'appuie sur quatre piliers majeurs :

```
             ┌─────────────────────────────────────────┐
             │            ChatInterface (UI)           │
             └────────────────────┬────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
        ┌───────────────────────┐   ┌───────────────────────┐
        │  CodeBuddyAgent Loop  │   │  MultiAgentSystem     │
        │  (Single Agent Run)   │   │  (MAS Coordination)  │
        └───────────┬───────────┘   └───────────┬───────────┘
                    │                           │
                    │                           ├─ Sequential / Parallel
                    │                           ├─ Hierarchical (Orchestrator)
                    │                           ├─ Peer Review / Iterative
                    │                           ▼
                    │               ┌───────────────────────┐
                    │               │ Specialized Agents:   │
                    │               │ Orchestrator, Coder,  │
                    │               │ Reviewer, Tester      │
                    │               └───────────────────────┘
                    ▼
        ┌───────────────────────────────────────────────────┐
        │ Fleet Bridge (P2P WebSocket Mesh / Fleet Hub)      │
        │ - peer.chat, peer.chat-session, peer.tool.invoke  │
        └───────────────────────────────────────────────────┘
```

### 2.1. Agents Spécifiés et Registre
* **[agent-registry.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/agent/specialized/agent-registry.ts) :** Enregistre et gère le cycle de vie de 8 agents intégrés spécialisés : PDF, Excel, DataAnalysis, SQL, Archive, CodeGuardian (sécurité des PR), SecurityReview, et le SWE Agent (développeur logiciel autonome).
* **SWE Agent (OpenManus-like) :** Construit autour d'une boucle "think-act" robuste, avec une détection de blocage (rejet des répétitions identiques de 3 actions consécutives) et contrôle de fin de boucle via le signal `__AGENT_TERMINATE__`.

### 2.2. Système Multi-Agents (MAS) et Coordination
* **[multi-agent-system.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/agent/multi-agent/multi-agent-system.ts) :** Coordonne les 4 rôles majeurs (`orchestrator`, `coder`, `reviewer`, `tester`) à l'aide de 5 topologies de collaboration :
  1. *Sequential* : Exécution linéaire ordonnée par dépendance de tâches.
  2. *Parallel* : Parallélisation des tâches indépendantes au sein d'une phase de build/test.
  3. *Hierarchical* : Structure chef-subordonné managée par l'Orchestrateur.
  4. *Peer Review* : Validation croisée critique (validation mutuelle avant validation finale).
  5. *Iterative* : Cycle fermé d'implémentation et de correction guidé par les retours de tests.
* **[workflow-orchestrator.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/agent/multi-agent/workflow-orchestrator.ts) :** Fournit un exécuteur pour l'exécution parallèle de flux et la gestion de file d'attente.
* **[enhanced-coordination.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/agent/multi-agent/enhanced-coordination.ts) :** Gère la détection de conflits de code (`code_overlap`) et l'attribution dynamique des sous-tâches selon les scores d'efficacité historique des agents.

### 2.3. Coordination Légère d'Équipe ("Agent Teams")
* **[team-manager.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/agent/multi-agent/team-manager.ts) :** Propose une coordination décentralisée interactive via la commande `/team`. Un agent assume le rôle de Team Lead, assigne des tâches à des Teammates disposant de fenêtres de contexte indépendantes, et communique via une boîte aux lettres partagée (`mailbox`) et une liste de tâches globale.

### 2.4. Le Mesh "Fleet" (Multi-AI Hub)
* **[fleet-bridge.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/server/websocket/fleet-bridge.ts) :** Permet la collaboration inter-machines (WebSockets). Les pairs partagent des événements, délèguent des sous-tâches (`peer_delegate`), invoquent des outils distants en lecture seule (`peer.tool.invoke`) après passage par 3 barrières de sécurité (allowlist, attribut `fleetSafe`, restriction de dossier racine), et maintiennent des sessions de chat collaboratives (`peer.chat-session`).

---

## 3. Analyse Comparative avec la Concurrence

Pour positionner Code Buddy, nous le comparons aux frameworks multi-agents de pointe :

| Dimension d'Autonomie / Collaboration | Code Buddy (Actuel) | Microsoft AutoGen | CrewAI | LangGraph | Cognition Devin / Devika | Manus Browser Agent |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Boucle d'apprentissage fermée** | **Partiel** : Leçons apprises persistées, mais non réinjectées automatiquement par défaut dans toutes les exécutions d'outils. | **Complet** : Ingestion automatique de feedback et génération dynamique de "skills" réutilisables. | **Absent** : Execution purement basée sur les prompts de départ. | **Sur-mesure** : Doit être programmée explicitement via le graphe d'états. | **Complet** : Apprentissage et mémorisation automatiques des corrections d'erreurs. | **Non applicable** : Agent spécialisé orienté Web. |
| **Topologies de Collaboration** | **Très Riche** : Sequential, Parallel, Hierarchical, Peer-Review, Iterative + Teams et Fleet WS Mesh. | **Très Riche** : Graphes de conversation dynamiques, sélection d'agent par LLM ou code. | **Moyen** : Processus séquentiels et hiérarchiques rigides. | **Extrême** : Définition de graphes d'états cycliques arbitraires (State Graph). | **Hiérarchique** : Système à base d'agents superviseurs et d'agents spécialisés. | **Monolithique** : Un agent principal décomposant en sous-étapes d'actions. |
| **Communication Distribuée (P2P)** | **Excellent** : Mesh WebSocket natif (Fleet Bridge) pour le partage de chat, sessions et invocation d'outils. | **Moyen** : Supporte la messagerie distribuée via RabbitMQ/event-bus, complexe à configurer. | **Absent** : Local uniquement. | **Absent** : Déploiement serveur unitaire (LangGraph Cloud), pas de mesh P2P. | **Absent** : Infrastructure cloud unitaire fermée. | **Absent** : Outil web fermé. |
| **Sécurité & Sandboxing d'Outils** | **Excellent** : 3 barrières de sécurité, modes d'autorisation, validation par signature de jeton et isolation. | **Moyen** : Exécution de code dans un conteneur Docker local ou sandbox légère. | **Faible** : Fait confiance aux scripts Python locaux sans isolation stricte. | **Moyen** : L'utilisateur doit configurer sa propre isolation d'outils. | **Excellent** : Machine virtuelle isolée complète par run. | **Moyen** : Sandbox locale, logs de navigation complets. |
| **Automatisation Web / Navigateur** | **Partiel** : Capture d'écran et extraction statique existantes, mais pas de pilote interactif autonome. | **Moyen** : Supporte Playwright/Selenium via du code écrit par les agents à la volée. | **Moyen** : Intègre des outils de recherche web de base. | **Moyen** : S'appuie sur des intégrations d'outils tiers (BrowserUse, etc.). | **Excellent** : Navigation interactive complète, résolution de Captchas. | **Leader** : Exécuteur de navigateur interactif autonome avec cockpit de visualisation. |
| **Supervision Mobile & À Distance** | **Absent** : Aucun canal actif hors du réseau local ou mesh WS. | **Absent** : Principalement destiné à être déployé comme service backend. | **Absent** : Pas de supervision mobile native. | **Moyen** : UI web de monitoring (LangSmith), pas de supervision active mobile. | **Excellent** : Interface web complète, alertes Slack/SMS. | **Moyen** : Interface web de visualisation en temps réel. |

---

## 4. Gaps Majeurs Identifiés (Obstacles à l'Autonomie & Collaboration)

1. **Absence d'ingestion automatique de la personnalité de l'utilisateur (User Model) :**
   L'agent ne dispose pas automatiquement des préférences utilisateur (préférences de style de code, technologies favorites) lors du démarrage d'une session, sauf s'il appelle explicitement l'outil `user_model_recall`.
2. **Provenance incomplète de l'usage des leçons apprises :**
   Bien que nous sachions quelle run a *créé* une leçon, nous n'enregistrons pas automatiquement quelles runs ultérieures ont *chargé* et *utilisé* cette leçon. La cartographie d'utilité des connaissances reste donc statique.
3. **Lignage de run brisé lors des compactions de contexte :**
   Lorsqu'une session subit une compaction de son historique de messages, l'ancien historique est compressé, mais le lien de filiation parent/enfant (`parentRunId`) n'est pas programmatiquement tracé via `forkRun`.
4. **Cloisonnement incomplet des compétences (Skills) dans l'UI et le prompt :**
   Les compétences (skills) désactivées par l'utilisateur ne sont pas formellement exclues du contexte injecté à l'agent, ce qui peut l'amener à tenter de les exécuter.
5. **Passivité du Browser Operator :**
   Le système propose uniquement des brouillons de session (`buildBrowserOperatorSessionDraft`). Aucun exécuteur réel ne gère la boucle de navigation Playwright interactive avec demande de consentement pas-à-pas à la façon de Manus.
6. **Passerelles de communication non-câblées :**
   Aucun listener actif n'est démarré pour traiter les interactions mobiles (`/api/mobile/*`) ou les messages inbound Telegram/Slack/Discord, limitant l'autonomie en dehors de la machine hôte.

---

## 5. Propositions de Modifications Détaillées

Nous proposons une série de modifications techniques structurées en 4 axes prioritaires.

### Axe 1 : Fermeture de la Boucle d'Apprentissage (Learning Loop)

```
┌────────────────────────┐        ┌────────────────────────┐
│     User Model         │        │    Lessons Database    │
│  (Accepted Preferences)│        │  (Obsidian Vault etc)  │
└───────────┬────────────┘        └───────────┬────────────┘
            │                                 │
            └────────────────┬────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────┐
│             Agent Context Pipeline                       │
│  - Inject dynamic <user_model_context>                   │
│  - Inject dynamic <lessons_context>                      │
└────────────────────────────┬─────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────┐
│                 LLM Execution Turn                       │
│  - Record usage of lessons dynamically                   │
│  - Trigger forkRun('compaction') on Context Compression  │
└──────────────────────────────────────────────────────────┘
```

#### Proposition 1.1 : Injection automatique du Profil Utilisateur
* **Description :** Injecter automatiquement les observations acceptées du modèle utilisateur (`getUserModel(cwd).summarize()`) dans le cycle de génération de prompt sous la forme d'un bloc `<user_model_context>`, de manière identique à l'injection des leçons.
* **Fichiers cibles :**
  * [agent-executor.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/agent/execution/agent-executor.ts) : Insérer l'injection dans la fonction principale de boucle de turn (`runTurnLoop`).
  * [prompt-builder.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/services/prompt-builder.ts) : Intégrer les variables dans le prompt système final tout en respectant le budget de jetons (tokens).

#### Proposition 1.2 : Enregistrement automatique de l'usage des leçons
* **Description :** Lier dynamiquement chaque leçon injectée à la run active. Lorsque `LessonsTracker.buildContextBlock()` est appelé pour un turn, enregistrer de façon non bloquante l'association `recordUsage(lessonId, runId)`.
* **Fichiers cibles :**
  * [lesson-provenance.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/agent/lesson-provenance.ts) : S'assurer que `recordUsage` est idempotent pour éviter la surcharge de l'index `.codebuddy/lessons-provenance.json`.
  * [context-pipeline.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/agent/execution/context-pipeline.ts) : Capturer l'injection de leçons et appeler l'enregistrement.

#### Proposition 1.3 : Filiation des Runs lors de la compaction
* **Description :** Lors du déclenchement de la compaction du contexte de message par `ContextManagerV2`, forker formellement la run active (`forkRun`) avec un motif de filiation `'compaction'` pour préserver l'arbre généalogique des sessions longues.
* **Fichiers cibles :**
  * [context-manager-v2.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/context/context-manager-v2.ts) : Repérer le point de compaction et émettre l'appel à `RunStore.forkRun()`.

---

### Axe 2 : Cloisonnement Strict des Compétences et Profils d'Outils

#### Proposition 2.1 : Exclusion des compétences (Skills) désactivées
* **Description :** Modifier le mécanisme d'injection des packages de compétences (`SkillsHub`) pour filtrer les répertoires et instructions des compétences désactivées par l'opérateur (via le CLI ou la GUI).
* **Fichiers cibles :**
  * [skills-ipc.ts] : Exposer les canaux IPC nécessaires à Cowork pour manipuler l'activation/désactivation.
  * [context-pipeline.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/agent/execution/context-pipeline.ts) : Filtrer les skills inactifs au moment de compiler le contexte de prompt.

#### Proposition 2.2 : Dynamic Schema Patching et Masquage d'Outils
* **Description :** Ajuster le constructeur de prompt pour que les schémas d'outils envoyés au modèle LLM ne contiennent absolument aucun outil marqué comme désactivé ou hors profil (par exemple, masquer `bash` ou `create_file` en profil `safe` ou `review`). Cela évite que l'agent ne tente d'invoquer des outils interdits et n'échoue.
* **Fichiers cibles :**
  * [tools.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/codebuddy/tools.ts) : Intégrer un filtre dynamique prenant en entrée la configuration `ToolFilterConfig`.

---

### Axe 3 : Supervision Sûre et Automate de Navigateur (Browser Operator)

#### Proposition 3.1 : Exécution du Browser Operator avec barrière de consentement (Consent Gate)
* **Description :** Passer le Browser Operator du statut de brouillon à exécuteur actif. Intégrer un système Playwright local visible (non headless par défaut) qui requiert le consentement de l'utilisateur avant d'exécuter des actions d'écriture (clics, frappes de texte, soumissions de formulaires).
* **Fichiers cibles :**
  * [browser-operator-session.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/browser-automation/browser-operator-session.ts) : Implémenter la boucle de décision (Observe-Act-Extract) avec validation utilisateur obligatoire à chaque étape d'écriture.

#### Proposition 3.2 : Mise en service du Mobile Gateway Listener
* **Description :** Activer un serveur HTTP/WS léger et sécurisé sous `/api/mobile/*` pour permettre la supervision à distance. Ce listener permettra de :
  * Paire un appareil mobile via QR Code local.
  * Lister les runs en cours et afficher les artéfacts textuels.
  * Approuver ou rejeter les actions risquées en attente de confirmation.
* **Fichiers cibles :**
  * [server/index.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/server/index.ts) : Enregistrer les routes spécifiées dans `mobile-gateway-listener-shell`.
  * [mobile-supervision-*.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/observability/) : Activer le gestionnaire de jetons et la file d'attente d'approbations.

---

### Axe 4 : Extensibilité par Système de Hooks

#### Proposition 4.1 : Implémentation d'un cycle de Hooks Génériques
* **Description :** Introduire des points d'ancrage (hooks) système pour permettre à des scripts externes ou des règles de sécurité de s'exécuter de façon autonome :
  * `beforeToolCall` : Validation avancée de la commande (ex. scan de vulnérabilités avant d'exécuter une commande bash).
  * `afterToolCall` : Analyse du retour d'outil pour auto-détection d'erreurs.
  * `beforeMemoryWrite` : Filtrage de données sensibles (credentials, secrets accidentels) avant écriture durcie.
* **Fichiers cibles :**
  * [infrastructure-facade.ts](file:///D:/CascadeProjects/grok-cli-weekend/src/agent/facades/infrastructure-facade.ts) : Exposer les fonctions d'enregistrement et de déclenchement des hooks.

---

## 6. Sûreté, Sécurité & Human-in-the-Loop (HITL)

Pour garantir une collaboration sûre entre agents autonomes, nous proposons d'appliquer une politique stricte de contrôle à 3 niveaux :

```
┌────────────────────────────────────────────────────────┐
│                  Action de l'Agent                     │
└──────────────────────────┬─────────────────────────────┘
                           │
             [Outil Sensible ou Destructeur ?]
                           │
              Oui ─────────┴───────── Non
               │                      │
               ▼                      ▼
┌──────────────────────────────┐ ┌───────────────────────┐
│   Demande de Confirmation    │ │  Exécution Directe    │
│  (Console local / App mobile)│ └───────────────────────┘
└──────────────┬───────────────┘
               │
      [Approbation reçue ?]
               │
        Oui ───┴─── Non
         │          │
         ▼          ▼
┌────────────────┐ ┌─────────────────────────────────────┐
│ Exécution      │ │ Rejet de l'action                   │
│ de l'outil     │ │ (Erreur renvoyée à la boucle Agent) │
└────────────────┘ └─────────────────────────────────────┘
```

1. **Review Gate obligatoire :** Toutes les écritures permanentes et critiques (promotion de leçons, mise à jour du profil utilisateur global) doivent nécessiter une confirmation explicite (locale ou mobile).
2. **Isolation d'outils et RBAC :** Restreindre les outils à un périmètre de dossier (workspace) spécifique configuré via `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT`, empêchant tout accès non autorisé à d'autres répertoires du système hôte.
3. **Audit Trails transparents :** Toutes les actions d'écriture et appels réseau d'outils doivent être enregistrés avec une signature unique de provenance de run dans `RunStore`.

---

## 7. Plan de Vérification

Pour valider l'impact et la sûreté de ces améliorations, la stratégie suivante sera appliquée :

### 7.1. Tests Unitaires et d'Intégration (Vitest)
1. **Validation du user_model_context :** simuler un profil utilisateur rempli et valider que le prompt système final injecté contient bien les balises XML correspondantes et n'excède pas le budget token.
2. **Validation de l'idempotence de lesson-provenance :** simuler une run de test injectant 10 fois la même leçon et valider que l'index ne contient qu'une seule liaison d'utilisation pour cette run.
3. **Test d'exclusion de schéma :** appliquer le profil d'outils `safe` et vérifier via les tests d'intégration que l'outil `bash` est totalement absent de l'appel LLM.

### 7.2. Diagnostics CLI & GUI
* Exécuter la suite de validation globale :
  ```bash
  npm run validate
  ```
* Lancer le diagnostic Hermes spécifique pour valider les profils d'outils configurés :
  ```bash
  buddy hermes doctor
  ```
