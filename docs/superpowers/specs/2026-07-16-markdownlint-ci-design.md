# Markdown Lint CI Enforcement

## Goal

Fix the current Markdown lint error and prevent future table-shape errors from
being silently accepted by CI.

## Design

- Escape the literal pipe in the `Task|Agent` table cell in
  `rules/execution-policy.md`, preserving the documented hook matcher while
  keeping the table at three columns.
- Remove `continue-on-error: true` from the Markdown lint job in
  `.github/workflows/ci.yml`, so any lint violation blocks the workflow.
- Add a zero-dependency regression test that verifies the workflow still uses
  the markdownlint-cli2 action, checks all five intended asset globs, keeps
  table-column validation (`MD056`) enabled, and does not make the lint job
  non-blocking again.

## Validation

Run the focused workflow test, the exact markdownlint-cli2 command used by CI,
the complete test suite, and the remaining CI validators. Existing non-blocking
harness warnings remain unchanged and are outside this Markdown lint scope.
