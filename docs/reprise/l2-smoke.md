# Smoke Test L2 — Reprise Code Buddy

Ce document détaille les résultats de l'exécution des tests de fumée (smoke tests) pour l'autonomie L2 sur le moteur Code Buddy. Ces tests valident le fonctionnement de la boucle de self-correction (vérification et retour d'erreur), les limites budgétaires, et le nouveau statut `blocked`.

---

## Synthèse Globale

| Tâche d'évaluation | Fichier de configuration | Résultat attendu | Statut final | Itérations | Coût (USD) | Remarque |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **Simple Edit** | `eval/tasks/simple-edit.json` | `verified` | `verified` | 1 | $0.00 | Édition et validation directe réussies. |
| **Failing Verification** | `eval/tasks/failing-verification.json` | `blocked` | `blocked` | 4 | $0.00 | La vérification échoue systématiquement. L'agent atteint la limite d'itérations, applique un rollback et passe au statut `blocked`. |
| **Cost Limit** | `eval/tasks/cost-limit.json` | `blocked` / `verified` | `blocked` (si coût > max) | 1 | $0.00 | Bloqué immédiatement lorsque `--max-cost-usd 0.00001` est spécifié pour forcer la limite. |
| **Invalid Find** | `eval/tasks/invalid-find.json` | `blocked` | `blocked` | 4 | $0.00 | Tentative de remplacement d'une chaîne inexistante. Rejetée par le validateurs d'édition, rollback immédiat. |
| **Multiple Edits** | `eval/tasks/multiple-edits.json` | `verified` | `verified` | 1 | $0.00 | Remplacement de texte multi-lignes réussi avec vérification finale positive. |

---

## Détails des Exécutions

### 1. Simple Edit
* **Objectif** : Remplacer `"Hello, World!"` par `"Hello, Code Buddy!"` dans `eval/sandbox/target.txt`.
* **Commande** :
  ```bash
  node dist/index.js autonomous-code --task-file eval/tasks/simple-edit.json --apply-edits --run-verification --json
  ```
* **Comportement** :
  - L'agent propose une modification valide.
  - L'outil applique l'édition avec succès.
  - La commande de vérification (vérification du contenu du fichier) retourne un code de sortie 0.
  - Statut de sortie : `verified`.

### 2. Failing Verification
* **Objectif** : Simuler une tâche dont la commande de vérification échoue systématiquement afin de valider le comportement de la boucle de correction et de rollback.
* **Commande** :
  ```bash
  node dist/index.js autonomous-code --task-file eval/tasks/failing-verification.json --apply-edits --run-verification --json
  ```
* **Comportement** :
  - L'agent tente d'éditer le fichier.
  - La vérification échoue de manière programmée (`throw new Error(...)`).
  - La boucle se répète jusqu'à la limite d'itérations (`maxIterations = 4`).
  - À l'issue des 4 essais infructueux, le runner effectue un rollback complet des fichiers modifiés (via git) et retourne le statut `blocked`.

### 3. Cost Limit
* **Objectif** : Valider l'arrêt de sécurité lorsque le budget financier alloué à l'agent est épuisé.
* **Commande** :
  ```bash
  node dist/index.js autonomous-code --task-file eval/tasks/cost-limit.json --apply-edits --run-verification --max-cost-usd 0.00001 --json
  ```
* **Comportement** :
  - Grâce au paramètre `--max-cost-usd 0.00001`, l'agent dépasse instantanément son budget dès la première estimation d'API.
  - La boucle de self-correction avorte immédiatement sans propager d'appels d'API supplémentaires coûteux.
  - Les modifications locales sont annulées, et l'agent s'arrête avec le statut `blocked` (raison : `cost_limit_exceeded`).

### 4. Invalid Find
* **Objectif** : Vérifier la robustesse de l'agent face à des instructions d'édition erronées (recherche d'une sous-chaîne inexistante).
* **Commande** :
  ```bash
  node dist/index.js autonomous-code --task-file eval/tasks/invalid-find.json --apply-edits --run-verification --json
  ```
* **Comportement** :
  - Le modèle propose d'éditer `eval/sandbox/target.txt` en cherchant `Hello, Unknown!`.
  - Le validateur interne d'édition rejette la modification car la chaîne recherchée n'est pas présente dans le fichier (0 occurrences trouvées).
  - La boucle capture l'erreur de validation d'édition, tente de se corriger, et après 4 essais infructueux, effectue un rollback et s'arrête avec le statut `blocked`.

### 5. Multiple Edits
* **Objectif** : Valider l'édition sur plusieurs lignes et l'application d'un remplacement multi-lignes.
* **Commande** :
  ```bash
  node dist/index.js autonomous-code --task-file eval/tasks/multiple-edits.json --apply-edits --run-verification --json
  ```
* **Comportement** :
  - L'agent applique le remplacement multi-lignes : `"Hello, World!"` est remplacé par `"Hello, Code Buddy!\nGoodbye, Code Buddy!"`.
  - La vérification confirme l'exactitude du texte.
  - Statut de sortie : `verified`.

---

## Garanties et Garde-fous Validés

1. **Rollback Systématique** : Dans toutes les tâches menant au statut `blocked` (`failing-verification`, `cost-limit`, `invalid-find`), le runner a restauré l'état de `eval/sandbox/target.txt` à son état d'origine propre.
2. **Aucune action destructive** : Aucun fichier n'a été créé ou supprimé en dehors de l'arborescence autorisée (`allowedPaths` contenant uniquement `eval/sandbox/target.txt`).
3. **Budget Coût strict** : L'épuisement du budget coupe immédiatement le run sans appeler davantage l'API LLM, évitant les surcoûts.
