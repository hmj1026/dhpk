# Codex skill usage discovery

Use this page when a project has the dhpk Codex projection and you need to
know which arguments are available. The command output is the authoritative
answer for the installed inventory revision; this page explains the lookup.

## Discover the grammar

```text
$flow-guide help
$flow-guide help flow-guide
$flow-guide help flow-drive
$flow-guide help dhpk-git-smart-commit
```

`help` is metadata-only. It lists Codex-invokable public names or returns one
usage card containing syntax, finite actions, options, authority, and examples.
It does not load the target procedure, execute a target, modify files, stage a
commit, or grant authority. The generated catalogue is
[`../skills/flow-guide/references/codex-usage-catalog.json`](../skills/flow-guide/references/codex-usage-catalog.json).

If `$flow-guide` is not discovered, confirm that the project-local projection
exists and is receipt-owned:

```bash
test -f .codex/.dhpk-installed.json
test -e .codex/skills/flow-guide/SKILL.md
```

Then rerun the supported installer from a persistent dhpk checkout:

```bash
DHPK_ROOT=/absolute/path/to/dhpk
bash "$DHPK_ROOT/scripts/hooks/install-codex-skills.sh" --update
```

`codex plugin list` is management evidence, not skill-discovery evidence. A
missing Codex CLI or unavailable custom-role registry is reported separately;
do not infer runtime support from a static projection.

## Main interfaces

| Need | Invocation | Boundary |
| --- | --- | --- |
| Discover arguments | `$flow-guide help [skill]` | Read-only metadata; no target execution |
| Get a route | `$flow-guide route <task>` | Advice only; add `--go` for at most one implicit handoff |
| Read policy | `$flow-guide rules <phase-or-question>` | Read-only policy lookup |
| Determine next action | `$flow-guide next <change-or-worktree>` | One evidence-backed next route |
| Close an edit boundary | `$flow-guide close <change-or-worktree>` | Checklist only; no commit/release claim |
| Implement confirmed work | `$flow-drive <change-id-or-confirmed-spec>` | Explicit-only, mode-free implementation |
| Group commits | `$dhpk-git-smart-commit` | Existing standalone commit owner; explicit Git authority |

`flow-guide` has exactly five actions: `help`, `route`, `rules`, `next`, and
`close`. The old `--mode classify|policy|checklist` and
`flow-drive:author` shapes are retired. `flow-drive` does not author proposals
or select a route. Use the external `$openspec-propose` skill when a proposal,
design, or task set is still missing.

## Common implementation modifiers

Ask the exact card before adding a modifier. The confirmed implementation entry
accepts only these options:

```text
$flow-drive <change-id> --plan
$flow-drive <change-id> --plan=opus:xhigh
$flow-drive <change-id> --worker=claude|codex|agy|auto
$flow-drive <change-id> --reasoner=codex:gpt-5.6-sol:high
$flow-drive <change-id> --architect
$flow-drive <change-id> --no-architect
```

`--codex` is a retired diagnostic and does not select a hidden peer. The exact
worker/reasoner values and any skill-specific options are in the generated card.

## Family selectors

The nine portable family names are `skill-scope`, `skill-forge`, `flow-guide`,
`flow-drive`, `change-verdict`, `code-trace`, `laravel`, `phpunit`, and
`harness-govern`. Use `$flow-guide help <family>` to see the current grammar.

- `skill-scope`: `health`, `judge`, `stocktake`, `scout`.
- `skill-forge`: `create`, `distill-rules`.
- `change-verdict`: `code`, `pr`, `security`, `tests`, `docs`, `risk`.
- `code-trace`: `explore`, `diagnose`, `history`, `select-tool`.
- `laravel`: selectors `5.4`, `6`, `7`, `8`, `9`, `10`, `11`, `mix`.
- `phpunit`: selectors `9`, `10`, `11`.
- `harness-govern`: `health`, `budget`, `fill`, `revise`, `sync`.

`git-smart-commit` remains a standalone public name. `agy-commit` is retired;
choose the AGY worker explicitly through the commit owner's documented option
when available. Version-note, harness, feasibility, request-ticket, and
OnePassword predecessor names are not aliases.

## Operator-only authentication

When a workflow needs OnePassword authentication, the operator runs `op signin`
in the terminal and confirms the session through the provider's own output.
Never put a session token, vault value, or login output in a prompt, generated
catalogue, receipt, or commit.

When upgrading from 0.53.0, the operator must also run `op signout`, confirm no
process still depends on the old session, and remove the legacy
`~/.op-claude-session` cache through the operator's secure-file procedure
without printing its contents. Installers and agents do not inspect or delete
that file automatically.

## Evidence boundary

A usage card proves only that metadata was generated and validated. It does not
prove the skill was executed, a worker was available, tests passed, a projection
loaded at runtime, or a release was published. Keep those states distinct in
the handoff: `PASS`, `BLOCKED`, `NOT_RUN`, `NOT_CONFIGURED`, or `UNAVAILABLE`.
