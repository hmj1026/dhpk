# Review Rubric

## Severity

| Level | Definition                                        | Examples                   |
| ----- | ------------------------------------------------- | -------------------------- |
| P0    | Security vulnerability, data corruption, core unavailable | SQLi, auth bypass     |
| P1    | Correctness risk, performance regression, test gap | Race condition, N+1       |
| P2    | Design flaw, maintainability issue                | Deep nesting               |
| Nit   | Style, naming                                     | Variable naming            |

## Response Gate

| Gate | Condition |
| --- | --- |
| READY | No P0/P1 and the evidence set is complete |
| BLOCKED | Has P0/P1 or a required safety condition is unmet |
| INCONCLUSIVE | The evidence set or fixed point is insufficient |
