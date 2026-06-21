# Architecture (main / preload / renderer + IPC)

Cowork est une application **Electron** (`cowork/`, `package.json` séparé du moteur Code Buddy). Comme toute app Electron, elle est scindée en **trois contextes d'exécution** isolés, qui ne partagent **aucune** mémoire et ne communiquent qu'à travers le pont IPC décrit plus bas.

## Les trois contextes

| Contexte | Fichier source | Rôle | Accès |
|----------|----------------|------|-------|
| **main** | `cowork/src/main/index.ts` | Process Node.js privilégié. Crée la `BrowserWindow`, gère le cycle de vie de l'app, les deep-links/protocole, la résolution du moteur, l'accès disque/SQLite, le serveur HTTP embarqué. | Node complet (fs, net, child_process, modules natifs). |
| **preload** | `cowork/src/preload/index.ts` | Pont de sécurité. Expose une surface **restreinte et typée** au renderer via `contextBridge.exposeInMainWorld('electronAPI', …)`. Tourne dans un contexte isolé (`contextIsolation`). | Limité : `ipcRenderer` uniquement, pas Node. |
| **renderer** | `cowork/src/renderer/` (React) | L'interface utilisateur (React + Vite). Ne voit **que** `window.electronAPI`. | Aucun accès Node ni système de fichiers direct. |

Cette séparation est la frontière de sécurité d'Electron : le renderer (qui affiche du contenu potentiellement non fiable) ne peut jamais appeler `fs` ou `child_process` directement — il doit passer par le preload, qui ne propose qu'une liste blanche d'opérations.

## Le pont IPC

### Sens renderer → main (commandes)

Le preload expose deux mécanismes complémentaires sur `window.electronAPI` :

1. **Wrappers typés (la grande majorité du trafic)** — `~150` méthodes `invoke` typées, regroupées en **~70 espaces de noms** (`config.*`, `mcp.*`, `session.*`, `workflow.*`, `server.*`, `fleet.*`, `skills.*`, `companion.*`, `project.*`, `team.*`, `memory.*`, `autonomy.*`, `git.*`…). Chacune appelle `ipcRenderer.invoke('<namespace>.<action>', …)` et attend une réponse `Promise`. Le handler correspondant est enregistré côté main via `ipcMain.handle`.

2. **Canal générique allowlisté** — `electronAPI.send(event)` et `electronAPI.invoke(event)` acceptent un `ClientEvent` discriminé par `event.type`, mais **bloquent tout type absent de `ALLOWED_CLIENT_EVENTS`** (un `ReadonlySet` codé en dur dans `src/preload/index.ts`, ~18 types : `session.start`, `session.continue`, `session.steer`, `session.stop`, `permission.response`, `settings.update`, `workdir.set`…) :

   ```ts
   // cowork/src/preload/index.ts
   invoke: async <T>(event: ClientEvent): Promise<T> => {
     if (!ALLOWED_CLIENT_EVENTS.has(event.type)) {
       console.warn('[Preload] Blocked unauthorized invoke type:', event.type);
       throw new Error(`Unauthorized event type: ${event.type}`);
     }
     return ipcRenderer.invoke('client-invoke', event);
   },
   ```

> **Modèle de menace (honnête).** L'allowlist du preload est une première barrière, mais la **vraie validation** (payloads, traversées de chemin, privilèges) est **déléguée au process main** dans les handlers `ipcMain.handle`. Le commentaire de `src/preload/index.ts` l'assume explicitement : le renderer ne peut pas contourner les contrôles parce que la source de vérité et les droits d'exécution résident dans le process main, de confiance. Ne supposez pas que le preload « sécurise » à lui seul.

### Sens main → renderer (événements de flux)

Le main pousse des événements vers le renderer via **un seul canal** : `'server-event'`.

```ts
// cowork/src/main/ipc-main-bridge.ts
export function sendToRenderer(event: ServerEvent) {
  // … (interception des sessions remote) …
  mainWindow.webContents.send('server-event', event);
}
```

Le type `ServerEvent` (`cowork/src/renderer/types/index.ts`, ligne ~1686) est une **union discriminée d'environ 70 types d'événements** (`stream.message`, `stream.partial`, `stream.thinking`, `stream.done`, `session.status`, `trace.step`, `permission.request`, `checkpoint.created`, `fleet.peers`, `subagent.spawned`, `team.update`, `update.available`…). C'est par ce canal que transitent le streaming des tokens, l'état des sessions, les traces d'exécution, les demandes de permission et les mises à jour de la flotte.

### Le contrat `setMainWindow()` / `getMainWindow()` (régression à connaître)

`sendToRenderer` récupère la fenêtre via `getMainWindow()`, défini dans `cowork/src/main/window-management.ts`. Ce module possède **sa propre** variable locale `let mainWindow: BrowserWindow | null = null`. Il faut donc impérativement appeler `setMainWindow(win)` **juste après** la création de la `BrowserWindow` :

