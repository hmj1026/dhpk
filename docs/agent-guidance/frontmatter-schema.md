# Frontmatter schema (agents and skills)

Use this page when authoring or reviewing a canonical agent role prompt or a
skill `SKILL.md`. It cites official Claude Code fields and then labels dhpk
local policy separately. Do not treat local policy as official schema.

Not for: rewriting skill bodies, auditing plugin or marketplace JSON beyond
the see-official pointer below, or editing generated Cursor/Codex/plugin
agent copies. Those copies refresh through existing projection jobs.

Official citations (locked 2026-09-08):

- Subagents: [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- Skills: [Skills](https://code.claude.com/docs/en/skills)

## Official agent fields

Only `name` and `description` are required. Other listed fields are optional
in Claude Code. Official identity comes from the `name` field; the filename
does not have to match.

| Field | Official required | Notes |
|---|---|---|
| `name` | Yes | Lowercase letters and hyphens. Cannot contain `:`. |
| `description` | Yes | When Claude should delegate to this subagent. |
| `tools` | No | Allowlist. Omitted → inherit every tool available to subagents. |
| `disallowedTools` | No | Deny list removed from inherited or specified tools. |
| `model` | No | `sonnet`, `opus`, `haiku`, `fable`, `inherit`, or a full model ID such as `claude-opus-5`. Omitted → Claude Code's subagent model order. |
| `maxTurns` | No | Maximum agentic turns. |
| `skills` | No | Skills preloaded into the subagent context. |
| `effort` | No | `low`, `medium`, `high`, `xhigh`, `max` (availability depends on the model). |
| `memory` | No | `user`, `project`, or `local`. |
| `background` | No | Keep the subagent in the background. |
| `isolation` | No | `worktree` for an isolated git worktree. |
| `color` | No | Task-list display color. |
| `initialPrompt` | No | Auto-submitted first user turn for `--agent` sessions. |
| `experimental` | No | Map; `cacheTtl` of `5m` or `1h` is the documented key. |

Plugin-shipped agents **ignore** `hooks`, `mcpServers`, and `permissionMode`.
Do not add those fields to dhpk plugin agent prompts; Claude Code drops them
when loading from a plugin. Copy the file into `.claude/agents/` or
`~/.claude/agents/` only if a non-plugin session needs those fields.

## Official skill fields

Claude Code reads skill frontmatter only when the opening `---` is line 1.
All skill fields are optional; `description` is recommended so Claude knows
when to load the skill.

| Field | Notes |
|---|---|
| `name` | Display name; plugin skills also use it as the last command segment. |
| `description` | What the skill does and when to use it. |
| `when_to_use` | Extra invocation context; counts toward the listing cap with `description`. |
| `argument-hint` | Autocomplete hint. |
| `arguments` | Named positional `$name` substitution. |
| `disable-model-invocation` | `true` → user-invoked only; not auto-loaded or preloaded into subagents. |
| `user-invocable` | `false` → hidden from `/` and not runnable as `/name`. |
| `allowed-tools` | Turn-scoped permission grant; does not restrict the tool pool. |
| `disallowed-tools` | Turn-scoped removal from the tool pool. |
| `model` | Same values as `/model`, or `inherit`. |
| `effort` | Same effort aliases as agents. |
| `context` | `fork` runs the skill in a subagent. |
| `agent` | Subagent type when `context: fork`. |
| `background` | With fork: `false` waits for the result. |
| `hooks` | Registered for the rest of the session when the skill is invoked. |
| `paths` | Glob patterns that limit auto-activation. |
| `shell` | `bash` or `powershell` for inline `!` commands. |
| `metadata` | Free-form map for local tooling; Claude Code does not act on it. |
| `license` | Agent Skills spec field; accepted, unused by Claude Code. |
| `compatibility` | Agent Skills spec field; accepted, unused by Claude Code. |

Command files under `commands/` support the same frontmatter except `name`
and `paths`, which Claude Code ignores there. This rewrite does not change
SKILL.md bodies.

## Local policy

These rules are **dhpk local policy**, not official Claude Code requirements.
`scripts/ci/validate-agents.js` and `doc-reviewer` enforce them on canonical
role prompts.

- Every canonical agent **role prompt** sets `tools` explicitly (non-empty).
  Official schema still treats `tools` as optional; omitting it inherits the
  full subagent tool pool, which dhpk does not want for shipped roles.
- `name` matches the agent file basename without `.md` (for example
  `agents/architect.md` → `name: architect`). Official schema allows a
  mismatch; dhpk does not, so plugin registration and dispatch stay predictable.
- `agents/INDEX.md` is a roster, not a subagent prompt. The validator skips
  it and does not force `tools` on it.
- Model **documentation** follows official aliases (`haiku`, `sonnet`,
  `opus`, `fable`, `inherit`, and full model IDs). The install-time validator
  currently accepts the named aliases including `inherit` and `fable`; it
  does not invent a second model stack.

The module-shipped polyfill reviewer is off the agent-definition rewrite map;
leave its inline companion copy until a later change.

## Plugin and marketplace manifests

Do not extend this page into plugin-manifest compliance. For `plugin.json`
and `marketplace.json` fields, see official plugin docs only:

- [Plugins](https://code.claude.com/docs/en/plugins)
- [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
