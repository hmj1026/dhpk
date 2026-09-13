# CI Cross-Platform Regression Fixes

## Goal

Restore the four currently failing validation tests and make their failure modes
deterministic across Linux and macOS CI/development environments.

## Design

- Parse ISO-8601 `saved_at` timestamps as UTC in the BSD `date` fallback used by
  `detect-phase.sh`.
- Keep `install.sh` strict-mode safe when the user selects no stacks by guarding
  iteration over empty arrays under Bash 3.2.
- Reuse the existing `portable-sed.sh` helper in `set-handoff-state.sh` so the
  in-place frontmatter update works with GNU and BSD sed.
- Keep `verify-runner`'s shared `runStep` API unchanged. When no package script
  exists and `tsconfig.json` is present, invoke `tsc` through
  `npx --no-install` so a missing local compiler cannot trigger a network
  install or hang CI. The regression fixture supplies a local compiler stub and
  asserts the no-install command shape.

## Validation

The existing focused tests remain the executable regression checks for all four
paths. The verify-runner fixture is strengthened to prove that the fallback
uses a local compiler without network installation. The project gates remain:

```text
node scripts/ci/validate-plugin.js --strict
node scripts/ci/catalog.js --check all
node tests/run-all.js
bash scripts/validate/validate-harness.sh
```

No API contracts or shared process-runner behavior are changed.
