---
description: 'Deep-dive analysis of an initial proposal — research code implementation, produce an actionable roadmap and alternatives'
argument-hint: '<initial proposal description or file path>'
allowed-tools: 'Read, Grep, Glob, Bash(git:*), Bash(node:*), Write'
metadata:
  dhpk-invocation-class: implicit-eligible
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/dhpk-tech-spec/SKILL.md

## Contract

Use for proposal-to-roadmap analysis; not for applying an already approved
change. See the [command contract](../docs/agent-guidance/command-contract.md).
Stop when the proposal or repository cannot be read; completion reports
verified assumptions, roadmap, alternatives, and unresolved risks.

## Context

- Project root: !`git rev-parse --show-toplevel`
- Recent changes: !`git diff --name-only HEAD~5 2>/dev/null | head -10`

## Task

You are now a `solution-architect` expert. Perform a deep analysis of the following initial proposal:

### Input

```
$ARGUMENTS
```

### Analysis Flow

#### Phase 1: Understand & Validate

1. Extract the core objectives of the initial proposal
2. Identify key assumptions (which may be wrong)
3. List technical points that need verification

#### Phase 2: Code Deep Dive

Research the existing codebase thoroughly:

```bash
SOURCE_ROOT="${SOURCE_ROOT:-.}"

# Find related implementations under the detected source root
grep -r "keyword" "$SOURCE_ROOT"/ --include="*.ts" -l | head -10

# Check similar features
ls "$SOURCE_ROOT"/service/ "$SOURCE_ROOT"/provider/

# Analyze specific implementation
cat "$SOURCE_ROOT"/service/similar.service.ts | head -100
```

**Must verify**:

- Naming conventions (camelCase/snake_case? prefixes?)
- DI injection patterns (@Inject/@InjectModel?)
- Error handling patterns (throw/return?)
- Implementation patterns of similar features

#### Phase 3: Roadmap Output

Based on the research, produce:

1. Implementation steps (immediately actionable)
2. Key pseudocode (**only core 1-3 lines, omit if not necessary**)
3. Alternative comparison

## Output

````markdown
# [Proposal Name] Implementation Roadmap

## Proposal Validation

| Assumption | Verification Result | Impact |
| ---------- | ------------------- | ------ |

## Code Research Summary

| Module | Existing Implementation | Reusable |
| ------ | ----------------------- | -------- |

## Implementation Roadmap

```mermaid
flowchart LR
    A[Step 1] --> B[Step 2] --> C[Step 3]
```
````

### Step 1: [Title]

**Objective**: One sentence
**Files**: `<source-root>/xxx.ts` (modify/create)

**Pseudocode** (only when necessary, 1-3 lines):

```typescript
// Reference: <source-root>/xxx.ts:50
await this.cache.set(key, data, TTL);
```

### Step 2: ...

## Alternatives

### Option B: [Name]

| Dimension  | Option A (Recommended) | Option B |
| ---------- | ---------------------- | -------- |
| Complexity |                        |          |
| Risk       |                        |          |

**Recommendation**: ...

## Risks & Mitigations

| Risk | Probability | Mitigation |
| ---- | ----------- | ---------- |

## Immediate Actions

1. [ ] First task
2. [ ] Second task

````

## Examples

```bash
# Analyze from description
/deep-analyze "Initial idea: use Redis to cache token prices with TTL 5 minutes"

# Analyze from file
/deep-analyze docs/features/xxx/tech-spec.md

# Analyze from request doc
/deep-analyze docs/features/xxx/requests/2026-01-20-xxx.md
````
