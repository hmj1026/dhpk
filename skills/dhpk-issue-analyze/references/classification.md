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
| Regression     | Reproducible | Low        | `/dhpk:dhpk-git-history-investigation`                       |
| Regression     | Reproducible | High       | `/dhpk:dhpk-git-history-investigation` + `/dhpk:dhpk-codebase-exploration --dual` |
| Regression     | Intermittent | -          | `/dhpk:dhpk-codebase-exploration --dual`                      |
| Always existed | Reproducible | Low        | `/dhpk:dhpk-codebase-exploration`                          |
| Always existed | Reproducible | High       | `/dhpk:dhpk-codebase-exploration --dual`                      |
| Always existed | Intermittent | -          | `/dhpk:dhpk-module-design --mode adversarial`    |
| Uncertain      | -            | -          | `/dhpk:dhpk-codebase-exploration` first                    |

## Keyword Triggers

### -> `/dhpk:dhpk-git-history-investigation`

- "It used to work" "after update" "it was fine last time" "regression"
- "When did it break" "who changed it" "which commit"

### -> `/dhpk:dhpk-codebase-exploration`

- "How does this feature work" "what does this code do" "what's the flow"
- "Don't know where it is" "how to trace"

### -> `/dhpk:dhpk-codebase-exploration --dual`

- "Need confirmation" "somewhat complex" "unsure of the cause"
- "Intermittent" "sometimes happens" "random"

### -> `/dhpk:dhpk-module-design --mode adversarial`

- "Many possible causes" "how to determine" "exhaust possibilities"
- "What are the possibilities" "not sure what the problem is"

## Composite Strategy

When the problem is complex, combine strategies:

```
1. /dhpk:dhpk-codebase-exploration -> Establish baseline understanding first
2. /dhpk:dhpk-git-history-investigation -> If regression is suspected
3. /dhpk:dhpk-codebase-exploration --dual -> When dual confirmation is needed
4. /dhpk:dhpk-module-design --mode adversarial -> Exhaust all possible causes
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
| Comes from `/load-pr-review` | No | Yes |

## Escalation Path

```
Initial investigation insufficient -> Escalate strategy

/dhpk:dhpk-codebase-exploration cannot find cause
    -> Escalate to /dhpk:dhpk-codebase-exploration --dual (add isolated perspective)

/dhpk:dhpk-git-history-investigation found commit but cause unclear
    -> Combine with /dhpk:dhpk-codebase-exploration (understand change logic)

/dhpk:dhpk-codebase-exploration --dual views diverge
    -> Escalate to /dhpk:dhpk-module-design --mode adversarial (bounded debate)
```
