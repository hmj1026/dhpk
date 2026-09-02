---
name: dhpk-feasibility-study
description: "Feasibility analysis from first principles. Purpose: evaluate solutions before dhpk-tech-spec, compare approaches, or assess risk. Not for: implementation (use dhpk-adaptive-dev-workflow in feature mode), architecture advice (use dhpk-module-design). Output: quantitative comparison + recommendation."
metadata:
  dhpk-invocation-class: "explicit-only"
---

# Feasibility Study Skill

## Supplementary Agent

The current model owns the primary feasibility analysis. For each solution
option, dispatch a fresh, isolated read-only background exploration so the
option evidence is independently collected:

Agent({
  description: "Explore feasibility of solution option",
  subagent_type: "general-purpose",
  prompt: `Research the feasibility of: <solution description>
Evaluate technical feasibility, effort, risk, extensibility, and maintenance cost.`
})

## When NOT to Use

- Already have a tech spec (use `/deep-analyze`)
- Need implementation, not analysis (use `/dhpk:dhpk-implement`)
- Quick question (use `/dhpk:dhpk-codebase-exploration --explain` or `/dhpk:dhpk-module-design`)

## Workflow

```
Decompose → Constraints → Code research → Solutions → Independent comparison → Decision → Report
```

### Phase 1: Requirement Decomposition

**Input source priority**:
1. If `canonical_docs.requirements` is non-null → consume as authoritative requirement source, validate via 5-Why
2. Otherwise → extract requirements from user input via 5-Why analysis

Use "5 Why" to uncover essence:
1. Surface requirement (what user asks for)
2. Underlying problem (why they need it)
3. Success criteria (quantifiable acceptance)

### Phase 2: Constraint Analysis

Inventory constraints by type (Technical, Business, Resource, Compatibility) with flexibility rating.

### Phase 3: Code Research

Research existing codebase:
- Related modules and reusable logic
- Existing design patterns
- Tech debt to work around

### Phase 4: Solution Exploration

Brainstorm 2-3+ solutions, each with:
1. Core idea (one sentence)
2. Implementation path
3. Quantified feasibility (see `references/analysis-phases.md`)
4. Cost and trade-offs

### Phase 5: Independent Comparison

The primary model compares the options first. An independent comparison is
explicitly requested when needed: use a fresh isolated subagent for the
independent critique, or select `--second-opinion=codex-exec` for a one-shot CLI
comparison. The CLI path is additive and opt-in. `--no-codex` remains a
supported primary-only option for callers that do not want a second opinion.

See `references/independent-comparison.md` for the comparison prompts and
evidence-record format. Do not claim an independent comparison when it did not
run.
If no second opinion is requested or available, mark the result
**degraded: primary model only** and state: "Only the primary model's comparison
is present; no independent review ran."

| Tool | Purpose | When |
|------|---------|------|
| Isolated general-purpose subagent | Independently enumerate and critique options | At start |
| Isolated general-purpose subagent | Evaluate design | After proposal forms |
| Explicit `--second-opinion=codex-exec` | Ask for an additional one-shot opinion | When requested |

### Phase 6: Comparative Decision

Side-by-side comparison → recommendation + backup + open questions.

## Evaluation Dimensions

| Dimension             | Green | Yellow | Red |
| --------------------- | ----- | ------ | --- |
| Technical Feasibility | Has existing patterns | Needs adaptation | Major innovation |
| Effort                | < 3 person-days | 3-10 person-days | > 10 person-days |
| Risk                  | Small scope | Some uncertainty | Many unknowns |
| Extensibility         | Easy to extend | Needs refactoring | Hard to extend |
| Maintenance Cost      | Clean, easy | Some complexity | Complex |

## Output

```markdown
## Feasibility Study: <title>
### Quantitative Comparison
| Criterion | Option A | Option B | Option C |
|-----------|----------|----------|----------|

### Recommendation
<selected option with rationale>
```

## Verification

- [ ] 5 Why decomposition completed
- [ ] Constraints inventoried with flexibility
- [ ] Existing code researched (grep/read)
- [ ] 2-3+ solutions explored with quantified assessment
- [ ] Independent comparison or an explicit degraded primary-only state documented
- [ ] Comparison table + recommendation + open questions

## References

- Analysis phases: `references/analysis-phases.md`
- Comparison prompts: `references/independent-comparison.md`
- Output template: `references/output-template.md`

## Relationship with Other Commands

```
/dhpk:dhpk-feasibility-study → /dhpk:dhpk-tech-spec → /deep-analyze → /dhpk:dhpk-implement
```

## Examples

```
Input: /dhpk:dhpk-feasibility-study "Add user quota management"
Action: 5 Why → constraints → code research → 3 solutions → independent comparison → recommendation

Input: /dhpk:dhpk-feasibility-study "Optimize cache" --context src/service/cache.ts
Action: Read cache code → constraints → solutions → isolated comparison → report
```
