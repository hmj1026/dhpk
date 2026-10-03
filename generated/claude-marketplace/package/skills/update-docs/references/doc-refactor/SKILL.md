---
name: doc-refactor
argument-hint: '<file-path>'
description: 'Use when refactoring one bounded Markdown document while preserving its facts, policy, frontmatter, and route semantics. Not for cross-file policy changes, generated projections, or broad documentation audits. Output: the refactored path, line-count comparison, preserved-fact summary, and PASS, NOT_RUN, or BLOCKED validation.'
allowed-tools: 'Read, Grep, Glob, Edit, Bash'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Bounded document refactor

Refactor only the Markdown file supplied in `$ARGUMENTS`. Keep policy, source
semantics, frontmatter, invocation class, route boundaries, and every recorded
fact. This is a structural documentation edit, not a new policy decision.

`$PROJECT_DIR` denotes the consumer project root in path examples. It is
notation for that root, not a required ambient environment variable. The file
supplied in `$ARGUMENTS` is the consumer target; repository guidance is an
optional consumer input when a step says it is present.

## When NOT to Use

- More than one document or a shared policy is changing: use its owning
  documentation workflow.
- The target is generated, missing, not Markdown, or unsafe to rewrite: stop
  and report `BLOCKED` without editing it.
- The request is a broad documentation audit or a link/frontmatter verdict:
  use a read-only review workflow.

## Workflow

1. **Map the document.** Confirm the path, read the complete file, and record
   its original line count. Classify it as agent guidance, skill, command, rule,
   reference, specification, changelog, or human-facing guide. Record the
   primary path, branch-only reference, context pointers, SSOT links, and every
   fact that must survive. Completion means the fact and dependency list is
   written in the working notes before editing.
2. **Refactor the hierarchy.** Keep the primary steps in the target. Disclose
   branch-only mechanics behind a precise pointer to an existing, resolvable
   reference; do not invent a checkout-relative resource. Remove no-op,
   duplicate, stale, and environment-cache prose. Use a table for repeated
   mappings and a flow/sequence diagram only when it materially improves
   comprehension. Keep each definition, rule, and caveat co-located.
3. **Preserve the boundary.** Retain frontmatter, invocation class, command
   flags, routes, tool/model support, precedence, and source semantics. Do not
   broaden the target or turn a plan into an applied implementation. Every
   step must end with an observable, exhaustive completion condition.
4. **Validate the output.** Run the repository’s available Markdownlint command
   on the target, check every changed link and referenced file, then reread the
   primary path, pointers, completion conditions, frontmatter, and preserved
   facts. If a check is unavailable, record `NOT_RUN` and why; do not call it a
   pass. Leave the target unchanged when mapping or safety gates fail.

Keep repository size guidance visible when it applies:

| File type | Target lines |
| --- | ---: |
| `CLAUDE.md` | `< 50` |
| `rules/*.md` | `< 30` |
| `agents/*.md` | `< 50` |
| `commands/*.md` | `< 40` |

## Output

Return:

```markdown
## Refactoring Result

- Input: <path>
- Output: <path>
- Original: X lines
- Simplified: Y lines (-Z%)
- Validation: PASS | NOT_RUN | BLOCKED

## Changes

- <summary>

## Preserved Facts

- <fact or pointer/SSOT dependency>
```

A shorter file is evidence, not a requirement. Report the exact blocker when
the target is generated, unsafe, unreadable, or fails validation. `PASS` means
all requested checks ran and the recorded boundary survived; `NOT_RUN` is not
`PASS`.

## Verification

- [ ] Input classification, line count, fact list, pointers, and SSOT
      dependencies were recorded before editing.
- [ ] Only the bounded target changed and its policy, route, invocation, flags,
      frontmatter, and source semantics are preserved.
- [ ] Primary steps remain local; any disclosed reference resolves and no
      dangling checkout-relative link was introduced.
- [ ] Markdownlint and link/reference checks are `PASS`, or each unavailable
      check is explicitly `NOT_RUN` with a reason.
- [ ] Output reports original/simplified counts, preserved facts, and one
      terminal validation state.

## References

- Native reads/searches (`Read`, `rg`, `find`, `ls`, `sed`) and the host’s
  Markdownlint command are the portable inspection tools.
- The consumer guidance files
  `$PROJECT_DIR/docs/agent-guidance/writing-for-agents.md` and
  `$PROJECT_DIR/docs/agent-guidance/command-contract.md`, when present, are
  policy owners; this skill keeps their pointer, hierarchy, completion, pruning,
  and boundary checks local so a consumer without those files can still run it.
