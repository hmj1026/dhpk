# Platform Mapping (Claude First)

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

| Category | Claude Source | Codex Target | Gemini Target | Antigravity Target |
|---|---|---|---|---|
| skills | `.claude/skills/<name>/SKILL.md` | `.codex/skills/<name>/SKILL.md` | `.gemini/skills/<name>/SKILL.md` | `.agent/skills/<name>/SKILL.md` |
| commands (opsx) | `.claude/commands/opsx/<cmd>.md` | N/A (skip) | `.gemini/commands/opsx/<cmd>.toml` | `.agent/workflows/opsx-<cmd>.md` |
| commands (non-opsx) | `.claude/commands/<cmd>.md` | N/A (skip) | `.gemini/commands/<cmd>.toml` (adapted, if command policy allows) | `.agent/workflows/<cmd>.md` (adapted, if workflow policy allows) |
| agents | `.claude/agents/<role>.md` | `.codex/agents/<role>.toml` (+ optional md) | N/A (skip) | N/A (skip) |
| config | `.claude/settings.local.json` | `.codex/config.toml` | N/A (skip) | `.agent/rules/project.md` |
| hooks | `.claude/hooks/<path>` | N/A (skip) | Conditional: `.gemini/hooks/<path>` only when repository enables Gemini hook surface | N/A (skip) |
| multi-agents | `.claude/agents/*` + rules | `.codex/config.toml` + `.codex/agents/*` | N/A (skip) | `.agent/workflows/*` (adapted) |

## Hooks Fine-Grained Mapping Policy

Gemini hooks are treated as **conditionally available**:

1. `adapted` only when at least one hook surface exists:
- `.gemini/hooks/`
- `.gemini/extensions/`
- `.gemini/settings.json` with `hooks` configuration

2. `skip-incompatible` when no hook surface is configured in repository.

3. Codex and Antigravity remain `skip-incompatible` for direct Claude hook parity in current repository structure.

## Status Policy
- `equivalent`: target has same feature semantics and complete baseline structure
- `adapted`: target has similar capability but requires platform-specific format/schema
- `skip-incompatible`: no stable equivalent capability in target platform
