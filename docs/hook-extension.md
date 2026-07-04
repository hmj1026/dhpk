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

Dispatch filter: `pre-bash-*.sh` hooks receive **every** Bash call;
`pre-commit-*.sh` hooks are only dispatched when the command contains
`git commit` (excluding `git commit-tree`) — the dispatcher pre-filters to
avoid forking a process tree per module on unrelated commands. A
`pre-commit-*` hook should still self-skip on non-commit payloads
(defense in depth), but must not rely on being called for anything else.

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

## Review sentinel slots

The reviewer sentinel SSOT lives in `scripts/hooks/_lib/payload.sh`
(`SENTINEL_NAMES` / `SENTINEL_LABELS` / `SENTINEL_AGENTS` /
`SENTINEL_SHORT_NAMES`, all index-aligned). Seven slots, fixed order:

| # | id | sentinel | trigger source |
|---|----|----------|----------------|
| 0 | code | `.pending-review` | built-in extensions + module triggers + `code:` extra paths |
| 1 | db | `.pending-db-review` | built-in (`.sql`, `migrations/`) + module triggers + `db:` |
| 2 | sec | `.pending-security-review` | built-in (auth/upload basenames) + module triggers + `sec:` |
| 3 | fe | `.pending-frontend-review` | module triggers (js etc.) + `fe:` — no built-in default |
| 4 | doc | `.pending-doc-review` | built-in (harness/openspec/docs md) + `doc:` |
| 5 | polyfill | `.pending-polyfill-review` | library-author module hook only |
| 6 | migration | `.pending-migration-review` | module.yaml `migration:` triggers (yii-1.1 ships `protected/migrations/`) or `mig:` extra paths — no built-in default |

Projects opt into slots 5–6 (and add extra paths to any slot) via
`review_trigger_extra_paths`, e.g. `["mig:db/migrate/", "db:app/models/"]`.
Agent names per slot are overridable via `review_agents`; shorter overrides
are padded with the defaults. Do **not** fork `payload.sh` to add a slot —
file an upstream slot request instead, so every array consumer stays aligned.

## Worked example — project-local async PostToolUse hook

A project can wire its own hooks alongside the plugin's in
`.claude/settings.json`. A real-world example: regenerate a skill index
whenever a `SKILL.md` changes —

```json
{ "hooks": { "PostToolUse": [ {
  "matcher": "Edit|Write|MultiEdit",
  "hooks": [ { "type": "command", "async": true,
    "command": "bash .claude/hooks/post-edit-skill-index.sh" } ] } ] } }
```

The hook reads the same stdin payload (parse it with the plugin's
`_lib/payload.sh` helpers), self-skips unless the edited path matches
`.claude/skills/*/SKILL.md`, and runs its generator script. Async
PostToolUse hooks must always exit 0 and keep findings on stderr.

## Disabling

Set `modules: []` (or remove a specific module from the list) in
userConfig. `DHPK_ACTIVE_MODULES` becomes empty (or omits the module),
and the dispatcher skips its hooks entirely. The plugin ships every
module, but only enabled ones run.

## Hook performance convention

Synchronous hooks run on the session hot path and share the platform's per-hook timeout budget. Follow this ordering so a hook never stalls a turn:

1. **Bash fast-exit gates first.** Evaluate cheap pure-bash checks — env-var reads (`CLAUDE_PLUGIN_OPTION_*`, `DHPK_*`), string/length tests, file-existence tests — and `exit 0` before invoking any `python3` / `git` / other subprocess. An opted-out or trivially-irrelevant event must cost zero forks.
2. **Bound every blocking read.** Read stdin with a deadline (`IFS= read -r -d '' -t <secs> VAR`) shorter than the hook's `hooks.json` timeout, so a stdin opened-but-not-closed degrades to an early exit instead of consuming the whole budget.
3. **Bound external subprocesses.** Wrap any call that can hang (a daemon probe like `docker ps`, a network call) with `run_with_timeout <secs> <cmd>` from `_lib/portable-timeout.sh` (coreutils `timeout` / `gtimeout`, else a perl-alarm fallback), using a deadline shorter than the hook's own budget.
4. **Declare an explicit `timeout` in `hooks/hooks.json`.** Every synchronous hook entry declares a `timeout` sized to its worst-case cost rather than inheriting the platform default — the outer platform backstop, with the inner guards above keeping the common case fast.

`userpromptsubmit-skill-hint.sh` demonstrates conventions 1, 2, and 4 (bash fast-exit gates ahead of any subprocess, a bounded `read -r -d '' -t 3` stdin read, and an explicit `hooks.json` timeout); `session-start.sh` demonstrates convention 3 (`run_with_timeout` around its `docker ps` probe). No single hook needs all four — apply whichever guards its own work requires (convention 2 for any stdin-reading hook, convention 3 for any hook that shells out to a call that can hang).
