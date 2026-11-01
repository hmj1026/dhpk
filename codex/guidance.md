# dhpk for Codex CLI

Installation and support-status SSOT: [platform-installation.md](../docs/platform-installation.md)
and [platform-installation.zh-TW.md](../docs/platform-installation.zh-TW.md).

This file describes how the `dhpk` plugin's content interacts with **Codex CLI** (separate from Claude Code). Claude Code does NOT auto-load anything inside the plugin's `codex/` directory.

## What dhpk provides to Codex CLI

## Conditional runtime evidence (#848/#854)

Installation and projection evidence establish the applicable Codex
installation contract. A fresh native role session is required only when a
loader, role registration, tool mapping, activation defect, or explicit native
acceptance request is in scope. `codex plugin list` remains management evidence;
it cannot promote `NOT_RUN`, `UNAVAILABLE`, or `BLOCKED` to runtime `PASS`.

When a user runs the bundled installer from a repository checkout (an
installed Claude plugin cannot supply `codex/`):

```bash
bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh
```

The canonical checkout keeps `codex/skills/` as symlinks to skill sources, where structured `dhpk-next` maps and `dhpk-modes` lists remain intact. Project-local Codex and Cursor installers materialize each selected skill as a physical tree and serialize non-string skill metadata values as JSON text inside YAML string scalars in the installed `SKILL.md` files. This transform leaves the source checkout untouched: receipt source fingerprints bind the raw source bytes, while destination fingerprints bind the projected bytes.

The default projection is hybrid: inventory-declared supporting assets are symlinked into the project, while skills and every `.codex/agents/*.toml` are materialized as physical files. `--copy` makes the remaining projection physical. `codex/config.toml.example` is placed alongside any existing `.codex/config.toml`. The installer records these destinations in the schema-v3 `.dhpk-installed.json` receipt, including each entry's effective mode and each skill's stable ID/current public name, and never replaces an unowned same-name asset. Codex CLI then discovers the skills/agents the same way it discovers any project-local Codex content, and generated roles resolve their trap sheets/contracts through `.codex/dhpk/`.

The current Codex projection contains 28 skill entries: 26 invokable skills and
two internal transport/dispatch-context runtimes. The inventory and generated
receipt, not this file, own that selection.

## Plugin loading differences (Claude Code vs Codex CLI)

| Concern | Claude Code | Codex CLI |
|---------|-------------|-----------|
| **Loading path** | `agents/`, `commands/`, `skills/`, `hooks/`, `modules/` at plugin root | `.codex/agents/` in the project (after sync); skills are discovered from `.agents/skills`, and the `.codex/skills/<name>` entries are compatibility symlinks to `../../.agents/skills/<name>` created by the installer; Codex lifecycle hooks use `~/.codex/hooks.json`, project `.codex/hooks.json`, or inline `[hooks]` in `config.toml` |
| **userConfig** | Yes — Claude prompts at install | Codex has no equivalent; configure via the synced `config.toml.example` |
| **Modules (`modules/<stack>-<version>/`)** | Selective activation via `userConfig.modules` | Not directly mirrored — Codex sees a flat skills set |
| **MCP** | Full (servers declared in plugin or user settings) | Configured via `config.toml` and `codex mcp add` |

See "Key Differences from Claude Code" below for the capability-level comparison (hooks, commands, agents, security/review).

## Authoring guidance

When writing skills meant to work in both harnesses:

- Keep `description:` framework-agnostic. Trigger keywords are what makes both harnesses pick the skill up.
- Avoid Claude-Code-specific syntax in skill bodies (e.g. `${user_config.X}` substitution, `TaskCreate` tool, slash-command examples).
- If a skill is intrinsically tied to Claude-specific hook payloads, sentinel paths, or plugin-managed lifecycle (e.g. a "review the last edit" workflow), it belongs in Claude Code only — do NOT mirror it into `codex/` unchanged. A generic Codex lifecycle hook must use Codex's own `hooks.json` or inline TOML contract.
- Tools the skill calls should be available in both environments (Read/Write/Bash usually safe; `mcp__*` tools require the matching MCP server on both sides).

## Layout: symlink projections under `codex/skills/`

Every entry under `codex/skills/` is an **in-repo relative symlink** to a
canonical flat package under `skills/<public-name>/`. Editing a projection edits
the canonical source, and the change applies to both worlds. The projection
names are the inventory's public `name` values (for example,
`codex/skills/tdd-workflow` -> `../../skills/tdd-workflow`). There are
no physical skill copies in this tree; the separate `plugins/dhpk/` package is
the tracked physical `codex-native` publication artifact and is maintained by
the native-package migration task.

