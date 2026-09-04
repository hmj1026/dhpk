# dhpk Codex dual-track

> **Languages**: **English** · [繁體中文](./README.zh-TW.md)

Claude Code **does not** load anything under this `codex/` directory. The content here mirrors the plugin's Claude-side skills and agents in Codex CLI format, so projects using both Claude Code and the Codex CLI can keep their assistant configurations in sync without maintaining a separate repo.

For the complete Supported project-local, legacy/native, and standard Agent
Plugin routes, see the [platform installation SSOT](../docs/platform-installation.md).

> **Layout note**: every entry under `codex/skills/` is an in-repo relative
> symlink to its flat canonical package at `../../skills/<public-name>/`. There
> are no physical skill copies in this projection; the separate
> `plugins/dhpk/` tree is the tracked native-package surface. See `AGENTS.md`
> for the canonical mapping and maintenance rule.

## Sync into a project

From the project root:

`CLAUDE_PLUGIN_ROOT` is available in Claude Code's plugin-runtime shell. In an
ordinary terminal, invoke the same script from a persistent checkout, for
example set `DHPK_ROOT=/absolute/path/to/dhpk` and run
`bash "$DHPK_ROOT/scripts/hooks/install-codex-skills.sh"`. Do not rely on an
ephemeral marketplace-cache path.

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"
```

By default the script uses a **hybrid projection**: skills and receipt-managed supporting assets are symlinked back to the source, while every `<project>/.codex/agents/*.toml` is a physical file so Codex can load it as a configuration layer. Re-run with `--update` after a plugin version bump; existing receipt-owned agent links are migrated to physical files without rematerializing skill links. The receipt is an ownership boundary: only entries recorded in `.dhpk-installed.json` whose destination still matches its marker can be replaced or removed.

### Flags

| Flag | Effect |
|------|--------|
| `--copy` | Make the entire projection physical. Agent TOMLs are already physical in the default hybrid mode. |
| `--update` | Re-sync even when the recorded plugin version matches. Use after a manual edit to the plugin or after pulling a new plugin version. |
| `--migrate` | Upgrade a legacy receipt. Only exact source matches are adopted; user-owned or mismatched destinations are preserved and reported. |
| `--uninstall` | Remove unchanged receipt-owned entries. Edited or orphaned entries and unrelated project assets are preserved. |
| `--force` | Skip the project-root heuristic check (`.git/`, `.claude/`, `package.json`, or `composer.json` must exist). |
| `--help` | Print this summary inline. |

### Idempotency

The ownership record is a schema-v3 receipt.

The script writes `<project>/.codex/.dhpk-installed.json` with schema version 3, plugin version, source fingerprint, mode, and a managed-entry inventory for skills, agents, and supporting assets. Skill entries retain the stable inventory `id`, current public `name`, destination, content fingerprint, source, and mode. Supporting assets remain schema-compatible and are declared in `manifests/distribution-inventory.json`, so generated agent references resolve inside a clean `.codex/` projection without Claude-only plugin-root paths. On `--update` or `--migrate`, receipt-owned unchanged legacy skill destinations are renamed to their public `dhpk-*` names; edited, unowned, third-party, retargeted, malformed, or ambiguous paths are preserved and reported as conflicts. Every mutating run prints deterministic created, updated, migrated, preserved, collision, pruned, and orphaned counts without absolute private paths. A legacy receipt without `managed_entries` fails closed for same-name collisions until `--migrate` is requested.

### `config.toml.example`

The script copies `config.toml.example` next to (not over) any existing `.codex/config.toml`. The example reflects <your-project>'s working Codex setup with project-specific values redacted to placeholders (`<PROJECT_PATH>`, `<PHP_CONTAINER>`, `<MYSQL_CONTAINER>`); edit those before using.

## After a plugin update

1. `claude plugin update dhpk@dhpk`
2. From each project that uses Codex: `bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --update`

The script detects the version delta from `.dhpk-installed.json` and re-syncs everything.

## Invoke a skill

Skill invocation is chat syntax, not a plugin-management command — `codex
plugin list` / `codex plugin add` only install or report status; they never
execute a skill. Every synced skill carries its public trigger in
`agents/openai.yaml`. The six capability families use unprefixed names
(`skill-scope`, `skill-forge`, `flow-guide`, `flow-drive`, `change-verdict`,
`code-trace`); other first-party skills retain the `dhpk-` prefix. Do not
write `$dhpk:<name>` or a retired predecessor name. Confirm that the selected
family or `dhpk-*` trigger resolves.

The explicit main-flow Codex entry is `$flow-drive <task>` when that family is
discovered; use `$flow-guide route <task>` for classification only.
Codex has no `/dhpk:do` command. If `$flow-drive` is not discovered, use
instruction routing in `AGENTS.md` and explicit `/opsx:*`; do not invent a
callable `/dhpk:do`.

## Agent roles

`codex/agents/` ships 16 direct roles (synced into `.codex/agents/`): 4 hand-maintained generic roles (`explorer`, `worker`, `monitor`, `bug-investigator`) plus 12 roles generated from the canonical agents (`architect`, `code-reviewer`, `security-reviewer`, `database-reviewer`, `tdd-guide`, `deep-reasoner`, `doc-reviewer`, `planner`, `spec-miner`, `frontend-reviewer`, `migration-reviewer`, `e2e-runner`). See `AGENTS.md` and [`agent-role-map.json`](agent-role-map.json) for the complete role map and manual/capability-gated outcomes.

Every `codex/agents/*.toml` file must declare non-empty `name`, `description`, `model`, `model_reasoning_effort`, and `developer_instructions` for Codex's documented project-local discovery path. Agent definitions use TOML only; the plugin's `validate_codex` gate enforces the static metadata contract.

Static validation and a current receipt do not prove callability. Start a fresh
Codex session and dispatch a non-built-in custom role; built-in `explorer`
cannot serve as the custom-registry canary. Until an actual spawn and targeted
wait succeed, record named-role runtime as `NOT_RUN`, `UNAVAILABLE`, or the
observed failure. An exact-ID `unknown agent_type` is a registry failure, not
evidence to rename the role or replace its GPT-5.6 family model; see
[`AGENTS.md`](AGENTS.md#role-discovery).

The 12 generated roles come from `scripts/gen-codex-agents.js`, run as:

```bash
node scripts/gen-codex-agents.js
```

The generator is deterministic — a re-run with no source change produces no diff. It leaves the 4 hand-maintained roles untouched.

The generator also applies the Codex handoff boundary: generated instructions
may reference only roles that are present in `codex/agents/`. The complete
canonical-agent coverage matrix is maintained in `agent-role-map.json`; roles
that are merged, skill/manual-fallback, capability-gated, or intentionally
unavailable must be explicit there rather than silently dropped. The status
definitions and dispatch guidance live in `AGENTS.md`.

## Uninstall

From the project root run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --uninstall`. The command removes only unchanged receipt-owned entries. Edited managed entries are marked orphaned and retained, and unrelated `.codex` content is never deleted. `--force` is unnecessary for uninstall and cannot force deletion; it only bypasses the normal project-root heuristic. Do not remove the whole `.codex` directory when it contains project-owned assets.
