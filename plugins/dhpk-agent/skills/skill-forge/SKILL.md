---
name: skill-forge
description: "Create or refactor an agent skill, or distill repeated principles into rules after explicit authoring or maintenance invocation. Not for: skill audits, searching only, one-off rule edits, slash commands, or application code review. Output: a validated skill package or an approval-ready rules candidate report."
metadata:
  dhpk-invocation-class: "explicit-only"
---

# Skill Forge

This is an explicit authoring gate. Choose `create` or `distill-rules` before
writing, keep the entrypoint lean, and leave unrelated repository surfaces
untouched.

Record invocation cost and context cost before loading branch references; use
progressive disclosure so the completed package remains checkable.

## When NOT to Use

- Audit one or many skills, or search for an existing skill → use `skill-scope`.
- Create a slash command → use `command-creator`.
- Review a code, pull request, security surface, test suite, or document → use
  `change-verdict`.
- Make a one-off rule edit without cross-skill evidence → edit the owning rule
  under its normal approval process.

## Mode selection

| Mode | Select when | Required result |
| --- | --- | --- |
| `create` | A reusable skill is missing or an existing package needs refactoring | A discoverable package with a lean entrypoint and routed references |
| `distill-rules` | Multiple skills express the same durable, cross-cutting behavior | A candidate report; rule edits require per-candidate approval |

## `create` workflow

1. Run the `skill-scope` `scout` mode first. Search local and marketplace
   sources before remote sources; record why a candidate is used, forked, or
   rejected. Done means duplication risk has a recorded disposition.
2. Decide create versus refactor from the target directory. Read the existing
   package before refactoring and preserve behavior unless the change is
   explicitly called out.
3. Write `SKILL.md` with exact package-name frontmatter, discriminating
   trigger and boundary wording, a short ordered workflow, an observable
   output, and verification. Use `writing-for-agents` for pointer, hierarchy,
   completion, leading-word, and pruning decisions.
4. Put branch-only procedures, schemas, examples, and deterministic helpers in
   `references/` or `scripts/`. Link each one from the entrypoint and state the
   condition that loads or runs it. Keep one meaning in one source of truth.
5. Run the health validator from `skill-scope`, then correct routing, reference,
   script, and frontmatter findings. Done means the package passes the focused
   validator and its output contract is testable.

## `distill-rules` workflow

1. Resolve the active rules and skill roots before collection. Run
   `scan-skills.sh`, then `scan-rules.sh`; retain their JSON and exit codes.
2. Cross-read the complete rules inventory and group skills by theme. Use
   `subagent-prompt.md` for the judgment schema; a candidate needs evidence from
   at least two skills, an actionable behavior, and a current-rule gap.
3. Merge duplicates across batches and classify each candidate as append,
   revise, new section, new file, already covered, or too specific. Use
   `results-schema.md` for persisted state and `end-to-end-example.md` for the
   expected report shape.
4. Present the candidate report before touching a rule. Apply only candidates
   the user explicitly approves; never infer approval from a general request to
   scan or improve rules.

## Output

For `create`:

```text
Target → scout disposition → package files → routing/output contract → validator result
```

For `distill-rules`:

```text
Inventory → candidates with 2+ evidence links → verdicts → approval state → next action
```

## Verification

- [ ] The explicit mode and target are recorded before any write.
- [ ] `scout` evidence or a justified no-match disposition is present for `create`.
- [ ] Entrypoint, references, scripts, and UI metadata use the same package name.
- [ ] `skill-lint.js` reports no P0/P1 findings for a created or refactored package.
- [ ] Rules candidates cite at least two skills, and no rule changed without per-candidate approval.
- [ ] The final report states changed files, command results, gate, and open risks.

## References

- `end-to-end-example.md` — use when shaping a complete rules-distillation report.
- `results-schema.md` — use when saving or resuming candidate evaluation state.
- `subagent-prompt.md` — use for the cross-read judgment prompt and candidate fields.

## Scripts

- `scan-skills.sh` — collect global and project consumer skills as JSON.
- `scan-rules.sh` — collect rule files and headings as JSON.
