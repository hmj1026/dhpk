# Read-only Verdict Template

## Change verdict: <mode>

- Fixed point: <merge-base or HEAD>
- Scope: <path/diff/branch/document>
- Sources: primary=<complete|degraded>; cli=<not requested|passed|failed>

<1-3 sentences on risks and conclusions>

## Findings

### P0

- [file:line] <title>
  - Impact:
  - Fix:
  - Test:

### P1

- ...

### P2

- ...

### Nit

- ...

## Tests

- unit: <suggestion>
- integration: <suggestion>
- e2e: <suggestion>

## Evidence gaps

- <missing or contradictory evidence, or none>

## Verdict

READY / BLOCKED / INCONCLUSIVE

- Blocking conditions (if any):

This template is returned in the response only. Do not save it as a report or
use it to update a gate or sentinel.
