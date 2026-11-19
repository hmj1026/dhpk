# Problem Classification Detailed Guide

## Classification Dimensions

| Dimension       | Criteria                        | Example                                    |
| --------------- | ------------------------------- | ------------------------------------------ |
| Temporality     | Previously normal vs always so  | "Broke after update" vs "Always like this"  |
| Certainty       | Reproducible vs intermittent    | "Every time" vs "Sometimes"                |
| Error Type      | Has stack trace vs logic error  | TypeError vs incorrect return value         |
| Complexity      | Single module vs cross-module   | Within Service vs inter-Service interaction |
| Possible Causes | Clear vs multiple possibilities | "null pointer" vs "performance issue"       |

## Classification Matrix

| Temporality    | Certainty    | Complexity | Strategy                                 |
| -------------- | ------------ | ---------- | ---------------------------------------- |
| Regression     | Reproducible | Low        | `code-trace`                       |
| Regression     | Reproducible | High       | `code-trace` + `code-trace --dual` |
| Regression     | Intermittent | -          | `code-trace --dual`                      |
| Always existed | Reproducible | Low        | `code-trace`                          |
| Always existed | Reproducible | High       | `code-trace --dual`                      |
| Always existed | Intermittent | -          | `module-design --mode adversarial`    |
| Uncertain      | -            | -          | `code-trace` first                    |

## Keyword Triggers

### Regression analysis -> `code-trace`

- "It used to work" "after update" "it was fine last time" "regression"
- "When did it break" "who changed it" "which commit"

### Code-flow exploration -> `code-trace`

- "How does this feature work" "what does this code do" "what's the flow"
- "Don't know where it is" "how to trace"

### -> `code-trace --dual`

- "Need confirmation" "somewhat complex" "unsure of the cause"
- "Intermittent" "sometimes happens" "random"

### -> `module-design --mode adversarial`

- "Many possible causes" "how to determine" "exhaust possibilities"
- "What are the possibilities" "not sure what the problem is"

## Composite Strategy

When the problem is complex, combine strategies:

```
1. code-trace -> Establish baseline understanding first
2. code-trace -> If regression is suspected
3. code-trace --dual -> When dual confirmation is needed
4. module-design --mode adversarial -> Exhaust all possible causes
```

## Review Thread Classification

When input is a PR review thread (not a GitHub Issue), use these dimensions instead:

| Dimension | Values | Description |
|-----------|--------|-------------|
| Category | `code_change` / `doc_update` / `question` / `disagree` / `nit` | Semantic type of the reviewer's comment |
| Complexity | Low / High | Scope of suggested change |
| Actionability | ACTIONABLE / NON_ACTIONABLE / UNCERTAIN | From Phase 2.5 independent verdict |

### Review Thread Category Mapping

| Category | Description | Priority | Default Action |
|----------|-------------|----------|----------------|
| `code_change` | Code modification suggestion | 1 | Fix in editor |
| `doc_update` | Documentation/comment update | 2 | Update docs |
| `question` | Question needing explanation | 3 | Reply with explanation |
| `disagree` | Design disagreement | 4 | Discuss (AskUserQuestion) |
| `nit` | Style/naming nitpick | 5 | Optional fix |

### Review Thread vs GitHub Issue Decision

| Signal | → GitHub Issue path | → Review Thread path |
|--------|--------------------|--------------------|
| Has issue number/URL | Yes | No |
| Has file:line + reviewer comment | No | Yes |
| Has labels/milestones | Yes | No |
| Comes from `change-verdict --mode pr` | No | Yes |

## Escalation Path

```
Initial investigation insufficient -> Escalate strategy

code-trace cannot find cause
    -> Escalate to code-trace --dual (add isolated perspective)

code-trace found commit but cause unclear
    -> Combine with code-trace (understand change logic)

code-trace --dual views diverge
    -> Escalate to module-design --mode adversarial (bounded debate)
```
