# opsx-apply-goal — Test-runner detection flags

Used by Step 4 of the `opsx-apply-goal` skill. Each flag is `true` when at least one
positive signal matches AND no negative override matches.

## Signal table

| Flag | Positive signals | Negative override |
|------|-----------------|------------------|
| `HAS_PHPUNIT` | `phpunit` · `.php` · `protected/tests/` · `CTestCase` · `TestCase extends` | `no PHP` · `no backend` |
| `HAS_JEST` | `jest` · `.test.js` · `.spec.js` · `js/tests/` · `npm run test` | `no JS` · `no frontend` |
| `HAS_PYTEST` | `pytest` · `.py` · `tests/test_` · `def test_` | — |
| `HAS_SWIFT_TEST` | `swift test` · `.swift` · `XCTest` · `XCTestCase` | — |
| `HAS_OTHER_TEST` | explicit test command in tasks.md (e.g. `go test`, `cargo test`) | — |

## Detection rules

1. Check `proposal.md` first for negation statements ("no backend changes",
   "no tests required", "no frontend", "doc-only"). These set the negative
   override for `HAS_PHPUNIT` / `HAS_JEST`.
2. Apply positive signals against the combined text of `proposal.md` +
   `design.md` + `tasks.md`.
3. If no flag is `true` → `HAS_TEST=false`. Doc-only and harness-only changes
   have no automated tests. Part 3 is still emitted if a build/lint gate is
   detected (below); omit Part 3 entirely only when test, build, and lint are
   all absent.

## Build/lint gates

Independent of test runners. Each flag is `true` when at least one positive
signal matches AND no negative override matches — same rule as the test table.
A build-only change can have `HAS_BUILD=true` while `HAS_TEST=false`.

| Flag | Positive signals | Negative override |
|------|-----------------|------------------|
| `HAS_BUILD` | `composer install` · `npm run build` · `yarn build` · `swift build` · `xcodebuild` · `make build` · `tsc --build` | `no build step` · `doc-only` |
| `HAS_LINT` | `eslint` · `phpcs` · `php-cs-fixer` · `phpstan` · `ruff` · `swiftlint` · `npm run lint` · `lint:fix` | `no lint` · `doc-only` |

When emitting Part 3, add `build output shows 0 errors` for `HAS_BUILD` and
`lint output shows 0 errors` for `HAS_LINT`. Keep each gate to one verifiable
line so the Haiku evaluator can check it from conversation. Detected nothing →
add nothing (no forced gate on changes that have no build/lint step).

## Coverage gate (opt-in, threshold-driven)

Closes the "new code shipped with zero tests still passes the `0 failed` gate"
hole — but only as an **outcome** check (unattended runs cannot enforce
tests-first). `HAS_COVERAGE=true` **only when `HAS_TEST=true` AND** the project
already has coverage tooling with a **fail-threshold** configured. Never invent a
threshold: no configured threshold → `HAS_COVERAGE=false` (soft-fallback to the
plain `0 failed` test gate).

| Flag | Positive signals (a configured fail-threshold) | Capture |
|------|-----------------|---------|
| `HAS_COVERAGE` (jest) | `coverageThreshold` in jest config / `package.json` | `COVERAGE_CMD = jest --coverage` |
| `HAS_COVERAGE` (phpunit) | `<coverage>` in `phpunit.xml` with a stated minimum, or `--coverage-text` + a stated % in tasks/proposal | `COVERAGE_CMD = phpunit --coverage-text` |
| `HAS_COVERAGE` (pytest) | `--cov-fail-under=<N>` / `[tool.coverage]` in `pyproject.toml` / `.coveragerc` | `COVERAGE_CMD = pytest --cov --cov-fail-under=<N>` |
| `HAS_COVERAGE` (swift) | `--enable-code-coverage` + a stated threshold | `COVERAGE_CMD = swift test --enable-code-coverage` |
| common intent | `coverage` · `≥ N%` · `--coverage` stated in `proposal.md` / `design.md` / `tasks.md` | `COVERAGE_THRESHOLD = <N>` when explicit |

Detection mirrors the test/build/lint tables: positive signal matches AND no
`no tests`/`doc-only` negative override. Capture `COVERAGE_CMD` (the runner's
coverage invocation) and `COVERAGE_THRESHOLD` (only when an explicit number is
stated). Step 6 uses these to enforce the threshold via the runner itself rather
than a separate coverage tool.

**Operator override (`--min-coverage N`):** opsx-apply-goal's `--min-coverage N` flag
forces this gate at threshold `N` even when no native threshold is configured —
the escape hatch for projects that have a test runner but no coverage config.
Requires `HAS_TEST=true` (a runner must exist to measure coverage); when set it
overrides any detected `COVERAGE_THRESHOLD`, and Step 6 derives `COVERAGE_CMD`
from the detected runner. No runner detected → the flag is ignored (noted in
Block A). The flag never *invents* a default — coverage is enforced only when the
operator explicitly asks or the project configures it.

