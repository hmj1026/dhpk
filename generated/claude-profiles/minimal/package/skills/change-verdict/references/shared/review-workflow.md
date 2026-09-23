# Read-only verdict workflow

This reference defines the shared sequence for `change-verdict`. It keeps all
state in the current response and process memory; it does not create state
files, review snapshots, gate files, or sentinel updates.

## Sequence

```text
resolve mode → pin fixed point → collect metadata → read evidence
→ primary verdict → optional CLI comparison → aggregate → return response
```

## Step 1: resolve and pin

Select exactly one mode and one scope. For an uncommitted diff, pin `HEAD`; for
a branch comparison, resolve a non-empty `git merge-base <base> HEAD`. If no
fixed point or readable scope exists, return `INCONCLUSIVE` and stop.

## Step 2: collect metadata

Read metadata only; the primary reviewer must read the actual source and diff.

| Mode | Read-only collection |
|---|---|
| `code` | `git status`, changed files, diff/stat, fixed point, relevant callers and tests. |
| `pr` | branch/base, commits, changed files, declared merge method, and PR metadata when supplied. |
| `security` | requested scope, auth/input/data boundaries, dependency manifests, and relevant tests. |
| `tests` | request/AC document, source files, tests, and available runtime evidence. |
| `docs` | complete document plus referenced source/configuration. |
| `risk` | current diff, changed files, imports/dependents, and optionally bounded history. |

Do not run formatters, fixers, migrations, generators, commits, staging, or
commands whose purpose is to create an artifact. A command that writes a cache
is also outside this workflow.

## Step 3: primary verdict

Use the current model in the read-only context. Research independently from
the supplied metadata and cite file:line, commit, command, or tool evidence.
Keep Standards and Spec axes separate for `code`; keep mode-specific dimensions
for every other mode. Redact secrets before including evidence in the response.

## Step 4: optional CLI comparison

Only the explicit `--second-opinion=codex-exec` option enables the bundled CLI
transport. Send a self-contained scope, fixed point, and task; do not send the
primary conclusion. Record its exit status and a bounded, redacted result as a
separate source. If it is absent or unavailable, state
`degraded: primary model only`.

## Step 5: aggregate and return

Deduplicate findings by canonical file and issue text, tolerate nearby line
movement, and retain the highest severity. A finding must survive evidence,
context, false-positive, severity, and gap checks. Return the normalized report
with one verdict:

- `READY`: scope and fixed point are valid, evidence is sufficient, and no P0/P1 remains.
- `BLOCKED`: a P0/P1 or required safety condition prevents a complete verdict.
- `INCONCLUSIVE`: evidence or mode selection is insufficient to classify the request.

The final gate exists only in the response. Never emit or clear a repository
sentinel, write a report, or invoke a writer.
