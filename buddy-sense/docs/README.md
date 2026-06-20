# Diagrams

Diagrams-as-code (Graphviz DOT), rendered to SVG via [Kroki](https://kroki.io) — the
`.dot` is the maintainable source; the `.svg` is committed so GitHub renders it inline.

| Source | Rendered | Shows |
|--------|----------|-------|
| `architecture.dot` | `architecture.svg` | the senses → thalamus → bridge → Code Buddy pipeline |
| `dreaming.dot` | `dreaming.svg` | heartbeat-paced memory consolidation |

Regenerate after editing a source (note the `text/plain` content type — required):

```bash
curl -s -X POST https://kroki.io/graphviz/svg -H "Content-Type: text/plain" \
  --data-binary @architecture.dot -o architecture.svg
```
