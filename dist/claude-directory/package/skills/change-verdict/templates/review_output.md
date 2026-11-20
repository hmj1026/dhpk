# Read-only Verdict Template

## Change verdict: <mode>

- Fixed point: <resolved commit or supplied snapshot>
- Scope: <selected paths, diff, branch, or document>
- Sources: primary=<complete|degraded>; cli=<not requested|passed|failed>

<One to three sentences on the evidence and conclusion.>

## Code evidence

Include this section only for `code` mode.

| Axis | Status | Evidence |
|---|---|---|
| Standards | MET / GAP / UNAVAILABLE | <standard and file:line evidence, or explicit gap> |
| Spec | MET / GAP / UNAVAILABLE | <spec and acceptance evidence, or explicit gap> |

## Findings

List normalized findings in severity order, highest first. Use one line per
finding and the source labels defined in
[`review-common.md`](../references/shared/review-common.md).

- [P0/P1/P2/Nit] <file:line> <evidence-backed issue> -> <text-only recommendation> [source: primary|cli|both]

## Tests

Include relevant existing test evidence or text-only test recommendations.

- <test evidence or recommendation>

## Evidence gaps

- <missing or contradictory evidence, or none>

## Verdict

READY / BLOCKED / INCONCLUSIVE

- Blocking conditions: <condition or none>

Use [`references/shared/review-rubric.md`](../references/shared/review-rubric.md)
for severity and final verdict meanings.

This template is returned in the response only. Do not save it as a report or
use it to update a gate or sentinel. Omit the Code evidence section outside
`code` mode; other modes use their own dimensions.
