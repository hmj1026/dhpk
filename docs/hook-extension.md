# Hook extension model

> **Languages**: **English** · [繁體中文](./hook-extension.zh-TW.md)

dhpk registers a deliberately small default lifecycle. The complete default
mapping is [`hooks/hooks.json`](../hooks/hooks.json). The machine-readable
default event manifest is [`hooks/default-events.json`](../hooks/default-events.json):
the three event groups listed there are wired by default. Events listed under
`optionalEvents` remain source assets until a consumer explicitly registers
them; optional events are not registered by default and are not silently active.

| Event | Script | Deterministic responsibility |
|---|---|---|
| `PreToolUse(Edit\|Write\|MultiEdit)` | `pre-edit-guard.sh` | protected-path and secret safety |
| `PreToolUse(Bash)` | `pre-bash-dispatch.sh` | shell safety plus Git branch-safety gates |
| `SessionStart` | `session-start.sh` | validate and activate configured modules |
| `SubagentStop` | `subagent-stop-verify.sh` | clean up stopped fast-worker liveness state |

`session-start.sh` activates modules only; it does not create snapshots, probe
Docker, inspect install health, inject prompt hints, or emit orchestration
advice.

## Bash outer ceiling

The Bash `PreToolUse` command declares `timeout: 2100` and `onFailure: "block"`.
Claude Code 2.1.295 and newer can block the triggering command when that hook
times out or cannot run. Older versions are not claimed to fail closed the same
way. This declaration is not a measured 2100-second wait.

The `Edit|Write|MultiEdit` guard also declares `onFailure: "block"`, with
`timeout: 5`. Claude Code 2.1.295 and newer fail-close that guard: a failed or
timed-out hook blocks the edit. Older Claude Code ignores `onFailure`, so a
failed or timed-out guard still lets the edit proceed.

The supported default envelope is one commit root each for JS, Python, Swift,
and PHP, one Python project group on that root, and Swift build/test settings
no higher than 360/480 seconds. Inner deadlines plus one second of grace are
JS 212, Python 255, Swift 842, and PHP 423, totaling 1732 seconds. The
remaining 368 seconds are for preparation and cleanup. Steps with no inner
deadline are outside that sum. Extra roots, extra groups, a larger Swift
override, or any run that reaches the ceiling can be interrupted. An
interrupted or unfinished check is not PASS, and the triggering Bash command
is not released past the ceiling. Inner deadlines stay unchanged.
`SubagentStop` is outside this ceiling.

## Reviewer evidence

Reviewer dispatch is orchestrator-owned and advisory. A reviewer writes a
Markdown report; no hook or artifact enforces a review gate.

## Optional extensions

Other hook scripts remain source assets for explicit consumer setup. They are
not activated merely by enabling a module or setting a userConfig key. A
consumer who needs them must register its own hook command and own its runtime
cost, output, and failure policy. This includes prompt hints, session/install
health checks, Docker probes, completion or graduation scans, SessionEnd and
compaction work, learning observation, post-edit formatting/linting, and Stop
reminders.

Module hooks may still participate in the combined Bash dispatcher:
`pre-bash-*.sh` and `pre-commit-*.sh` receive Bash payloads for active modules;
non-zero exit status blocks that Bash call. They must self-skip outside their
applicable project/file context.

## Hook argument expansion

When the Claude Code plugin runtime invokes a hook, `${CLAUDE_PLUGIN_ROOT}` tokens
inside that hook entry's `args` are expanded to the installed plugin root before the
subprocess starts. This is observed behavior, not a published or guaranteed
contract; treat it as compatibility guidance and re-check it against the installed
runtime before changing hook argument paths. The source mapping remains
[`hooks/hooks.json`](../hooks/hooks.json).

## Copying assets to a consumer project

`/dhpk:setup --install hooks|rules|scripts|all` invokes
`scripts/setup/install-assets.sh`. Hooks and scripts copy into
`<project>/.claude/dhpk/{hooks,scripts}`. Default `--install rules` writes
`<project>/.claude/rules/dhpk-overrides.md` and does not copy upstream policy
into `.claude/dhpk/rules/`; `--vendor` restores that discouraged verbatim
copy. An existing `.claude/dhpk/rules/` tree is reported as legacy and left
in place. The installer never edits consumer hook settings. Use `--dry-run` to
inspect the full source/target plan; differing target files are conflicts and
require explicit `--force`. Executable source files retain their executable
bit. Any destination path with a symlink component is rejected even with
`--force`, including the rules stub path.
