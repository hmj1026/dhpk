# Routing Signature Guide

## Problem

The YAML `description` field is the **only** information Claude sees at Level 1 (always in context). If it reads like a generic summary, Claude cannot reliably decide whether to trigger the skill.

## Routing Signature Format

A compact routing signature encodes three cues in one description:

```
<What it does>. Use when: <triggers>. Not for: <exclusions>. Output: <deliverable>.
```

## Examples

### Before (generic summary)

```yaml
description: Portable code review. Supports fast, full, and branch variants.
```

### After (routing signature)

```yaml
description: "Portable code review. Use when: PR review, code audit, second opinion on changes. Not for: docs (use change-verdict docs), security (use change-verdict security), tests (use change-verdict tests). Output: severity-grouped findings + merge gate."
```

### More Examples

| Skill | Before | After |
|-------|--------|-------|
| flow-drive (implementation mode) | Feature development workflow. Covers implementation, verification, pre-commit checks. | Feature development workflow. Use when: implementing features, writing code, running dev loop. Not for: understanding code (use code-trace), reviewing code (use change-verdict). Output: implemented feature with tests + review gate. |
| flow-guide (classify mode) | Bug/Issue fix workflow. Investigate, locate, fix, test, review. | Bug classification workflow. Use when: classifying bugs, resolving issues, selecting a route. Not for: implementation (use flow-drive), understanding code (use code-trace). Output: workflow classification + next route. |
| tech-spec | Tech spec knowledge base. Full workflow from requirement analysis to spec output. | Tech spec generation and review. Use when: designing features, writing specs, reviewing specs. Not for: implementation (use flow-drive), architecture advice only (use module-design). Output: numbered tech spec document. |

## Checklist

When writing a routing signature:

- [ ] Description starts with what the skill does (1 sentence)
- [ ] "Use when" lists 2-4 concrete trigger scenarios
- [ ] "Not for" lists 2-3 common misroutes with redirects
- [ ] "Output" names the deliverable type
- [ ] Total length under 300 characters
- [ ] No overlap with sibling skills' triggers
