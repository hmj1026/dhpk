---
description: 'Quick pre-commit checks — lint:fix -> test:unit'
argument-hint: '[--skip-lint]'
allowed-tools: 'Bash(node:*), Bash(git:*), Read'
---

## Task

Run the deterministic fast precommit pipeline:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/precommit-runner.js" --mode fast --tail 60
```

The runner is the sole owner of ecosystem detection, package-manager selection, step ordering, graceful skips, changed-file reporting, and the final verdict. Treat a non-zero exit as a real precommit failure; do not recreate or bypass its fallback logic in prose.
