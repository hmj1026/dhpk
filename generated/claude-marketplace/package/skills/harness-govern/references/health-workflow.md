# Health mode

Health is a read-first diagnostic for one resolved harness. It combines
project-local hygiene with Claude/plugin synchronization; it does not review
application code or invent a replacement for the install commands.

## Invocation

```text
$harness-govern health [--scope hygiene|sync|all] [--fix-safe|--fix] [--dry-run]
```

`all` is the default. `--fix-safe` and `--fix` are mutually exclusive. The
default is report-only. `--dry-run` keeps the run report-only even when a fix
tier was supplied; record that suppression in the report.

## Procedure

1. Resolve `HARNESS_DIR` with `harness-directory-contract.md`; report the
   selected directory rather than assuming `.claude`.
2. For `hygiene`, read `hygiene-checks.md` and execute C1-C7. Include the
   command-skill pairing and cache checks even when their result is a skip.
3. For `sync`, read `plugin-sync.md` and execute S1-S3. Compare manifest,
   local, and plugin content by blob hash where the contract requires it.
4. Classify findings as P0, P1, or P2. A fix tier delegates to the targeted
   `/install-*` operation; this mode never writes settings, rules, hooks, or
   scripts directly. Keep symlink and settings precedence warnings visible.
5. Stop on an unreadable source or ambiguous directory. A failed baseline is
   evidence of the current harness state, not permission to stack a fix.

## Output contract

```markdown
# Harness Health Report
- Mode: health / scope: <hygiene|sync|all>
- Active harness: <path>; main rule: <path>
- Dry-run: <yes|no>; fix tier: <report|safe|guided>

## Hygiene Summary (C1-C7)
| Item | Status | Notes |
|------|--------|-------|
| ... | PASS/FAIL/SKIP | ... |

## Sync Summary (S1-S3)
| Check | Status | Detail |
|-------|--------|--------|
| ... | PASS/FAIL/SKIP | ... |

## Issues
- P1/P2 finding → targeted recommendation

## Gate
PASS / FAIL / BLOCKED / NOT_CONFIGURED / NOT_RUN
```

P1 findings include a specific safe or guided install command. Report the
managed inventory and every selected check; a missing optional target is
`NOT_CONFIGURED`, never a silent pass.

## Completion

Health is complete when every requested C1-C7/S1-S3 check has a status, every
finding has severity and evidence, the fix boundary is explicit, and one gate
plus one next action is emitted. Read these only when the corresponding scope
is selected:

- `hygiene-checks.md` — exact C1-C7 commands and criteria.
- `plugin-sync.md` — S1-S3 state machine, managed inventory, and fix tiers.
- `usage-examples.md` — supported invocation examples.
- `best-practices.md` — directory and naming conventions used by the checks.
