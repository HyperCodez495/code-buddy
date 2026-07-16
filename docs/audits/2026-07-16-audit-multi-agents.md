<!-- Audit multi-agents (14 sous-systèmes, 29 agents, 109 findings vérifiés) — 2026-07-16 -->

# Rapport d'audit priorisé — Code Buddy (14 sous-systèmes)

## 1. Synthèse exécutive

L'état de santé est celui d'un système fonctionnellement riche mais dont **la surface d'exposition réseau/serveur est structurellement sous-défendue** et dont **une part notable des garde-fous annoncés n'est jamais exécutée** (code mort ou non câblé donnant une fausse assurance). Aucun défaut ne casse le chemin de chat nominal, mais on compte 1 critique + ~22 high, très majoritairement **CONFIRMED**, concentrés sur trois axes. Les 3 leviers à plus fort impact :

1. **Durcir la frontière d'exposition** (HTTP scopes, auth WS Gateway, SSRF redirect/rebinding/webhook, plafonds de coût fleet, rédaction des secrets CKG, isolation Python du self-improve) — c'est là que résident toutes les escalades de privilège et exfiltrations.
2. **Fiabiliser écritures et durée de vie process pour le 24/7** (writes atomiques mémoire/apply/archive, kill du sidecar Rust, ledgers/Maps non bornés) — la robustesse longue durée est aujourd'hui aléatoire.
3. **Résorber le code mort/non câblé qui ment sur les garanties** (ToT/reasoning Grok-only, middlewares en promesse flottante, blocs de contexte hors budget de compaction, privacy-lint jamais appelée, CI codecov/publish inertes).

---

## 2. Problèmes critiques & high (triés par impact décroissant)

