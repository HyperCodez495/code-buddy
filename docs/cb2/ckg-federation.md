# Fédération du Collective Knowledge Graph (P0)

La fédération CKG partage les leçons et faits de première main entre pairs de la fleet. Elle est strictement pull-only : le demandeur appelle `peer.ckg.sync`, reçoit un delta borné, puis réingère chaque entrée avec la provenance `peer:<peerId>` via l’API normale du CKG.

## Activation et configuration

La fonctionnalité est désactivée par défaut. `CODEBUDDY_CKG_SYNC=true` doit être défini sur les deux pairs :

- le pair serveur vérifie la variable avant toute lecture de son ledger ;
- le demandeur la vérifie avant toute requête, lecture d’état ou écriture locale ;
- si elle manque, l’appel échoue avec `CKG_SYNC_NOT_ENABLED` et aucune donnée n’est exposée.

Variables disponibles :

| Variable | Défaut | Rôle |
|---|---:|---|
| `CODEBUDDY_CKG_SYNC` | absent/désactivé | Doit valoir exactement `true` des deux côtés. |
| `CODEBUDDY_CKG_SYNC_TYPES` | `lesson,fact` | Allowlist CSV locale. `decision` n’est jamais partagé par défaut. |
| `CODEBUDDY_CKG_SYNC_MAX` | `1000` | Nombre maximal d’entrées ingérées pendant un pull. |
| `CODEBUDDY_FLEET_API_KEY` | absent | Authentification d’une URL WebSocket passée directement à la CLI. |
| `CODEBUDDY_FLEET_JWT` | absent | Alternative JWT pour une URL WebSocket directe. |

Une allowlist explicite peut inclure `lesson`, `fact`, `discovery` et `decision`. Les types demandés sont toujours intersectés avec l’allowlist du pair qui sert les données, puis de nouveau validés contre l’allowlist locale du demandeur.

## Protocole `peer.ckg.sync`

Requête :

```json
{
  "sinceTs": 1784109600000,
  "types": ["lesson", "fact"],
  "limit": 200
}
```

- `sinceTs` est optionnel, exprimé en millisecondes Unix ; seules les entrées strictement plus récentes sont servies.
- `types` est optionnel et ne peut élargir l’allowlist du serveur.
- `limit` vaut `200` par défaut et doit être compris entre `1` et `500`.

Réponse :

```json
{
  "entries": [
    {
      "v": 1,
      "kind": "entity",
      "recordedAt": "2026-07-15T10:00:00.000Z",
      "agentId": "machine/repo",
      "contentHash": "…",
      "id": "fact:collective:example",
      "type": "fact",
      "name": "example",
      "text": "…",
      "confidence": 0.8
    }
  ],
  "maxTs": 1784109600000
}
```

Les objets de `entries` sont des événements `entity` standards du ledger JSONL existant ; le format du ledger n’est pas modifié. `maxTs` devient le `sinceTs` de la page suivante. Quand aucune entrée n’est retournée, il reste égal au curseur reçu.

## Ingestion, déduplication et anti-boucle

L’état local est stocké dans `~/.codebuddy/collective/sync-state.json`, séparément pour chaque pair. Il contient le dernier `sinceTs` validé et les IDs d’entrée déjà vus. L’écriture est atomique par renommage d’un fichier temporaire.

Pour chaque entrée nouvelle, le demandeur appelle `CollectiveKnowledgeGraph.remember()` avec `agentId` et `source` égaux à `peer:<peerId>`. Deux pairs indépendants qui confirment le même fait deviennent donc deux contributeurs CKG distincts ; le calcul natif de corroboration augmente sa confiance.

L’anti-ragot est appliqué avant la réponse : toute entrée dont `agentId` ou `source` commence par `peer:` est exclue. Un pair ne sert donc que son savoir de première main. Il n’existe ni push, ni appel récursif, ni propagation multi-saut en P0.

Le demandeur valide aussi intégralement la réponse : une entrée mal formée, hors allowlist ou déjà marquée comme distante fait échouer le pull. La borne `CODEBUDDY_CKG_SYNC_MAX` reste dure, même si plusieurs pages sont disponibles.

## CLI

Depuis un processus où le pair est déjà présent dans le registre fleet :

```bash
CODEBUDDY_CKG_SYNC=true buddy research sync mon-pair
```

Une URL Gateway WebSocket peut aussi être utilisée directement avec une clé ou un JWT fleet :

```bash
CODEBUDDY_CKG_SYNC=true \
CODEBUDDY_FLEET_API_KEY='…' \
buddy research sync ws://pair.example:3000/ws
```

Prévisualisation sans écriture du ledger ni de `sync-state.json` :

```bash
CODEBUDDY_CKG_SYNC=true buddy research sync mon-pair --dry-run
```

Le pair distant doit lui aussi démarrer avec `CODEBUDDY_CKG_SYNC=true`; sinon il répond explicitement `CKG_SYNC_NOT_ENABLED`.
