# Separate Public Workflows, Methods, and Project Conventions

Status: accepted

## Context

Issue #1084 found that portable skills mixed three kinds of content: the user
task a skill completes, the working method it applies, and dhpk's own delivery
habits (git flow, changelog, strict OpenSpec archive, `flow-guide close`, zsh).
The same task could therefore be routed through mutually exclusive procedures
depending on which document an agent read first, and dhpk's own conventions
leaked into consumer projects as if they were portable rules. Verification
results were also reused after later mutations such as `precommit`'s
`lint:fix`, and several Review Gate-era ADRs still read as accepted.

## Decision

Content is classified by what it owns. The terms are defined in
[`GLOSSARY.md`](../../GLOSSARY.md#skill-distribution).

- A **Public Workflow** owns a user's task outcome: a fixed bug, a verdict, a
  pull request, a roadmap.
- A **Method** owns only evidence that the method was applied: RED/GREEN
  records, a root-cause trace, a before/after simplification. It can be
  invoked directly or applied by a Public Workflow.
- A **Specialist Reference** supplies stack or version guidance and has no
  discovery entry of its own.
- A **Project Convention** belongs to the consumer project. A Public Workflow
  follows it and never supplies one.

Calls go one way only: a Public Workflow may apply Methods and Specialist
References, and a Method may consult Specialist References. A Method never
invokes a Public Workflow. `flow-guide` is optional navigation and is not an
implicit parent of any skill; no skill may require passing through it.

A Method invoked directly delivers its evidence and stops. It does not commit,
open a pull request, run Project Convention delivery steps, or claim the task
accepted.

Current classification:

| Kind | Skills |
| --- | --- |
| Method | `tdd-workflow`, `code-trace`, `code-simplify`, `dhpk-legacy-characterization-tests`, `module-design` |
| Public Workflow | `flow-drive`, `change-verdict`, `create-pr`, `precommit`, `repo-verify`, `proposal-analyze`, `release-creator`, and the remaining task entries |
| Specialist Reference | stack and version skills such as `laravel`, `php`, `nextjs`; their discovery surface is out of scope here |

The test for a borderline skill is whose outcome it delivers. `code-trace` can
be called alone to find a root cause, but it hands over evidence; whether and
how to fix belongs to a Public Workflow or the user.

**Evidence binds to a snapshot.** The kernel's
[Evidence snapshots](../../rules/execution-policy-kernel.md#evidence-snapshots)
rule owns validity, mutation ordering, and affected-scope reuse. Skills reference
it rather than restating it.

**Document status uses the existing ADR status line.** A replaced ADR reads
`Status: superseded by NNNN`, and the replacing ADR lists it under
`Supersedes`. Non-ADR design documents carry a one-line status at the top. No
validator or CI gate enforces this (#827, #970).

dhpk's own conventions stay in the repository's `AGENTS.md` and `rules/` for
developing dhpk itself. They are not part of what portable skills carry.

## Considered Options

- Calling Methods Public Workflows, because users can invoke them directly.
  Rejected: it hides that a Method never owns acceptance or delivery, which is
  exactly where hidden write authority came from.
- Folding Methods into Specialist Reference. Rejected: Specialist References
  have no discovery entry, so this would remove working entry points.
- Introducing a separate "task skill" term from the RFC. Rejected: Public
  Workflow already defines input, outcome, and authority boundary.

## Consequences

Three walkthroughs fix what each common task requires and what it may skip:

- **Ordinary bug.** The user calls `flow-drive`, which applies `tdd-workflow`
  and commits per the Project Convention. Required: a failing test, the fix,
  and verification on the final snapshot. Skippable: planner, reasoner,
  OpenSpec, ADR, and `flow-guide`.
- **Undecided design.** `module-design` (Method) or `proposal-analyze` (Public
  Workflow with a roadmap outcome) produces the decision without gaining write
  authority. Implementation starts in `flow-drive` only after the decision is
  confirmed.
- **Pull request preparation.** Apply the kernel's snapshot rule when
  `precommit` mutates files, then obtain the affected `repo-verify` or
  `change-verdict` evidence. `create-pr` takes its base branch from the Project
  Convention and does not assume `develop`.

ADRs 0011, 0012, 0013, and 0015 described the risk router, evidence receipts,
and typed-receipt lifecycle that 0026 removed; they are now marked superseded
by 0026.

Moving the Project Convention text that is currently bundled into skills is
follow-up work tracked under #1089. The kernel snapshot rule is implemented by
#1090. This ADR does not authorize follow-up edits by itself.
