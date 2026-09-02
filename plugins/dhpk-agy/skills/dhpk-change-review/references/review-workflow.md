# Portable code review workflow

This reference contains the shared workflow for
`skills/dhpk-change-review/SKILL.md`. The entrypoint selects a variant and then
loads this file for the exact fail-closed, dual-review sequence.

## Shared sequence

```text
PENDING → collect metadata → optional pre-checks → dual review → await/reconcile
→ aggregate → emit gate → loop if blocked
```

## Step 0: initialize the gate

Run:

```bash
bash scripts/emit-review-gate.sh PENDING
```

This sets `review_mode=dual` and `aggregate_gate.executed=false`. If the
process stops before the final gate, the stop guard remains fail-closed.

## Step 1: collect change metadata

Collect metadata only; the selected primary reviewer reads the actual diff and
file contents itself.

| Variant | Collection |
|---|---|
| Fast | `git diff --name-only HEAD` and `git diff --stat HEAD` |
| Full | Same as Fast, then run the resolved lint/build pre-checks |
| Branch | Same as Fast plus current branch, base branch, and commit count |

The primary reviewer independently reads each diff with `git diff HEAD --
<file>` and the research instructions in its prompt.

## Step 1.5: feature context and acceptance criteria

Run `bash scripts/resolve-feature.sh` and parse its JSON. If
`has_requests=true` and confidence is `high` or `medium`:

1. Find the newest `requests/*.md` under `docs_path`.
2. Read its `## Acceptance Criteria` checkboxes.
3. Remove criteria that only name review or precommit gates.
4. Cap the checklist at 20 items and record the request path.

If resolution fails, no request exists, or the section cannot be parsed, set
`SPEC_CHECKLIST=null` and continue without silently inventing criteria.

## Step 1.6: deferred findings

If `.claude_nit_history.json` exists, retain only non-expired deferred entries
and sanitize each before prompt injection:

- limit `canonical_issue` to 120 characters;
- strip markdown control characters and raw code;
- retain only file:line evidence;
- reject secrets and shell metacharacters;
- cap the XML block at 10 entries.

Missing, invalid, empty, or unsafe history is a no-op:
`DEFERRED_CONTEXT=null`.

## Step 2: full-variant pre-checks

For Full only, resolve `{LINT_FIX_COMMAND}` and `{BUILD_COMMAND}` from the
host project's `CLAUDE.md` or `package.json`, run them, and record the results
as `LOCAL_CHECKS`.

## Step 3: independent dual review

On the first review, dispatch two reviewers in parallel:

1. The primary reviewer with the variant prompt and a read-only sandbox; save
   its review artifact.
2. A secondary reviewer through the selection cascade:
   `pr-review-toolkit:code-reviewer`, then `strict-reviewer`, then primary-only
   degraded mode if both are unavailable.

If the caller explicitly selects `--backend cli`, run the retained CLI
transport as an additional, clearly labeled review input. The current-model
primary path remains complete without it, and the CLI is never a hidden
fallback.

The secondary prompt receives changed files and diff stats, reads the actual
diff, and must verify every finding with evidence, context, false-positive,
severity, and gap checks. Findings use
`[P0/P1/P2/Nit] file:line issue → fix` and end with `Ready` or `Blocked`.

For `--continue`, reread the pinned diff and prior review artifact with the
re-review template, then redispatch the secondary reviewer in fresh context.
Any code edit resets the review cycle and requires a fresh fixed point.

## Step 3.5: await and reconcile

The primary reviewer is the blocking reviewer for the initial gate. The
secondary result is included if it completes before aggregation, reconciled
before precommit if it arrives in time, and handled through the degradation
matrix on failure or timeout. A late P0/P1 reopens the fix → review loop.

## Step 4: aggregate

Apply `references/review-common.md`'s Dual Reviewer Aggregation rules for
severity mapping, normalization, deduplication, source attribution, sorting,
degradation, and the gate decision.

## Step 4.5: emit the gate

Run one of:

```bash
bash scripts/emit-review-gate.sh READY
bash scripts/emit-review-gate.sh BLOCKED
```

The final report ends with `✅ Ready` when no P0/P1 remains, or `⛔ Blocked`
when a P0/P1 remains. The emitted state and report must agree.
