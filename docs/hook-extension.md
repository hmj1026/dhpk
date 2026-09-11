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

## Reviewer evidence

Reviewer dispatch is orchestrator-owned. A reviewer records a durable,
identity-compatible Review Gate result; missing, malformed, warning, or failing
evidence leaves the obligation unresolved.

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
`scripts/setup/install-assets.sh`. It copies selected source assets to
`<project>/.claude/dhpk/{hooks,rules,scripts}` without editing consumer hook
settings. Use `--dry-run` to inspect the full source/target plan; differing
target files are conflicts and require explicit `--force`. Executable source
files retain their executable bit.
