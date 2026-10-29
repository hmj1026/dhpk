# Maintainer delivery

This guide applies to dhpk repository maintenance. Portable `create-pr` keeps
its existing scope and grants no merge authority. A human merge checkpoint is
the default; an agent may execute a merge only with explicit user authorization.

## Preflight

After synchronizing canonical resources and the inventory-declared copies in
`codex/supporting/` (the [supporting assets](../distribution-surfaces.md#lifecycle-model)),
run the short preflight before formal package generation or the full suite:

```sh
node scripts/maintainer/verification-run.js preflight --root PATH --base FULL_SHA --base-ref develop
```

Use the full commit SHA of the reviewed base. The preflight reuses the existing
changelog validator, Codex skill metadata suite, and catalog check with that
diff base. It stops at the first failure. Catalog admission checks whether a
new test suite has a registered source owner; missing owners remain warnings. Coverage is evaluated against committed changes; run
this after the canonical commit and before generating its outputs.

## Issue snapshot

For a complete, durable issue intake, run:

```sh
node scripts/maintainer/issue-snapshot.js --repo OWNER/REPO --issue N --out /absolute/path/snapshot.json
```

The `dhpk.issue-snapshot.v1` snapshot records the full body, comments, labels,
and timestamps. Source drift checks protect the snapshot and output is atomic.
Use the resulting snapshot as intake evidence; reobserve the issue when current
state matters.

## Verification run

Start a source- and command-bound run with a stable task, attempt, and key:

```sh
node scripts/maintainer/verification-run.js start --root PATH --task ID --attempt ID --key NAME -- COMMAND ARGS
node scripts/maintainer/verification-run.js status --record /absolute/path/record.json
```

The run records durable logs and holds an exclusive claim. A duplicate running
request attaches to the existing run; a passed run is reused. If the owner is
unknown, retain that state and do not rerun automatically. Retry a failed run
only explicitly with `--retry` and a new attempt. Keep only `recordPath` references in the task ledger; derive verification
state from the records rather than saving a second status copy:

```sh
node scripts/maintainer/verification-run.js overview --ledger /absolute/path/run.json
```

The ledger uses `dhpk.verification-ledger.v1`; each top-level object with its
own `recordPath` is a record reference. For example:

```json
{
  "schema": "dhpk.verification-ledger.v1",
  "verification": {"recordPath": "/absolute/path/record.json"}
}
```

Relative record paths resolve beside the ledger. The overview retains each
record's source identity; historical PASS does not attest the current checkout.
Missing, corrupt, duplicate, or unknown records never fall back to a cached
ledger status. Preserve the records and logs as evidence for their exact source,
command, and effective environment. The
runner stores an environment digest rather than raw secret values. A source
change detected between the beginning and end leaves verification unknown;
this check does not prove a hermetic run or detect every transient edit.

## Hosted CI watch

Publish final PR metadata once, then observe the pinned head without changing
PR state to trigger another run:

```sh
node scripts/maintainer/verification-run.js ci-watch --repo OWNER/REPO --pr N --head SHA --log /absolute/path/ci-watch.log
```

A missing run has a 180-second grace period with a fresh lookup at the deadline.
Queued or running CI is followed rather than retriggered. An absent run after
the grace period is BLOCKED. `--wait-seconds 0` performs the immediate lookups;
`--interval-seconds` controls polling and defaults to 20. The watcher follows
the latest matching `ci.yml` PR run, rechecks head and run identity after watch,
and follows a newer run before reporting success. It performs no workflow or
PR mutations. Full watch output goes to the log; console output contains only
observed state transitions and the final result. Delivery-gate evidence remains
a separate requirement.

## Delivery gate

Prepare and validate final PR title and body after final-head local checks and
review, then publish that metadata once. If metadata is edited afterwards,
invalidate the run record and reobserve the latest head and hosted run.

```sh
node scripts/maintainer/delivery-gate.js --repo OWNER/REPO --pr N --head SHA --evidence FILE
```

The default gate is read-only. It checks the exact head, local `PASS`, review
`APPROVE` with nonempty artifacts, final PR metadata and its body SHA-256, and
live hosted required checks. The evidence object uses `schema: "dhpk.delivery-evidence.v1"` and root
`headSha`; `local` has `headSha`, `status`, `command`, and `logPath`; `review`
has `headSha`, `status`, `reviewers`, and `reportPath`; and `metadata` has
`title` and `bodySha256`. These records are attestations, not cryptographic
authentication.

Only after explicit user authorization and a successful gate, add `--execute`.
It rechecks the gate and performs an ordinary merge with `--merge` and
`--match-head-commit SHA`. It does not use `--auto`, `--admin`, or branch
deletion. Observe the effective required checks and applicable ruleset live;
`develop` must require `Validate harness assets`. Ruleset and App identifiers
come from that live lookup. Monitor post-merge release CI only when the
applicable workflow is triggered.

## Context loading

Start from the guidance index and load only the section for the current task.
Use CX for named symbols and the GitNexus guide for graph failures; retain
unresolved evidence instead of repeating the same failing lookup. Bound each
read to the relevant section and each search to matching paths. Read matching
role capabilities before assigning a task, and keep release work with the
delivery owner when a worker role excludes it.
