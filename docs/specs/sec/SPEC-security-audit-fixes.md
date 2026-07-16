# SPEC — Correctifs de sécurité (audit multi-agents 2026-07-16)

Tu travailles dans un worktree git du repo **Code Buddy** (agent de codage IA multi-provider,
TypeScript strict ESM, tests Vitest). Branche : `fix/security-audit-critical`.
Ces correctifs viennent d'un audit multi-agents vérifié. Chaque preuve `fichier:ligne` a été
confirmée dans le code réel — mais **RE-VÉRIFIE chaque ligne** avant d'éditer (le code a pu bouger).

## Règles du repo (OBLIGATOIRES)
- Imports relatifs avec extension `.js` même depuis des `.ts`. Pas de `any`. `noUncheckedIndexedAccess` ON.
- `logger` (`src/utils/logger.js`) en production, jamais `console.*` (sauf CLI dans `src/commands/`).
- Fichiers kebab-case ; tests UNIQUEMENT sous `tests/`.
- **FAIL-CLOSED** partout : en cas de doute, refuser. Ne casse PAS les cas légitimes existants
  (loopback autorisé pour `OLLAMA_HOST`/`SEARXNG_URL`/dev-origins — respecte la politique du garde SSRF
  existant `src/security/ssrf-guard.ts`, ne réimplémente pas ta propre allowlist).
- Conventional Commits (`fix(security): …`). Avant CHAQUE commit : `npm run typecheck` (0 erreur) +
  les tests ciblés du correctif verts. N'exécute PAS la suite complète. `npm install --no-audit --no-fund`
  si node_modules manque.
- Ne commite jamais : SPEC-*.md, node_modules, état `.codebuddy/`.
- CHAQUE correctif DOIT avoir un test qui prouve le fix (le mauvais cas est refusé). NE MODIFIE PAS CLAUDE.md.

## Ordre de priorité : fais P0 d'abord (commit isolé), puis chaque P1 (commits séparés).

---

## P0 — [CRITIQUE] Endpoints mutateurs sans `requireScope`
- **Fichier** : `src/server/index.ts`. `requireScope` n'est appelé qu'UNE fois (~l.314, sur le GET
  read-only `/v1/models`), alors qu'il existe ~17 `app.(post|put|delete)` inline NON gardés :
  webhooks (`POST /api/webhooks`, `POST /api/webhooks/:id/trigger`), cron
  (`POST /api/cron/jobs/:id/trigger`), heartbeat (`/api/heartbeat/tick|start|stop`), identité
  (`PUT /api/identity/:name`), `/api/auth-profiles`, etc.
- **Impact** : une clé API de scope `chat` est de-facto admin (installe des skills = exécute du code,
  reset des profils d'auth, réécrit l'identité système).
- **Fix** : ajoute `requireScope('admin')` (ou le scope adéquat — `sessions`/`memory` selon l'effet)
  sur CHAQUE endpoint inline à effet de bord. Reproduis EXACTEMENT le motif des routers modulaires
  déjà corrects (`src/server/routes/sessions.ts`, `memory.ts`, `tools.ts`). Ne touche pas aux GET
  read-only légitimes. Recense d'abord tous les mutateurs inline (grep `app.post|app.put|app.delete`).
- **Test** (`tests/server/require-scope-mutators.test.ts`) : émets un token de scope `chat` et attends
  **403** sur chacun de ces endpoints mutateurs ; un token `admin` passe (200/expected).

---

## P1a — SSRF : suivi de redirection 30x non re-validé
- **Fichiers** : `src/tools/fetch-tool.ts:96,124` ; `src/tools/image-tool.ts:115,121` ;
  `src/tools/web-search.ts:892` (les `fetch(...)` suivent les 302 sans re-valider la cible).
- **Impact** : une 302 vers `169.254.169.254`/loopback est suivie → creds cloud metadata / services internes.
- **Fix** : `redirect: 'manual'` (ou `maxRedirects: 0`) puis, sur chaque `Location`, re-passer par
  `assertSafeUrl` AVANT de suivre (boucle bornée, ex. max 5 sauts), et **strip l'en-tête
  `Authorization` sur redirection cross-origin**. Factorise un helper `safeFetchFollow(url, init)` si
  pertinent. Respecte la politique SSRF existante (les hôtes trusted restent autorisés).
- **Test** (`tests/tools/ssrf-redirect.test.ts`) : `global.fetch` mocké renvoyant 302 →
  `http://169.254.169.254/…` ⇒ la requête est refusée (pas suivie) ; une redirection same-origin
  légitime passe.

## P1b — Webhook des règles sensorielles sans garde SSRF
- **Fichiers** : `src/sensory/sensory-action-executor.ts` (`runWebhook`, ~l.96-112, ne valide que le
  schéma http(s)) ; `src/sensory/sensory-rules-engine.ts` (`validateRule` ~l.44-76 ; le hot-reload
  mtime-cache doit AUSSI passer par la validation).
- **Impact** : exfiltration auto du contexte perçu (descriptions domicile, images) + SSRF, sur chaque
  événement caméra/micro.
- **Fix** : passe `action.url` par `assertSafeUrl` — fail-closed **à l'écriture** (`validateRule`,
  qui doit rejeter une règle webhook vers une cible privée) ET **à l'exécution** (`runWebhook`).
