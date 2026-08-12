# Skill platform consolidation and migration

> **Languages**: **English** · [繁體中文](./skill-platform-migration.zh-TW.md)

This guide is the upgrade contract for the collision-safe skill platform. It
applies to maintainers, Claude marketplace consumers, projects that sync dhpk
into `.codex/`, and users who also have Matt Pocock or other global skills
installed.

Current Codex/Cursor installation routes and rollback boundaries live in the
[platform installation SSOT](./platform-installation.md).

## Current contract

| Concern | Current implementation |
|---|---|
| Canonical source | 103 flat packages at `skills/dhpk-<name>/` |
| Public identity | Every dhpk skill name begins with `dhpk-` |
| Inventory SSOT | `manifests/distribution-inventory.json` schema v2 |
| Module projection | 37 relative symlinks under `modules/*/skills/` |
| Codex project projection | 15 relative symlinks under `codex/skills/` |
| Codex native package | 15 physical packages under `plugins/dhpk/skills/`; zero symlinks |
| Codex project receipt | `.codex/.dhpk-installed.json` schema v3 |
| Default hooks | `PreToolUse`, `PostToolUse`, `SessionStart`, `SubagentStop` |
| Learning | `dhpk-continuous-learning-v2` is opt-in |

Directory placement and README lists are not authoritative. The inventory
owns stable ids, public names, lifecycle, modules, and publication surfaces;
the validators reconcile every projection against it.

## Invocation syntax

Names are deliberately different across host surfaces:

| Surface | Syntax | Example |
|---|---|---|
| Claude command | `/dhpk:<command>` | `/dhpk:harness-audit` |
| Claude plugin skill | `/dhpk:<public-skill-name>` | `/dhpk:dhpk-change-review` |
| Codex skill | `$<public-skill-name>` after discovery | `$dhpk-change-review` |

The repeated `dhpk` in a Claude skill invocation is intentional. The first is
the Claude plugin namespace; the second is part of the globally collision-safe
skill name. A command uses only the plugin namespace and command filename.

## Consolidated capabilities

Three overlapping groups were merged instead of retaining aliases as separate
skills:

| Previous skills | Current public skill | What was retained |
|---|---|---|
| `code-explore`, `code-investigate`, `codex-explain` | `dhpk-codebase-exploration` | symbol/flow exploration, depth-controlled explanation, optional second perspective |
| `codex-cli-review` | `dhpk-change-review` | MCP and hardened CLI backends, merge-base diff pinning, standards/spec/security/test axes |
| `software-architecture` | `dhpk-module-design` | deep-module vocabulary, deletion test, interface/test seam, architecture handoff |

All other retained skills also received a `dhpk-` public name. The stable
inventory `id` is intentionally separate from `name`, so future renames do not
break receipt ownership.

## Hooks and commands after consolidation

The default hook surface now has five focused responsibilities:

1. Protect edits to sensitive paths.
2. Combine shell safety and Git/review-debt checks before Bash.
3. Route post-edit review sentinels.
4. Validate and activate configured modules at session start.
5. Reconcile reviewer evidence at subagent stop.

Formatting, lint, Docker probes, prompt hints, session snapshots, continuous
learning, and other advisory work are explicit consumer extensions rather than
default hooks. See [Hook extension model](./hook-extension.md).

Commands remain namespaced `/dhpk:<name>`. Overlapping workflows use four
primary entry points:

- `/dhpk:do` for task routing.
- `/dhpk:codex-review --scope ...` for Codex review variants.
- `/dhpk:precommit` with `--fast` where applicable.
- `/dhpk:setup --install hooks|rules|scripts|all` for configuration and assets.

Thin compatibility aliases remain for one minor release where shipped; the
command index marks retired install aliases and they must not be used in new
documentation.

## Upgrade a Claude marketplace installation

```bash
claude plugin update dhpk@dhpk
```

Start a fresh Claude session or run `/reload-plugins`. Confirm that
`/dhpk:setup`, `/dhpk:do`, and `/dhpk:harness-audit` resolve. Project-local
copies of old dhpk skills are not updated by the marketplace; remove them only
after confirming they are redundant and version controlled or otherwise
recoverable.

## Upgrade a project-local Codex projection

Run from the project root after updating the Claude plugin:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --migrate --update
```

The schema-v3 receipt records stable id, public name, destination, source,
mode, and fingerprint for every managed skill, agent, and supporting asset.
Migration adopts only unchanged exact legacy matches. It preserves and reports
user-owned, edited, retargeted, malformed, ambiguous, or colliding content.

Available operations:

| Flag | Contract |
|---|---|
| `--copy` | Materialize regular files; portable when the plugin root may disappear. |
| `--update` | Reconcile receipt-owned entries with the current plugin root. |
| `--migrate` | Adopt exact unchanged legacy destinations and rename them to public `dhpk-*` names. |
| `--uninstall` | Remove only unchanged receipt-owned entries; preserve edited/orphaned/unrelated files. |
| `--force` | Bypass only the project-root heuristic; never bypass ownership or filesystem safety. |

Do not delete the whole `.codex/` directory: it may contain project-owned
agents, skills, MCP configuration, and hooks.

## Verification

Maintainers should run:

```bash
node scripts/ci/validate-distribution.js
node scripts/ci/validate-openai-metadata.js
node scripts/ci/verify-codex-native-package.js plugins/dhpk
node tests/documentation-platform-parity.test.js
node tests/run-all.js
```

Expected topology is 103 canonical skills, 31 modules, 15 Codex project/native
skills, relative symlinks only in module/Codex projections, and no symlinks in
the native package.

## Rollback

Before migration, commit or snapshot `.codex/` and its receipt. If migration
reports a collision, do not force deletion: restore the snapshot or resolve the
specific user-owned destination, then rerun `--migrate --update`. To leave dhpk
project sync, run `--uninstall`; it preserves modified and unrelated entries.

The canonical source and generated native package must never be edited in
parallel. Edit `skills/dhpk-*/`, regenerate the native package, validate, and
commit both the source and generated artifact together.
