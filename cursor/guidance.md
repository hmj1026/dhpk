# dhpk for Cursor (project-local harness)

Installation and support-status SSOT: [platform-installation.md](../docs/platform-installation.md)
and [platform-installation.zh-TW.md](../docs/platform-installation.zh-TW.md).

This file describes the **project-local** Cursor route. Cursor does not auto-load
the in-repo `cursor/` tree; a consumer project receives files only after
`install-cursor-harness.sh` materializes them into `.cursor/`.

The marketplace / `~/.cursor/plugins/local/dhpk-cursor` package remains a
separate route. Do not copy `plugins/dhpk-cursor/` into a project `.cursor/`
directory: project rules must be `.mdc`, and that package has no `skills/`.

## Dual route

| Route | Owner | What it is for |
|-------|-------|----------------|
| Cursor project-local sync | `.cursor/.dhpk-installed.json` | Supported write path. Installs skills, subagents, `.mdc` rules, commands, and `.cursor/dhpk/` support files into the consumer project. |
| Cursor Plugin package | `plugins/dhpk-cursor/` | Marketplace or `~/.cursor/plugins/local/` install. Native components only; portable skills stay on `plugins/dhpk-agent/`. |

Canonical skill, agent, command, and rule **bodies** stay in `skills/`,
`agents/`, `commands/`, and `rules/`. `cursor/skills/` is symlink-only.
`cursor/agents/`, `cursor/rules/*.mdc`, `cursor/commands/`, and `cursor/dhpk/`
are generated. `cursor/dhpk/` is the rewritten support tree (trap sheets,
contracts, policies, and other inventory supporting assets) that the installer
copies into `.cursor/dhpk/`.

## Installer

From a checkout, run at the consumer project root:

```bash
bash /path/to/dhpk/scripts/hooks/install-cursor-harness.sh
```

Inside a Claude plugin runtime:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh"
```

Flags match the Codex installer: default symlink, `--copy`, `--update`,
`--migrate`, `--plan --json`, `--adopt`, `--uninstall`, and `--force` (project-root
heuristic only). The schema-v3 receipt is `.cursor/.dhpk-installed.json`.
Unowned same-name files are never replaced.

`dhpk-install cursor` write/rollback actions stay `NOT_IMPLEMENTED`. Use this
bash installer for supported writes.

## Destinations

```text
.cursor/
  .dhpk-installed.json
  skills/<public-name>/     -> symlink or copy of the canonical skill
  agents/*.md               -> generated Cursor subagents
  rules/*.mdc               -> generated project rules
  commands/*.md             -> generated commands
  dhpk/                     -> trap sheets, contracts, rewritten policies
```

This installer does **not** write `.cursor/hooks.json`. Native Cursor hook
mapping is deferred. Cursor may still load Claude hooks from
`.claude/settings.json` when Third-party skills are enabled; that is an
optional compatibility path, not the v1 owner.

If Codex is also installed, Cursor can list `.codex/skills/` through
compatibility loading. v1 still always installs Cursor-owned `.cursor/skills/`
links so Cursor does not depend on Codex or that toggle. Treat `.cursor/` as
the intended owner if names collide.

## Regenerating the in-repo projection

```bash
node scripts/ci/gen-cursor-sync.js
node scripts/ci/validate-cursor-sync.js
```

Do not hand-copy a skill into `cursor/skills/`. Update the distribution
inventory and regenerate.

## Cursor agent models

Canonical `agents/*.md` keep Claude model aliases. The Cursor projection
rewrites them:

| Cursor agents | Model |
|---|---|
| General workflow (`fast-worker`, reviewers, `planner`, `deep-reasoner`, build-resolvers, …) | `cursor-grok-4.6-high` |
| `doc-reviewer`, `docs-lookup`, `doc-updater` | `composer-2.5-fast` |

External CLI wrappers (`codex-*`, `agy-fast-worker`) stay in the tree; they
are not part of the initial Cursor workflow. Their Cursor-side wrapper still
uses Grok 4.6. The Claude `model-economics` rule remains the Claude/Codex
cost lens and is not the Cursor dispatch map.
