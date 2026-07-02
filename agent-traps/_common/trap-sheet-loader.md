# Stack Trap-Sheet Loader

Shared procedure for loading stack-specific traps on demand, referenced by generic (stack-neutral) agents. Keeps each agent body free of the detection boilerplate; only the agent's `<agent-name>` in the locator path and any agent-specific manifest/stack-id exceptions differ per caller.

1. **Active stacks**: read `$DHPK_ACTIVE_MODULES` (comma list) if set; otherwise detect from manifests via Bash — `composer.json` (`require.php` floor + framework key, e.g. `yiisoft/*`, `laravel/framework`), `package.json`, `*.xcodeproj` / `Package.swift`, `pyproject.toml`.
2. For each detected stack `S`, Read `${CLAUDE_PLUGIN_ROOT}/agent-traps/<agent-name>/<S>.md` if it exists and apply those traps; ignore stacks with no sheet. (Locator: `find "${CLAUDE_PLUGIN_ROOT}/agent-traps/<agent-name>" -name '<S>.md'`.)

Callers that need extra manifest signals or module-id remapping beyond the above (e.g. a `vue` dependency inside `package.json`, or a `frontend`/`ios` stack-id consolidation for perf sheets) document that exception inline in their own "Stack trap sheet" section rather than here — those are genuinely agent-specific, not part of the shared shape.
