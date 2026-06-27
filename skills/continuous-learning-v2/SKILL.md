---
name: continuous-learning-v2
description: 'Instinct-based learning system that observes Claude Code sessions via hooks, mints atomic confidence-scored instincts, and evolves them into skills/commands/agents with project-scoped isolation. Use when: setting up session learning, tuning confidence thresholds, reviewing/exporting/importing instincts, evolving instincts into skills, or managing project-scoped vs global scope. Not for: one-off coding tasks, hand-authoring a specific skill (use create-skill), or code review. Output: confidence-scored instinct files, scope/promotion decisions, and evolved skill/command/agent artifacts.'
origin: ECC
version: 2.1.0
---

# Continuous Learning v2.1 - Instinct-Based Architecture

An advanced learning system that turns your Claude Code sessions into reusable knowledge through atomic "instincts" - small learned behaviors with confidence scoring.

**v2.1** adds **project-scoped instincts** — React patterns stay in your React project, Python conventions stay in your Python project, and universal patterns (like "always validate input") are shared globally.

## When to Activate

- Setting up automatic learning from Claude Code sessions
- Configuring instinct-based behavior extraction via hooks
- Tuning confidence thresholds for learned behaviors
- Reviewing, exporting, or importing instinct libraries
- Evolving instincts into full skills, commands, or agents
- Managing project-scoped vs global instincts
- Promoting instincts from project to global scope

## When NOT to Use

- One-off coding tasks where no reusable pattern is emerging — just do the work.
- Hand-authoring a specific skill, command, or agent — use `create-skill` / `command-creator`.
- Code review, doc review, or security audits — use the matching review skills.
- Sharing raw session transcripts — only distilled instincts are exportable (see Privacy in `references/version-history.md`).
- Work outside a git repo with no project context — instincts fall back to global scope, intended only for truly universal patterns.

## How It Works

1. **Observe** — `PreToolUse`/`PostToolUse` hooks (`observe.sh`) capture every prompt and tool call (100% reliable) and detect project context, appending to `projects/<hash>/observations.jsonl`.
2. **Analyze** — a background observer agent (Haiku) reads observations and detects patterns: user corrections, error resolutions, repeated workflows.
3. **Create** — each pattern becomes an atomic instinct under `instincts/personal/`, scoped `project` (default) or `global`, with a confidence score.
4. **Evolve** — `/evolve` clusters related instincts into generated skills/commands/agents under `evolved/`; `/promote` lifts cross-project instincts to global scope.

See `references/instinct-model.md` for the full pipeline diagram and the instinct schema.

## Quick Start

### 1. Enable Observation Hooks

**If installed as a plugin** (recommended):

No extra `settings.json` hook block is required. Claude Code v2.1+ auto-loads the plugin `hooks/hooks.json`, and `observe.sh` is already registered there.

If you previously copied `observe.sh` into `~/.claude/settings.json`, remove that duplicate `PreToolUse` / `PostToolUse` block. Duplicating the plugin hook causes double execution and `${CLAUDE_PLUGIN_ROOT}` resolution errors because that variable is only available inside plugin-managed `hooks/hooks.json` entries.

**If installed manually** to `~/.claude/skills`, add this to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning-v2/hooks/observe.sh"
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning-v2/hooks/observe.sh"
      }]
    }]
  }
}
```

### 2. Initialize Directory Structure

The system creates directories automatically on first use, but you can also create them manually:

```bash
# Global directories
mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/ecc-homunculus"/{instincts/{personal,inherited},evolved/{agents,skills,commands},projects}

