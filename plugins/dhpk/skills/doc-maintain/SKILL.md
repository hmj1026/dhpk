---
name: doc-maintain
description: 'Maintain documentation through stale-doc refresh, architecture codemap generation, or a bounded Markdown refactor. Selects update, codemap, or refactor while preserving each output and evidence contract. Not for application source, tests, manifests, route tables, generated projections, or broad policy review.'
argument-hint: '<task | mode> <target>'
allowed-tools: 'Read, Write, Edit, Grep, Glob, Bash'
metadata:
  dhpk-capability-id: dhpk.skill.doc-maintain
  dhpk-name-style: portable-family
  dhpk-invocation-class: implicit-eligible
  dhpk-modes: "[\"update\",\"codemap\",\"refactor\"]"
  dhpk-next: "{\"PASS\":\"none\",\"FAIL\":\"none\",\"BLOCKED\":\"none\",\"NOT_RUN\":\"none\",\"UNAVAILABLE\":\"none\",\"update:PASS\":\"git-smart-commit\"}"
---

# Documentation maintenance

1. Select the mode from the requested output below. A command's fixed mode or
   explicit mode wins; clarify ambiguous target ownership before editing.
2. Resolve the remaining normalized arguments as that mode's consumer input.
   Record the target, existing dirty work, canonical evidence and any locale pair.
3. Load only the selected mode procedure and apply its local completion gates.
4. Return its report with the actual PASS, NOT_RUN, BLOCKED or human-decision
   state. Keep source implementation, installation and release evidence separate.

| Mode | Task and input | Procedure | Output and authority |
| --- | --- | --- | --- |
| update | Stale documentation path or workflow keyword | [update](references/update.md) | Documentation update report; PASS/NOT_RUN/BLOCKED/Need Human; documentation only |
| codemap | Structural change or architecture refresh of live consumer tree | [codemap](references/codemap.md) | Five CODEMAPS documents and codemap-diff report; PASS/BLOCKED/confirmation-required; preserve the 30% overwrite gate |
| refactor | One existing, safe Markdown path | [refactor](references/refactor.md) | Refactored path, before/after line counts, preserved facts; PASS/NOT_RUN/BLOCKED |

Authority is documentation-only: application source, tests, manifests, route
tables and generated runtime projections belong to their respective owners.
An update does not refresh codemaps or refactor an unrelated file. A refactor
retains facts and policy; a codemap refresh keeps its output-path restrictions.
