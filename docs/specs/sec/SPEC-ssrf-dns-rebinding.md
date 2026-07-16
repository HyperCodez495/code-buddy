# SPEC — SSRF DNS-rebinding : IP pinning (audit 2026-07-16)

Worktree git du repo **Code Buddy** (TypeScript strict ESM, Vitest). Branche : `fix/ssrf-dns-pinning`.

## Règles du repo (OBLIGATOIRES)
- Imports `.js` même depuis `.ts`. Pas de `any`. `logger` en prod. Tests sous `tests/`. FAIL-CLOSED.
- Ne casse PAS les cas légitimes (hôtes trusted, IP literals, hostnames publics normaux).
- Conventional Commits (`fix(security): …`). Avant commit : `npm run typecheck` (0) + tests ciblés verts.
- Ne commite jamais SPEC-*.md ni node_modules. NE MODIFIE PAS CLAUDE.md.

## Problème (TOCTOU / DNS rebinding)
`src/security/ssrf-guard.ts` `SSRFGuard.isSafeUrl()` (~l.312-330) fait `dns.lookup(host,{all:true})`,
valide chaque IP, puis **jette le résultat**. Ensuite `fetch(url)` (dans `safeFetchFollow` de
`src/security/safe-fetch.ts` et ses appelants) **re-résout le DNS indépendamment**. Un domaine hostile
à TTL=0 peut renvoyer une IP publique à la validation puis `169.254.169.254`/loopback au fetch → le
garde est intégralement contournable. Preuve audit : `ssrf-guard.ts:315-330`.

## Fix — épingler l'IP validée dans le fetch
1. **`src/security/ssrf-guard.ts`** :
   - Étends `SSRFCheckResult` avec `addresses?: Array<{ address: string; family: number }>` (les IP
     résolues ET validées). Renseigne-le dans `isSafeUrl` quand la résolution DNS a eu lieu (chemin
     `resolveDns`). Pour un IP literal, `addresses` peut rester absent (déjà une IP, rien à rebinder).
   - N'altère PAS la sémantique `{safe, reason}` existante (rétro-compatible : champ optionnel).
2. **`src/security/safe-fetch.ts`** (`safeFetchFollow`) :
   - Après `assertRedirectTargetIsSafe(currentUrl)`, récupère le `SSRFCheckResult` (adapte
     `assertRedirectTargetIsSafe` pour le RETOURNER au lieu de juste throw).
   - Si `result.addresses` est non vide, exécute le `fetch` avec un **dispatcher undici épinglant l'IP** :
     `import { Agent } from 'undici'` et un `Agent({ connect: { lookup: (hostname, opts, cb) =>
     cb(null, [{ address: pinned.address, family: pinned.family }]) } })` (ou la signature `lookup`
     appropriée à la version d'undici présente — vérifie `node_modules/undici`). Passe ce dispatcher
     via l'option `dispatcher` du `fetch`. Le SNI/TLS et l'en-tête Host restent le hostname d'origine
     (undici connecte à l'IP mais garde `servername`=hostname) → **pas de rebinding possible**.
   - **Par saut de redirection** : re-valider + re-épingler l'IP de la nouvelle cible (la boucle
     existante le permet déjà — étends-la).
   - Ferme/relâche le dispatcher après usage (`agent.close()` dans un finally) pour ne pas fuir.
   - Fallback sans régression : si `addresses` absent (IP literal / resolveDns off), fetch normal
     `redirect:'manual'` comme aujourd'hui.
3. **Vérifie la version d'undici** (`node -e "console.log(require('undici/package.json').version)"`)
   et adapte la signature exacte de `connect.lookup` / du dispatcher. Node ≥18 fournit undici built-in ;
   importe depuis le paquet `undici` (déjà une dép transitive — sinon utilise `require('node:...')`
   ou l'API `Agent` exposée). Si l'API dispatcher n'est pas disponible, échoue de façon EXPLICITE
   (throw clair) plutôt que de fetcher sans pinning — fail-closed.

## Tests exigés (`tests/security/ssrf-dns-pinning.test.ts`)
- `isSafeUrl` renseigne `addresses` sur un hostname résolu (resolver `dns.lookup` injecté/mocké).
- **Anti-rebinding (le test clé)** : un `lookup` qui retournerait une IP PRIVÉE au 2e appel est
  neutralisé — le fetch cible l'IP validée épinglée (spy sur le dispatcher `connect.lookup` :
  l'adresse connectée == l'IP validée, jamais la rebindée). Mocke `fetch`/le dispatcher pour observer
  l'IP de connexion.
- IP literal / resolveDns off ⇒ chemin fallback, pas de dispatcher (non-régression).
- Redirection cross-host ⇒ re-validation + re-pinning de la nouvelle IP.
- Cible privée à la 1re validation ⇒ refus (comportement existant préservé).

## Critères de done
- `npm run typecheck` : 0. Tests ciblés + `npm test -- tests/security` (guard existant) verts.
- Les appelants de `safeFetchFollow` (fetch-tool, image-tool, web-search) continuent de fonctionner.
- `docs/security/ssrf-pinning.md` : court doc du modèle (validation→pinning, limites). Commits `fix(security): …`.

## Interdits
- Ne réécris pas la logique de classification d'IP privée (réutilise `checkIPv4String`/`checkIPv6`).
- Ne désactive jamais la validation. Pas de fetch sans pinning quand des addresses sont disponibles.
- Ne touche pas au plafond coût fleet (autre vague).