## Sentinel strategy rationale

The goal condition uses a universal `ls .pending-*` check rather than
enumerating specific reviewers (code / db / security / frontend / doc /
polyfill / migration). Enumerating reviewers requires predicting which files
Claude will edit — an inference that is error-prone and breaks cross-language
portability:

- **False positives**: requiring a reviewer PASS that was never triggered →
  goal can never satisfy (impossible condition).
- **False negatives**: missing a reviewer that WAS triggered → goal satisfies
  too early (incomplete review).

The `ls` check is self-calibrating: it passes only after all sentinels written
during the actual implementation run have been cleared. No file-edit prediction
is needed.

Test-runner conditions (phpunit / jest / pytest / etc.) are kept because the
test command itself is language-specific; the goal cannot say "run tests"
without knowing which runner to use.

---

## Non-automatable tasks (HAS_SKIP_TASKS)

Some tasks require human action and **must be exempted from Part 3** of the
goal condition. Claude can never satisfy these conditions autonomously — a human
must verify and mark the checkbox `[x]` manually.

Set `HAS_SKIP_TASKS=true` when tasks.md contains at least one task matching the
signals below. Count and surface these tasks in Block A so the implementer
knows to handle them out-of-band.

### Skip-signal categories

**A — Hardware / real-device**

| Signal phrases | Examples |
|----------------|---------|
| `real device` · `real iPhone` · `real Android` · `実機` · `on-device` | Camera, mic, GPS, Bluetooth, NFC, Face ID, fingerprint, battery drain, memory pressure |
| Network condition simulation requiring physical environment | "Test in airplane mode", "verify on 2G" |

**B — Visual / UI human-eye**

| Signal phrases | Examples |
|----------------|---------|
| `visually verify` · `visually confirm` · `looks correct` · `animation` · `design matches` · `mockup` | Animation smoothness, layout fidelity, font/color rendering |
| `cross-browser` · `Safari iOS` · `Internet Explorer` · `WebView` | Browser-specific rendering |
| `screen reader` · `VoiceOver` · `TalkBack` · `a11y manual` | Accessibility with assistive tech |

**C — External service (no sandbox)**

| Signal phrases | Examples |
|----------------|---------|
| `production payment` · `live Stripe` · `live PayPal` | Real payment gateway, no test mode |
| `SMS delivery` · `email delivery` · `push notification` (to real device) | Actual delivery verification |
| `OAuth` · `SSO` · `browser callback` | Auth flows requiring browser interaction |
| `no staging` · `no sandbox` | Third-party APIs without test environment |

**D — Deployment / environment-gated**

| Signal phrases | Examples |
|----------------|---------|
| `deploy to staging` · `deploy to production` · `verify in production` | Requires actual deployment |
| `Terraform apply` · `infrastructure provisioning` | Cloud infra changes |
| `real database migration` · `verify migration on live data` | Migration on production data |

**E — Human review / sign-off**

| Signal phrases | Examples |
|----------------|---------|
| `sign-off` · `approval` · `get approval` · `review with` | Designer, PM, QA, client, legal |
| `QA team` · `product team` · `stakeholder` · `present to` | Formal acceptance gates |
| `compliance review` · `legal review` | Regulatory sign-off |

**F — Scale / traffic-dependent**

| Signal phrases | Examples |
|----------------|---------|
| `load test` · `stress test` · `real traffic` | Performance under production-scale traffic |
| `N million records` · `large dataset` (when sample data only) | Tests requiring production data volume |
| `soak test` · `long-running test` (hours/days) | Tests beyond CI timeout |

### How HAS_SKIP_TASKS affects the goal

- **HAS_SKIP_TASKS=true AND HAS_TEST=true**: Add automated test-runner conditions
  to Part 3 normally. Append a note in Block A listing the skipped tasks and
  instructing the implementer to mark them `[x]` manually before the session ends.
- **HAS_SKIP_TASKS=true AND HAS_TEST=false**: Omit Part 3 entirely (same as
  doc-only). All verification is human-driven; note this in Block A.
- The skipped tasks still need their checkboxes marked `[x]` — Part 1 of the
  goal (all checkboxes done) still applies. The implementer must verify manually
  and tick them before the session goal can satisfy.

### Block A note for skipped tasks

When `HAS_SKIP_TASKS=true`, include in Block A:

```
║  Manual tasks : <N> tasks require human verification (exempt from auto-goal)
║    → <task text, truncated to 60 chars>
║    → ...
```
