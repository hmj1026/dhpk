# Explanation mode

Use this reference only for `--explain`. Read the target and enough imports,
callers, and project configuration to explain its role; do not equate the
target file with the whole system.

| Depth | Required output |
|---|---|
| `brief` | One-sentence purpose and one evidence link |
| `normal` | Purpose, ordered execution flow, key concepts, and direct dependencies |
| `deep` | Normal output plus callers, complexity, edge cases, and risks or improvement options |

For a second perspective, send the same target and depth to a fresh isolated
read-only subagent with a clean prompt. Preserve separate evidence until the
final reconciliation. An explicit `--second-opinion=codex-exec` may add a
one-shot CLI perspective; it is not implicit.
