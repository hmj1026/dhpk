---
name: deep-analyze
description: "Deep-dive analysis of an initial proposal — research code implementation, produce an actionable roadmap and alternatives"
---
Before creating OpenSpec artifacts, use the external `$openspec-propose`
workflow. For this command's repository-specific authoring boundary, consult
[`docs/agent-guidance/openspec-authoring.md`](https://github.com/hmj1026/dhpk/blob/main/docs/agent-guidance/openspec-authoring.md).
This command only researches a proposal and produces an analysis; it does not
create or apply an OpenSpec change.

## Contract

Use for proposal-to-roadmap analysis; not for applying an already approved
change. See the [command contract](https://github.com/hmj1026/dhpk/blob/main/docs/agent-guidance/command-contract.md).
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
/deep-analyze docs/features/xxx/proposal.md

# Analyze from request doc
/deep-analyze openspec/changes/xxx/proposal.md
````
