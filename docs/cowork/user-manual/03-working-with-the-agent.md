# 3. Travailler avec l'agent

Comment confier du travail à l'agent, lire ce qu'il fait, et garder le contrôle à chaque tour.

## 3.1 Composer une tâche

Tapez une instruction claire dans le composer. L'agent travaille mieux avec un objectif et des
contraintes, par exemple : *« Refactore `auth.ts` pour utiliser async/await, garde l'API publique
inchangée, et lance les tests. »*

- **Joignez du contexte** avec **+** ou par glisser-déposer (fichiers, dossiers, images). Les pièces
  jointes apparaissent comme des puces que vous pouvez retirer.
- **`@`** mentionne un fichier précis, un sous-agent, ou un connecteur pour que l'agent l'utilise.
- **`/`** ouvre les commandes slash pour des actions rapides (export, save, et vos commandes
  personnalisées).

Envoyez avec **Entrée** (ou **Ctrl+Entrée**). **Maj+Entrée** pour un saut de ligne.

## 3.2 Lire une réponse

Un tour peut contenir plusieurs types de blocs, chacun rendu distinctement :

- **Réflexion (thinking)** — le raisonnement étendu du modèle, replié par défaut ; dépliez-le pour
  l'inspecter.
- **Appel d'outil** — un appel comme `read_file`, `bash` ou `edit`, avec ses entrées.
- **Résultat d'outil** — la sortie (copiable ; les erreurs sont mises en évidence).
- **Code** — coloration syntaxique, avec bouton de copie.
- **Sortie terminal** — sortie de commande rendue en ANSI.
- **To-do** — une checklist que l'agent maintient pour le travail multi-étapes.
- **Question** — une question inline à laquelle l'agent a besoin que vous répondiez pour continuer.

> _[capture : un tour avec réflexion, un appel d'outil et un résultat]_

## 3.3 Approuver les actions de l'agent

Quand l'agent veut faire quelque chose de sensible (écrire un fichier, lancer une commande, piloter
le navigateur), une **boîte de dialogue de permission** apparaît avec l'outil, ses entrées, et un
indicateur de risque. Les motifs dangereux (ex. `rm -rf`, `chmod 777`) sont signalés. Vous pouvez :

- **Autoriser** — l'exécuter une fois.
- **Refuser** — le bloquer ; l'agent replanifie.
- **Toujours autoriser** — créer une règle pour auto-approuver les demandes similaires (une étape de
  confirmation s'applique pour les outils dangereux).

La fréquence des demandes dépend du **mode de permission** — voir
[Permissions & sandbox](04-permissions-and-sandbox.md).

> _[capture : dialogue de permission avec l'assistant de règles]_

## 3.4 Piloter en cours de tour

- **Stop** — le bouton rouge ⏹ (ou `Échap` avec le chat actif) interrompt l'agent immédiatement.
- **Régénérer** — survolez un message de l'agent pour rejouer ce tour si le résultat ne convient pas.
- **Sélecteur de modèle** — changez de modèle depuis l'en-tête du chat sans quitter la session ; le
  nouveau modèle s'applique au tour suivant.
- **Niveau de raisonnement** — un sélecteur règle l'ampleur de la réflexion étendue
  (off → minimal → low → medium → high). Les niveaux élevés peuvent aider sur les tâches difficiles,
  au prix de coût/latence.

## 3.5 La mémoire pendant le travail

L'agent peut retenir des faits durables (préférences, décisions, pièges) entre les sessions. Quand il
propose une mémoire, une carte inline vous laisse l'éditer ou l'accepter. Gérez tout ensuite depuis
l'onglet **Mémoire** du panneau de contexte. Voir
[Productivité & contrôle distant](09-productivity-and-remote.md#mémoire).

## 3.6 Task mode & autonomie

- Le **task mode** change la façon dont l'agent planifie et exécute les travaux longs.
- Pour des runs sans intervention, montez le **mode de permission** (ex. *Accept edits* ou
  *Don't ask*) — mais délibérément : plus vous donnez d'autonomie, plus la supervision compte.
  Commencez en **Default** et desserrez à mesure que la confiance s'installe. Voir le chapitre
  suivant.