# Project directories are auto-created when the hook first runs in a git repo
```

### 3. Use the Instinct Commands

```bash
/instinct-status     # Show learned instincts (project + global)
/evolve              # Cluster related instincts into skills/commands
/instinct-export     # Export instincts to file
/instinct-import     # Import instincts from others
/promote             # Promote project instincts to global scope
/projects            # List all known projects and their instinct counts
```

## Commands

| Command | Description |
|---------|-------------|
| `/instinct-status` | Show all instincts (project-scoped + global) with confidence |
| `/evolve` | Cluster related instincts into skills/commands, suggest promotions |
| `/instinct-export` | Export instincts (filterable by scope/domain) |
| `/instinct-import <file>` | Import instincts with scope control |
| `/promote [id]` | Promote project instincts to global scope |
| `/projects` | List all known projects and their instinct counts |

> **Operator note (<your-project>-local)**: `instinct-export --output` accepts any writable path. Do **not** point it at `.claude/rules/`, `.claude/skills/`, or any business directory (`protected/`, `domain/`, `infrastructure/`) — the CLI does not block these. Default target is stdout or a `/tmp/...yaml` path; only override `--output` after reviewing the destination.

## Scripts

Helper scripts live in this skill's `scripts/` directory.

### `detect-project.sh`

- **Purpose**: Shared project-detection helper. **Sourced** (not executed) by `observe.sh` and `start-observer.sh` to resolve the current project context and its storage directory; auto-runs `_clv2_detect_project` on source.
- **Usage**: `. skills/continuous-learning-v2/scripts/detect-project.sh`
- **Inputs (env)**: `CLAUDE_PROJECT_DIR` (highest priority), then `git remote get-url origin` / repo root (auto); `CLV2_HOMUNCULUS_DIR` / `XDG_DATA_HOME` for storage root; optional `CLV2_PYTHON_CMD`.
- **Outputs (exported vars)**: `PROJECT_ID`/`_CLV2_PROJECT_ID` (12-char hash or `global`), `PROJECT_NAME`, `PROJECT_ROOT`, `PROJECT_DIR`, `CLV2_OBSERVER_SENTINEL_FILE`, `CLV2_PYTHON_CMD`. Side effects: creates the project dir tree and updates `projects.json` + `project.json`.
- **Exit codes**: designed to be sourced — returns `0`; the global fallback (no git/project) is a normal `0` result, not an error.

### `test_parse_instinct.py`

- **Purpose**: `pytest` unit suite for `instinct-cli.py` — covers `parse_instinct_file`, path-traversal validation, project detection, instinct loading/dedup, promotion, and the `status`/`projects` commands.
- **Usage**: `pytest skills/continuous-learning-v2/scripts/test_parse_instinct.py` (or `python3 -m pytest ...`).
- **Inputs**: none from the user — uses `tmp_path` fixtures with mocked git/env; requires `pytest` installed. Imports `instinct-cli.py` via `importlib` (hyphenated filename).
- **Outputs**: standard `pytest` report to stdout.
- **Exit codes**: `0` when all tests pass, non-zero on any failure (standard `pytest` semantics).

### `migrate-homunculus.sh`

- **Purpose**: One-time migration of legacy data from `~/.claude/homunculus` to the new `ecc-homunculus` data directory (see `references/storage-and-config.md`).
- **Usage**: `bash skills/continuous-learning-v2/scripts/migrate-homunculus.sh`
- **Inputs**: legacy `~/.claude/homunculus` tree; honors `CLV2_HOMUNCULUS_DIR` / `XDG_DATA_HOME` for the destination.
- **Outputs**: migrated instincts/observations under the resolved data directory.
- **Exit codes**: `0` on success or when nothing to migrate; non-zero on copy failure.

> `instinct-cli.py` is the CLI behind the `/instinct-*`, `/promote`, and `/projects` commands above — invoke it through those commands rather than directly.

## Output

- Confidence-scored instinct files (`*.yaml`) under the project or global `instincts/personal/`.
- Scope decisions (`project` vs `global`) and promotion candidates.
- Evolved artifacts: generated `skills/`, `commands/`, `agents/` under `evolved/`.
- Status reports via `/instinct-status` and `/projects`; export bundles (instincts only) via `/instinct-export`.

## Verification

- `/instinct-status` lists newly created instincts with their confidence scores.
- New instinct files exist under `${XDG_DATA_HOME:-~/.local/share}/ecc-homunculus/projects/<hash>/instincts/personal/`.
- Observations grow: `projects/<hash>/observations.jsonl` gains lines after tool calls (confirms hooks fire).
- `config.json` `observer.enabled` reflects the intended state.
- Unit tests pass: `pytest skills/continuous-learning-v2/scripts/test_parse_instinct.py`.

## References

- `references/instinct-model.md` — read when authoring instincts by hand or debugging the observation→evolution pipeline (schema + full diagram).
- `references/confidence-scoring.md` — read when tuning thresholds or interpreting confidence scores and how they rise/fall.
- `references/scope-and-promotion.md` — read when classifying an instinct as project vs global, or running `/promote`.
- `references/storage-and-config.md` — read when setting up storage, debugging project hashing, tuning the observer, or locating instinct files.
- `references/version-history.md` — read when migrating from v1/v2.0, explaining version differences, or auditing the privacy model.

## Related

- [ECC-Tools GitHub App](https://github.com/apps/ecc-tools) - Generate instincts from repo history
- Homunculus - Community project that inspired the v2 instinct-based architecture (atomic observations, confidence scoring, instinct evolution pipeline)
- [The Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) - Continuous learning section

---

*Instinct-based learning: teaching Claude your patterns, one project at a time.*
