---
name: precommit
description: "Pre-commit checks — lint:fix -> build -> test:unit"
---
## Task

Run the deterministic precommit pipeline. `--fast` selects fast mode; without
it, use full mode.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/precommit-runner.js" --mode <fast|full> --tail 80
```

The runner is the sole owner of ecosystem detection, package-manager selection, step ordering, graceful skips, changed-file reporting, and the final verdict. Treat a non-zero exit as a real precommit failure; do not recreate or bypass its fallback logic in prose.