The installer and layout validator enforce the complete projection set,
relative targets, metadata/invocation/reference/output contracts, and
deterministic inventory mappings. Do not hand-copy a skill into `codex/skills/`.
When exposing another canonical package, update the distribution inventory and
recreate its relative projection with the same public name.

## Module skills inside Codex

The plugin's `modules/<stack>/skills/` trees are also relative symlink
projections into the same flat canonical packages. Codex receives only the
inventory-declared `codex-sync` subset; Claude module activation continues to
use `userConfig.modules`. The module projections are not a second source tree
and must not be copied into `codex/skills/`.

## Updating after a plugin version bump

```bash
claude plugin update dhpk@dhpk
# Then, in each project that uses Codex:
bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh --update
```

The script detects the version delta from `.codex/.dhpk-installed.json` and re-syncs everything.

Legacy projects can opt into deterministic adoption with `--migrate`; a
receipt-owned unchanged legacy skill destination is renamed to its current
public name and installed atomically. Edited, unowned, third-party,
retargeted, malformed, or ambiguous legacy entries are reported as conflicts
and retained. Only exact current-source matches without a legacy rename are
adopted into a new receipt entry. Use `--uninstall` for ownership-aware
cleanup. Modified receipt entries are reported as orphaned and retained, as are
unrelated project assets.

For local agent tuning, edit the materialized `.codex/agents/*.toml` file and
run `--update --plan --json` first. The plan reports destination and source
fingerprints for an edited role; a normal update preserves that role and any
unmanaged local guidance while updating unchanged managed roles. Apply a
reported collision only with the exact `--adopt=<path>@<destination>@<source>`
token from that plan. Adoption backs up the local role, verifies both
fingerprints again, and records ownership; a source or destination change
after planning aborts safely. Supporting assets remain source-linked, so keep
consumer-specific instructions in a separate local guidance file rather than
editing through a symlink.

## dhpk main flow for Codex

dhpk ships 18 direct Codex agent roles under `codex/agents/` (synced into
`.codex/agents/`): 4 hand-maintained roles and 14 generated roles.

Use `$flow-guide` when ownership, policy, the next action, closeout, or Codex
arguments are unclear. Its five read-only actions are `help`, `route`, `rules`,
`next`, and `close`. Use `$flow-drive <task-text|task-file|confirmed-spec-or-change-id>` only when
the task goal, constraints, and acceptance contract are settled; `$flow-drive
--help` is read-only. It is explicit-only and has no route/workflow mode.
Unknown causes may be diagnosed within that confirmed outcome; sufficient
cause and verification evidence must precede dependent writes. Flow Drive uses
the current Host and Model. Shared delegated dispatch, when requested through
another supported entrypoint, remains subject to current Host capabilities and
explicit Provider grants. Codex CLI has no `/dhpk:do` command or dhpk
slash-command router. The nine portable families
(`flow-guide`, `flow-drive`, `change-verdict`, `code-trace`, `laravel`,
`phpunit`, `js-static-checks`, `php`, and `yii1`) use their unprefixed
public names. For every other skill, use its inventory-declared public name
without inferring a prefix. The standalone `git-smart-commit` skill keeps its
existing public name (`$git-smart-commit`).
Codex built-in commands such as `/hooks` and `/agent` are not custom dhpk
`/dhpk:*` commands; Claude plugin slash commands and sentinel hooks are
Claude-only.

For parameter discovery, run `$flow-guide help` for the catalogue or
`$flow-guide help <skill>` for one metadata-only usage card. The human guide is
[`docs/codex-skill-usage.md`](../docs/codex-skill-usage.md), and the generated
catalogue is
[`skills/flow-guide/references/codex-usage-catalog.json`](../skills/flow-guide/references/codex-usage-catalog.json).
Help does not load target procedures, execute a target, or grant its authority.

Availability evidence is a receipt-owned `.codex/skills/flow-guide` or
`.codex/skills/flow-drive` package that resolves as the corresponding `$name`.
`codex plugin list` is management evidence only. If the family is not
discovered, follow the canonical [execution policy](../rules/execution-policy.md),
invoke roles with `/agent <role-name>`, and use the external OpenSpec plugin's
`/opsx:*` commands or `$openspec-propose` where appropriate. Do not claim a
missing `$name` is callable.

For a standalone Flow Drive installation without the dhpk projection, copy the
complete pinned canonical skill into the project `.agents/skills/flow-drive`.
The [installation and lifecycle guide](../docs/flow-drive-standalone.md) owns
its pin, update, removal, and managed-source switch. A fresh-session discovery
check is required before claiming the skill is callable.

When `$flow-guide` or `$flow-drive` is available, the roles below remain `/agent`
dispatch targets for the downstream handoff:

- **Bug with unknown root cause**: use `bug-investigator` only for bounded intake triage; escalate confirmed reasoning-heavy cases to `deep-reasoner`, then invoke `worker` and `code-reviewer`.
- **New feature / cross-module design**: resolve any unsettled layer placement or boundary through the necessary architecture evidence, then establish the required RED evidence before implementation. Use `architect` or `tdd-guide` when their separate ownership or runtime expertise is needed; after the TDD guide establishes RED, hand production GREEN to `worker` by default, followed by the applicable review wave. TDD and explicit higher-priority instructions remain binding.
- **Investigation / "how does X work?"**: invoke `explorer` (read-only, no edits).
- **Deep root-cause analysis or algorithm design**: invoke `deep-reasoner`.

The CLI does not mechanically enforce this sequence, but agents must: record the
canonical decision state, obtain the read-only reasoner result before a writer
when required, and preserve the planner/review/CI/archive/PR checkpoints. The
external `/opsx:apply` flow remains unchanged. Proposal authoring belongs to
the external `$openspec-propose` skill; it is not a `flow-drive` mode.

### Context tiers and handoff packet

Use the canonical `rules/execution-policy.md` §Context tiers and dispatch
packet for `cold`, `bounded`, and `full` selection. The worker-facing packet
schema and completion boundary live in `codex/agents/worker.toml`; do not
reconstruct either contract from inherited parent history.

Before dispatching any named specialist through `spawn_agent`, load that
context-tier rule and the standalone
[`subagent-prompt-template.md`](../docs/subagent-prompt-template.md); together
they own the fork parameters and complete message shape.

### Codex handoff boundary

The Codex projection must never name an agent that is absent from
`codex/agents/*.toml`. The canonical Claude agents may retain Claude-only
specialist handoffs, but the generator adapts those references for Codex:

- `code-reviewer` uses the available `deep-reasoner` for deep error-handling
  review and `architect` for non-trivial type/design review; the reviewer may
  perform either check directly when a second role is unnecessary.
- `tdd-guide` may hand browser journeys to the available `e2e-runner` role.
- `e2e-runner` may create and maintain test specs, fixtures, and runner output when the parent session allows writes. It does not receive a separate sandbox from its role file. If Playwright or a browser is unavailable it must return `Verdict: BLOCKED` with the resume command instead of claiming a pass.
- `explorer` stays read-only and returns evidence inline. Implementation goes to `worker`.

If a project does not expose the required runner or role, use the documented
manual fallback; do not invoke an unavailable agent name.

### Review discipline and hook boundaries