- **Test** (`tests/sensory/webhook-ssrf.test.ts`) : une règle webhook vers une IP privée est rejetée
  par `validateRule` ET, si elle existe déjà, refusée par `runWebhook` ; un webhook externe légitime passe.

## P1c — privacy-lint jamais invoquée sur le routage fleet
- **Fichiers** : `src/tools/route-peer-tool.ts:136-156` ; `src/tools/peer-chain-tool.ts:78`
  (aucun `scanForSecrets`). Le garde existe (`src/fleet/privacy-lint.ts`).
- **Impact** : un prompt avec clé API/IBAN/SSN routé vers un peer cloud sauf si le LLM pense à
  `privacyTag:'sensitive'`.
- **Fix** : appelle `scanForSecrets(prompt)` (ou l'API de `privacy-lint.ts`) AVANT de construire les
  `constraints` ; force `privacyTag='sensitive'` quand des secrets sont détectés, et bloque le
  routage vers un peer cloud/non-local sur détection high-confidence.
- **Test** (`tests/tools/route-peer-privacy.test.ts`) : un prompt contenant une clé API ⇒ routé
  `sensitive`/bloqué (pas de délégation cloud) ; un prompt anodin route normalement.

## P1d — Écriture à chemin arbitraire via `output` de video_stitch/assembleFilm
- **Fichiers** : `src/tools/video/film-assemble.ts:829` (`path.resolve(output)` sans confinement) ;
  exposé via `src/tools/registry/multimodal-tools.ts:950,987`.
- **Impact** : `output: "../../etc/x.mp4"` ⇒ l'agent (donc une injection de prompt) écrit hors racine.
- **Fix** : fais passer `output` par le confinement média existant (`ensureConfinedMediaDirectory`
  ou équivalent dans le module média) ; rejette les chemins absolus et contenant `..`.
- **Test** (`tests/tools/video/film-output-confinement.test.ts`) : `output` absolu ou `../` ⇒ rejeté ;
  un nom de fichier relatif simple passe (résolu sous le dossier média).

## P1e — maxBytes des downloads média contourné
- **Fichiers** : `src/tools/media-generation-tool.ts:1758-1759` (`arrayBuffer()` bufferise tout AVANT
  le contrôle de taille) et ~l.1214 (aucun contrôle). Le helper correct `readBoundedResponseBytes`
  n'est câblé qu'à ~l.636.
- **Impact** : une réponse upstream surdimensionnée ⇒ OOM/crash ; le plafond ~250 Mo est illusoire.
- **Fix** : route CES DEUX chemins de download via `readBoundedResponseBytes` (streaming borné).
- **Test** (`tests/tools/media-download-bounded.test.ts`) : un corps de réponse mocké dépassant le cap
  ⇒ erreur/troncature avant bufferisation complète.

## P1f — Rédaction des secrets CKG limitée à `text` (name + relations en clair)
- **Fichiers** : `src/memory/collective-knowledge-graph.ts:286,316-318` (rédaction seulement sur
  `text`) ; `src/memory/buddy-memory-client.ts:164` (idem côté client).
- **Impact** : une clé API/IBAN dans un `name` ou `targetName`/`reason` de relation entre en clair
  dans le ledger COLLECTIF partagé.
- **Fix** : introduis un helper unique `redactRememberInput(input)` appliqué à `name`, `text`,
  `rel.targetName`, `rel.reason` (réutilise `scanForSecrets`/`redactSecrets` existants) ; applique-le
  aux deux entrées (in-process + client `buddy-memory`).
- **Test** (`tests/memory/ckg-redaction.test.ts`) : un secret placé dans `name` et dans un
  `rel.targetName` est rédigé dans l'entrée persistée.

## P1g — Rollback self-improve détruit le WIP non commité
- **Fichier** : `src/agent/autonomous/agentic-coding-runner.ts:5769` (`git checkout -B` emporte le
  working tree) et ~l.5909-5913 (`git reset --hard` + `git clean -fd` dans le finally).
- **Impact** : un run self-improve approuvé qui échoue efface le WIP et les fichiers non suivis de Patrice.
- **Fix** : `git stash -u` (inclut les non-suivis) AVANT la création de la branche sandbox, et
  `git stash pop`/restore dans le finally APRÈS le reset — OU restreins le nettoyage aux seuls chemins
  de `contract.edits`. Ne détruis jamais du contenu hors du périmètre du contrat.
- **Test** (`tests/agent/self-improve-rollback-preserves-wip.test.ts`) : dans un repo git temporaire
  avec un fichier non suivi + une modif non commitée, un run sandbox qui échoue laisse ces deux
  éléments intacts (spawn git injecté/mocké selon le pattern des tests existants).

---

## Critères de done
- `npm run typecheck` : 0 erreur. Tous les tests ciblés ci-dessus verts.
- Aucun cas légitime cassé (loopback trusted, webhooks externes valides, downloads normaux).
- Commits Conventional séparés par correctif (`fix(security): …`).

## Interdits
- Ne réimplémente PAS ta propre logique SSRF/allowlist — réutilise `assertSafeUrl`/`ssrf-guard.ts`.
- Ne fais PAS le SSRF DNS-rebinding (refonte du guard) ni le plafond de coût fleet (câblage tracker) —
  ce sont des chantiers séparés hors de cette vague. Reste sur les 8 correctifs ci-dessus.
- Ne touche pas aux endpoints GET read-only ni aux tests existants qui passent.
