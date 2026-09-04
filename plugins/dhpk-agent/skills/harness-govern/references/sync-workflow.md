# Sync mode

Sync compares Claude-first harness capabilities with configured Codex,
Antigravity, AGY, and Cursor targets. It preserves mapping evidence and
approval boundaries; it is not a reverse sync or a single-platform editor.

## Invocation

```text
$harness-govern sync plan [--targets ...] [--format markdown|json]
$harness-govern sync openspec-tasks --plan <file> --change-name <id>
$harness-govern sync apply --plan <file> --dry-run [--format markdown|json]
$harness-govern sync apply --plan <file> --approved-plan-sha256 <sha256> [--format markdown|json]
$harness-govern sync validate [--targets ...|--all-targets] [--format markdown|json]
$harness-govern sync self-test [--format markdown|json]
```

The first command is the default action when no subcommand is supplied. Read
`runtime-entrypoints.md` to resolve the CLI and
`harness-directory-contract.md` before choosing roots. The shipped
`scripts/multi_ai_sync.py` and its library are the deterministic implementation.

## Procedure and gates

1. **Preflight.** Mark each source/target `PASS`, `WARN`, or `BLOCKED`; a
   missing optional target may be `WARN` for a plan and `NOT_CONFIGURED` for
   validation. Source `BLOCKED` stops the run.
2. **Self-test.** Run `python3 -B scripts/multi_ai_sync.py self-test ...` and
   stop unless `failed: 0`.
3. **Plan.** Include every feature mapping with `status`, `reason`, evidence,
   source/target paths, adapted candidates, and skip-incompatible reasons.
   Plan-only creates no target mutation.
4. **Tasks and dry-run.** Generate OpenSpec tasks only from approved adapted
   mappings. Before apply, run `apply --dry-run`; distinguish `applied`,
   `manual`, and `failed` items. A fallback root is evidence, not parity proof.
5. **Validate.** Discover the configured target set and report each as `PASS`,
   `FAIL`, `BLOCKED`, `NOT_CONFIGURED`, or `SKIP_INCOMPATIBLE`; retain the
   deprecated `legacy_gate` only when the script emits it. Never treat missing
   unrequested targets as failure.

## Output and completion

```text
Preflight → self-test → plan/tasks → dry-run/apply → per-target validation
→ Gate (PASS/FAIL/BLOCKED) → failed/skipped summary → next action
```

`--dry-run` reports the exact mutation set and `plan_sha256`, and writes no
targets. An approved live apply must supply the same digest with
`--approved-plan-sha256`; changed plan bytes, absolute/traversing paths,
symlinked ancestors, and destinations outside the repository-local target
allowlist fail closed. Apply still requires the selected target to be writable
and must retain a manual/failed report. External credentials, publication, and
release remain outside this mode's authority.

Sync is complete when self-test is green, the approved scope matches the
dry-run, every mapping has a decision contract, and each applicable target has
an honest terminal state. Load `execution-contract.md`, `platform-mapping.md`,
`risk-policy.md`, `capability-sources.md`, `improvement-todo.md`, and
`source-conflicts.json` only for this mode.
