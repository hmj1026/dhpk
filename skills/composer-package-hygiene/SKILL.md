---
name: composer-package-hygiene
description: Composer-published package contract review. Use when: deciding semver, auditing public API or composer.json, validating Laravel package discovery, or coordinating a package release. Not for: everyday application code, language idioms, or Laravel-specific authoring mechanics. Output: a contract verdict, audited manifest, or release gate backed by the package-contract reference.
---

# Composer package hygiene

Use this skill for PHP packages installed by downstream projects. Treat every public
symbol, `composer.json` entry, published artifact, tag, and registry release as one
consumer-facing contract.

## Working sequence

1. Load `references/package-contracts.md` and select the branch that matches the task.
2. Inspect the package's declared PHP/dependency floors, public symbols, autoload maps,
   Laravel discovery metadata, and release files before choosing a change.
3. Classify compatibility from the contract rules, not from author intent or the
   current resolver result alone.
4. Run the branch-specific checks in the verification gate below and report any
   unavailable consumer or registry check as blocked rather than green.

## Contract branches

- Semver or public API change → `package-contracts.md` §Semver and §Public API surface.
- `composer.json`, autoload, or dependency change → §composer.json hygiene.
- Laravel providers, aliases, or facade discovery → §Laravel package discovery.
- Changelog, tag, or Packagist publication → §Release flow.

## When NOT to Use

- Application code that is never published to downstream consumers.
- Language-level idiom selection; use `modules/php-7.4/skills/php-modern-pro`.
- Laravel service-provider, facade, publishing, or Testbench mechanics; use
  `laravel-package-author` or `laravel-testbench-matrix`.
- A release workflow that does not publish a Composer package.

## Output

Return one of:

- a semver verdict (`major`, `minor`, or `patch`) with the contract evidence;
- an audited `composer.json` covering constraints, autoload, plugins, suggestions, and
  Laravel discovery metadata; or
- a release gate showing the CHANGELOG, tag, GitHub release, package matrix, and
  registry state.

## Verification

- [ ] The relevant section of `package-contracts.md` was loaded before judging.
- [ ] Every changed public symbol has an intentional `@api` / `@internal` status and
  its dependency types are included in the compatibility decision.
- [ ] `composer validate --strict` passes.
- [ ] Lowest supported dependency floors and the declared PHP/framework matrix pass.
- [ ] Laravel packages pass `php artisan package:discover --ansi` in a fresh consumer
  install, with a facade smoke test when aliases are present.
- [ ] A release has a matching versioned CHANGELOG entry, tag, GitHub release, and
  registry visibility; missing external evidence is reported as blocked.

## References

- `references/package-contracts.md` — semver, public API, composer.json, Laravel
  discovery, and release contract details; load only the branch being used.
- `modules/php-7.4/skills/php-modern-pro/SKILL.md` — PHP language and dual-floor idioms.
- `skills/laravel-package-author/SKILL.md` — Laravel package authoring mechanics.
- `skills/laravel-testbench-matrix/SKILL.md` — per-major Testbench matrix mechanics.