Post-edit review is advisory. Assign the matching reviewers to a completed implementation wave and its source snapshot. Do not run the full reviewer batch after every edit, and do not use a sentinel file as a gate. Codex CLI supports lifecycle hooks from user/project `hooks.json` files or inline `[hooks]` TOML ([official Hooks documentation](https://learn.chatgpt.com/docs/hooks)), but those hooks are a separate Codex contract. A Codex `PreToolUse` hook can block a tool call; a `PostToolUse` hook runs after the tool and cannot undo its side effects.

- `code-reviewer` — source changes in that wave.
- `security-reviewer` — auth, crypto, money-handling, file-upload, or input-handling changes in that wave.
- `database-reviewer` — SQL, Repository, or migration changes in that wave.
- `doc-reviewer` — policy or documentation edits in that wave.

Read-only roles follow the inline result in `.codex/dhpk/contracts/artifact-contract.md`. The parent session owns sandbox and approval. A role file does not create an independent sandbox. Configured Codex lifecycle hooks can add event-level checks, while review sequencing remains instruction-based unless the project implements it with Codex's hook contract.

### Agent roster → Codex role map

**Available in Codex** (`codex/agents/`, 18 roles):

| Role | Use for |
|------|---------|
| `explorer` | Read-only investigation; implementation goes to `worker` |
| `worker` | Generic scoped implementation |
| `monitor` | Watching long-running tasks/processes |
| `bug-investigator` | Root-cause investigation for bugs and regressions |
| `architect` | Layer placement and cross-module design decisions |
| `code-reviewer` | Review of a completed implementation wave |
| `security-reviewer` | Security review of auth/crypto/money/upload/input paths |
| `database-reviewer` | SQL, Repository, and migration review |
| `tdd-guide` | Write-tests-first workflow |
| `deep-reasoner` | Deep root-cause analysis and algorithm design |
| `doc-reviewer` | Policy and documentation review |
| `planner` | Plan critique and bounded warm/cold diff review |
| `frontend-reviewer` | Frontend JavaScript/TypeScript review |
| `migration-reviewer` | Migration safety and rollback review |
| `e2e-runner` | Playwright user-journey authoring and execution |
| `ui-verifier` | Verification of a rendered page against stated UI criteria |
| `docs-writer` | Documentation authoring for a settled content packet |
| `scoped-worker` | Bounded implementation with exact file ownership |

The canonical source also contains roles that are not standalone Codex
dispatch targets. Their outcome is explicit in
[`agent-role-map.json`](agent-role-map.json), and the matrix is validated so
each canonical role is classified exactly once:

- `direct`: a standalone `.toml` role is dispatchable by Codex.
- `merged`: the role's contract is handled by the named direct target; invoke
  that target instead of an unavailable alias.
- `skill/manual-fallback`: use a mirrored skill or perform the documented
  workflow manually when no isolated role is needed.
- `capability-gated`: dispatch only when the named runtime/module capability is
  present; otherwise report the missing capability and stop.
- `intentionally-unavailable`: do not dispatch inside Codex; the target field
  records the explicit reason.

| Coverage outcome | Canonical roles |
|------|--------------------|
| `merged` | `codex-reasoner`, `codex-worker`, `fast-worker`, `performance-analyzer`, `refactor-cleaner`, `silent-failure-hunter`, `type-design-analyzer` |
| `skill/manual-fallback` | `agy-worker`, `doc-updater`, `docs-lookup`, `harness-reviser`, `python-build-resolver`, `rust-build-resolver`, `swift-build-resolver`, `version-matrix-impact-reviewer` |
| `capability-gated` | `polyfill-reviewer`, `smoke-tester`, `ui-ux-verifier` |
| `intentionally-unavailable` | `codex-bridge` |

Specialization for fallback areas is delivered through the mirrored
`codex/skills/` tree or an explicitly documented capability gate, not through
an implicit unavailable-agent handoff.

## Key Differences from Claude Code

| Feature | Claude Code | Codex CLI |
|---------|------------|-----------|
| Hooks | 8+ event types (PreToolUse, PostToolUse, SessionStart, Stop, etc.) plus dhpk sentinel enforcement | Lifecycle hooks via user/project `hooks.json` or inline `[hooks]` TOML; separate from Claude sentinel enforcement |
| Context file | CLAUDE.md + AGENTS.md | AGENTS.md only |
| Commands | Custom `/slash` commands | Built-in `/hooks`; `$flow-guide` for discovery and `$flow-drive` for confirmed implementation; instruction fallback otherwise. No `/dhpk:do` |
| Agents | `Task`/subagent tool | Multi-agent via `/agent` and `[agents.<name>]` roles |
| Security / review | Safety hooks + advisory reviewer dispatch | Parent-session sandbox and approval, plus instruction-based read-only roles |

Codex lifecycle hooks and the parent session sandbox are independent controls. Hooks can enforce event-specific policy. The parent session owns sandbox and approval, and a custom agent file cannot replace that sandbox.

### Role discovery

dhpk targets Codex's project-local `.codex/agents/*.toml` discovery path. Each
role file carries its own `name`; matching the filename is a convention, while
the TOML field is the identifier. The `[agents.<name>]` blocks in
`config.toml.example` are optional metadata; their presence does not prove
that Codex discovered or loaded the corresponding custom role. The
supported top-level concurrency setting is `max_concurrent_threads_per_session`;
the example also shows the effective default subagent model and reasoning
effort.

Every `codex/agents/*.toml` file MUST declare non-empty `name`, `description`,
`model`, `model_reasoning_effort`, and `developer_instructions`; the plugin's
`validate_codex` guardrail enforces this static metadata contract. Codex agent
definitions are TOML-only; legacy Markdown role bodies are not dispatchable.
The 14 generated roles are produced by `scripts/gen-codex-agents.js`: 11 from
shared `agents/*.md` sources and 3 from Codex-only
`codex/agent-sources/{ui-verifier,docs-writer,scoped-worker}.md` sources. The
Codex-only sources are authoring inputs only and are not installed; generated
TOMLs are installed under `.codex/agents/`. The generator is
deterministic/idempotent (re-running with no source change produces
byte-identical output) and does not touch the 4 hand-maintained roles. Model
and effort rationale is maintained in `../rules/model-economics.md`.

When a custom agent file sets model or model_reasoning_effort, that file value takes precedence. Before the file applies, Codex resolves each setting from an explicit spawn value, then the [agents] default, then the parent. A start argument does not rewrite a pinned file effort. Do not declare sandbox_mode in the role file.

A physical file, valid metadata, and successful built-in `explorer` dispatch do
not prove that the project custom-role registry loaded. Runtime PASS requires a
fresh `codex exec` session with an observed custom-role spawn and targeted wait.
On `unknown agent_type`, follow the Codex registry branch in
`../rules/execution-policy.md`; retain the exact role ID and GPT-6 family model
instead of treating either as a speculative fix.
