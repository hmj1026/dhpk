---
name: openspec-artifact-guard
description: Enforce OpenSpec artifact shape and detect specs-vs-spec-delta naming confusion and tasks.md ↔ git-log drift. Use when creating/editing files under `openspec/`, reviewing a PR that touches `openspec/`, or verifying a change before archive. Not for implementing the change or archiving it; use the dedicated OpenSpec workflow for those phases. Output: a check report with verdict, artifact evidence, and task/git alignment. Catches direct edits to `openspec/specs/` SSOT during an active change (should live in `openspec/changes/<slug>/specs/` with delta markers); spec-delta files missing ADDED/MODIFIED/REMOVED markers (silent no-op on archive); tasks.md checkboxes drifting from git-log evidence; camelCase / under_score slugs that break tool derivation. Companion to the broader `openspec-verify-change` workflow — this is the fast safety net during edits.
---

# OpenSpec artifact guard

OpenSpec's directory shapes are easy to mis-name. The most expensive
mistake — editing `openspec/specs/` directly during an active change — is
also the most invisible: nothing throws, the file commits cleanly, and the
delta-merge step on archive silently does nothing because the SSOT already
matches.

This skill is the fast pre-archive guard. The deep verifier is
`openspec-verify-change` (different skill). Run this one whenever
`openspec/**` files are in the diff.

> Background reading: `modules/library-author/references/openspec-naming-gotchas.md`

---

## When to run

- Editing any file under `openspec/`
- Reviewing a PR whose diff touches `openspec/`
- Before invoking `openspec:archive` on a change (last-line safety net)
- After mass-rename in the openspec tree (slug normalization)

## When NOT to Use

- Editing source code that has nothing to do with the spec
- Running `openspec:verify` already (it covers a superset of these checks)

---

## Inputs

The diff under `openspec/` (or, if no diff, the current working tree state):

```bash
git diff --name-only -- openspec/
# or, if no diff:
find openspec/ -type f -name '*.md' -newer openspec/project.md 2>/dev/null
```

Also read `openspec/changes/*/` directory shapes (regardless of diff).

---

## Checks

### Check 1 — Direct SSOT edit during active change (CRITICAL)

Find files matching `openspec/specs/**` in the diff that are NOT in an
archive commit.

```bash
git diff --name-only | grep -E '^openspec/specs/[^/]+/'
```

A new file or modified file here is **suspect**. The only legitimate way
to update `openspec/specs/` is through `openspec:archive` which applies
delta directives from `openspec/changes/<slug>/specs/` to the SSOT.

**Confirm legitimacy by:**
- The commit message contains `archive` AND
- The same commit touches `openspec/changes/.archive/<slug>/` or
  `openspec/changes/archive/<slug>/`

If both conditions are met → APPROVE.
Otherwise → CRITICAL: redirect the edit to
`openspec/changes/<current-change>/specs/<capability>/spec.md` with
delta markers.

### Check 2 — Spec-delta missing directive markers (CRITICAL)

For every file matching `openspec/changes/*/specs/**/spec.md`:

```bash
grep -lE '^## (ADDED|MODIFIED|REMOVED) Requirements' <file>
```

A spec-delta with no `## ADDED Requirements` / `## MODIFIED Requirements`
/ `## REMOVED Requirements` heading is indistinguishable from an SSOT
spec. On archive, no delta directives → no SSOT mutation → silent no-op.

**Fix:** the writer must declare each requirement under the appropriate
directive. The mechanical fix is to prefix existing `## Requirements`
with `ADDED` (or whichever matches intent).

### Check 3 — Required artifacts present (HIGH)

For every directory `openspec/changes/<slug>/`:

```bash
test -f openspec/changes/<slug>/proposal.md || echo "MISSING proposal.md"
test -f openspec/changes/<slug>/tasks.md    || echo "MISSING tasks.md"
test -d openspec/changes/<slug>/specs/      || echo "MISSING specs/ dir"
```

`design.md` is optional and skipped from this check.

### Check 4 — tasks.md vs git log drift (HIGH)

For each active change:

```bash
slug="$(basename "$change_dir")"
# Count unchecked items in tasks.md
unchecked="$(grep -cE '^\s*-\s*\[ \]' openspec/changes/$slug/tasks.md)"
# Count commits in this branch that reference the slug
commits="$(git log --grep="$slug" --oneline | wc -l)"
```

If `commits` is **substantial** (≥ 3) but `unchecked` is still high, the
tasks.md is drifting from actual progress. Flag as HIGH and quote the
3 most recent slug-referencing commits.

This check is heuristic — false positives are possible if commit messages
don't reference the slug. Report as suggestion ("review whether these
commits closed any open tasks"), not assertion.

### Check 5 — Slug normalization (MEDIUM)

```bash
for dir in openspec/changes/*/; do
    slug="$(basename "$dir")"
    if echo "$slug" | grep -qE '[A-Z_]'; then
        echo "MEDIUM: non-kebab slug '$slug' (use lowercase + hyphens)"
    fi
done
```

Skip `openspec/changes/archive/` and `openspec/changes/.archive/`.

### Check 6 — proposal.md capability references (HIGH)

For each `proposal.md`, extract referenced capability IDs (look for lines
like `- **<capability-id>**:` or `capability: <id>`). For each ID, verify
either:
- `openspec/specs/<id>/spec.md` exists (capability already in SSOT — change
  is modifying it), OR
- `openspec/changes/<slug>/specs/<id>/spec.md` exists with `ADDED`
  directives (change is creating it)

A referenced capability with neither presence → HIGH: the proposal cites a
capability that doesn't exist anywhere.

---

## Output

```
[CRITICAL|HIGH|MEDIUM|LOW] <check-name>
File: openspec/<path>
Issue: <one-line description>
Fix: <one-line recommendation, often with exact command>
```

End with:
```
Verdict: APPROVE | WARNING | BLOCK
```
- APPROVE = no CRITICAL/HIGH
- WARNING = HIGH only
- BLOCK = any CRITICAL

If no findings, output one line:
```
APPROVE: openspec/ shape is valid. <N> change(s) checked.
```

---

## Verification

- [ ] All six checks ran against the current `openspec/` diff (or working tree).
- [ ] No `openspec/specs/` SSOT edit outside an archive commit (Check 1).
- [ ] Every spec-delta carries ADDED / MODIFIED / REMOVED markers (Check 2).
- [ ] Each active change has proposal.md, tasks.md, and specs/ (Check 3).
- [ ] Slugs are kebab-case (Check 5); proposal capability refs resolve (Check 6).
- [ ] Verdict emitted: APPROVE / WARNING / BLOCK.

---

## Common traps the guard catches

- **Writer "fixes" the SSOT directly because the change felt small** —
  Check 1 catches this. The fix is mechanical (move the diff under the
  change directory), but only if caught before merge.
- **Spec written without delta markers because the author copied an SSOT
  file as the template** — Check 2 catches this. The whole spec is well-
  formed but it's a no-op on archive.
- **`tasks.md` declared as done in a stand-up but never checked off** —
  Check 4 catches this. Reduces "what's left on this change?" ambiguity.
- **`camelCase` slug from a quick `mkdir`** — Check 5 catches this. Tool
  slug derivation typically splits on hyphens; a camel slug becomes one
  giant token.

---

## Related skills

- `openspec-verify-change` — full pre-archive verifier (this skill is the fast subset)
- `openspec-archive-change` — applies delta directives to SSOT
- `openspec-sync-specs` — manual delta merge without archiving
