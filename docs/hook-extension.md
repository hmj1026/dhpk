# Hook extension model

dhpk registers a deliberately small default lifecycle. The complete default
mapping is [`hooks/hooks.json`](../hooks/hooks.json):

| Event | Script | Deterministic responsibility |
|---|---|---|
| `PreToolUse(Edit|Write|MultiEdit)` | `pre-edit-guard.sh` | protected-path and secret safety |
| `PreToolUse(Bash)` | `pre-bash-dispatch.sh` | shell safety plus Git/review-debt gates |
| `PostToolUse(Edit|Write|MultiEdit)` | `post-edit-dispatch.sh` | review-sentinel creation and routing |
| `SessionStart` | `session-start.sh` | validate and activate configured modules |
| `SubagentStop` | `subagent-stop-verify.sh` | reconcile a reviewer sentinel only after valid evidence |

`post-edit-dispatch.sh` invokes only `post-edit-remind.sh`; it does not run
module lint, formatting, CRLF, lockfile, or transcript work by default.
`session-start.sh` activates modules only; it does not create snapshots, probe
Docker, inspect install health, inject prompt hints, or emit orchestration
advice.

## Reviewer evidence

`SubagentStop` is intentionally strict. A reviewer clears only its own sentinel
when the artifact is fresh, canonical, and has a filename of the form
`<agent>-YYYYMMDD-HHMMSS-<slug>.md`. The file must start with delimited YAML
frontmatter and include `agent`, `generated_at`, `commit`, `scope`,
`severity_summary`, and `verdict`; only `APPROVE` or `PASS` clears the sentinel.
Missing, malformed, warning, or failing evidence leaves review debt armed.

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

## Copying assets to a consumer project

`/dhpk:setup --install hooks|rules|scripts|all` invokes
`scripts/setup/install-assets.sh`. It copies selected source assets to
`<project>/.claude/dhpk/{hooks,rules,scripts}` without editing consumer hook
settings. Use `--dry-run` to inspect the full source/target plan; differing
target files are conflicts and require explicit `--force`. Executable source
files retain their executable bit.
