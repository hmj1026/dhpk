# dhpk Codex dual-track

Claude Code **does not** load anything under this `codex/` directory. The content here mirrors the plugin's Claude-side skills and agents in Codex CLI format, so projects using both Claude Code and the Codex CLI can keep their assistant configurations in sync without maintaining a separate repo.

> **Layout note**: all non-module entries under `codex/skills/` are in-repo symlinks to `../../skills/<name>/`. Only the four documented module-skill mirrors are physical directories. See `AGENTS.md` for the canonical mapping and maintenance rule.

## Sync into a project

From the project root:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"
```

By default the script creates **symlinks** from `<project>/.codex/{skills,agents}/*` back to the plugin cache. Symlinks track plugin updates automatically — re-run with `--update` after a plugin version bump to refresh.

### Flags

| Flag | Effect |
|------|--------|
| `--copy` | Copy regular files instead of symlinking. Use on Windows without dev-mode, or on shares where symlinks misbehave. |
| `--update` | Re-sync even when the recorded plugin version matches. Use after a manual edit to the plugin or after pulling a new plugin version. |
| `--force` | Skip the project-root heuristic check (`.git/`, `.claude/`, `package.json`, or `composer.json` must exist). |
| `--help` | Print this summary inline. |

### Idempotency

The script writes `<project>/.codex/.dhpk-installed.json` recording the plugin version, mode, and timestamp. Re-running without `--update` is a no-op when the recorded version matches the current plugin version.

### `config.toml.example`

The script copies `config.toml.example` next to (not over) any existing `.codex/config.toml`. The example reflects <your-project>'s working Codex setup with project-specific values redacted to placeholders (`<PROJECT_PATH>`, `<PHP_CONTAINER>`, `<MYSQL_CONTAINER>`); edit those before using.

## After a plugin update

1. `claude plugin update dhpk@dhpk`
2. From each project that uses Codex: `bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --update`

The script detects the version delta from `.dhpk-installed.json` and re-syncs everything.

## Invoke a skill

Skill invocation is chat syntax, not a plugin-management command — `codex
plugin list` / `codex plugin add` only install or report status; they never
execute a skill. Every synced skill carries its own `$<skill-name>` trigger
(baked into its `agents/openai.yaml` `default_prompt`), and this repo's
generic namespace is `$dhpk:<skill-name>` when Codex resolves the skill
through the dhpk plugin. Use the unprefixed `$<skill-name>` form only once
you have verified the skill is exposed on a standalone local surface without
a plugin namespace — do not infer that from `codex plugin list` showing dhpk
as installed; confirm the skill actually resolves first.

## Agent roles

`codex/agents/` ships 11 roles (synced into `.codex/agents/`): 4 hand-maintained generic roles (`explorer`, `worker`, `monitor`, `bug-investigator`) plus 7 roles generated from the canonical Claude agents (`architect`, `code-reviewer`, `security-reviewer`, `database-reviewer`, `tdd-guide`, `deep-reasoner`, `doc-reviewer`). See `AGENTS.md` for the full role map and manual invocation workflows.

Every `codex/agents/*.toml` file must declare non-empty `name`, `description`, `model`, `model_reasoning_effort`, and `developer_instructions` — Codex CLI auto-discovers `.codex/agents/*.toml` and errors if `name` is missing. Agent definitions use TOML only; the plugin's `validate_codex` gate enforces the runtime metadata contract.

The 7 generated roles come from `scripts/gen-codex-agents.js`, run as:

```bash
node scripts/gen-codex-agents.js
```

The generator is deterministic — a re-run with no source change produces no diff. It leaves the 4 hand-maintained roles untouched.

The generator also applies the Codex handoff boundary: generated instructions
may reference only roles that are present in `codex/agents/`. Claude-only
specialist roles are represented by the documented available-role or manual
fallback policy in `AGENTS.md`; they are not dispatchable from Codex.

## Uninstall

`rm -rf .codex/{skills,agents,.dhpk-installed.json}` from the project root. The script makes no global modifications, so there is nothing else to clean up.
