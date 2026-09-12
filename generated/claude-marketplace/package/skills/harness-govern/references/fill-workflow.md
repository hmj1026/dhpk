# Fill mode

Fill is an explore-driven backfill for a project harness. It is appropriate
for a new team or a harness with real missing layers, not for a one-file edit.

## Invocation

```text
$harness-govern fill [--layers <list>] [--dry-run] [<task description>]
```

Resolve the active harness with `harness-directory-contract.md` before
inventory or layer selection. `--dry-run` previews all proposed files and
does not write them.

## Five phases

1. **Inventory.** Read the root instructions, actual layer files, representative
   agents/skills/rules, hooks, OpenSpec and build/CI entrypoints. Prefer
   `cx overview` then `cx definition`; use targeted reads for larger files.
   Record stack/version, execution and test commands, layers, high-risk zones,
   and existing harness gaps.
2. **Explore.** Dispatch at most three non-overlapping read-only explorers per
   round. Each scope names its files, tool priority, hard constraints,
   easy-to-mis-edit locations, suggested layer/skill/rule, and unknowns.
3. **Consolidate.** Re-check conflicting findings against source, remove
   duplicate or generic advice, and classify the result into root rules,
   layer rules, skills, rules, agents, and memory.
4. **Build.** Read `frontmatter-templates.md`; propose or apply only approved
   skills, agents, and rules. Keep each generated SKILL.md within 250 lines and
   preserve existing files incrementally. New agents/commands require their
   index and execution-policy synchronization in the owning harness.
5. **Write layers.** Update root or per-layer instructions only after checking
   symlink targets. Keep per-layer files focused and within their local line
   contract. Run targeted validation after each approved change.

## Dry-run and output

The default deliverable is an inventory and proposed file plan. `--dry-run`
must list planned paths, skipped paths, reasons, and estimated line counts with
zero writes. An approved apply lists created/modified files, line counts,
post-change checks, and a conventional commit message draft; it does not stage,
commit, push, or create a pull request.

```text
Active harness → baseline → explorer scopes → consolidated gaps →
planned/applied files → verification → PASS/FAIL/BLOCKED → next action
```

## Completion

Fill is complete when every observed gap is accepted, skipped with a reason, or
written and individually checked; all selected layers are represented; the
file list and line counts are present; and unknowns remain explicit. Read
`frontmatter-templates.md` only when Phase 4 creates or revises a product.
