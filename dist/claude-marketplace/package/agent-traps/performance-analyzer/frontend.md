# Frontend Performance Traps

Investigate a user-visible performance concern or a change with a plausible measured cost. Start with a representative route, interaction, data shape, device, and network; record the baseline and the same measurements after a proposed fix.

## Rendering and collection costs

**Trigger → evidence/action:** A profile or reproducible interaction points to repeated expensive rendering, layout, sorting, filtering, or nested collection work. Use a representative dataset and browser profile to identify the hot path, then compare the focused change under the same workload. Apply memoization, virtualization, caching, or a different collection strategy only when the measurement identifies a cost and confirms improvement.

**Do not apply when:** The work is small and bounded or no user-visible cost is established. Do not add blanket memoization or virtualization based only on the presence of a list.

## Bundle and route cost

**Trigger → evidence/action:** A shipped entry or route has evidence of costly transfer, parse, compile, or evaluation. Inspect the built bundle and route loading behavior, then measure the affected scenario and compare before and after. Split or defer code only where it reduces the relevant initial or route cost.

**Do not apply when:** The dependency is not shipped to the client, or its contribution is not material in the affected route. Respect existing project budgets; do not invent arbitrary bundle-size caps.

## Memory and retained resources

**Trigger → evidence/action:** Memory grows over repeated interactions or route transitions, or profiles show retained DOM, collections, listeners, or subscriptions. Reproduce the sequence and compare heap snapshots or allocation profiles; identify the retaining path and verify that the fix releases it. Chrome documents [heap snapshots](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots/) for comparing retained objects and leaks.

**Do not apply when:** A bounded allocation is released after the task or route, or a single snapshot shows no growth pattern. Distinguish expected caching from a leak before recommending eviction.

## Evidence quality

Use lab profiling to reproduce a specific regression and field data when available to understand actual user experience. Lab and field results can differ; keep the workload and environment attached to each conclusion. See web.dev’s [Web Vitals measurement guidance](https://web.dev/articles/vitals-measurement-getting-started) and [lab/field comparison](https://web.dev/articles/lab-and-field-data-differences).

**Do not apply when:** A micro-optimization has no representative workload or before/after measurement. Report the affected user scenario, evidence, expected trade-off, and follow-up measurement instead of a generic performance score.
