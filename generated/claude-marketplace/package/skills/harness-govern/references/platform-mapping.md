# Platform Mapping (Claude First)

> **Note**: OpenSpec mappings (`commands (opsx)` row below and anything
> referencing `opsx/<cmd>`) assume the user has installed the
> [OpenSpec plugin](https://github.com/Fission-AI/OpenSpec) separately.
> dhpk no longer bundles OpenSpec wrappers as of v0.2.1, so if OpenSpec
> is not installed, treat those rows as N/A and skip them during sync.

## Canonical Source

- Source platform: `claude`
- Source root: `.claude`

## Categories

- `skills`
- `commands`
- `agents`
- `config`
- `hooks`
- `multi-agents`

## Path Mapping Rules

| Category | Claude Source | Codex Target | Antigravity Target | Cursor Target |
|---|---|---|---|---|
| skills | `.claude/skills/<name>/SKILL.md` | `.codex/skills/<name>/SKILL.md` | `.agent/skills/<name>/SKILL.md` | `.cursor/skills/<name>/SKILL.md` |
| commands (opsx) | `.claude/commands/opsx/<cmd>.md` | N/A (skip) | `.agent/workflows/opsx-<cmd>.md` | `.cursor/commands/opsx-<cmd>.md` |
| commands (non-opsx) | `.claude/commands/<cmd>.md` | N/A (skip) | `.agent/workflows/<cmd>.md` (adapted, if workflow policy allows) | `.cursor/commands/<cmd>.md` (adapted, if command policy allows) |
| agents | `.claude/agents/<role>.md` | `.codex/agents/<role>.toml` (+ optional md) | N/A (skip) | `.cursor/agents/<role>.md` |
| config | `.claude/settings.local.json` | `.codex/config.toml` | `.agent/rules/project.md` | `.cursor/rules/project.md` |
| hooks | `.claude/hooks/<path>` | N/A (skip) | N/A (skip) | `.cursor/hooks/<path>` |
| multi-agents | `.claude/agents/*` + rules | `.codex/config.toml` + `.codex/agents/*` | `.agent/workflows/*` (adapted) | `.cursor/agents/review.md` |

AGY native plugins are package projections, not Claude-first file-sync
targets. Validate and install `plugins/dhpk-agy/` through the AGY package
workflow; its consumer path is `~/.gemini/config/plugins/dhpk/`.

## Hooks Fine-Grained Mapping Policy

Codex and Antigravity remain `skip-incompatible` for direct Claude hook parity
in the current repository structure. Cursor owns its native hook projection;
AGY hooks, when present, belong to the native package manifest rather than this
sync matrix.

## Status Policy

- `equivalent`: target has same feature semantics and complete baseline structure
- `adapted`: target has similar capability but requires platform-specific format/schema
- `skip-incompatible`: no stable equivalent capability in target platform
