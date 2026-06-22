# 8. Outils, MCP & skills

La puissance de l'agent vient des **outils**. Ce chapitre couvre les outils intégrés, leur extension
via des serveurs **MCP** et des **skills**, et l'automatisation de séquences via des **workflows**.

## 8.1 Outils & flux d'approbation

De base, l'agent peut lire/écrire/éditer des fichiers, lancer des commandes shell, exécuter du code
dans la sandbox, et (si activé) piloter un navigateur ou l'ordinateur. Chaque appel sensible passe
par le flux de **permission** décrit dans [Permissions & sandbox](04-permissions-and-sandbox.md) :
vous Autorisez, Refusez, ou Toujours-autorisez, en enregistrant éventuellement une règle cadrée.

## 8.2 MCP — connecter des capacités externes

Le **Model Context Protocol (MCP)** permet à l'agent d'utiliser des serveurs externes (navigateurs,
Notion, GitHub, systèmes de fichiers, et plus).

- **Connecteurs** (Réglages → Connectors) — ajoutez un serveur par nom + arguments, puis activez-le.
  Ses outils deviennent disponibles pour l'agent et apparaissent dans les règles de permission.
- **MCP marketplace** (Réglages → MCP marketplace) — parcourez et installez des serveurs en quelques
  clics, avec épinglage de version.
- **MCP playground** (Réglages → MCP playground) — testez les outils d'un serveur avec des arguments
  JSON, sans dépenser un tour de chat — utile pour déboguer un nouveau connecteur.

> _[capture : MCP marketplace]_

## 8.3 Skills

Les **skills** sont des capacités packagées en langage naturel (définies en paquets `SKILL.md`). Les
skills intégrés incluent la génération de documents — **PPTX**, **DOCX**, **XLSX**, **PDF** — vous
pouvez donc demander à l'agent « fais une présentation à partir de ces données » et il emploie le bon
skill.

- **Réglages → Skills** — activer/désactiver les skills.
- **Skills Browser** (`Cmd/Ctrl+Maj+L`) — parcourir les skills disponibles avec descriptions et
  exemples.
- **Skills personnalisés** — ajoutez les vôtres en paquets `SKILL.md` ; installez/gérez-les depuis
  les réglages skills.

## 8.4 Commandes personnalisées & snippets

- **Commandes personnalisées** (Réglages → Custom commands) — définissez votre propre `/commande`
  pour un prompt ou un workflow fréquent ; déclenchez-la en tapant `/` dans le composer.
- **Snippets** (`Cmd/Ctrl+Maj+S`, Réglages → Snippets) — une bibliothèque de modèles de prompt/texte
  réutilisables, insérés par autocomplétion.

## 8.5 Workflows

Pour l'automatisation répétable et multi-étapes, Cowork inclut un **éditeur de workflow visuel** (un
DAG de nœuds d'outils, conditions, branches parallèles, gates d'approbation, et variables).

- Un éditeur intégré permet de glisser des nœuds et de les relier.
- Le builder avancé **Workflow Pro** (basé sur ReactFlow) ajoute validation, debugger pas-à-pas,
  construction de chemins conditionnels, sous-workflows, diffs de versions, et partage.
- Gérez les workflows enregistrés depuis **Réglages → Workflows** ; lancez-les depuis la palette de
  commandes ou une commande personnalisée.

> _[capture : éditeur de workflow]_

## 8.6 Hooks

Les **hooks** (Réglages → Hooks) lancent une commande shell ou un appel HTTP automatiquement sur des
événements de l'agent (avant/après une commande, sur prompt, à la fin). Un dialogue de dry-run permet
de tester un hook avant de l'activer. Utilisez les hooks pour brancher Cowork sur la CI, des
notifications, ou vos propres scripts.
