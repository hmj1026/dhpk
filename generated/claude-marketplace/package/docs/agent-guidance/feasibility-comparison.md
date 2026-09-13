# Feasibility comparison handoff

Use this note when a feasibility request must hand off to the external
`dhpk-module-design` comparison capability. The handoff preserves the useful
parts of the retired feasibility workflow: quantified alternatives,
independent evidence, and an explicit recommendation boundary.

Invoke the external owner with a concrete comparison request, for example:

```text
$dhpk-module-design --mode compare "<question>"
```

Attach this packet when the comparison needs repository context or a second
opinion. Do not turn the packet into an implementation plan.

## Required input packet

Provide:

1. problem essence and measurable success criteria;
2. technical, business, resource, and compatibility constraints, each marked
   fixed or flexible;
3. relevant existing modules, reusable patterns, and evidence paths;
4. at least two materially different options (three for a broad change);
5. comparison dimensions and any hard vetoes;
6. the requested independent-comparison path, or an explicit primary-only
   decision.

## Quantified option record

For every option, record the implementation path and this same table:

| Dimension | Green | Yellow | Red |
| --- | --- | --- | --- |
| Technical feasibility | existing pattern, direct use | adaptation required | major innovation or unknown |
| Effort | `< 3` person-days | `3–10` person-days | `> 10` person-days |
| Risk | small, bounded scope | known uncertainty | many unresolved unknowns |
| Extensibility | easy to extend | refactoring likely | hard to extend safely |
| Maintenance cost | clean and local | added complexity | complex or opaque |

Use numbers where possible: person-days, touched modules, migration hops,
runtime or storage limits, test cells, and known dependency changes. Explain
each rating with evidence or an assumption. Do not compare options using
confidence alone.

## Independent comparison contract

The primary analysis and independent comparison are separate evidence streams.
Use a fresh, read-only context with this self-contained prompt:

```text
# Independent feasibility comparison
Requirement: <problem and success criteria>
Constraints: <fixed and flexible constraints>
Options: <option descriptions and quantified assessments>

Evaluate each option independently. Check feasibility, effort, risk,
extensibility, maintenance cost, assumptions, and open questions. Do not
assume a prior recommendation. Return evidence and a bounded recommendation.
```

Keep the first analysis's recommendation out of the blind prompt. Record one
of these outcomes:

| Outcome | Required wording/evidence |
| --- | --- |
| Reviewer ran | reviewer identity/path, prompt boundary, result, and disagreements |
| Reviewer failed | failure and fallback; failure is not feasibility evidence |
| Not requested | `Degraded — only the primary model's comparison is present; no independent review ran.` |

An explicit `--second-opinion=codex-exec` is additive and opt-in. If it is not
selected or available, retain the degraded state rather than implying a second
perspective. If the reviewer overturns a premise, reopen the affected design
decision instead of silently adopting it.

## Output and decision boundary

Return one side-by-side table, the recommended option, a backup option and its
trigger, trade-offs, assumptions, open questions, and the independent evidence
record. The external architecture skill owns the final comparison language;
this packet owns completeness of inputs and honesty of the evidence state.

Before handing off, verify:

- at least two options have comparable quantitative records;
- constraints and success criteria are explicit;
- repository reuse and tech debt are evidenced;
- independent review is recorded as ran, failed, or not requested;
- recommendation and backup are bounded by stated conditions;
- no implementation, commit, deployment, or release claim is smuggled into
  the feasibility result.

Current owner: `skills/dhpk-module-design/SKILL.md`. The retirement mapping and
rollback boundary for the former feasibility skill are recorded in
`docs/skill-platform-migration.md`; this document retains its quantified and
independent-comparison requirements without depending on deleted sources.
