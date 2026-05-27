# Étude globale — durcissement des systèmes de pilotage (desktop + web)

> 2026-05-27. Déclenchée par une veille externe (Agent S2 / ScaleCUA / Browser Use) relayée pour « blinder Code Buddy ». Fondée sur **deux audits read-only du code réel** + une **vérification empirique** de chaque finding critique. Suite de [`scratch/` weekend pilot work] et du *pilot systems study*.

## 0. TL;DR

- **Notre archi hybride est la bonne** (UIA-primary + fallback universel scroll/OCR/coords côté desktop ; selector-first `data-agent-ref` + fallback coords côté web). La taxonomie SOTA (Screenshot+Vision / Accessibility / Hybrid) valide ce choix.
- **Faille de sécurité réelle trouvée ET corrigée ce tour** : le guard SSRF laissait passer toutes les plages privées dont le 1ᵉʳ octet ≥ 128 (`192.168/16`, `172.16/12`, `169.254/16` = metadata cloud) à cause d'un bug de décalage signé, **et** l'action `navigate` directe ne l'appelait pas du tout.
- **Vraie limite architecturale découverte** : le script PowerShell desktop est **au plafond de la ligne de commande Windows** (`-EncodedCommand`). Toute addition non triviale casse tout via `spawn ENAMETOOLONG`. C'est l'argument décisif pour migrer vers un **runspace persistant / script-fichier** (résout aussi la latence).

---

## 1. État des deux pilotes (findings vérifiés)

### Desktop (`src/tools/computer-control-tool.ts` + `src/desktop-automation/`)
- **Latence** : un **processus PowerShell frais par action** (`windows-native-provider.ts:170-173`, `smart-snapshot.ts` `runPowerShellEncoded`). Pas de runspace réutilisé. ~400-600 ms/action de surcoût de démarrage. Timeout `tryWindowsActivateNamedRole` = 30 s (`computer-control-tool.ts:3276,3821`).
- **Plafond de taille de script (NOUVEAU, vérifié ce tour)** : le gros script de `tryWindowsActivateNamedRole` (depth-18 walk + `Realize-VirtualItem` + helpers) est si proche de la limite de ligne de commande Windows que **+~40 lignes de logs l'a fait dépasser → `spawn ENAMETOOLONG`**, cassant toutes les actions sémantiques. Contrainte dure, pas cosmétique.
- **Gestion d'erreur** : nombreux `catch {}` silencieux (≈30+) ; pas de retry/backoff ; `Start-Sleep` codés en dur. La boucle de scroll de `Realize-VirtualItem` se **termine déjà** correctement (break à `vpct>=100` + break no-progress) — l'« hang 30 s » de l'audit était surévalué.
- **Couverture** : ~18/40 ControlTypes mappés (`smart-snapshot.ts` `mapWindowsRole`). Non mappés : DataGrid/Grid/Table, Spinner/ProgressBar/ScrollBar (RangeValue), multi-select (Selection conteneur), Window/Transform.
- **Code mort** : fast-path CDP commenté (`computer-control-tool.ts:5000-5021, 5092-5112`) — dépend d'un `SystemControl.getActiveWindow()` absent. Dette de nettoyage, pas un risque.

### Web (`src/browser-automation/`)
- **Surface** : ~49 actions via `BrowserTool` ; Playwright 1.58.2. Sélecteur-first `data-agent-ref` **committé et câblé** (`browser-manager.ts:520` injection, `:739-755` click, `:775-796` type) + jitter humain + courbe de Bézier souris ; fallback coordonnées réel.
- **Robustesse** : attentes parfois codées en dur (`browser-manager.ts:893` `waitForTimeout(200)` sur dropdown) ; pas de retry sur select/drag ; `catch (_) {}` larges (`:733-737, :804-807, :943-944`) masquent les échecs ; pas d'invalidation de snapshot sur navigation SPA (refs périmées) ; iframes/shadow DOM non traversés.
- **Sécurité** : `ssrf-guard.ts` complet (RFC1918, loopback, IPv4-mapped IPv6, octal/hex…) — **mais bug critique corrigé ce tour** (voir §2).
- **Stagehand / operator** : `browser-operator-executor.ts` (4 couches : session/plan/executor/Stagehand) existe mais **n'utilise PAS `BrowserManager`** → deux chemins disjoints, pas de partage de session.

### Maturité relative
Web plus large en surface, desktop plus spécifique. Les deux ont la bonne stratégie hybride. Le desktop paie la latence + le plafond de script PowerShell ; le web manque d'auto-wait/SPA/iframe.

---

## 2. Livré ce tour (quick-wins vérifiés)

