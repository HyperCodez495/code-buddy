# Plan d'Audit des Dépendances NPM (Mai 2026)

Ce document décrit l'analyse et la stratégie de remédiation pour les vulnérabilités identifiées par `npm audit` dans le projet **Code Buddy**.

---

## 1. Synthèse des Vulnérabilités

| Package | Sévérité | Chemin | Statut dans Code Buddy | Stratégie de Résolution |
|---|---|---|---|---|
| **protobufjs** | Critique / Modérée | Transitif (`@opentelemetry/sdk-node`, `@whiskeysockets/baileys`) | Production & Optionnel | Forcer la version `^7.4.0` via les `overrides` dans `package.json`. |
| **simple-git** | Haute (RCE) | Transitif (`node-llama-cpp`) | Optionnel | Forcer la version `^3.36.0` via les `overrides` dans `package.json`. |
| **tar** | Haute (Path Traversal) | Direct | Optionnel (CLI & Cowork) | Mettre à jour vers `^7.5.15` dans `package.json` et utiliser l'override existant dans `cowork/package.json`. |
| **vite** | Haute | Direct / Transitif (`vitest`, `cowork`) | Développement | Mettre à jour à `^7.3.3` dans `cowork/package.json` et forcer via les `overrides` globaux. |
| **ws** | Modérée | Direct / Transitif | Optionnel & Développement | Mettre à jour vers `^8.20.1` dans `package.json` et s'assurer que l'override propage la correction. |
| **yaml** | Modérée | Direct | Production | Mettre à jour vers `^2.9.0` dans `package.json` pour éliminer le risque de Stack Overflow. |
| **xlsx** | Haute (Prototype Pollution) | Direct | Optionnel | **Non résoluble par npm public**. SheetJS a migré sa distribution sur son propre registre CDN. La dépendance étant optionnelle, elle est conservée en l'état sans impact sur le chemin de production critique. |

---

## 2. Actions de Résolution

### A. Modifications dans `package.json` (Racine)

1. Mettre à jour les dépendances directes :
   - `yaml` de `^2.8.0` vers `^2.9.0`
2. Mettre à jour les dépendances optionnelles :
   - `tar` de `^7.5.3` vers `^7.5.15`
   - `ws` de `^8.18.0` vers `^8.20.1`
3. Ajouter des clauses d'override sélectif :
   - `protobufjs` : `^7.4.0`
   - `simple-git` : `^3.36.0`
   - `vite` : `^7.3.3`

### B. Modifications dans `cowork/package.json` (Cockpit Electron)

1. Mettre à jour la dépendance de développement :
   - `vite` de `^7.3.1` vers `^7.3.3`
2. S'assurer que les overrides globaux ou locaux de `tar` s'appliquent correctement (déjà présent en `^7.5.11` dans `cowork/package.json`).

---

## 3. Validation de la Sécurité

Après application des modifications, les commandes de validation suivantes seront exécutées :
1. `npm install` pour régénérer le `package-lock.json` avec les résolutions d'overrides.
2. `npm audit --only=prod` pour valider l'absence de vulnérabilités critiques dans le chemin de production.
3. `npm run validate` pour s'assurer qu'aucune régression (typecheck, lint, tests) n'a été introduite.
