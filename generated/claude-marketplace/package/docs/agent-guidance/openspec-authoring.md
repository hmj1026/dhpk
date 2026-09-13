# OpenSpec authoring handoff

Use this note when a request needs an OpenSpec proposal, design, delta spec,
or implementation task list. It preserves the durable contract previously
spread across the tech-spec and create-request skills; the external OpenSpec
authoring workflow remains the artifact owner.

## Deliverable boundary

Produce a decision-ready artifact set with one traceable chain:

```text
problem and goals → requirements → design → specs → tasks → acceptance evidence
```

Keep requirements, architecture, implementation tasks, and per-task progress
distinct. A request ticket is a work-breakdown unit, not a requirements or
architecture document. Put detailed API and pseudocode in the design/spec
artifact and link to it from the task.

## Authoring sequence

1. Resolve the feature context from an explicit path/key, branch, changed
   paths, or a single feature directory. Record the source and confidence;
   stop for human input when no feature can be resolved.
2. State the problem, goals, non-goals, constraints, and measurable success
   conditions. Use a short 5-Why pass when the request describes a solution
   but not the underlying problem.
3. Inspect the current code and documents before designing. Record reusable
   modules, public seams, files that need change, dependencies, and known
   debt. Prefer evidence (`path:line`, symbol, command) over an assertion.
4. Design the smallest coherent change: architecture boundary, data model,
   public API, core logic, error behavior, and migration/rollback path. Keep
   risks next to their mitigation and owner.
5. Assign stable requirement IDs (`REQ-1`, `REQ-2`, ...) and reference them
   from design decisions, spec scenarios, tasks, and acceptance criteria.
   Every requirement must end in an observable test or evidence item.
6. Split implementation into dependency-ordered tasks. Each task names its
   owned files, prerequisite, expected evidence, and the gate that closes it.
7. Run the focused public-seam tests first, then the relevant suite and
   repository checks. Update task progress from actual evidence; do not turn
   a heuristic or a documentation-only change into a completed implementation.

Completion criterion: every in-scope requirement maps to a design/spec
scenario, a task or an explicit no-code decision, and an acceptance result;
every unresolved question is visible in the handoff.

## Split before execution

Count the following signals after initial exploration:

| Signal | Count as |
| --- | ---: |
| More than 8 acceptance criteria, excluding review/precommit quality gates | 1 primary |
| Behavior/documentation and code/script layers mixed | 1 primary |
| Three or more independent functional areas | 1 primary |
| Two or more independent work-breakdown groups | 0.5 secondary |
| Estimated effort spans multiple medium/large items or exceeds 3 days | 0.5 secondary |

`split_score = primary_count + 0.5 × secondary_count`.

Score below 2: keep one request. Score 2 or higher: propose a split. Score 3
or higher: strongly recommend a split. Split by behavior/code layer first,
then by functional area, then balance acceptance criteria. Give each sibling
its own scope, related files, acceptance subset (target eight or fewer), and a
`Depends On` link when ordering matters.

## Traceability and acceptance

Use a compact matrix in the design or proposal:

| Requirement | Design/spec scenario | Task | Public seam / oracle | Evidence |
| --- | --- | --- | --- | --- |
| `REQ-1` | `Scenario: ...` | `T-1` | `command` or test | `PASS`, path:line, output |

Acceptance criteria are checkboxes only when they are observable and bounded.
Name the expected result, the public seam, and the command or fixture that
proves it. Use independent expected values/fixtures where behavior matters;
tests that only compare an implementation with itself are not evidence. Apply
the repository's coverage target where the project requires it, but report the
actual focused and suite counts rather than an unverified percentage.

Keep request status explicit:

- `Pending` — no implementation evidence.
- `In Progress` — some implementation or test evidence exists.
- `Candidate Complete` — all criteria appear checked but closure-grade
  verification is incomplete.
- `Completed` — every criterion has high-confidence verification evidence.

## Risk and decision records

For each material risk, record impact, likelihood or uncertainty, mitigation,
owner, and the gate that detects it. Separate open questions from assumptions;
do not hide a missing dependency behind a green local check. If an independent
review changes the premise or direction, update all proposal/design/spec/task
artifacts and sweep the old wording before review.

## Public test seams and evidence

Prefer the narrowest public contract that proves the behavior: a family-local
resolver/CLI, a documented command, a public API, or a user-visible artifact.
Test both the success and fail-closed paths, including malformed or ambiguous
input where routing is involved. A standalone copy probe should clear module
search paths and run from an empty project when portability is a requirement.

At completion, report:

- exact branch, commit/tree identity, and owned changed paths;
- RED/GREEN or focused test command, relevant-suite command, and exit status;
- static/spec/lint/review gates and their actual result;
- remaining `BLOCKED`, `NOT_RUN`, or `OPEN / NO-SHIP` boundaries;
- deployment, pilot, release, merge, and external-action evidence separately
  from local implementation evidence.

## Source pointers

- External `$openspec-propose` — proposal, design, delta-spec, and task
  authoring entry.
- `openspec/config.yaml` — project-local OpenSpec schema and conventions.
- `docs/agent-guidance/writing-for-agents.md` — durable agent-facing writing
  and verification contract.
- `docs/skill-platform-migration.md` — retirement mapping and rollback boundary
  for the former tech-spec and request skills.
