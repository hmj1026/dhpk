---
description: 'Refactor one bounded Markdown document without losing information; disclose branch-only reference and visualize relationships only when it improves comprehension.'
argument-hint: '<file path>'
allowed-tools: 'Read, Grep, Glob, Edit'
metadata:
  dhpk-invocation-class: implicit-eligible
---

## Contract

Use for one bounded Markdown document. Preserve policy, source semantics,
frontmatter, invocation class, and route boundaries. Use the
[command contract](../docs/agent-guidance/command-contract.md) for invocation,
failure, and output rules.

Do not use this command for cross-file policy changes, generated projections,
or a broad documentation audit. Stop when the input is missing, generated, or
unsafe to rewrite; report the blocker and leave the file unchanged.

## Task

For the file specified by `$ARGUMENTS`:

1. **Map the document**

   - Record the input path and line count.
   - Classify the document: agent guidance, skill, command, rule, reference,
     specification, changelog, or human-facing guide.
   - Identify the primary path, branch-only reference, context pointers, SSOT
     links, and facts that must survive the refactor.
   - Completion: the fact list and any pointer/SSOT dependencies are recorded.

2. **Refactor the structure**

   - Put the primary steps in the file and disclose branch-only reference
     behind a precise pointer.
   - Remove no-op, duplicate, stale, and environment-cache prose.
   - Use a table for repeated mappings or comparisons.
   - Use a flow or sequence diagram only when the relationship is materially
     easier to understand visually than as a short list or table.
   - Keep each concept's definition, rules, and caveats co-located.
   - Keep every step's completion condition observable and exhaustive.
   - Completion: the refactored file preserves the recorded fact list and has
     no new policy, route, invocation, or source-semantic change.

3. **Validate**

   - Run Markdownlint on the output.
   - Check changed links and referenced files.
   - Re-read the primary path, pointers, completion conditions, and preserved
     facts.
   - A shorter file is useful evidence, not a requirement; keep a file at the
     same length when compression would hide required context.
   - Completion: validation passes, or every unavailable check is reported
     with its reason.

## Simplification Standards

| File Type      | Target Lines |
| -------------- | ------------ |
| CLAUDE.md      | < 50         |
| rules/\*.md    | < 30         |
| agents/\*.md   | < 50         |
| commands/\*.md | < 40         |

## Output

```markdown
## Refactoring Result

- Input: <path>
- Output: <path>
- Original: X lines
- Simplified: Y lines (-Z%)
- Validation: PASS | NOT_RUN | BLOCKED

## Changes

- <summary>
```
