# dhpk for Codex CLI

Installation and support-status SSOT: [platform-installation.md](../docs/platform-installation.md)
and [platform-installation.zh-TW.md](../docs/platform-installation.zh-TW.md).

This file describes how the `dhpk` plugin's content interacts with **Codex CLI** (separate from Claude Code). Claude Code does NOT auto-load anything inside the plugin's `codex/` directory.

## What dhpk provides to Codex CLI

When a user runs the bundled installer:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"
```

`codex/skills/` and `codex/agents/` are symlinked (or `--copy`-ed) into the project's `.codex/skills/` and `.codex/agents/`, while the inventory-declared support tree is materialized under `.codex/dhpk/` and `codex/config.toml.example` is placed alongside any existing `.codex/config.toml`. The installer records these destinations in the schema-v3 `.dhpk-installed.json` receipt, including each skill's stable id and current public name, and never replaces an unowned same-name asset. Codex CLI then discovers the skills/agents the same way it discovers any project-local Codex content, and generated roles resolve their trap sheets/contracts through `.codex/dhpk/`.

## Plugin loading differences (Claude Code vs Codex CLI)

| Concern | Claude Code | Codex CLI |
|---------|-------------|-----------|
| **Loading path** | `agents/`, `commands/`, `skills/`, `hooks/`, `modules/` at plugin root | `.codex/agents/`, `.codex/skills/` in the project (after sync); Codex lifecycle hooks use `~/.codex/hooks.json`, project `.codex/hooks.json`, or inline `[hooks]` in `config.toml` |
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
canonical flat package under `skills/<dhpk-name>/`. Editing a projection edits
the canonical source, and the change applies to both worlds. The projection
names are the inventory's public `name` values (for example,
`codex/skills/dhpk-tdd-workflow` -> `../../skills/dhpk-tdd-workflow`). There are
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
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --update
```

The script detects the version delta from `.codex/.dhpk-installed.json` and re-syncs everything.

Legacy projects can opt into deterministic adoption with `--migrate`; a
receipt-owned unchanged legacy skill destination is renamed to its current
public `dhpk-*` name and installed atomically. Edited, unowned, third-party,
retargeted, malformed, or ambiguous legacy entries are reported as conflicts
and retained. Only exact current-source matches without a legacy rename are
adopted into a new receipt entry. Use `--uninstall` for ownership-aware
cleanup. Modified receipt entries are reported as orphaned and retained, as are
unrelated project assets.

## dhpk main flow for Codex

dhpk ships 16 direct Codex agent roles under `codex/agents/` (synced into `.codex/agents/`): 4 hand-maintained generic roles — `explorer` (read-only investigation), `worker` (generic scoped implementer), `monitor` (long-running task watcher), `bug-investigator` (root-cause investigation) — plus 12 roles generated from the canonical agents — `architect`, `code-reviewer`, `security-reviewer`, `database-reviewer`, `tdd-guide`, `deep-reasoner`, `doc-reviewer`, `planner`, `spec-miner`, `frontend-reviewer`, `migration-reviewer`, `e2e-runner`.

Codex CLI has no `/dhpk:do` command or dhpk slash-command router. It does provide built-in commands such as `/hooks`; invoke the roles below manually with `/agent <role-name>`, while treating the canonical [execution policy](../rules/execution-policy.md) as the required routing contract:

- **Bug with unknown root cause**: use `bug-investigator` only for bounded intake triage; escalate confirmed reasoning-heavy cases to `deep-reasoner`, then invoke `worker` and `code-reviewer`.
- **New feature / cross-module design**: invoke `architect` to decide layer placement, then `tdd-guide` to write tests first. If the settled GREEN footprint is ≤2 production files, `tdd-guide` may finish it and proceed to review; dispatch `worker` only for a larger-footprint handback, then invoke `code-reviewer`.
- **Investigation / "how does X work?"**: invoke `explorer` (read-only, no edits).
- **Deep root-cause analysis or algorithm design**: invoke `deep-reasoner`.

The CLI does not mechanically enforce this sequence, but agents must: record the
canonical decision state, obtain the read-only reasoner result before a writer
when required, and preserve the planner/review/CI/archive/PR checkpoints. The
external `/opsx:apply` flow remains unchanged.

### Context tiers and handoff packet

Use the canonical `rules/execution-policy.md` §Context tiers and dispatch
packet for `cold`, `bounded`, and `full` selection. The worker-facing packet
schema and completion boundary live in `codex/agents/worker.toml`; do not
reconstruct either contract from inherited parent history.

### Codex handoff boundary

The Codex projection must never name an agent that is absent from
`codex/agents/*.toml`. The canonical Claude agents may retain Claude-only
specialist handoffs, but the generator adapts those references for Codex:

- `code-reviewer` uses the available `deep-reasoner` for deep error-handling
  review and `architect` for non-trivial type/design review; the reviewer may
  perform either check directly when a second role is unnecessary.
