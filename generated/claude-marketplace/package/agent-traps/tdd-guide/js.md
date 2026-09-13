# tdd-guide × js / TypeScript

For the tdd-guide agent on Jest / Vitest (unit + integration) and Playwright (E2E) for `.ts/.tsx/.js/.jsx`. Neighboring agents: e2e-runner (Playwright journeys — boundingBox/dialog traps live in `agent-traps/e2e-runner/playwright.md`). Vue component-test specifics → pair with the `vue` module if active.

Layout: `*.test.ts` beside source (or `__tests__/`) = unit (pure functions / components in isolation; mock externals at the boundary); `*.integration.test.ts` = route handler + real query path against an in-memory / test store; `e2e/*.spec.ts` = Playwright, one critical user journey per file. Method names: `it('<subject> <condition> <expected>')`, not `it('works')`.

| Trigger | Action | Non-apply |
|---|---|---|
| test name needs "and"; multiple behaviors in one case | Arrange-Act-Assert — one observable behavior per test; split | — |
| spy `toHaveBeenCalledTimes` as a proxy for behavior | assert observable output: return value / rendered DOM / emitted event a caller sees | a documented fire-and-forget logger |
| shared mutable module state; test B depends on test A's order | isolate: reset with `beforeEach` / `vi.restoreAllMocks()` | — |
| mock of the unit under test | mock external boundaries only (network / fs / clock / third-party SDK); prefer `vi.mock` / `jest.mock` at the module edge | — |
| floating promise / un-awaited assertion | `await` the assertion or return the promise; fake timers for time-dependent code | a documented fire-and-forget logger |
| brittle CSS / nth-child Playwright selectors | `getByRole` / `getByLabel` / `data-testid`; assert on user-visible state | E2E files that belong to e2e-runner — boundingBox/dialog traps live in `agent-traps/e2e-runner/playwright.md` |
| happy-path only | cover null / empty / boundary / invalid-type / thrown-error (`expect(fn).rejects.toThrow(...)`) | — |

## Run

```bash
npm test                      # or: vitest run / jest
npx playwright test           # E2E
npm run test:coverage         # threshold via coverageThreshold (jest) / coverage.thresholds (vitest), floor 80%
```
