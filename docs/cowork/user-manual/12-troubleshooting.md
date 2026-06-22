# 12. Dépannage

Problèmes courants et comment les résoudre.

## « No provider configured » / impossible d'envoyer un message
Ouvrez **Réglages → API**, choisissez un provider, collez la clé (ou connectez-vous / pointez vers
votre serveur local), choisissez un modèle, et cliquez **Test**. Vérifiez l'absence d'espaces ou de
guillemets parasites autour de la clé.

## « Request timed out » ou « Connection failed »
- Vérifiez votre connexion internet et que le provider n'est pas en panne.
- Vérifiez la clé API et, pour les endpoints personnalisés, la **Base URL**.
- Pour les providers **locaux** (Ollama, LM Studio, vLLM), confirmez que le serveur local tourne et
  que l'URL correspond.
- Lancez **Réglages → API diagnostics** pour tester DNS/TLS/auth/disponibilité du modèle étape par
  étape.

## « Sandbox not available »
- **Windows :** installez WSL2 avec `wsl --install`, puis rouvrez **Réglages → Sandbox**. Sans lui,
  Cowork retombe sur l'exécution native avec le path guard.
- **macOS :** installez Lima avec `brew install lima`, puis **Initialize** depuis l'onglet Sandbox.
- **Linux :** l'exécution native est attendue ; le path guard confine toujours l'accès fichier.

## « Permission denied » quand l'agent écrit un fichier
- Confirmez que le **dossier de travail** est bien réglé (écran d'accueil / barre latérale).
- Approuvez l'action dans le **dialogue de permission**, ou ajoutez une règle allow dans
  **Réglages → Permission rules** (et vérifiez qu'aucune règle deny ne la bloque).

## Les fichiers n'apparaissent pas dans l'onglet Fichiers
- Assurez-vous d'avoir choisi le dossier qui les contient réellement.
- Rafraîchissez en rouvrant le panneau de contexte ; les très gros dossiers mettent un instant à
  s'indexer.

## Un modèle est absent de la liste déroulante
- Le provider n'a peut-être pas renvoyé sa liste de modèles, ou votre clé n'y a pas accès.
  Rafraîchissez la liste dans **Réglages → API**, ou tapez le nom du modèle manuellement.

## L'agent demande sans cesse une approbation
C'est le mode de permission **Default** qui fait son travail. Pour réduire les demandes sans risque,
ajoutez des règles allow cadrées (ex. `Bash(npm *)`) via l'assistant de règles, ou montez le **mode
de permission** délibérément — voir [Permissions & sandbox](04-permissions-and-sandbox.md).

## UI lente ou mémoire élevée sur les longues sessions
- Utilisez la **vue focus** (`Cmd/Ctrl+Maj+F`) pour un rendu plus léger.
- Surveillez la **jauge de fenêtre de contexte** ; compactez ou scindez la session avant qu'elle ne
  se remplisse.
- Archivez ou supprimez les anciennes sessions depuis la barre latérale.

## L'agent est à court de contexte
Ouvrez les **insights de session** pour voir l'usage, puis compactez la conversation ou démarrez une
session neuve. Coupler avec **Code Explorer** (le graphe de connaissances du code servi via MCP)
permet à l'agent de répondre aux questions de structure sans recharger les fichiers, ce qui réduit
fortement la pression sur le contexte.

## Obtenir plus d'aide
- Dans l'app : `Cmd/Ctrl+/` (raccourcis), **Réglages → Logs** (diagnostics), et les docs d'aide
  embarquées.
- Projet : ouvrez une issue sur le [dépôt Code Buddy](https://github.com/phuetz/code-buddy).
