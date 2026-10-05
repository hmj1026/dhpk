# Read-only verdict workflow

This reference owns scope resolution, fixed-point handling, evidence collection,
and the shared review sequence. The review and its final gate exist only in the
response; no state file, review snapshot, gate file, or sentinel is created.

## Sequence

```text
resolve one mode and scope → pin the reviewed snapshot → collect metadata
→ read evidence → primary verdict → optional CLI comparison
→ normalize findings → return the response
```

## Step 1: resolve scope and pin the snapshot

Choose exactly one mode and a concrete, readable scope: a diff, branch, path
set, document, PR, or supplied evidence set. Record the scope in the report.
If the mode or scope is missing, ambiguous, contradictory, or unreadable,
return `INCONCLUSIVE` and stop.

For Git-backed changes, record the exact commit used as the comparison point:

- For an uncommitted diff, pin the current `HEAD`; the selected scope is the
  working-tree change relative to that commit.
- For a branch comparison, resolve a non-empty `git merge-base <base> HEAD`
  once and record its commit SHA. Use that SHA for later diff and history
  reads; the named base branch is only an input to resolution.
- For a path or document review, record the source revision or supplied
  snapshot that provides the reviewed content.

Do not re-resolve a moving branch name after the point is recorded. A changed
scope or snapshot needs a new review. If the selected scope cannot be
reproduced from the recorded point, return `INCONCLUSIVE`.

## Step 2: collect mode-specific metadata

Collect only the metadata needed to navigate to evidence. The primary reviewer
must read the actual source and change contents.

| Mode | Read-only collection |
|---|---|
| `code` | status, selected paths, diff/stat, fixed point, relevant callers and tests. |
| `pr` | branch/base, commits, changed files, declared merge method, and supplied PR metadata. |
| `security` | requested scope, auth/input/data boundaries, dependency manifests, and relevant tests. |
| `tests` | request or acceptance criteria, source, tests, and available runtime evidence. |
| `docs` | complete target plus referenced source or configuration. |
| `risk` | current diff, changed files, imports/dependents, and optionally bounded history. |

Commands must remain read-only. Do not run formatters, fixers, migrations,
generators, commits, staging, or commands whose purpose is to create an
artifact. A command that writes a cache is also outside this workflow.

## Step 3: form the primary verdict

Read the selected evidence independently and follow the evidence and finding
rules in [`review-common.md`](review-common.md). In `code` mode, assess the
Standards and Spec axes separately. Other modes use only their relevant
dimensions. Keep unsupported claims and unavailable evidence visible.

## Step 4: compare an optional CLI opinion

Only explicit `--second-opinion=codex-exec` enables the bundled CLI transport.
Send the selected scope and pinned point, not the primary conclusion. The
wrapper-generated workflow text carries the selected scope, review depth, and
pinned merge-base value. Use those values as supplied; obtain any needed file
or commit details by reading the selected repository snapshot. Record the CLI
exit status and a bounded, redacted result separately. If the option is absent
or the CLI is unavailable, report `degraded: primary model only`.

## Step 5: normalize and return

Use [`review-common.md`](review-common.md) for finding normalization and
source labels, [`review-rubric.md`](review-rubric.md) for severity and final
verdict meanings, and [`../../templates/review_output.md`](../../templates/review_output.md)
for the response shape. Do not persist the report or emit or clear a sentinel.
