---
description: 'Refactor documents — simplify without losing information, visualize flows with sequenceDiagram.'
argument-hint: '<file path>'
allowed-tools: 'Read, Grep, Glob, Edit'
metadata:
  dhpk-invocation-class: implicit-eligible
---

## Contract

Use for a bounded documentation refactor; not for changing policy or source
semantics. See the [command contract](../docs/agent-guidance/command-contract.md).
Stop when the input is missing or unsafe to rewrite; completion reports the
preserved facts, output path, and before/after line counts.

## Task

For the file specified by `$ARGUMENTS`:

1. **Analyze original content**

   - Count lines
   - Identify core information vs redundancy

2. **Refactor**

   - Long paragraphs -> tables
   - Steps -> sequenceDiagram
   - Duplicates -> single source

3. **Validate**
   - Key information preserved
   - Line count reduced

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

- Original: X lines
- Simplified: Y lines (-Z%)

## Changes

- <summary>
```
