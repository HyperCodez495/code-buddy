# 2. L'interface

Ce chapitre est une visite guidée de la fenêtre principale.

## 2.1 Vue d'ensemble

```
┌───────────────────────────────────────────────────────────────────────┐
│  Barre de titre : onglets · runner · presse-papier · voix · ⌘/ · ⚙     │
├───┬───────────────────────────────────────────────┬─────────────────────┤
│ R │                                               │                     │
│ a │   Vue chat (messages + composer)              │   Panneau de        │
│ i │                                               │   contexte (onglets)│
│ l │                                               │                     │
│   │   [ composer : + · texte · @ · / · 🎤 · modèle · ⏹ · ↵ ]          │
└───┴───────────────────────────────────────────────┴─────────────────────┘
```

## 2.2 Barre de titre

En haut se trouvent les **onglets** de session et une rangée de contrôles rapides (les icônes varient
selon les fonctions activées) :

- **Badge runner** — quel moteur exécute (Core engine vs runner embarqué).
- **Résumé presse-papier**, **Voix**, **Notifications** (cloche, avec compteur de non-lus).
- **Raccourcis clavier** (`Cmd/Ctrl+/`) et **Réglages** (`Cmd/Ctrl+,`).
- Boutons pour ouvrir les grands panneaux : **Fleet**, **Team**, **Insights de session**,
  **Trace de raisonnement**, **Vue focus**, **Favoris**, **Companion**, et d'autres.

> _[capture : contrôles de la barre de titre]_

## 2.3 Rail de navigation

Un rail vertical d'icônes (ShellNavigation) à gauche lance les zones principales — Réglages, Fleet,
Mémoire, Raisonnement, Autonomie, Vue focus, Recherche, Skills, Companion, et d'autres selon le build.

## 2.4 Vue chat & composer

Le centre est la conversation. Les messages affichent du contenu riche : blocs **réflexion**
(thinking) repliables, **appels d'outils** et leurs **résultats**, **blocs de code** (avec copie),
**sortie terminal**, listes de **tâches** (to-do), et questions inline de l'agent.

Le **composer** en bas est votre poste de travail :

- **+** — joindre des fichiers ou images (ou glisser-déposer, ou coller une image).
- **Zone de texte** — tapez votre prompt. `Entrée` envoie ; `Maj+Entrée` insère un saut de ligne.
- **`@`** — mentionner un fichier, un agent ou un connecteur (autocomplétion).
- **`/`** — lancer une commande slash (palette d'autocomplétion).
- **🎤** — entrée vocale (speech-to-text).
- **Modèle** — affiche/change le modèle actif.
- **⏹ Stop** — interrompre l'agent en cours.
- **↵ Envoyer**.

> _[capture : composer avec une pièce jointe et le menu @]_

## 2.5 Panneau de contexte (droite)

Un panneau à onglets qui garde tout ce qui concerne le travail en cours à côté du chat :

- **Fichiers** — parcourir l'espace de travail ; cliquer un fichier pour l'aperçu.
- **Git** — branche, fichiers stagés/modifiés/non suivis, commit.
- **Diffs** — relire les changements faits par l'agent.
- **Checkpoints** — une timeline de snapshots à restaurer ou comparer.
- **Mémoire** — les faits retenus par l'agent entre les sessions.
- **Sous-agents** — statut en direct des agents auxiliaires en parallèle.
- **Knowledge** — la base de connaissances indexée de votre projet.

Affichez/masquez le panneau avec `Cmd/Ctrl+B` ; glissez la séparation pour redimensionner. Voir
[Fichiers, Git & checkpoints](05-files-git-checkpoints.md).

## 2.6 Vue focus

`Cmd/Ctrl+Maj+F` ouvre une vue plein écran sans distraction : juste le dernier prompt et la dernière
réponse, un chrono d'exécution, et le statut. Idéal pour suivre une tâche longue. `Échap` pour sortir.

> _[capture : vue focus]_

## 2.7 Split & docking

`Cmd/Ctrl+\` bascule une disposition en deux volets pour lire un aperçu de fichier à côté du chat.
L'espace de travail gère des onglets ancrables (chat, trace de raisonnement, contexte).

## 2.8 Thèmes & langue

Dans **Réglages → General** :

- **Thème** — Clair, Sombre, **Open Cowork** (thème d'accent), ou **Système** (suit l'OS).
- **Langue** — English, Français, ou 中文. L'UI se met à jour instantanément et le choix persiste.

> _[capture : Réglages → General avec thème et langue]_