| Problème | Domaine | Preuve | Impact | Amélioration |
|---|---|---|---|---|
| **[CRITICAL]** Endpoints mutateurs inline sans `requireScope` : une clé scope `chat` est de-facto admin | Sécu serveur | `server/index.ts:604,624,662,745,790` (requireScope seulement l.314) | Escalade totale : install/désinstall skills (exéc code), reset des profils d'auth, réécriture de l'identité système, cron/heartbeat | Envelopper chaque mutateur dans `requireScope('admin'/…)` ou extraire en routers dédiés |
| **[H]** Bypass d'auth du transport WS Gateway (modes ≠ `token`) | Cowork | `gateway.ts:771-779` (`authenticated=true` inconditionnel), routage sans `checkAuthorization` | Tout client réseau pilote l'agent dès qu'un bind non-loopback est activé en mode allowlist/pairing (défauts) | Appliquer `checkAuthorization` au chemin WS ; refuser l'auto-auth hors mode token |
| **[H]** SSRF par suivi de redirection 30x non re-validé | Sécu serveur | `fetch-tool.ts:96,124` ; `image-tool.ts:115,121` ; `web-search.ts:892` | 302 vers `169.254.169.254`/loopback suivi → creds cloud metadata / services internes | `redirect:'manual'`/`maxRedirects:0` + re-`assertSafeUrl` par saut, strip Authorization cross-origin |
| **[H]** SSRF DNS rebinding (TOCTOU) : check et fetch résolvent le DNS séparément | Sécu serveur | `ssrf-guard.ts:315-330` (verdict au hostname, pas d'IP pinning) | Guard intégralement contournable par tout domaine hostile TTL=0 | Résoudre l'IP une fois, valider, fetcher en épinglant l'IP |
| **[H]** Webhook des règles sensorielles sans aucun garde SSRF/egress | Sensoriel | `sensory-action-executor.ts:100-105` ; hot-reload bypasse même `validateRule` (`sensory-rules-engine.ts:44-53`) | Exfiltration auto du contexte perçu (descriptions domicile, images) + SSRF, sur chaque événement caméra/micro | Passer `action.url` par le garde SSRF, fail-closed dans validateRule ET runWebhook |
| **[H]** privacy-lint jamais invoquée sur le chemin de routage fleet | Fleet | `route-peer-tool.ts:136-156`, `peer-chain-tool.ts:78` (aucun `scanForSecrets`) | Un prompt avec clé API/IBAN/SSN routé vers un peer cloud sauf si le LLM pense à `privacyTag:'sensitive'` | Appeler `scanForSecrets(prompt)` avant `constraints`, forcer `sensitive`/bloquer sur highConfidence |
| **[H]** Aucun plafond coût/tokens sur peer.chat/dispatch/session ; le fleet cost-tracker est mort | Fleet | `peer-chat-bridge.ts:214-221,455-462` ; `fleet/cost-tracker.ts` zéro importeur | Un peer authentifié vide les crédits/clé API du peer local en boucle | Câbler `checkBudget`/`charge` avant/après chaque `client.chat` entrant + maxTokens par défaut |
| **[H]** Rédaction des secrets CKG limitée à `text` : `name`/cibles de relations en clair dans le ledger PARTAGÉ | Mémoire | `collective-knowledge-graph.ts:286,316-318` ; `buddy-memory-client.ts:164` | Clé API/IBAN dans un `name`/`targetName` diffusé en clair à toute la flotte | `redactRememberInput()` unique sur name/text/rel.targetName/rel.reason (+ liste client) |
| **[H]** Outils Python auto-écrits contournent le gate statique réseau/FS (G1 écrit pour JS) | Self-improve | `authored-tool-runtime.ts:23` (python autorisé) ; `authored-artifact-gate.ts` NETWORK_RE/FS_WRITE_RE JS-only ; patterns network en `appliesTo:['skill']` | `urllib`/`socket`/`subprocess`/`os.system`/`shutil.rmtree` passent G1 puis s'exécutent au scoring | Ajouter patterns Python en subsystem `code`, ou restreindre AUTHORED_LANGUAGES à js/ts, idéalement vrai sandbox |
| **[H]** Sandbox `isolate` ne bloque ni lecture des secrets par chemin absolu ni réseau | Self-improve | `execute-code-runner.ts:59-76` (seul HOME redirigé, uid inchangé) ; commentaires l.47-49/71-72 trompeurs | Combiné au point précédent : `open('/home/.../.codebuddy/auth.json')` lisible → exfiltration au scoring | Sandbox FS/réseau réel (bwrap/namespaces) ; corriger commentaires ; test lecture chemin absolu |
| **[H]** Relecteurs LLM ne voient que 6000 chars mais le verdict peut rester `accept` | Review gate | `llm-reviewer.ts:42,63-66,82` ; `aggregate()` ne consulte aucun flag de troncature | Sur write full, un fichier neuf >6000 chars passe non relu mais « accept applied » | Propager un flag `truncated` et interdire l'accept d'un fichier tronqué (fail-closed) |
| **[H]** Le garde-fou maxBytes des downloads média est contourné (`arrayBuffer()` bufferise tout avant contrôle) | Media | `media-generation-tool.ts:1758-1759` (test a posteriori), `1214` (aucun test), `readBoundedResponseBytes` câblé qu'en l.636 | Réponse upstream surdimensionnée → OOM/crash ; plafond 250 Mo illusoire | Router les 2 chemins via `readBoundedResponseBytes` |
| **[H]** Écriture à chemin arbitraire via `output` de video_stitch/assembleFilm (aucun confinement) | Media | `film-assemble.ts:829` (`path.resolve` sans check), exposé `multimodal-tools.ts:950,987` | `../../etc/…` : l'agent (donc injection prompt) écrit mp4+sidecar hors racine | Passer par `ensureConfinedMediaDirectory` / rejeter absolus et `..` |
| **[H]** ToT/MCTS (`/think`, tool `reason`) codé en dur sur Grok/xAI, inaccessible sur gpt-5.5/ChatGPT OAuth | Reasoning | `think-handlers.ts:211-223`, `tool-handler.ts:1464`, `tree-of-thought.ts:100-104` (défaut `grok-3-latest`) | Sur la config réelle de Patrice, tout le sous-système raisonnement échoue net | Router via `resolveCommandProvider`/modèle courant (comme scene-planner) |
| **[H]** Contenu multimodal/tableau aplati en `null` avant comptage → sous-comptage systématique des tokens | Contexte | `context-manager-v2.ts:322-327` neutralise le support Array de `token-counter.ts:106-117` | Messages multimodaux comptés 0 → compaction/warnings retardés, dépassement fenêtre | Passer `msg.content` tel quel (le compteur gère déjà les tableaux) |
| **[H]** Les blocs de contexte injectés (workspace, lessons, KG, todo…) échappent au budget de compaction | Contexte | `agent-executor.ts:1318` (compaction) puis `1321-1333` push après | Au round limite, milliers de tokens empilés après compaction → dépassement réel | Injecter avant compaction, ou réserver un sous-budget et recompacter |
| **[H]** Garde anti-mismatch Gemini corrige `currentModel` mais laisse le provider sur le slug Grok | Providers | `client.ts:427-434` (pas de `setModel`), `provider-gemini-native.ts:436-438` | Client Gemini construit avec slug non-Gemini → URL `/models/<grok>:generateContent` → 404 ; `getCurrentModel()` ment | Appeler `geminiProvider.setModel('gemini-2.5-flash')` dans la branche |
| **[H]** `BuddyMemoryClient.close()` ne tue jamais le sidecar (ordre inversé) | Mémoire | `buddy-memory-client.ts:171-179` (`fail()` nullifie `child` avant `child?.kill()`) | Chaque close laisse un `buddy-memory serve` orphelin tenant le ledger | Capturer la ref avant `fail()` puis kill |
| **[H]** `saveMemories` réécrit tout le fichier mémoire NON atomiquement et sans verrou | Mémoire | `persistent-memory.ts:1143` (`writeFile` direct) vs pattern tmp+rename l.1006-1008 | Crash → `CODEBUDDY_MEMORY.md` tronqué ; 2 process → last-writer-wins silencieux | tmp+rename atomique + lock O_EXCL par scope |
| **[H]** Rollback self-improvement (`git reset --hard`+`git clean -fd`) détruit le WIP non commité | Cœur agentique | `agentic-coding-runner.ts:5769,5909-5913` (sandbox hérite du working tree) | Un run approuvé qui échoue efface le WIP et les fichiers non suivis de Patrice | `git stash -u` avant/restore après, ou revert ciblé par chemins de `contract.edits` |
| **[H]** Upload Codecov de la CI principale est mort : `npm test` ne génère aucun `lcov.info` | Tests & qualité | `ci.yml:52,57-63` ; `test`=`vitest run` sans `--coverage` | Le job coverage bloquant sur PR uploade un fichier inexistant/périmé | Utiliser `test:coverage` ou retirer l'étape ; `if hashFiles(lcov)!=''` |
| **[H]** `npm publish` gaté par 2 dossiers de tests seulement (fleet+kanban) | Tests & qualité | `release.yml:55-59` sans `needs` vers ci.yml | Un tag publie un tarball dont l'essentiel de la suite n'a pas été rejoué sur ce SHA | Faire dépendre le publish d'un ci.yml vert (`workflow_run`) sur le même SHA |
| **[H]** Champ `thinking` (budget_tokens) envoyé à tous les backends OpenAI-compat sans garde | Providers | `provider-openai-compat.ts:676-678,855` ; asymétrie vs `shouldIncludeSearchParameters:457-483` | `/think` sur OPENAI_API_KEY strict → param inconnu → HTTP 400, tour cassé | Gater sur `getModelInfo(model).provider ∈ {xai,anthropic}` |
| **[H]** Stream-retry ré-émet le préfixe entier, corrompant les args de tool-call concaténés | Providers | `stream-retry.ts:135-140` ; `chunk-processor.ts:522` (concat) | Coupure au milieu des args → JSON dupliqué → `JSON.parse` échoue (opt-in `CODEBUDDY_STREAM_RETRY=1`) | Émettre `stream_restart` à la frontière de retry, ou exclure les tours tool-call |
| **[H]** `ReasoningFacade` (~367 l.) jamais consommée : code mort dupliquant `getTreeOfThoughtReasoner` | Reasoning | `reasoning/index.ts:25-29` (ré-export seul) ; vrais consommateurs via `getTreeOfThoughtReasoner` | Auto-sélection/escalade de mode réputées exister ne tournent jamais | Câbler comme point d'entrée unique, ou supprimer avec son test |

---

## 3. Par sous-système

### Cœur agentique
- **[H]** Rollback self-improve destructeur (voir tableau).
- **[M, PLAUSIBLE]** Pipeline de middlewares enregistrée dans une **promesse flottante non attendue** (`codebuddy-agent.ts:338`) : un premier tour très rapide (modèle local/mock) peut s'exécuter avec `pipeline=undefined` → TurnLimit/CostLimit/QualityGate/Verification silencieusement sautés. Exposer une promesse `ready` avant le 1er tour.
- **[M]** `compactLargeToolResults`/`getAdaptiveCompactionThreshold` = **code mort** + `require()` en ESM (`agent-executor.ts:654-682`) : garde-fou Manus #13 jamais exécuté.
- **[M]** God-file `agentic-coding-runner.ts` (8551 l., 43 exports) mêlant orchestration/snapshots/canvas/I-O — noie les invariants sandbox/rollback.
- **[L]** `singleToolMode` : calls différés poussés dans `preparedMessages` transitoire → perdus (bug latent, flag mort).
- **[L]** `CODEBUDDY_SELF_IMPROVEMENT` muté en `process.env` global + `contract.riskLevel` muté en place (`:5515-5516`) : course sous cells concurrentes. Passer par AsyncLocalStorage, cloner le contrat.
- **[L, PLAUSIBLE]** Imports dynamiques dispersés dans le hot path (dont `model-tools` redondant avec l'import statique l.67) : impact perf négligeable (cache modules), à hoister pour la lisibilité.

### Providers & routing modèle
- **[H]** Mismatch Gemini, champ `thinking` non gaté, stream-retry corruptif (voir tableau).
- **[L]** Failover cross-provider perd le `defaultThinkingLevel` programmatique (`client.ts:659-667,782-790`) — précisément le réglage utilisé en prod. Helper `cloneRuntimeSettingsInto`.
- **[L]** Détection LM Studio/local par **ports codés en dur** (`:1234`/`:11434`) — trou sur port non standard. Dériver de `model-tools`/env.
- **[L]** `getModelToolConfig` renvoie des **références partagées mutables** (`model-tools.ts:718-722`) — hazard latent ; renvoyer un shallow-clone ou `Object.freeze`.
- **[L]** Duplication `getProviderName`/`ChatRequestPayload` client vs provider — **divergence déjà arrivée** (`chat_template_kwargs` d'un côté, sentinelles CLI de l'autre). Extraire une fonction/type partagés.
- **[L, PLAUSIBLE]** `model-routing.ts` câblé en dur Grok — mais **chemin mort** (aucun appelant prod de `autoRouteIfEnabled`). Seule fuite : `/router` affiche une comparaison Grok-only trompeuse. Supprimer/marquer non câblé.

### Contexte & compaction
- **[H]** Sous-comptage multimodal + blocs injectés hors budget (voir tableau).
- **[M]** `_prepareMessagesInternal` **mort et divergent** de `prepareMessagesRaw` (manque le `RunStore.forkRun`) — supprimer.
- **[M]** `computeStatsFingerprint` fait `JSON.stringify`+sha256 O(N) **même sur cache hit** (`:336-354`) ; le commentaire « microseconds » est faux. Clé légère / WeakMap.
- **[M]** `AUTOCOMPACT_PCT` basé sur `maxContextTokens` alors que `isNearLimit` utilise `effectiveLimit`, en **OU** → le levier documenté est inerte au-dessus de ~71-75 % de fenêtre. Uniformiser la base.
- **[M]** `takeSnapshot` écrit un **chemin fixe partagé** (`context-snapshot.json`) → écrasement entre sessions concurrentes (fleet/serveur). Inclure le sessionId + écriture atomique.
- **[M]** Sanitizer : `<think>` **non fermé** (sortie tronquée) fuit intégralement, et le strip `[INST]`/`<<SYS>>` peut effacer du contenu légitime. Ajouter un catch-all pour blocs non terminés.
- **[L]** Fenêtre glissante enrichie **duplique** les messages importants de la zone de chevauchement (`enhanced-compression.ts:271-281`) — masqué par `repairToolCallPairs`.

### Tools & registry
- **[M]** Index BM25 de `tool_search` construit **sans les keywords** (`tools.ts:701-706` alors que `BM25Index.index` les accepte) → métadonnées curées ignorées, tools indécouvrables.
- **[M]** **Dérive fleetSafe** : 59 tools `fleetSafe:true` mais seuls 3 exécuteurs câblés (`peer-tool-bridge.ts:327-331`) → capacité fantôme + doc trompeuse. Exécuteur générique confiné, ou réduire le flag aux 3 réels + test d'invariant.
- **[M]** God-file `computer-control-tool.ts` (6587 l., 1 classe) — éclater les backends plateforme/OmniParser/actions.
- **[M, PLAUSIBLE]** Sélection RAG **étranglée** : `maxTools(15)` ≈ `|alwaysInclude|` → 0-2 slots scorés seulement. Le run empirique **falsifie** la « neutralisation totale » (2 tools scorés surfacent, ex. `docker` NON surfacé). Découpler le budget des tools forcés (maxTools réservé aux scorés) ou relever à 25-30.
- **[L]** `register_tool` rend un tool appelable après **simple scan statique** (pas de held-out G3/G4) — atténué par opt-in + sandbox. Smoke-test comportemental ou marquer `unverified`.
- **[L, PLAUSIBLE]** Scoring MCP en comptage brut vs TF-IDF builtins : **le biais pro-MCP claimé est faux** (magnitudes comparables) ; c'est un ordre non déterministe. Normaliser sur la même échelle.

### Fleet multi-AI
- **[H]** privacy-lint non câblée + pas de plafond coût + secrets CKG (voir tableau).
- **[M]** Fuite mémoire : `dispatchedTasks` croît sans borne, `clearDispatch()` jamais appelé (`peer-chat-bridge.ts:386-485`). TTL+cap.
- **[M]** `peer.chat-session` : nombre de sessions et longueur d'historique **non bornés** (DoS RAM+disque, coût token quadratique). Plafonner + tronquer.
- **[M]** Machinerie `dispatchProfile/toolPolicy/toolset` exposée sur le fil mais **tools désactivés en dur** (`[]`/`undefined`) → parité Hermes non branchée, fausse confiance.
- **[M]** Regex `aws-secret-key` (40 chars) → **faux positifs sur SHA git complets/valeurs .env** → mémoire/leçon rédigée `[REDACTED]` ou rejetée. Exiger un contexte, ou ne pas lever `hasSecrets` sur ce kind low-confidence.
- **[M]** Plafond anti-boucle sur `frame.depth` **fourni par l'appelant** ; `peer_delegate` repart top-level. Inoffensif tant que les handlers sont sans tools, dangereux dès qu'ils seront outillés. Dériver la profondeur côté serveur via traceId.
- **[L]** `peer.tool.invoke.stream` transmet le contenu **deux fois** (chunks + payload final), borné 256 Ko. En stream, omettre `output` final.

### Self-improvement
- **[H]** Python contourne G1 + sandbox ne bloque pas secrets/réseau (voir tableau).
- **[M]** `EvolutionaryArchive` **ni atomique ni append-only** ; un fichier corrompu se lit silencieusement comme vide → tous les scénarios seed ré-attaqués + historique DGM perdu. JSONL O_APPEND + quarantaine bruyante.
- **[M]** `runLoop` **affamé par un seul scénario non-améliorable** (tool + skill engines) : `runCycle` retourne dès la 1re proposal rejetée, `runLoop` break. Faire `continue`.
- **[M]** Tests du gate/isolation **couvrent seulement JavaScript** — toute la surface Python (langage autorisé) non testée, régressions Python passeraient la CI verte.
- **[M, PLAUSIBLE]** Chemin `skills` = surface d'auto-écriture la plus faible (pas de held-out, coverage par sous-chaîne, auto-install en contexte). **Correction** : le firewall G2 est un vrai scanner (~26 patterns), pas « deux regex ». Compromis opt-in documenté ; garder propose-only sous auto-apply, coverage sémantique.
- **[L]** `engine.ts` ignore l'`appliedRef` du gate et re-devine la leçon par égalité de contenu → `appliedRef` undefined possible → rollback cassé. Utiliser `result.appliedRef`.
- **[L]** `SECRET_RE`/regex firewall étroites et lexicales, dernière barrière anti-exfiltration — traiter comme heuristique, s'appuyer sur un vrai sandbox.

### Sécurité serveur & HTTP
- **[CRITICAL]** Endpoints mutateurs sans scope + **[H]** SSRF redirect/rebinding (voir tableau).
- **[M]** Config `allowedHosts`/`extraBlockedHosts` du SSRFGuard = **câblage mort** (`getSSRFGuard()` appelé sans arg partout). Fusionner la config ou la supprimer.
- **[M]** Limiteurs préconfigurés (dont `sensitive` 5/min) **jamais montés** (`rate-limit.ts:358`) — combiné au CRITICAL, brute-force facilité.
- **[M]** Stores des limiteurs **par-route** sans cleanup ni cap (`createRouteRateLimiter`/`endpointRateLimit`) → fuite mémoire lente sous trafic A2A varié. Factoriser le cleanup du store global.
- **[M]** Clés API **en mémoire volatile** perdues au restart (`api-keys.ts:12`) — pas de révocation persistante. Persister les hash.
- **[M]** God-file `server/index.ts` (2171 l., ~34 handlers inline) = **cause racine** du CRITICAL (discipline de scope divergente). Extraire en routers. *(Argument perf du finding retiré : imports/getters sont cachés.)*

### Mémoire (CKG + persistante)
- **[H]** Rédaction CKG partielle + close() sidecar + saveMemories non atomique (voir tableau).
- **[M]** `load()` du ledger CKG **clear+reparse intégral à chaque lecture** (recall/ingest/retract) → latence O(N) croissante sans borne (chemin TS par défaut). Chargement incrémental + snapshot `.snap`.
- **[M]** Auto-link ingest/recallHybrid **embedde chaque entité une par une** sur cache froid ; `embedBatch` existe mais inutilisé → N inférences MiniLM séquentielles. Batcher + persister le cache.
- **[M]** Archivage du forgetting **non newline-safe** : mémoires multi-lignes corrompent l'archive → non restaurables (contredit la promesse « restaurable »). Échapper les `\n`.
- **[L, PLAUSIBLE]** `memory-consolidation.ts` **mort en production** (jamais câblé à une fin de session) + `memoriesUpdated:0` en dur. **Correction** : un test existe (pas « aucun test »). Câbler sur SessionFacade ou supprimer + corriger CLAUDE.md.
- **[L]** Le « lock » O_EXCL de la consolidation **écrit quand même** dans le catch (`append anyway`) — aucune exclusion mutuelle (module non exécuté aujourd'hui).
- **[L]** `remember()` n'appelle pas `load()` avant d'appliquer (contrairement à `rememberFact`/`retract`) → corroboration/supersede sur état périmé ; commentaire de `retract` trompeur. Homogénéiser.

### Sensoriel & companion
- **[H]** Webhook sans SSRF (voir tableau).
- **[M]** L'action `agent` **échappe au gate destructif** appliqué à `shell` (`sensory-rules-engine.ts:73-74`) → tour headless `buddy -p` déclenché sur événement. Forcer une posture read-only (plan) par défaut — levier plus fiable qu'un scan de mots-clés.
- **[M]** Surface `arrival` déclarée dans le conducteur mais **n'appelle jamais `claim()`** → salut + réplique présence/proactive dans la même fenêtre 45s (effet chatterbox). Faire consulter `claim('arrival')`.
- **[M]** Le runner de rappels **ne pose pas le plancher** du conducteur (`claim('reminder')` seulement dans cooking-timer) → un tick proactif peut suivre immédiatement une annonce médicament. Ajouter `claim('reminder')`.
- **[M]** Rappel one-shot **silencieusement perdu** si le daemon reste down jusqu'au jour civil suivant (`reminders.ts:197`) — pas d'escalade `missed`. Détecter au démarrage les one-shots dépassés.
- **[L]** God-file `voice-loop.ts` (2906 l., 46 exports) — zone d'une régression audio récente (`3c55da46`). Extraire routing/audio/reply.
- **[L]** `wireSpeechReaction` fonction-monstre (~629 l., ~15 variables mutables) — encapsuler dans une `SpeechTurnMachine`.
- **[L]** `rule-runs.jsonl` **sans rotation** contrairement à `dreams.jsonl` (`sensory-rules-engine.ts:248`) — hazard disque 24/7 connu. Appliquer la même rotation bornée.

### Review gate & confirmation
- **[H]** Relecteurs LLM tronqués à 6000 chars mais accept possible (voir tableau).
- **[M]** Apply **non atomique** alors que le rollback l'est (`apply-transaction.ts:113-114` vs restore temp+rename) → fenêtre de corruption sur crash, promesse « all-or-nothing » non tenue. Écrire via tmp+rename.
- **[L]** Chemin gaté (apply-transaction) **contourne UnifiedVfsRouter** → échappe à `measureLatency`, `editHistory` faussé. *(Menace symlink surévaluée : `resolvePath` valide en amont.)*
- **[L]** Mode per-file : repli d'annotation LLM → **mauvaise attribution** (`llm-reviewer.ts:93`) — neutralisé car per-file jamais atteint en prod.
- **[L]** Branche apply partiel **per-file livrée mais jamais atteinte** (défaut `atomic` partout) — dérive déclaré/consommé.
- **[L]** Cap du static-gate mesuré en **code units UTF-16** mais annoncé « bytes » (`static-gate.ts:55-58`) → sous-estime jusqu'à 3× sur CJK. `Buffer.byteLength`.
- **[L]** `isRevisable=true` pour tout reject non-failClosed, y compris **blockers structurels irréparables** (protected-path, caps) → tours de reviser gaspillés. Catégoriser les non-révisables (garder `secret` révisable).

### Cowork (Electron GUI)
- **[H]** Bypass auth WS Gateway (voir tableau).
- **[M]** `createWindow` **dupliquée et morte** dans `window-management.ts:157` (assigne le mainWindow module-local, motif exact de la régression rc.8). Supprimer la version morte.
- **[M]** `scanMediaLibrary` : parcours fs **synchrone** sur le process main à chaque `media.list` (`media-library.ts:66-130`) → gel UI (borné depth 4/cap 500). Passer aux `fs.promises`/worker + cache invalidé sur génération.
- **[L]** Comparaison de token d'auth **non constant-time** (`gateway.ts:756`, `===`) — atténué par rate-limit. `crypto.timingSafeEqual`.
- **[L]** Map `authAttempts` **jamais purgée** (`gateway.ts:56`) — fuite lente sur bind exposé.
- **[L]** God-file `index.ts` Cowork (6469 l., 204 handlers IPC, 192 imports) + double suivi de `mainWindow`. Extraire en `registerXxxIpc`.
- **[L]** Absence de tests sur les plus gros modules main (gui-operate-server 6883 l., session-manager 3004 l., agent-runner 2740 l.). *(Corrigé : ~8 tests dans src/main, pas 37.)*

### Tests & qualité
- **[H]** Codecov mort + publish sous-gaté (voir tableau).
- **[M]** Glob `**/*real*.test.ts` **trop large** (exclut tout test contenant « real ») + `RUN_REAL_TESTS` **absent de toute CI** → ~62 tests d'intégration réels morts. Resserrer le glob + job nightly.
- **[M]** Seuils de couverture 70 % **déclarés mais jamais appliqués** sur `validate`/ci.yml (seulement sous `--coverage`). Intégrer `test:coverage` ou rendre Sonar bloquant.
- **[M]** 33 assertions vides `expect(true).toBe(true)` sur chemins critiques (dispose/reset) — le nom du test ment. Vraies assertions + règle ESLint.
- **[M]** `knowledge-manager.ts` (380 l., **injecté dans le system prompt**) **aucun test direct**. Ajouter tests parse/priorité/scope.
- **[M, PLAUSIBLE]** Centaines de sleeps temps-réel (~399 `setTimeout(resolve)`, ~147 à 10 ms) — pattern **confirmé** mais la « flakiness structurelle » et les comptes (458/117) restent inférés. Migrer vers fake timers / `vi.waitFor`.
- **[L]** God-files de test (jusqu'à 6588 l.) + artefacts runtime versionnés ET gitignorés (`.codebuddy/tool-results/*`) qui se salissent — `git rm --cached`.

### Reasoning & council
- **[H]** ToT Grok-only + ReasoningFacade morte (voir tableau).
- **[M]** `getTreeOfThoughtReasoner` **fige apiKey/baseURL/model** du 1er appel (singleton) → `/switch` de modèle ignoré. Reconstruire sur changement de signature.
- **[M]** Boucle d'exécution de code MCTS (RethinkMCTS) **morte** : `executeCommand` jamais injecté → `executeCodeSafely` désactivé renvoie `success:true` → **bonus +0.3 factice** à tout nœud avec code. Renvoyer neutre/`false` ou brancher un BashTool gaté.
- **[M]** `ModelScoreboard` : ledger JSONL **non borné + reparse intégral** à chaque écriture concurrente, requêtes O(N) par candidat. *(Corrigé : impact par run council, pas par tour — routing opt-in off.)* Agrégats incrémentaux + rotation.
- **[M]** Fallback juge = **membre du panel qui s'auto-évalue**, biaisant le `finalText` VISIBLE (pas seulement le learning). Exclure le juge du set qu'il évalue.
- **[L]** `judge.ts:166` : RegExp d'extraction du gagnant **plante au-delà de 26 réponses** (lettres hors A-Z). Restreindre à `[A-Z]` + try/catch → abstain.
- **[L, PLAUSIBLE]** `searchProgressive` reconstruit l'arbre à chaque palier — mais **chemin dormant** (`progressiveDeepening` false partout). À traiter avec la facade.

### Media & studios
- **[H]** maxBytes contourné + output path arbitraire (voir tableau).
- **[M]** God-file `media-generation-tool.ts` (1946 l.) ; les modules `video/*` en dépendent juste pour `writeMediaSidecar` → couplage entrant. Extraire `media/asset-io.ts`.
- **[L]** **Six réimplémentations** quasi-identiques du runner spawn+timeout+slice (bornes de buffer divergentes -200k/-500k). Extraire `spawnCapture`.
- **[L]** `video-studio` ignore les presets de résolution (scènes 1920×1080 puis rescalées) — réachabilité étroite (CLI protégé). Réutiliser `resolveOutputProfile`.
- **[L]** `assessFilmQuality` **décode le film entier** avec timeout fixe 5 min → sur long-format, timeout → rapport dégradé. Échantillonner + timeout échelonné.
- **[L, PLAUSIBLE]** Dérive xfade : **mécanisme claimé inexact** (pas de dérive vidéo). Vrai défaut adjacent : `acrossfade` consomme 0.04 s côté audio là où le xfade vidéo n'en consomme pas → **désync A/V ~0.04 s par cut dégénéré**. Faire coïncider les deux côtés + test A/V.
- **[L, PLAUSIBLE]** ImageMagick reçoit `imagePath` en 1er opérande sans neutraliser les préfixes de coder (`msl:`/`https:`) — non réachable aujourd'hui (imagePath = PNG mmdc interne) mais fonctions exportées. Rejeter `^[a-z]+:`.

---

## 4. Quick wins (< 1 j chacun, fort ratio valeur/effort)

1. **Gater le champ `thinking` par provider** (`provider-openai-compat.ts`) — évite les HTTP 400 sur `/think` + OpenAI/Groq. *(H)*
2. **`geminiProvider.setModel()` dans la branche de correction mismatch** (`client.ts:431`). *(H)*
3. **Corriger le rollback self-improve** : `git stash -u` avant sandbox. *(H)*
4. **`BuddyMemoryClient.close()`** : capturer la ref avant `fail()`. *(H)*
5. **saveMemories / apply-transaction / EvolutionaryArchive → tmp+rename** (pattern déjà présent dans chaque fichier). *(H/M)*
6. **Joindre les keywords à `initToolSearchIndex`** + **passer `msg.content` tel quel au token-counter**. *(M/H)*
7. **Câbler `scanForSecrets` dans `route-peer-tool`** et forcer `sensitive`. *(H)*
8. **Ajouter le garde SSRF au webhook sensoriel** (fail-closed des deux côtés). *(H)*
9. **CI** : `npm test` → `test:coverage` sur le job codecov ; resserrer le glob `*real*`. *(H/M)*
10. **Confiner `output` d'assembleFilm** via `ensureConfinedMediaDirectory` ; **router les 2 downloads média** via `readBoundedResponseBytes`. *(H)*
11. **Supprimer les faux tests** `expect(true).toBe(true)` + règle ESLint. *(M)*
12. **`git rm --cached`** des artefacts `.codebuddy/tool-results/*` + supprimer `createWindow` morte de `window-management.ts`. *(L/M)*
13. **Restreindre l'alphabet juge à `[A-Z]`** + try/catch → abstain. *(L)*

---

## 5. Chantiers de fond (ordre suggéré)

1. **Durcissement de la frontière serveur/exposition (sécurité, priorité absolue).**
   a. Extraire les mutateurs inline de `server/index.ts` en routers avec `requireScope` (résout le CRITICAL).
   b. Refondre `checkAuthorization` sur le chemin WS Gateway Cowork (bypass auth).
   c. **Refonte SSRF unifiée** : résolution DNS unique + IP pinning + re-validation à chaque redirection + strip cross-origin, appliquée à fetch-tool/image-tool/web-search/webhook sensoriel/config vivante. Un seul module, tous les appelants passent par lui.
   d. Monter les rate-limiters `sensitive`/`auth` sur les mutateurs.

2. **Vrai sandbox pour le self-improvement.** Remplacer les regex par-langage + la redirection HOME par un sandbox réseau/FS réel (bwrap/namespaces) pour le scoring des tools authored (Python inclus), avec tests Python. Élimine deux HIGH d'un coup.

3. **Robustesse 24/7 : écritures atomiques + bornage des ledgers/Maps.** Généraliser tmp+rename (mémoire, apply, archive, snapshots) ; factoriser un writer JSONL borné partagé (dreams/rule-runs/scoreboard/CKG) ; TTL/cap sur `dispatchedTasks`, peer-sessions, `authAttempts`, stores rate-limit ; chargement incrémental du ledger CKG + snapshot `.snap` ; kill fiable du sidecar.

4. **Réintégration du raisonnement dans la config active.** Router ToT/`reason`/`/think` via `resolveCommandProvider`/modèle courant ; décider du sort de `ReasoningFacade` (câbler comme point d'entrée unique, ou supprimer avec `searchProgressive`/`escalate`) ; corriger le singleton figé et le bonus MCTS +0.3 factice.

5. **Compaction fidèle au budget.** Compter le contenu multimodal ; intégrer les blocs injectés (workspace/lessons/KG/todo) dans le budget de compaction ; unifier les bases de seuil (`effectiveLimit`) ; supprimer `_prepareMessagesInternal` mort.

6. **Découpe des god-files (par lots, après stabilisation des points ci-dessus).** Ordre par risque de sécurité : `agentic-coding-runner.ts` (8551 l., isole les invariants sandbox/rollback) → `server/index.ts` → `computer-control-tool.ts` → `index.ts` Cowork → `media-generation-tool.ts` (+ extraction `asset-io.ts`/`spawnCapture` partagés) → `voice-loop.ts`. Ajouter un garde-fou taille-de-fichier au CI aux côtés de `check:circular`.

7. **Boucler la parité fleet honnêtement.** Soit exécuter un agent réellement outillé filtré par `toolPolicy` dans `runDispatchedTask` (et dériver la profondeur anti-boucle côté serveur via traceId), soit retirer l'exposition du toolset/dispatchProfile tant que les tools ne tournent pas — pour que le contrat sur le fil corresponde au comportement. Idem `fleetSafe` : exécuteur générique confiné ou réduction du flag aux 3 tools réels.

**Note transverse** : un pattern « déclaré/testé mais non consommé en production » revient dans ≥9 sous-systèmes (ReasoningFacade, model-routing Grok, memory-consolidation, fleet cost-tracker, per-file apply, compactLargeToolResults, SSRF config, rate-limiters sensitive, RUN_REAL_TESTS). Au-delà des corrections individuelles, instaurer une **règle CI de détection de code exporté sans appelant de production** (grep hors tests/index) éviterait la ré-accumulation de cette dette de fausse assurance.
