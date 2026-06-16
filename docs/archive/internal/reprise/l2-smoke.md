# Smoke Test L2 - Reprise Code Buddy

Ce document détaille le smoke réel de l'autonomie L2 sur le moteur Code Buddy.
Il valide les chemins `verified` et `blocked`, les limites budgétaires, le rollback,
les chemins Windows avec espaces, et le harnais `eval/run-task.mjs`.

## Commande Canonique

Le format courant des tâches est :

- `eval/tasks/<slug>/contract.json`
- `eval/tasks/<slug>/expected.json`

Le lancement recommandé est le harnais isolé :

```bash
node eval/run-task.mjs
```

Le harnais crée un vrai dépôt Git temporaire pour chaque tâche, copie `eval/sandbox/`,
réécrit le champ `repo` du contrat vers ce dépôt temporaire, lance le vrai CLI compilé
`node dist/index.js autonomous-code ...`, inspecte le vrai `git status`, puis nettoie.

Pour lancer une ou plusieurs tâches ciblées :

```bash
node eval/run-task.mjs simple-edit space-path-edit
```

Une tâche inconnue échoue avant tout setup et affiche la liste disponible.

## Synthèse Globale

| Tâche | Fichiers | Résultat attendu | Statut final réel | Remarque |
| :--- | :--- | :--- | :--- | :--- |
| `cost-limit` | `eval/tasks/cost-limit/contract.json` | `blocked` | `blocked` | Bloqué avec `--max-cost-usd 0.00001`, sans fichier modifié. |
| `failing-verification` | `eval/tasks/failing-verification/contract.json` | `blocked` | `blocked` | Vérification volontairement en échec, rollback attendu. |
| `invalid-find` | `eval/tasks/invalid-find/contract.json` | `blocked` | `blocked` | Remplacement impossible car la chaîne source est absente. |
| `multiple-edits` | `eval/tasks/multiple-edits/contract.json` | `verified` | `verified` | Remplacement multi-lignes validé. |
| `simple-edit` | `eval/tasks/simple-edit/contract.json` | `verified` | `verified` | Édition simple de `eval/sandbox/target.txt`. |
| `space-path-edit` | `eval/tasks/space-path-edit/contract.json` | `verified` | `verified` | Édition d'un fichier dont le chemin contient des espaces. |

## Garde-fous Validés

1. **Isolation réelle** : chaque tâche tourne dans un dépôt Git temporaire propre.
2. **Rollback** : les tâches `blocked` ne laissent pas de modification hors scope.
3. **Budget coût** : `cost-limit` coupe le run avant une exécution coûteuse.
4. **Scope strict** : le harnais compare les fichiers réellement modifiés aux `allowedPaths`.
5. **Robustesse Windows** : exécution sans shell quoting fragile, chemins temporaires avec espaces, Node sous `Program Files`, et fichiers sandbox avec espaces.
6. **Parsing Git robuste** : le harnais lit `git status --porcelain=v1 -z --untracked-files=all`.
7. **Ordre stable** : les tâches sont découvertes et exécutées dans un ordre déterministe.

## Dernière Validation Réelle

Commandes relancées après la mise à jour de cette documentation :

```bash
node --check eval/run-task.mjs
node eval/run-task.mjs not-a-task
node eval/run-task.mjs
```

Résultat attendu du lot complet : `ALL EVALUATION TASKS PASSED SUCCESSFULLY.`
