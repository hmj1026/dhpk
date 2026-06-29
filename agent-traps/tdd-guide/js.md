# tdd-guide — JS / TypeScript traps

Jest / Vitest (unit + integration) and Playwright (E2E) conventions for
`.ts/.tsx/.js/.jsx`. Vue component-test specifics → pair with the `vue` module if active.

## Test layout

| Path | Rule |
|------|------|
| `*.test.ts` beside source (or `__tests__/`) | Unit — pure functions / components in isolation; mock externals at the boundary |
| `*.integration.test.ts` | Integration — route handler + real query path against an in-memory / test store |
| `e2e/*.spec.ts` | Playwright — one critical user journey per file |

- Method names describe behavior: `it('<subject> <condition> <expected>')`, not `it('works')`.

## Conventions

- **Arrange-Act-Assert** — one observable behavior per test; split when the name needs "and".
- **Assert observable output, not internals** — return value / rendered DOM / emitted event a caller sees, never a spy `toHaveBeenCalledTimes` as a proxy for behavior.
- **Test isolation** — no shared mutable module state across tests; reset with `beforeEach` / `vi.restoreAllMocks()`; never let test B depend on test A's order.
- **Mock external boundaries only** — network / fs / clock / third-party SDK; do not mock the unit under test. Prefer `vi.mock` / `jest.mock` at the module edge.
- **Async correctness** — `await` the assertion or return the promise; never leave a floating promise (the test passes before the assertion runs). Use fake timers for time-dependent code.
- **Semantic selectors (Playwright)** — `getByRole` / `getByLabel` / `data-testid`, never brittle CSS / nth-child chains; assert on user-visible state.
- **Edge + error paths** — null / empty / boundary / invalid-type / thrown-error, not just the happy path (`expect(fn).rejects.toThrow(...)`).

## Run

```bash
npm test                      # or: vitest run / jest
npx playwright test           # E2E
npm run test:coverage         # threshold via coverageThreshold (jest) / coverage.thresholds (vitest), floor 80%
```
