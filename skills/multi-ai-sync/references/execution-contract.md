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
```

Validate config/frontmatter/TOML/JSON loadability, platform smoke, hooks, and
multi-agent representative cases. Use these exit semantics:

- `PASS`: config/smoke pass and no representative `FAIL` or `SKIP`.
- `PARTIAL`: config/smoke pass and only explicit incompatible skips remain.
- `FAIL`: config/smoke fails or any representative case fails.

## Report contract

Every mapping records:

- `status`: `equivalent`, `adapted`, or `skip-incompatible`;
- `reason` and `evidence_urls`;
- `source_path` and `target_path`.

Every run reports preflight status, plan/task/apply artifacts, mutation/manual/
failure counts, and the final validation Gate. A partial apply or validation
failure must not be reported as complete.
