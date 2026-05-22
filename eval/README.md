# Harnais d'évaluation Code Buddy

Ce dossier contient le harnais d'évaluation de l'autonomie L2 pour Code Buddy. Les tâches sont définies sous `eval/tasks/<slug>/` sous forme de deux fichiers JSON :
- `contract.json` : Le contrat de tâche passé au runner autonome.
- `expected.json` : Les assertions d'évaluation à vérifier après le run (statut, budget, fichiers modifiés).

## Lancement des évaluations

Pour exécuter toutes les tâches d'évaluation et valider la non-régression de l'agent :

```bash
node eval/run-task.mjs
```

Pour exécuter une tâche spécifique par son identifiant :

```bash
node eval/run-task.mjs simple-edit
```

## Structure d'une tâche d'évaluation

### `contract.json`
Contrat standard au format JSON Zod utilisé par `buddy autonomous-code` :
- `repo` : Chemin absolu vers le dépôt local.
- `task` : Description textuelle de la tâche.
- `allowedPaths` : Liste des chemins de fichiers modifiables.
- `verification` : Commandes de validation.
- `riskLevel` : Niveau de risque (`low`, `medium`, `high`).
- `edits` : Pré-déclaration d'éditions (optionnel).

### `expected.json`
Assertions de succès attendues :
- `status` : Le statut final retourné par l'agent (`verified` ou `blocked`).
- `args` : Arguments supplémentaires facultatifs à passer au CLI (ex. `["--max-cost-usd", "0.00001"]`).
- `maxFilesChanged` : Nombre maximal de fichiers autorisés à être modifiés par le run.
- `mustTouchPaths` : Liste des fichiers qui doivent impérativement être modifiés.
- `mustNotTouchOutside` : Boolean garantissant qu'aucun fichier en dehors de `allowedPaths` n'a été altéré.
- `verificationMustPass` : Boolean indiquant si la commande de vérification doit passer.
