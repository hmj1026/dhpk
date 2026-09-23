---
description: 'Short Claude front door for the implicit-eligible $js-static-check-strategy status action.'
argument-hint: '[--path <directory>]'
allowed-tools: 'Skill'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# `/dhpk:ts-check-status`

Forward `$ARGUMENTS` unchanged to the canonical
`$js-static-check-strategy status` action. Pass `--path <directory>` to scan a
specific frontend root; when omitted, the owning Skill applies
`CLAUDE_PLUGIN_OPTION_JS_CHECK_PATH` or its `js/` default and returns the
machine-readable directive distribution.

Not for: everyday JavaScript feature work or isolated lint-rule lookups (use `dhpk-js-lint-config`).

This command is a thin Host front door. The owning Skill and its standalone
runner own classification, deterministic ordering, unavailable-path
diagnostics, and the `PASS` / `UNAVAILABLE` evidence state.

Completion: relay the Skill result without converting an unavailable scan into
a passing status.
