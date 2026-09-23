---
name: project-brief
description: "Use when converting one readable technical specification into a PM or CTO executive brief. Not for editing the source specification or preserving implementation detail. Output: a saved executive-summary path and retained unresolved decisions."
metadata:
  dhpk-invocation-class: "implicit-eligible"
---

# Project brief

Convert one technical specification into a PM/CTO-readable executive summary.
The input path in `$ARGUMENTS` is read-only. Parse an optional `--output <path>`
without changing any other argument; when omitted, save beside the source with
the `-brief` suffix. Stop with `BLOCKED` when the source is missing or
unreadable, or when the requested output cannot be written.

`$PROJECT_DIR` denotes the consumer project root in path examples. It is
notation for that root, not a required ambient environment variable. The source
and any `--output` path are consumer project files; preserve the explicit output
path or the default beside-source path described above.

## When NOT to Use

- The source technical specification needs correction: edit it through its
  owning workflow first.
- The audience needs implementation-level detail, code analysis, or module
  names: return the technical specification instead.
- More than one source document or a broad documentation refresh is in scope:
  use a bounded documentation workflow.

## Workflow

1. **Read the source.** Resolve the path from `$ARGUMENTS`, record the source
   path, and read it completely. Extract the core value proposition. Preserve
   unresolved decisions instead of silently resolving them.
2. **Extract the business view.** Capture one sentence covering what, why, and
   value; compare current state with target; retain solution pros/cons and the
   recommendation; keep milestones, risks, dependencies, timeline, and
   resources.
3. **Simplify deliberately.** Remove code snippets, internal module names, and
   implementation detail. Keep a plain-language architecture overview with no
   more than three layers. Turn immediate actions into PM/CTO decision points.
4. **Write the brief.** Save to the explicit `--output` path or to the source
   directory using `<stem>-brief<extension>`. Do not modify the source file.

The conversion map is:

| Technical section | Executive treatment |
| --- | --- |
| Trust boundary diagram | Simplify to at most three architecture layers |
| Code analysis; reusable modules | Remove |
| System architecture; implementation roadmap | Keep in simplified form |
| Key design decisions | Remove implementation detail |
| Alternative comparison; risks and mitigations; timeline | Keep |
| Immediate actions | Simplify to decision points |

## Output

Write this Markdown shape, replacing placeholders with evidence from the
source:

````markdown
# [Project Name] Executive Summary

## Project Overview
> One sentence: what, why, and value

## Current State vs Target
| Dimension | Current | Target |
| --------- | ------- | ------ |
|           |         |        |

## Solution Evaluation
| Solution | Pros | Cons | Recommendation |
| -------- | ---- | ---- | -------------- |
| Option A |      |      |                |
| Option B |      |      |                |
| Recommended |   |      | ✅ Adopt       |

## Architecture Overview
(Simplified system diagram, three layers maximum)

## Milestones
| Week | Deliverable | Dependencies |
| ---- | ----------- | ------------ |
| Week 1 |         |              |

## Risk Summary
| Risk | Impact Level | Mitigation |
| ---- | ------------ | ---------- |
|      |              |            |

## Resource Requirements
- **Headcount**:
- **Timeline**:
- **External Dependencies**:

## Decision Points
> Items requiring PM/CTO decision
- [ ] Decision 1:
- [ ] Decision 2:
````

Return the saved output path and list decisions retained for review. A brief is
an applied documentation write, not evidence that the underlying proposal was
approved or implemented.

## Verification

- [ ] The source was readable and remains unchanged.
- [ ] The output exists at the requested or default path and is readable.
- [ ] Code snippets, internal module names, and unnecessary implementation
      details are absent.
- [ ] Business value, current/target state, alternatives, milestones, risks,
      resources, and decision points are present.
- [ ] Unresolved decisions are retained and the report names the output path.

## References

- Native file reads and writes are sufficient; use repository search only to
  clarify names that the source explicitly references.
- `$PROJECT_DIR/docs/agent-guidance/command-contract.md`, when present in the
  consumer checkout, provides the shared failure/output vocabulary; this skill
  keeps the required `BLOCKED` and output-path boundary locally.