### ✅ SSRF — bug de fond corrigé + parité d'appel + scope (sécurité)
1. **Bug signé dans `isPrivateIPv4` (`ssrf-guard.ts`)** : `(uint32 & 0xffff0000)` renvoie un `int32` **signé** en JS → négatif dès que le 1ᵉʳ octet ≥ 128 → ne valait jamais le littéral hex positif. Conséquence : `192.168.x`, `172.16-31.x`, `169.254.169.254` (**metadata cloud**), multicast, réservé — **tous laissés passer**. Corrigé en forçant la comparaison non signée (`(u & mask) >>> 0`). Vérifié empiriquement avant/après (loopback+10/8 bloqués avant ; toutes les plages privées bloquées après ; publics `1.1.1.1`/`8.8.8.8` et `172.32` hors-plage laissés passer).
2. **`navigate` direct ne validait pas l'URL** (`browser-tool.ts:722`) — le guard n'était câblé qu'en mode batch (`:474`). Ajout du `assertSafeUrl`, **scopé aux schémas réseau http/https** uniquement (les schémas locaux `file://`/`about:`/`data:` restent permis — pas un SSRF, et le pilote web navigue légitimement vers des fichiers locaux ; le canari a attrapé cette régression et le scope la corrige).
3. **Tests** : `tests/browser-automation/navigate-ssrf.test.ts` (8) — bloque loopback/metadata/192.168/172.16/10.x ; laisse passer publics + `172.32` (frontière /12). Canari `npm run pilot:validate` vert.

---

## 3. Tenté puis **reverté** (et pourquoi c'est une donnée précieuse)

### ❌ « scroll polling adaptatif + log des catches » sur `Realize-VirtualItem`
La prémisse de l'audit (hang 30 s) était fausse : la boucle se termine déjà. Mon ajout (logs par catch + compteur 3-strike + commentaires) a **gonflé le script PowerShell au-delà de la limite de ligne de commande Windows** → `spawn ENAMETOOLONG` → **toutes** les actions via `tryWindowsActivateNamedRole` cassées. Le canari `pilot:validate` l'a attrapé (3/4 fail) ; revert → 4/4. **Leçon = §4 item 1** : le script desktop n'a plus de marge ; il faut sortir de `-EncodedCommand`.

---

## 4. Roadmap différée (priorisée, file:line — à attaquer une par une, avec validation Patrice)

1. **Runspace PowerShell persistant / script-fichier** (`windows-native-provider.ts:170`, `smart-snapshot.ts` `runPowerShellEncoded`). Résout **deux** problèmes : (a) latence ~400-600 ms→~50-100 ms/action ; (b) le **plafond `ENAMETOOLONG`** (un script chargé depuis un fichier `.ps1` ou une session ouverte n'a plus la limite de ligne de commande). **Le plus haut levier.** *Deep — refactor de code stable, ne pas faire seul sans go explicite.*
2. **IPv6 SSRF** : revoir `isPrivateIPv6` (`ssrf-guard.ts:177`) pour le même type de bug + couvrir ULA `fc00::/7`, link-local `fe80::/10`. *Quick win.*
3. **Web : invalidation du snapshot sur navigation SPA** (`browser-manager.ts:395`) — refs périmées après changement de route. *Deep.*
4. **Web : auto-wait + retry** (remplacer `waitForTimeout(200)` `:893` par `waitForSelector(:visible)` ; retry sur select/drag/goto). *Quick → medium.*
5. **Web : iframes / shadow DOM** (`SnapshotOptions.frame` défini mais inutilisé). *Deep.*
6. **Desktop : mappings ControlType manquants** (DataGrid/Table via Grid/GridItem, Spinner/ProgressBar via RangeValue, multi-select via Selection) — = **P1** du plan `peppy-dancing-rabbit`. *Medium.*
7. **Nettoyage des `catch {}` silencieux** (desktop ≈30+, web `:733/804/943`) — **mais** côté desktop : écrire les warnings dans un **side-channel fichier**, jamais sur stdout (parsé en JSON) ET sans gonfler le script (cf. §3). *Medium, à coupler avec l'item 1.*
8. **Étude SOTA** : `simular-ai/Agent-S` (archi) → 1 page de patterns portables (cf. backlog d'inspiration). *Recherche.*

---

## 5. Lien SOTA
- Hybride = mature : confirmé. Notre fallback universel desktop est le seul recours pour Avalonia (Skia, pas de HWND → peers UIA only).
- **Gap vs SOTA** : leur « accessibility <200 ms » suppose un binding natif ; nous payons le spawn PowerShell. L'item 1 (runspace) ferme partiellement cet écart.
- **Robustesse OS-change** (Win11 24H2 a changé l'arbre UIA) : notre tuning (depth 18, scroll cap 200) y est sensible. `npm run pilot:validate` sert de **canari** à relancer après chaque MAJ Windows.
