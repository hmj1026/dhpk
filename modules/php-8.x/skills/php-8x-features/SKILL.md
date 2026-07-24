---
name: php-8x-features
description: Use when the project's PHP floor permits 8.x syntax, when reviewing whether a 7.4-and-up library can adopt an 8.x idiom conditionally, or when designing an API with attributes, enums, readonly, or newer types. Not for everyday business logic, 7.4 baseline guidance, or legacy 5.6 code. Output: a feature recommendation or migration decision with its minimum PHP version and library-floor rule.
---

# PHP 8.x features — routing entrypoint

Use this skill to decide whether a PHP 8.0–8.3 language feature is legal for
the actual runtime and package floor. Start with the feature catalog before
editing code; PHP 8.x syntax has no runtime polyfill.

## Working sequence

1. Read `composer.json`, CI matrices, and deployment metadata to identify the
   lowest supported PHP version.
2. Open the relevant version section in
   `references/feature-catalog.md`.
3. Apply the catalog's library rule: attributes may be inert on 7.4, while
   the other listed 8.x syntax requires a compatible parser.
4. If the floor changes, run the composer-package-hygiene checks and record
   the semver consequence.
5. Verify with the project's parser, static-analysis, and focused-test gates.

## Decision branches

- Choosing a language idiom: use the feature's minimum-version entry and
  compare it with the declared floor.
- Supporting `^7.4 || ^8.0`: use the mixed-floor decision table; do not hide
  parse errors behind runtime checks.
- Designing public API: inspect named-argument stability, attributes read by
  frameworks, and serialization or reflection consequences.
- Raising `composer.json`'s PHP floor: hand off to
  `skills/composer-package-hygiene/SKILL.md` for semver and release review.

## When NOT to Use

- Everyday business logic where no PHP-version decision is involved.
- PHP 7.4 baseline or dual-floor patterns; use `php-modern-pro`.
- Legacy PHP 5.6 compatibility work; use `php-pro`.

## Output

Return one of:

- a feature recommendation with its minimum PHP version and compatibility
  caveat; or
- a migration decision listing the required floor bump, affected matrix
  cells, and verification evidence.

Do not report a feature as compatible until the lowest declared floor and the
framework/tooling that consumes it have been checked.

## Verification

- [ ] The selected feature's minimum PHP version is at or below the declared
      project floor.
- [ ] A `^7.4 || ^8.0` library uses only attributes without a deliberate
      gated branch; all other 8.x syntax is excluded or the floor is raised.
- [ ] Composer constraints and CI matrix cells agree with the decision.
- [ ] Parser, static-analysis, and focused tests pass for the affected cells.
- [ ] A floor bump is treated as a semver-major release decision.

## References

- `references/feature-catalog.md` — feature examples, caveats, and mixed-floor
  decision tables.
- `modules/php-7.4/skills/php-modern-pro/SKILL.md` — 7.4 baseline and
  dual-version-floor patterns.
- `modules/php-7.4/references/static-checks.md` — lint and analysis pipeline.
- `skills/composer-package-hygiene/SKILL.md` — package-floor and release flow.
