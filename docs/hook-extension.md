# Hook extension model — wrapper-dispatch

How dhpk routes PostToolUse / PreToolUse events through core hooks and
opt-in module hooks.

## Why a wrapper

Claude Code's plugin manifest can declare hooks statically in
`hooks/hooks.json`, but a static wiring cannot conditionally call a hook
that lives in an opt-in module (`modules/<m>/hooks/...`) — the manifest
either calls a hook or it doesn't.

dhpk solves this with a thin **dispatcher** in core
(`scripts/hooks/post-edit-dispatch.sh`,
`scripts/hooks/pre-bash-dispatch.sh`). The dispatcher:

1. Captures the JSON payload from stdin.
2. Synchronously runs the matching **core** hook
   (`post-edit-remind.sh`, `pre-bash-guard.sh`).
3. Iterates `DHPK_ACTIVE_MODULES` (set by `session-start.sh` from the
   `modules` userConfig) and invokes each module's matching hook.

This keeps `hooks/hooks.json` static while letting modules contribute
behaviour at runtime.

## Dispatchers

| Dispatcher | Wired by `hooks.json` for | Calls (always) | Calls (per active module) |
|---|---|---|---|
| `scripts/hooks/post-edit-dispatch.sh` | `PostToolUse` matcher `Edit\|Write\|MultiEdit` | `scripts/hooks/post-edit-remind.sh` (sync — sentinel routing must complete first) | `modules/<m>/hooks/post-edit-*.sh` (each backgrounded so long-running lint never stalls the edit pipeline) |
| `scripts/hooks/pre-bash-dispatch.sh` | `PreToolUse` matcher `Bash` | `scripts/hooks/pre-bash-guard.sh` (sync — non-zero exit aborts the bash call) | `modules/<m>/hooks/pre-bash-*.sh` and `modules/<m>/hooks/pre-commit-*.sh` (all sync — non-zero exit aborts the bash call) |

`hooks.json` keeps the legacy `post-write-crlf-fix.sh` (async normalisation)
as a separate entry — it doesn't need module context, so the dispatcher
doesn't proxy it. Same for `pre-edit-guard.sh`, `session-start.sh`,
`stop-review-reminder.sh`, and `reap-stale-sentinels.sh`.

## Authoring a module hook

A module's hook lives under `modules/<m>/hooks/` and follows the same
contract as a core hook:

1. **Always exit 0 on success, 2 to block** (PreToolUse only).
2. **Self-skip silently** when prerequisites are missing — never error
   out for "this isn't a JS file" or "no `npx` in PATH". The dispatcher
   invokes module hooks unconditionally per active module; skipping is
   the module's responsibility.
3. **Read stdin payload via `_lib/payload.sh`'s `extract_tool_input`.**
   The dispatcher streams the same payload to every hook it calls.
4. **Source dependencies via relative paths** (`. "$(dirname "$0")/../../../scripts/hooks/_lib/payload.sh"`
   from `modules/<m>/hooks/`). Avoid absolute paths so the module is
   portable across plugin install locations.

## Naming convention

The dispatcher picks up module hooks by filename glob:

- `post-edit-dispatch.sh` → globs `modules/<m>/hooks/post-edit-*.sh`.
- `pre-bash-dispatch.sh` → globs `modules/<m>/hooks/pre-bash-*.sh` and
  `modules/<m>/hooks/pre-commit-*.sh`.

If you need a new dispatch direction (e.g. SessionStart per-module
behaviour), add a new dispatcher in core that follows the same
template.

## Performance & async semantics

- **post-edit dispatcher**: core runs sync; module hooks run in the
  background. The dispatcher exits with the core's exit code, so Claude
  Code observes the sentinel-write result. Module hooks complete on their
  own time — perfect for ESLint / type-check / lint-style work that the
  user doesn't need to wait for.
- **pre-bash dispatcher**: every hook runs sync, in order, and any
  non-zero exit aborts. This is the right semantics for guards (rm -rf
  block, push-while-sentinel block, pre-commit lint gate).

## Worked example — JS module

`modules/js/hooks/`:

```
modules/js/hooks/
├── _lib/
│   └── js-tier-detect.sh         # source-only tier detector (frontend / vendor / non-js)
├── post-edit-js-lint.sh          # picked up by post-edit-dispatch.sh
└── pre-commit-js-validation.sh   # picked up by pre-bash-dispatch.sh
```

The post-edit hook runs `npx eslint <file>` per frontend-tier edit,
backgrounded so the edit pipeline doesn't wait. The pre-commit hook
inspects `git commit` invocations, runs `npm run lint && npm run
typecheck` on staged JS, and exits 2 on failure to block the commit.

## Disabling

Set `modules: []` (or remove a specific module from the list) in
userConfig. `DHPK_ACTIVE_MODULES` becomes empty (or omits the module),
and the dispatcher skips its hooks entirely. The plugin ships every
module, but only enabled ones run.