```ts
// cowork/src/main/index.ts (~ligne 962)
setMainWindow(mainWindow); // sinon getMainWindow() retourne null
```

> **Régression dual-`mainWindow` (corrigée commit `751f7eb6`).** `index.ts` et `window-management.ts` déclaraient chacun un `let mainWindow` distinct. Seul celui de `index.ts` était assigné ; `getMainWindow()` retournait donc **toujours `null`**, et **tous** les événements main→renderer étaient silencieusement perdus (UI muette, aucun streaming). Le correctif a exporté `setMainWindow()` et l'a appelé après la création de la fenêtre.
>
> **Règle :** si vous ajoutez un module qui a besoin de `mainWindow`, **importez le setter** depuis `window-management.ts` — ne **re-déclarez jamais** la variable. Le même motif vaut pour `setTray()` / `getTray()`.

## État persistant (où vivent les données)

`<userData>` = `app.getPath('userData')` (chemin Electron par OS : `~/.config/Cowork` sous Linux, `~/Library/Application Support/Cowork` sous macOS, `%APPDATA%\Cowork` sous Windows).

| Donnée | Emplacement | Source |
|--------|-------------|--------|
| Base SQLite de Cowork (sessions, projets, messages…) | `<userData>/cowork.db` (+ `-wal`/`-shm`) | `cowork/src/main/db/database.ts` |
| Workflows visuels persistés | `<userData>/workflows.json` | `cowork/src/main/workflows/workflow-bridge.ts` |
| Répertoire de travail par défaut | `<userData>/default_working_dir` | `cowork/src/main/index.ts` |
| Secret JWT du serveur embarqué | `~/.codebuddy/.jwt_secret` (mode `0600`) | `cowork/src/main/server/server-bridge.ts` |
| Base SQLite du **moteur** Code Buddy | `~/.codebuddy/codebuddy.db` | moteur core, via `server-bridge.ts` |

Le secret JWT est **chargé s'il existe, sinon généré** (`crypto.randomBytes(64)`) et écrit en `0600` ; en cas d'échec d'écriture, un secret éphémère est utilisé pour ce boot. C'est requis parce que le middleware d'auth du serveur core lève une erreur au chargement sous `NODE_ENV=production` si `JWT_SECRET` est absent.

## Résolution du moteur Code Buddy (4 couches)

Cowork ne ré-implémente pas l'agent : il **charge dynamiquement** le moteur Code Buddy (le `dist/` du repo parent) et instancie `CodeBuddyEngineAdapter`. Le chemin du moteur est résolu par `resolveEnginePathWithDiagnostic()` (`cowork/src/main/engine/embedded-mode.ts`), dans cet ordre de priorité (type `EnginePathLayer`) :

| Ordre | Couche (`layer`) | Chemin résolu | Quand |
|-------|------------------|---------------|-------|
| 1 | `env-override` | `process.env.CODEBUDDY_ENGINE_PATH` (tel quel) | Surcharge manuelle (dev/test). |
| 2 | `packaged` | `<resourcesPath>/dist` | App empaquetée (`app.isPackaged`). |
| 3 | `dev-from-bundle` | `<mainBundleDir>/../../../dist` | Dev, à partir du bundle main compilé. |
| 4 | `dev` | `<appPath>/../dist` | Dev par défaut (repli). |

```ts
// cowork/src/main/index.ts (~ligne 1382)
const engineResolution = resolveEnginePathWithDiagnostic({
  envOverride: process.env.CODEBUDDY_ENGINE_PATH,
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appPath: app.getAppPath(),
  mainBundleDir,
});
log(`[Main] Resolving Code Buddy engine: layer=${engineResolution.layer} path=${engineResolution.path}`);
```

L'adaptateur est ensuite importé en ESM via `pathToFileURL(...).href` (obligatoire : sous Windows, le loader ESM de Node rejette les chemins absolus bruts type `D:\...` avec `ERR_UNSUPPORTED_ESM_URL_SCHEME`). Le profil Code Buddy sélectionné dans Cowork est appliqué **avant** la construction de l'adaptateur, en important `toml-config` depuis **le même** chemin moteur pour partager le singleton `ConfigManager`.

## Solidité (honnêteté technique)

- **Solide / éprouvé :** la séparation 3-contextes, le canal unique `server-event`, le contrat `setMainWindow`/`getMainWindow` (la régression `751f7eb6` a un test de non-régression), la résolution 4 couches du moteur, et la persistance SQLite/`workflows.json`/JWT. Ce sont les chemins empruntés à chaque démarrage.
- **À surveiller :** la sécurité IPC repose sur la **validation côté main**, pas sur le preload seul — tout nouveau handler `ipcMain.handle` doit valider ses entrées (chemins, privilèges) lui-même. L'allowlist `ALLOWED_CLIENT_EVENTS` ne couvre que le canal générique `client-event`/`client-invoke`, pas les ~150 wrappers typés (qui exposent directement leur namespace au main).
