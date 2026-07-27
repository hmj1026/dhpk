# Execution Contract

Read this reference after preflight and before generating a plan. Use the same
`SYNC_CLI` resolved by `runtime-entrypoints.md` for every command in one run.

If the repository is not the current working directory, place
`--root <repo-root>` before the subcommand.

## Plan

```bash
python3 -B "$SYNC_CLI" plan --format markdown
python3 -B "$SYNC_CLI" plan --format json \
  --output /tmp/multi-ai-sync-plan.json
```

The plan must include coverage, mapping decisions, migration candidates,
skip register, source arbitration, and evidence URLs.

## OpenSpec tasks

Run only after user approval:

```bash
python3 -B "$SYNC_CLI" openspec-tasks \
  --plan /tmp/multi-ai-sync-plan.json \
  --change-name claude-sync-YYYY-MM-DD \
  --output openspec/changes/claude-sync-YYYY-MM-DD/tasks.md
```

Only `adapted` items become tasks. Keep `skip-incompatible` items in the skip
register with their reason and evidence.

## Dry-run and apply

Always inspect the dry-run before mutation:

```bash
python3 -B "$SYNC_CLI" apply \
  --plan /tmp/multi-ai-sync-plan.json \
  --dry-run \
  --format markdown \
  --output /tmp/multi-ai-sync-apply-dryrun.md
```

The dry-run report must list planned files, target/category breakdown, risks,
and manual items. After review, run:

```bash
python3 -B "$SYNC_CLI" apply \
  --plan /tmp/multi-ai-sync-plan.json \
  --format markdown \
  --update-tasks openspec/changes/claude-sync-YYYY-MM-DD/tasks.md \
  --manual-draft-output artifacts/multi-ai-sync-manual-draft-YYYY-MM-DD.md \
  --output artifacts/multi-ai-sync-apply-YYYY-MM-DD.md
```

Apply policy:

- Automatically apply `skills` and `commands/workflows`.
- Produce reviewer-ready drafts for `agents`, `config`, and `multi-agents`.
- Record the CLI fallback when `.codex/skills` is not writable.
- Let `--update-tasks` check items only from the apply report.

## Validation

```bash
python3 -B "$SYNC_CLI" validate --format markdown
# Explicit request (absent target reports BLOCKED, not NOT_CONFIGURED):
python3 -B "$SYNC_CLI" validate --targets codex gemini --format markdown
python3 -B "$SYNC_CLI" validate --all-targets --format markdown
```

Omitting `--targets`/`--all-targets` auto-discovers the configured target set
from documented markers (Codex: `.codex/config.toml`; Gemini:
`.gemini/commands/**/*.toml`; Antigravity: `.agent/rules/*.md`); an absent,
unrequested target reports `NOT_CONFIGURED` and never fails the gate.

Validate config/frontmatter/TOML/JSON loadability, platform smoke, hooks, and
multi-agent representative cases. Every check reports one of `PASS`, `FAIL`,
`NOT_CONFIGURED`, or policy-backed `SKIP_INCOMPATIBLE` (with a machine-readable
reason). Final gate exit semantics:

- `PASS`: every applicable configured (or explicitly requested and present) check passes.
- `FAIL`: any applicable configured/requested check fails. Takes precedence over `BLOCKED`.
- `BLOCKED`: no `FAIL`, but at least one `--targets`/`--all-targets`-requested platform is entirely absent.
- `NOT_CONFIGURED` / `SKIP_INCOMPATIBLE` rows stay visible but never independently move the gate off `PASS`.
- `legacy_gate` (deprecated, removal-pending): `PASS`/`PARTIAL`/`FAIL` compatibility field for consumers not yet migrated to the four values above.

## Report contract

Every mapping records:

- `status`: `equivalent`, `adapted`, or `skip-incompatible`;
- `reason` and `evidence_urls`;
- `source_path` and `target_path`.

Every run reports preflight status, plan/task/apply artifacts, mutation/manual/
failure counts, and the final validation Gate. A partial apply or validation
failure must not be reported as complete.
