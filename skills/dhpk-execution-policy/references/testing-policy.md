# Script testing policy

Every guard, resolver, validator, runner, sentinel/lifecycle script, codegen script, and pure `_lib` helper under `scripts/` MUST have a dedicated discoverable `tests/<stem>[-<aspect>].test.js` test.

Shell hooks are driven by a piped payload through the shared hook harness and asserted on exit status/output. JS, Python, and other scripts run directly via `spawnSync`. Tests use `tests/_lib/tinytest.js` without an external framework.

Installer, session-lifecycle, and git/network-shelling scripts may use smoke coverage that proves syntax, safe sandbox execution, and safe no-op behavior. Smoke coverage is not proof of full behavior.
