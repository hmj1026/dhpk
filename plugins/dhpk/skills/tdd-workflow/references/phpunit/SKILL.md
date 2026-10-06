---
name: phpunit
description: 'Use when writing, reviewing, or migrating PHPUnit 9, 10, or 11 tests, resolving a project version, or choosing assertion, metadata, provider, mock, hook, runner, or coverage APIs. Not for PHPUnit 5/6/7-only suites, everyday assertion writing without a version decision, or Laravel routing. Output: selected version boundary, applicable reference, migration guidance, and verification evidence.'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# PHPUnit family — version router

Use this family for PHPUnit 9, 10, and 11 work. Resolve one version first,
then read exactly that selector reference; conditional references keep unrelated
version guidance out of context.

## Resolution contract

1. If the caller supplies 9, 10, or 11, use that selector without reading
   project files or dhpk manifests.
2. Otherwise inspect the current project's composer.lock (installed
   phpunit/phpunit version) and then composer.json (require and require-dev).
   Select a single resolvable major.
3. If no supported major is detected, ask which version applies. Do not guess,
   default to the newest reference, or use distribution/install manifests.

The family-local resolver and portable CLI implement this contract:

    node scripts/resolve-version.js --json [--version 9|10|11]

The JSON result reports status, family, selector, source, reference,
loadedReferences, and the selected guidance. An unresolved result reports
status "ask", no reference loaded, and an actionable question.

## Version branches

- 9 — PHPUnit 8.5/9.x lifecycle signatures, assertions, providers, mocks,
  hooks, risky-test checks, and the complete API migration catalog:
  references/9.md.
- 10 — PHP 8.1 floor, attributes preferred while doc-comment metadata still
  works, runner/configuration changes, hooks, and the 9 → 10 checklist:
  references/10.md.
- 11 — PHP 8.2 floor, attribute-first migration, deprecated doc-comment
  metadata, typed overrides, discovery, and the 10 → 11 checklist:
  references/11.md.

The lifecycle authority is explicit: PHPUnit 10 supports attributes and still
reads doc-comment metadata (attributes take precedence); PHPUnit 11 deprecates
doc-comment metadata; PHPUnit 12 removes test annotations, while
@codeCoverageIgnore, @codeCoverageIgnoreStart, and @codeCoverageIgnoreEnd
remain supported.

## When NOT to Use

- Use `dhpk-php-runtime-router` for Laravel routing and general PHP runtime
  family selection.
- For PHPUnit 5, 6, or 7-only suites, use PHP 5.6-compatible test guidance
  instead of this modern family.
- For everyday assertion writing without a version decision, use focused
  test-design guidance rather than loading a version reference.

## Shared test discipline

Keep setUp(), tearDown(), and static lifecycle methods compatible with the
selected framework signature. Register expectException*() immediately before
the throwing call, prefer strict assertIs*() assertions, use static named data
providers, and default to createMock(). Treat every non-empty migration scan as
an explicit TODO; enable strict risky-test checks without deleting meaningful
assertions.

## Output and verification

Return the selected version boundary, applicable reference, a focused migration
or implementation recommendation, and evidence from the focused test and
relevant suite. For migration work, list every remaining scan match as a TODO
and state the PHP/PHPUnit floor. For a copied family directory, run the
family-local CLI with NODE_PATH empty and an explicit selector.

The family-local `scripts/resolve-version.js` is the JSON CLI entrypoint. It
accepts an optional explicit selector and exits non-zero when resolution asks
for input or encounters an error. `scripts/version-resolver.js` is the
programmatic resolver used by the CLI and returns the selected reference,
loaded contents, or an ask result with no loaded references.
