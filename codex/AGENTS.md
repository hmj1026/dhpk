# dhpk for Codex CLI

This file describes how the `dhpk` plugin's content interacts with **Codex CLI** (separate from Claude Code). Claude Code does NOT auto-load anything inside the plugin's `codex/` directory.

## What dhpk provides to Codex CLI

When a user runs the bundled installer:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"
```

`codex/skills/` and `codex/agents/` are symlinked (or `--copy`-ed) into the project's `.codex/skills/` and `.codex/agents/`, plus `codex/config.toml.example` is placed alongside any existing `.codex/config.toml`. Codex CLI then discovers the skills/agents the same way it discovers any project-local Codex content.

## Plugin loading differences (Claude Code vs Codex CLI)

| Concern | Claude Code | Codex CLI |
|---------|-------------|-----------|
| **Loading path** | `agents/`, `commands/`, `skills/`, `hooks/`, `modules/` at plugin root | `.codex/agents/`, `.codex/skills/` in the project (after sync) |
| **userConfig** | Yes — Claude prompts at install | Codex has no equivalent; configure via the synced `config.toml.example` |
| **Modules (`modules/<stack>-<version>/`)** | Selective activation via `userConfig.modules` | Not directly mirrored — Codex sees a flat skills set |
| **MCP** | Full (servers declared in plugin or user settings) | Configured via `config.toml` and `codex mcp add` |

See "Key Differences from Claude Code" below for the capability-level comparison (hooks, commands, agents, security/review).

## Authoring guidance

When writing skills meant to work in both harnesses:

- Keep `description:` framework-agnostic. Trigger keywords are what makes both harnesses pick the skill up.
- Avoid Claude-Code-specific syntax in skill bodies (e.g. `${user_config.X}` substitution, `TaskCreate` tool, slash-command examples).
- If a skill is intrinsically tied to a hook lifecycle (e.g. a "review the last edit" workflow), it belongs in Claude Code only — do NOT mirror it into `codex/`.
- Tools the skill calls should be available in both environments (Read/Write/Bash usually safe; `mcp__*` tools require the matching MCP server on both sides).

## Layout: symlinks vs physical copies under `codex/skills/`

Most entries under `codex/skills/` are **in-repo symlinks** back to the canonical `skills/<name>/`. Editing a symlinked skill edits the Claude-side canonical, and the change applies to both worlds. Only intentionally-diverged or module-mirrored skills are stored as physical directories here.

Physical (non-symlink) entries:

| Path | Why it's physical |
|------|-------------------|
| `codex/skills/multi-ai-sync/` | Codex side has additional Python (agent-sync bundling) the Claude side doesn't need. |
| `codex/skills/skill-health-check/` | Codex side targets a command-centric model (no `Agent`/`Task` entitlements, different orphan-detection logic). |
| `codex/skills/bug-investigation/` | Codex side mandates strict OpenSpec post-investigation; Claude side keeps OpenSpec optional. |
| `codex/skills/{php-pro,php56-yii-dev,yii1-security-audit,legacy-code-characterization}/` | Module-skill mirrors. The canonical sources live under `modules/<stack>/skills/`; these are flat-tree copies for Codex which has no module-loading machinery. |

When editing a physical entry, the change applies only to the Codex side — verify intent first.

## Module skills inside Codex

The plugin's `modules/php-5.6/skills/`, `modules/yii-1.1/skills/`, `modules/phpunit-5.7/skills/` are NOT synced into the Codex `.codex/skills/` automatically — they live behind `userConfig.modules` gating, which Codex CLI doesn't honour.

If you want a stack module's content available in Codex too, copy or symlink the specific skills manually:

```bash
# Example: surface the yii-1.1 skills in .codex/
ln -sf "${CLAUDE_PLUGIN_ROOT}/modules/yii-1.1/skills/yii1-security-audit" .codex/skills/yii1-security-audit
ln -sf "${CLAUDE_PLUGIN_ROOT}/modules/yii-1.1/skills/php56-yii-dev" .codex/skills/php56-yii-dev
```

(A future release may add a `--with-modules` flag to `install-codex-skills.sh` that automates this.)

## Updating after a plugin version bump

```bash
claude plugin update dhpk@dhpk
# Then, in each project that uses Codex:
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --update
```

The script detects the version delta from `.codex/.dhpk-installed.json` and re-syncs everything.

## dhpk main flow for Codex

dhpk ships 11 Codex agent roles under `codex/agents/` (synced into `.codex/agents/`): 4 hand-maintained generic roles — `explorer` (read-only investigation), `worker` (generic scoped implementer), `monitor` (long-running task watcher), `bug-investigator` (root-cause investigation) — plus 7 roles generated from the canonical Claude agents — `architect`, `code-reviewer`, `security-reviewer`, `database-reviewer`, `tdd-guide`, `deep-reasoner`, `doc-reviewer`.

Codex CLI has no `/dhpk:do` command and no slash commands at all, so there is no automated router. The workflows below are **instructions to follow manually**, invoking each role in turn with `/agent <role-name>`:

- **Bug with unknown root cause**: invoke `bug-investigator` first (evidence → hypothesis → root cause), then `worker` to apply the patch, then `code-reviewer` to review the diff.
- **New feature / cross-module design**: invoke `architect` to decide layer placement, then `tdd-guide` to write tests first, then `worker` to implement, then `code-reviewer`.
- **Investigation / "how does X work?"**: invoke `explorer` (read-only, no edits).
- **Deep root-cause analysis or algorithm design**: invoke `deep-reasoner`.

These are sequencing guidelines, not enforced routes — nothing in Codex CLI checks that you followed them.

### Review discipline (no hooks, no sentinels)

Claude Code enforces post-edit review through hooks and `.pending-*` sentinel files: a PostToolUse hook writes a sentinel after an edit, and a reviewer agent clears it before work is considered done. **Codex CLI has neither hooks nor sentinels.** There is no automated mechanism that fires after an edit or blocks completion until a review has run.

Because of this, after ANY code edit made via a Codex role, the user or parent flow MUST manually invoke the appropriate review role via `/agent`:

- `code-reviewer` — after any source edit.
- `security-reviewer` — after auth, crypto, money-handling, file-upload, or input-handling changes.
- `database-reviewer` — after SQL, Repository, or migration changes.
- `doc-reviewer` — after policy or documentation edits.

`sandbox_mode` (read-only vs `workspace-write`) is the **only hard enforcement primitive** Codex CLI offers. Everything else described here — review sequencing, security discipline, workflow routing — is instruction-based, not mechanically enforced. This guidance does not claim Codex fires PostToolUse or Stop hooks, and does not claim any `.pending-*` sentinel mechanism exists in Codex — both are Claude-Code-only.

### Agent roster → Codex role map

**Available in Codex** (`codex/agents/`, 11 roles):

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

**Claude-only (unavailable in Codex)**:

| Role | Reason unavailable |
|------|--------------------|
| `planner` | Bound to `/dhpk:do --plan` and the Task-tool mechanism, neither of which exists in Codex |
| `frontend-reviewer`, `migration-reviewer`, `polyfill-reviewer` | Narrow / situational reviewers (front-end tiers, migration safety, multi-major polyfills) — delivered as `codex/skills/` content rather than forked roles; the generic `code-reviewer` covers the common path in Codex |
| `ui-ux-verifier`, `e2e-runner`, `docs-lookup` | Depend on Playwright/MCP agent wiring not mirrored into Codex |
| `performance-analyzer`, `silent-failure-hunter`, `refactor-cleaner` | Narrow situational hunters — delivered as skills instead (per ECC's precedent), not per-agent forks |
| `python-build-resolver`, `rust-build-resolver`, `swift-build-resolver` | Stack-specific build-resolvers not mirrored as Codex roles |
| `codex-bridge` | Codex-about-Codex role — not applicable from inside Codex itself |

Specialization for these areas is delivered through the mirrored `codex/skills/` tree, not through per-agent forks.

## Key Differences from Claude Code

| Feature | Claude Code | Codex CLI |
|---------|------------|-----------|
| Hooks | 8+ event types (PreToolUse, PostToolUse, SessionStart, Stop, etc.) | Not supported |
| Context file | CLAUDE.md + AGENTS.md | AGENTS.md only |
| Commands | `/slash` commands | Instruction-based invocation |
| Agents | `Task`/subagent tool | Multi-agent via `/agent` and `[agents.<name>]` roles |
| Security / review | Hook + `.pending-*` sentinel enforcement | Instruction-based + `sandbox_mode` |

`sandbox_mode` is the only hard enforcement primitive Codex CLI offers. Review and security discipline described in this file is otherwise instruction-based — nothing in Codex mechanically blocks completion the way Claude Code's hooks and sentinels do.

### Role discovery

Syncing `.codex/agents/` alone is sufficient for role discovery — each role `.toml` file carries its own `name` field, and Codex CLI reads roles directly from that directory. The `[agents.<name>]` blocks in `config.toml.example` are **optional**: they add a description, nickname, or concurrency caps (`max_threads`, `max_depth`), but they are not required for a role to load or be invocable via `/agent`.

Every `codex/agents/*.toml` file MUST declare non-empty `name`, `description`, and `developer_instructions` — Codex CLI auto-discovers `.codex/agents/*.toml` and errors "must define a non-empty name" if `name` is missing, and the plugin's `validate_codex` guardrail enforces all three fields. The 7 generated roles are produced by `scripts/gen-codex-agents.js` from the canonical `agents/<name>.md` sources; the generator is deterministic/idempotent (re-running with no source change produces byte-identical output) and does not touch the 4 hand-maintained roles.
