---
name: dhpk-tech-spec
description: 'Tech spec generation and review. Use when: designing features, writing specs, spec review. Not for: requirements analysis (use /dhpk:deep-analyze), implementation (use dhpk-feature-dev), architecture advice (use dhpk-codex-architect). Output: numbered tech spec document.'
allowed-tools: 'Read, Grep, Glob, Bash(git:*), Write'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Tech Spec Skill

Use `dhpk-module-design` for the shared module/interface/seam vocabulary and
place testing decisions at the highest existing public seam. This skill owns
the numbered spec; it does not restate architecture mechanics.

## When NOT to Use

- Creating request documents (use /dhpk:dhpk-create-request)
- Code implementation (use feature-dev)
- Architecture consulting (use /dhpk:dhpk-codex-architect)

## Commands

| Command         | Purpose              | When                    |
| --------------- | -------------------- | ----------------------- |
| `/dhpk:dhpk-tech-spec`    | Create or update tech spec | Auto-detects create/update from filesystem state |
| `/deep-analyze` | Deepen spec + roadmap | After initial concept   |
| `/review-spec`  | Review tech spec     | Spec confirmation       |

## Context-Aware Mode (Upsert)

When invoked without a full requirement description, the skill auto-detects the target feature using the 5-level cascade from `references/feature-context-resolution.md`.

| Filesystem State | Action |
|-----------------|--------|
| `docs/features/<key>/2-tech-spec.md` exists | **Update mode**: read existing spec, research code changes since last update, incrementally update changed sections |
| `docs/features/<key>/2-tech-spec.md` absent | **Create mode**: generate new spec from template |
| Feature not resolved | Gate: Need Human |

In **update mode**, focus on sections affected by recent code changes (use `git diff` to identify). Preserve unchanged sections.

## Workflow

```mermaid
sequenceDiagram
    participant A as Analyst
    participant C as Codebase
    participant D as Document

    A->>A: 1. Requirement clarification
    A->>C: 2. Code research
    C-->>A: Related modules
    A->>A: 3. Solution design
    A->>A: 4. Risk assessment
    A->>A: 5. Work breakdown
    A->>D: 6. Output document
```

## Spec Structure

1. Requirement summary (problem + goals + scope)
2. Existing code analysis
3. Technical solution (architecture + data model + API + core logic)
4. Risks and dependencies
5. Work breakdown
6. Testing strategy
7. Open questions

## Output

Numbered tech spec document with sections: Overview, Requirements, Architecture, Implementation plan, Work breakdown, Testing strategy, Open questions.

## Verification

- Solution covers all requirement points
- Testing decisions name the public seam and an independent expected result.
- Architecture diagrams use Mermaid
- Risks have mitigation strategies
- Work can be broken into trackable items

## References

- `references/template.md` - Spec template + review dimensions

## File Location

```
docs/features/{feature}/
├── 2-tech-spec.md    # Technical spec (numbered per docs-numbering rule)
├── requests/         # Request documents
└── README.md         # Feature description
```

## Examples

```
Input: /dhpk:dhpk-tech-spec "Implement user asset snapshot feature"
Action: Requirement clarification -> Code research -> Solution design -> Output document
```

```
Input: /review-spec docs/features/xxx/2-tech-spec.md
Action: Read -> Research -> Review -> Output report + Gate
```
