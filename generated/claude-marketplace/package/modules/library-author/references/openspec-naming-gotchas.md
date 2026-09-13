# OpenSpec naming gotchas

OpenSpec has two directory shapes that look identical at a glance but mean
different things. Mis-naming silently produces an artifact that never gets
merged into the SSOT specs, so the team thinks it's tracked when it isn't.

The `openspec-artifact-guard` skill enforces the distinctions below. This
file is the explanatory reference the skill links to when reporting a
mismatch.

---

## The two shapes

```
openspec/
├── specs/                          # SSOT — long-lived capability specs
│   └── <capability-id>/
│       └── spec.md
│
└── changes/<change-slug>/
    ├── proposal.md
    ├── tasks.md
    ├── design.md                   # optional
    └── specs/                      # spec-delta — short-lived diffs to SSOT
        └── <capability-id>/
            └── spec.md             # contains delta directives (ADDED/MODIFIED/REMOVED)
```

**Top-level `openspec/specs/`** = the project's current truth. Read-only
during a change; only updated when a change is **archived** (delta merged in).

**Inside-change `openspec/changes/*/specs/`** = the diff. Contains
"ADDED:" / "MODIFIED:" / "REMOVED:" markers that describe how the SSOT should
change when this change archives. **This is what people call "spec-delta"
even though the directory is named `specs/` too.**

---

## The gotcha

When asked to "add a spec for capability X", a writer might create:

```
openspec/specs/devkit-X/spec.md          # ← WRONG inside an active change
```

…which writes directly to the SSOT and bypasses the change-review workflow.
The correct shape during an active change is:

```
openspec/changes/<my-change>/specs/devkit-X/spec.md   # ← RIGHT
```

When the change archives, the delta directives are applied to the SSOT.

---

## Detection rules (for `openspec-artifact-guard`)

A finding is **CRITICAL** if any of:

1. A new file appears under `openspec/specs/**` in a commit that is NOT an
   archive commit (archive commits touch `openspec/changes/archive/**` or
   `openspec/changes/.archive/**`).
2. A change directory `openspec/changes/<slug>/` is missing `proposal.md` or
   `tasks.md`.
3. Inside-change `specs/<capability>/spec.md` files do NOT contain at least
   one of the delta markers: `## ADDED Requirements`, `## MODIFIED
   Requirements`, `## REMOVED Requirements`. (A spec-delta with no markers is
   indistinguishable from an SSOT spec — it will silently no-op on archive.)

A finding is **HIGH** if:

4. `tasks.md` has unchecked items but `git log --grep=<slug>` shows commits
   that imply the items were completed (e.g. commit mentions the task title).
   Drift means the docs lie about progress.
5. `proposal.md` references a capability ID that has no corresponding
   `specs/<capability-id>/spec.md` in EITHER the SSOT OR the change.

---

## The auto-derived slug rule

Many tools derive the change slug from the directory name. **Slugs must:**
- Use kebab-case ASCII
- Start with a verb when possible (`add-...`, `harden-...`, `migrate-...`)
- Not contain spaces, underscores, or capital letters

`openspec-artifact-guard` flags `openspec/changes/MyNewFeature/` (camel-case)
and `openspec/changes/feature_x/` (underscore) as MEDIUM findings.

---

## Reference incidents

- **devkit** keeps a CLAUDE.md note about this gotcha because a hand-edit
  to `openspec/specs/` once shipped without going through the change
  workflow. The fix was caught at archive time when the delta directives
  no-op'd because there was no SSOT entry to diff against.
- **devkit memory** `reference_openspec_workflow.md` (auto-memory) records
  the historical context.

---

## Quick reference card

| Task | Correct location |
|------|------------------|
| Document the current truth | `openspec/specs/<cap>/spec.md` (only via archive) |
| Propose a change | `openspec/changes/<slug>/proposal.md` |
| List tasks for a change | `openspec/changes/<slug>/tasks.md` |
| Describe spec delta | `openspec/changes/<slug>/specs/<cap>/spec.md` with `## ADDED/MODIFIED/REMOVED` markers |
| Optional design notes | `openspec/changes/<slug>/design.md` |

| Anti-pattern | Why wrong |
|--------------|-----------|
| Editing `openspec/specs/` directly | Bypasses change review |
| Delta file without ADDED/MODIFIED/REMOVED | Silent no-op on archive |
| `tasks.md` not updated post-commit | Drift between docs and reality |
| camelCase or `under_score` slug | Tool slug derivation breaks |