- `tdd-guide` may hand browser journeys to the available `e2e-runner` role.
- `e2e-runner` is workspace-write because it may create and maintain test
  specs, fixtures, and artifacts; if Playwright or a browser is unavailable it
  must return `Verdict: BLOCKED` with the resume command instead of claiming a
  pass.

If a project does not expose the required runner or role, use the documented
manual fallback; do not invoke an unavailable agent name.

### Review discipline and hook boundaries

Claude Code enforces post-edit review through hooks and `.pending-*` sentinel files: a PostToolUse hook writes a sentinel after an edit, and the reviewer records evidence while the runtime hook clears it only after a fresh passing artifact. Codex CLI supports lifecycle hooks from user/project `hooks.json` files or inline `[hooks]` TOML ([official Hooks documentation](https://learn.chatgpt.com/docs/hooks)), but those hooks are a separate Codex contract and do not reproduce dhpk's Claude sentinel chain automatically. A Codex `PreToolUse` hook can block a tool call; a `PostToolUse` hook runs after the tool and cannot undo its side effects.

Because of this, after ANY code edit made via a Codex role, the user or parent flow MUST manually invoke the appropriate review role via `/agent`:

- `code-reviewer` — after any source edit.
- `security-reviewer` — after auth, crypto, money-handling, file-upload, or input-handling changes.
- `database-reviewer` — after SQL, Repository, or migration changes.
- `doc-reviewer` — after policy or documentation edits.

`sandbox_mode` (read-only vs `workspace-write`) remains the primary built-in execution boundary. Configured Codex lifecycle hooks can add event-level checks, while review sequencing, security discipline, workflow routing, and dhpk sentinel semantics remain instruction-based unless the project explicitly implements them with Codex's hook contract. Codex hooks do not create or clear Claude `.pending-*` sentinels by implication.

### Agent roster → Codex role map

**Available in Codex** (`codex/agents/`, 16 roles):

| Role | Use for |
|------|---------|
| `explorer` | Read-only investigation and evidence gathering |
| `worker` | Generic scoped implementation |
| `monitor` | Watching long-running tasks/processes |
| `bug-investigator` | Root-cause investigation for bugs and regressions |
| `architect` | Layer placement and cross-module design decisions |
| `code-reviewer` | Post-edit code review |
| `security-reviewer` | Security review of auth/crypto/money/upload/input paths |
| `database-reviewer` | SQL, Repository, and migration review |
| `tdd-guide` | Write-tests-first workflow |
| `deep-reasoner` | Deep root-cause analysis and algorithm design |
| `doc-reviewer` | Policy and documentation review |
| `planner` | Plan critique and bounded warm/cold diff review |
| `spec-miner` | Brownfield behavioral-spec extraction |
| `frontend-reviewer` | Frontend JavaScript/TypeScript review |
| `migration-reviewer` | Migration safety and rollback review |
| `e2e-runner` | Playwright user-journey authoring and execution |

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
| `merged` | `codex-deep-reasoner`, `codex-fast-worker`, `fast-worker`, `performance-analyzer`, `refactor-cleaner`, `silent-failure-hunter`, `type-design-analyzer` |
| `skill/manual-fallback` | `agent-evaluator`, `agy-fast-worker`, `doc-updater`, `docs-lookup`, `harness-reviser`, `python-build-resolver`, `rust-build-resolver`, `swift-build-resolver`, `version-matrix-impact-reviewer` |
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
| Commands | `/slash` commands | Instruction-based invocation |
| Agents | `Task`/subagent tool | Multi-agent via `/agent` and `[agents.<name>]` roles |
| Security / review | Hook + `.pending-*` sentinel enforcement | `sandbox_mode` + optional Codex lifecycle hooks + instruction-based review |

Codex lifecycle hooks and `sandbox_mode` are independent controls: hooks can enforce event-specific policy, while `sandbox_mode` controls tool execution permissions. Nothing in the Codex projection automatically creates the Claude `.pending-*` sentinel review gate.

### Role discovery

Syncing `.codex/agents/` alone is sufficient for role discovery — each role `.toml` file carries its own `name` field, and Codex CLI reads roles directly from that directory. The `[agents.<name>]` blocks in `config.toml.example` are **optional**: they add a description or nickname. The supported top-level concurrency setting is `max_concurrent_threads_per_session`; the example also shows the effective default subagent model and reasoning effort.

Every `codex/agents/*.toml` file MUST declare non-empty `name`, `description`, `model`, `model_reasoning_effort`, and `developer_instructions` — Codex CLI auto-discovers `.codex/agents/*.toml` and errors "must define a non-empty name" if `name` is missing, and the plugin's `validate_codex` guardrail enforces the runtime metadata contract. Codex agent definitions are TOML-only; legacy Markdown role bodies are not dispatchable. The 12 generated roles are produced by `scripts/gen-codex-agents.js` from the canonical `agents/<name>.md` sources; the generator is deterministic/idempotent (re-running with no source change produces byte-identical output) and does not touch the 4 hand-maintained roles. Model and effort rationale is maintained in `../rules/model-economics.md`.
