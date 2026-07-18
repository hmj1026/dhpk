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

The core `post-edit-remind.sh` also deduplicates its immediate advisory by the
set of pending sentinels. It stores the last observed set in
`.claude/artifacts/sessions/.advisory-state`, emits the advisory only when that
set changes, and notices external reviewer clears before a later edit re-arms
the set. A path with no matching trigger is silent unless `DHPK_DEBUG=1`; the
sentinel writes themselves remain synchronous and idempotent.

## Dispatchers

| Dispatcher | Wired by `hooks.json` for | Calls (always) | Calls (per active module) |
|---|---|---|---|
| `scripts/hooks/post-edit-dispatch.sh` | `PostToolUse` matcher `Edit\|Write\|MultiEdit` | `scripts/hooks/post-edit-remind.sh` (sync — sentinel routing must complete first) | `modules/<m>/hooks/post-edit-*.sh` (each backgrounded so long-running lint never stalls the edit pipeline) |
| `scripts/hooks/pre-bash-dispatch.sh` | `PreToolUse` matcher `Bash` | `scripts/hooks/pre-bash-guard.sh` (sync — non-zero exit aborts the bash call) | `modules/<m>/hooks/pre-bash-*.sh` and `modules/<m>/hooks/pre-commit-*.sh` (all sync — non-zero exit aborts the bash call) |

`hooks.json` keeps `post-edit-advisory.sh` (async CRLF normalisation +
lockfile-sync reminder, see below) as a separate entry — it doesn't need
module context, so the dispatcher doesn't proxy it. Same for
`pre-edit-guard.sh`, `pre-edit-batch-gate.sh`, `session-start.sh`, and
`stop-review-reminder.sh`.
`reap-stale-sentinels.sh` is not a standalone `hooks.json` `Stop` entry at
all — it runs at `SessionEnd`, invoked by `session-end.sh`.

### Inline edit batch gate

`pre-edit-batch-gate.sh` is a synchronous `PreToolUse` guard for
`Edit|Write|MultiEdit`. It counts distinct in-project source files per session,
excluding bookkeeping and out-of-project paths. The third file warns; from the
fourth it exits 2 only when `DHPK_ORCHESTRATION_DISPATCH=on`. Explicit
`DHPK_INLINE_BATCH_OK=1` acceptance and a live fast-worker marker bypass the
counter. Sidecar/parsing failures fail open.

## Merged single-parse hooks

Two hooks each merge a pair of formerly-separate scripts so the shared
payload (a Bash command, or an edited file path) is parsed exactly once,
then evaluated against independent, disjoint triggers/slots:

- **`scripts/hooks/pretool-git-gate.sh`** (`PreToolUse` Bash matcher) —
  parses `tool_input.command` once and evaluates two independent slots
  against it:
  - **sentinel-commit slot** — warns (or blocks) on `git commit` / `merge` /
    `rebase` / `cherry-pick` while reviewer sentinels are pending. Mode:
    `DHPK_SENTINEL_COMMIT_GATE` (`warn|block|off`).
  - **protected-branch slot** — warns (or blocks) on `git commit` / `merge`
    / `rebase` / `cherry-pick` / `reset` / `push` on a protected branch
    (`main`, `master`, `develop`, `release/*`, `hotfix/*` by default). Mode:
    `DHPK_BRANCH_SAFETY` (`warn|block|off`). Warn-mode dedups the reminder
    once per session per (branch, protected-list) via a session-scoped tmp
    state file; block mode is never deduped — a rejected command must
    always explain itself.

  If either slot fires in block mode, the hook emits one combined stderr
  message naming every fired slot and exits 2. Otherwise, if any slot fires
  in warn mode, it emits one combined `systemMessage` covering every fired
  warn slot and exits 0. Else it exits 0 silently.

- **`scripts/hooks/post-edit-advisory.sh`** (`PostToolUse` `Edit|Write|MultiEdit`
  matcher, async) — extracts `file_path` once and evaluates two disjoint
  triggers:
  - **CRLF normalisation** — normalises CRLF → LF in `.sh` files (a plain
    stdout echo, not a `systemMessage`).
  - **root-manifest lockfile-sync reminder** — when a root-level package
    manifest (`package.json`, `composer.json`, etc.) is edited, emits a
    `systemMessage` reminding that the matching lock file needs
    regenerating before commit. Advisory only — writes no sentinel.

  Always exits 0 regardless of which advisories fire.

## SubagentStop ordering

`hooks.json`'s `SubagentStop` array wires `scripts/hooks/subagent-stop-quality.sh`
**before** `scripts/hooks/subagent-stop-verify.sh` — block-before-auto-clear.
`subagent-stop-quality.sh` is a default-OFF quality gate
(`CLAUDE_PLUGIN_OPTION_SUBAGENT_QUALITY_GATE=on` to enable) that blocks a
subagent whose final report is thin, a bare approval, an unresolved error
with no risk/next-step language, or an evidence-free review-shaped report —
so `subagent-stop-verify.sh` never auto-clears a reviewer's sentinel on a
no-op reply.

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

Reviewer dispatch itself establishes review debt. `pre-agent-liveness-mark.sh`
uses the same slot table to arm an absent owning sentinel with
`arm-on-dispatch <agent>` provenance and an `[arm-on-dispatch]` marker in the
path field. The marker means “dispatch owed” without inventing a pending file;
a fresh matching reviewer artifact at `SubagentStop` clears it through the
normal auto-clear path. An already-armed sentinel is never rewritten.

## Session advisory once-guard

SessionStart advisories share `_lib/advise-once.sh` and call
`dhpk_advise_once <key>`. The helper stores a session-ID-keyed marker under
`.claude/artifacts/sessions/`, so plugin-version, cross-CLI drift, and
module/manifest-mismatch warnings appear at most once per session and may
appear again in a new session. If marker storage fails, it returns permission
to emit rather than hiding the advisory.

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
