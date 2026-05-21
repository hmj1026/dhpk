# dhpk for Codex CLI

This file describes how the `dhpk` plugin's content interacts with **Codex CLI** (separate from Claude Code). Claude Code does NOT auto-load anything inside the plugin's `codex/` directory.

## What dhpk provides to Codex CLI

When a user runs the bundled installer:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"
```

`codex/skills/` and `codex/agents/` are symlinked (or `--copy`-ed) into the project's `.codex/skills/` and `.codex/agents/`, plus `codex/config.toml.example` is placed alongside any existing `.codex/config.toml`. Codex CLI then discovers the skills/agents the same way it discovers any project-local Codex content.

## What's different between Claude Code and Codex CLI

| Concern | Claude Code | Codex CLI |
|---------|-------------|-----------|
| **Loading path** | `agents/`, `commands/`, `skills/`, `hooks/`, `modules/` at plugin root | `.codex/agents/`, `.codex/skills/` in the project (after sync) |
| **Hooks** | Full lifecycle (PreToolUse, PostToolUse, SessionStart, Stop, etc.) | Not supported as of this writing |
| **Slash commands** | Yes (`/dhpk:create-pr`) | No — Codex uses instruction-based invocation |
| **userConfig** | Yes — Claude prompts at install | Codex has no equivalent; configure via the synced `config.toml.example` |
| **Modules (`modules/<stack>-<version>/`)** | Selective activation via `userConfig.modules` | Not directly mirrored — Codex sees a flat skills set |
| **Multi-agent (Task/Subagent)** | Built-in `Task` tool | Codex's own `[agents.<name>]` definitions and `/agent` invocations |
| **MCP** | Full (servers declared in plugin or user settings) | Configured via `config.toml` and `codex mcp add` |
| **Sentinel review pattern** | Hook-driven (`post-edit-remind`, `stop-review-reminder`) | Not available — Codex has no hook system |

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
claude plugin update dhpk
# Then, in each project that uses Codex:
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --update
```

The script detects the version delta from `.codex/.dhpk-installed.json` and re-syncs everything.
