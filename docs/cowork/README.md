# Documentation Cowork

Cowork est l'application desktop (Electron) de Code Buddy. Elle embarque **le même
moteur** que le CLI — pas un fork — donc tous les providers, outils, MCP, skills et
middlewares en héritent. Cette documentation couvre l'architecture, les panneaux,
les workflows visuels, le build, les réglages et le dépannage.

> Honnêteté : chaque page signale ce qui est **solide** et ce qui est **expérimental**.

## Sommaire

| Page | Contenu |
|------|---------|
| [00 — Vue d'ensemble](00-overview.md) | Ce qu'est Cowork, le moteur embarqué, la stack, le lancement |
| [01 — Architecture](01-architecture.md) | main / preload / renderer, le pont IPC, l'état persistant |
| [02 — Les panneaux](02-panels.md) | Tous les onglets du dock, par groupe, avec leur statut |
| [— Panneaux de réglages](settings-panels.md) | Détail des onglets de la fenêtre Settings |
| [03 — Workflows visuels](03-workflows.md) | Le DAG visuel → l'Orchestrator core (pool de 4 agents) |
| [04 — Build, dev, run](04-build-run.md) | `build:gui`, la boucle de dev Linux, `rebuild`, les tests |
| [05 — Réglages & serveur](05-settings-server.md) | Providers/modèles, OAuth, le serveur HTTP embarqué |
| [06 — Dépannage](06-troubleshooting.md) | Les gotchas (dual-mainWindow, ABI sqlite, GPU Linux…) |

## Démarrage rapide

```bash
buddy install-gui          # une fois : installe Electron + build le bundle desktop
buddy gui                  # lance l'application (alias : buddy desktop)
# Dev :
cd cowork && npm run dev
```

Voir aussi : [`cowork/ARCHITECTURE.md`](../../cowork/ARCHITECTURE.md) · [`docs/cowork.md`](../cowork.md) · [`cowork/DEV-LINUX.md`](../../cowork/DEV-LINUX.md).
