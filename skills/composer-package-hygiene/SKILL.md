---
name: composer-package-hygiene
description: Composer-published package author concerns — semver decisions, public API surface declaration (@api / @internal / final), composer.json autoloader hygiene (PSR-4 vs files, allow-plugins, suggest vs require), Laravel package discovery validation (extra.laravel.providers/aliases), and the release flow (changelog ↔ tag ↔ gh release consistency). Framework-agnostic — applies to any PHP package distributed via Packagist, whether plain library, Symfony bundle, or Laravel package. Use when designing a public API for a new package, reviewing a composer.json before publishing, cutting a release, deciding whether a change is a major/minor/patch bump, auditing autoload entries, or validating that Laravel package discovery still works. Not for everyday application code — load only when working on a library that other projects will install. Counterpart to php-modern-pro (language-level idioms) and any future laravel-N-dev (framework patterns).
---

# Composer package hygiene — author-side discipline

This skill applies whenever you are working on a PHP package that gets
published to Packagist (or a private composer repository) and installed
into other projects. Application code does not need this.

> Mental model: every line in `composer.json`, every public class, every
> tag is a **contract** with downstream consumers. Breaking the contract
> requires a major bump. Hide implementation aggressively so you keep the
> contract small.

---

## Semver — what counts as breaking

| Change | Bump |
|---|---|
| Remove or rename a public class / method / function | major |
| Add a required parameter to a public method | major |
| Tighten a public parameter type (e.g. `string` → `int`) | major |
| Loosen a public return type (e.g. `string` → `string\|null`) | major |
| Raise PHP floor (`^7.4 \|\| ^8.0` → `^8.0`) | major |
| Raise a runtime dependency's floor in a way that excludes existing supporters | major |
| Add a new public class / method | minor |
| Add an optional parameter with a default | minor |
| Tighten a return type (e.g. `string\|null` → `string`) | minor |
| Loosen a parameter type (e.g. `int` → `int\|string`) | minor |
| Add a new optional dependency to `suggest` | minor |
| Bug fix that doesn't change documented behaviour | patch |
| Documentation, internal refactor, test-only change | patch |

**Trap**: "we never documented this method as public — we can remove it".
If the method has a `public` visibility modifier and no `@internal`
PHPDoc, downstream code may use it. Removing it is a breaking change
*regardless of intent*. The fix is to add `@internal` *before* anyone
adopts your package; you can't retroactively reclassify after the fact
without a major bump.

---

## Public API surface — keep it minimal

Three orthogonal tools, used together:

### 1. PHPDoc `@api` / `@internal`

```php
/**
 * @api
 */
final class Gateway { /* ... */ }

/**
 * @internal — implementation detail; do not depend on this from outside the package.
 */
final class GatewayRequestBuilder { /* ... */ }
```

- `@api` marks the documented public surface.
- `@internal` signals "you may import this, but I owe you nothing across
  versions". Static analyzers (PHPStan with `bleedingEdge`, Psalm in
  strict mode) warn on cross-package use of `@internal` symbols.
- Default for new classes you're unsure about: `@internal`. It's easier
  to promote later than to demote.

### 2. `final` on classes

```php
final class UserId { /* ... */ }
```

- Marks the class as not-designed-for-extension. Downstream `extends` is
  illegal, so you keep freedom to change protected method signatures,
  add private state, etc.
- Exception: classes specifically designed as extension points (abstract
  base classes, service providers). Document the extension contract in
  PHPDoc.
- Trap: removing `final` is *backwards-compatible* (downstream gains
  freedom). Adding `final` is *breaking*. Decide on `final` at v1.0 and
  stick with it.

### 3. Dependency surface — what leaks through

Every type your public methods accept or return is part of your contract.
A `public function send(Symfony\HttpClient\Response $r): void` makes
Symfony's `Response` class part of *your* package's API.

| Goal | Tactic |
|---|---|
| Stable signature across dependency majors | Accept a PSR interface (`Psr\Http\Message\ResponseInterface`) instead of a concrete class |
| Hide a runtime-mandatory dependency from the public surface | Wrap it in a value object you own; expose your VO instead |
| Hide an optional dependency entirely | Put it behind a facade method that throws when the dep is missing; declare it in `suggest`, not `require` |

---

## composer.json hygiene

### Version constraints

| Pattern | Use for | Avoid |
|---|---|---|
| `"^X.Y"` | Anchor to a known-good major | when X is 0 — caret means "compatible with 0.x patch", not "any 0.x" |
| `"^X.Y \|\| ^A.B"` | Cross-major support (PHP 7\|8, Laravel 6→11) | when one of the majors is unsupported by some required dep |
| `">=X"` | **don't** | auto-opts into future majors, including ones that break you |
| `"*"` | **never** | rolls the dice on every install |
| `"dev-main"` | **never in stable releases** | floats; breaks reproducible installs |

### Autoloader

| Section | Use for | Trap |
|---|---|---|
| `autoload.psr-4` | Production code, one namespace per root | every file globbed; don't include vendored or generated dirs |
| `autoload.files` | Polyfills, global helpers, autoload-time class_alias | runs on every request; cost compounds — keep entries minimal |
| `autoload.classmap` | Non-PSR-4 legacy code | each file scanned at dump time; slows `composer dump-autoload` on large dirs |
| `autoload-dev` | Test classes | never `psr-4` autoload tests as production — namespace pollution |

### `require` vs `require-dev` vs `suggest`

```json
{
  "require":     { "php": "^7.4 || ^8.0", "psr/log": "^1.0 || ^2.0 || ^3.0" },
  "require-dev": { "phpunit/phpunit": "^9.6", "orchestra/testbench": "^6.0 || ^7.0" },
  "suggest":     { "aws/aws-sdk-php": "Required for signed Elasticsearch requests via AwsSignedHandler (^3.0)." }
}
```

- `require` is for every consumer. Every entry runs `composer install` on
  every downstream — be parsimonious.
- `require-dev` for development-only tooling (phpunit, php-cs-fixer,
  testbench). Downstream consumers don't install these.
- `suggest` for optional features that gate at runtime via a
  `class_exists` / `function_exists` check. Add a usage hint in the value
  (which library, which feature, which constraint).

### `config.allow-plugins`

```json
{
  "config": {
    "allow-plugins": {
      "composer/package-versions-deprecated": true
    }
  }
}
```

- Composer 2.2+ requires explicit allow-listing for any composer plugin
  package. Without this, `composer install` halts on first encounter.
- Allow only what you actually use. Don't blanket-allow.

### `minimum-stability` + `prefer-stable`

```json
{ "minimum-stability": "stable", "prefer-stable": true }
```

- Stable for libraries. Never ship a beta dependency in a stable release.
- `prefer-stable: true` makes the resolver prefer stable versions when
  both are available within constraints.

---

## Laravel package discovery validation

If `extra.laravel.providers` and `extra.laravel.aliases` exist, the
package gets auto-registered by Laravel's package discovery on `composer
install`. Two failure modes to guard against:

### 1. Provider class doesn't exist

```json
{ "extra": { "laravel": { "providers": ["Devkit\\Laravel\\DevkitServiceProvider"] } } }
```

The class must exist at the declared FQCN. CI should run:

```bash
composer install --no-dev   # installs the package as a consumer would
php artisan package:discover --ansi  # this is what Laravel runs post-install
```

A missing class produces `Class "Devkit\Laravel\DevkitServiceProvider" not
found`. Fix the FQCN or the autoload mapping.

### 2. Facade alias mismatched to accessor

```json
{ "extra": { "laravel": { "aliases": { "Trail": "Devkit\\Laravel\\Ui\\Facades\\Trail" } } } }
```

```php
class Trail extends Illuminate\Support\Facades\Facade
{
    protected static function getFacadeAccessor(): string
    {
        return 'devkit.trail';  // must match what the service provider binds
    }
}
```

The accessor string must match the key the service provider registers
(`$this->app->singleton('devkit.trail', …)`). Drift produces "Class
'devkit.trail' not found" at runtime — invisible until someone calls
`Trail::method()`.

CI test: load the package, call one method through the facade, assert no
exception.

---

## Release flow — keep tag, changelog, and package in sync

A clean release has all three pointing at the same SHA:

1. **CHANGELOG** entry merged into main with the new version heading.
2. **git tag** matching the version (`vX.Y.Z`, with the `v` prefix is
   Packagist convention).
3. **GitHub release** with the changelog excerpt as the body.

### One command via `gh`

```bash
# After CHANGELOG.md is merged and you're on main:
VERSION=1.4.0
gh release create "v$VERSION" \
    --title "v$VERSION" \
    --notes "$(awk "/^## \[?$VERSION\]?/{flag=1; next} /^## /{flag=0} flag" CHANGELOG.md)"
```

The `awk` extracts the changelog block for the version. Adjust the regex
if your CHANGELOG uses a different heading style (Keep a Changelog vs
plain version headings).

### Pre-release checklist

Before tagging, run through:

- [ ] `composer validate --strict` — catches malformed composer.json
- [ ] `composer install --prefer-lowest --prefer-stable` — works against
      the lowest version of every constraint (catches "I wrote `^2.0`
      but accidentally used a 2.5-only method")
- [ ] Test matrix passed on all declared PHP × framework cells
- [ ] CHANGELOG updated with the new version block
- [ ] `git diff <previous-tag>..HEAD` — eyeball the public API surface
      changes; confirm the version bump matches semver implications
- [ ] No `dev-main` or `@dev` constraints in `composer.json`
- [ ] All `@internal` / `@api` PHPDoc tags accurate for the new code

### Packagist sync

If the package is configured with the GitHub webhook, the tag push
triggers Packagist within ~minute. Without the webhook, the maintainer
must click "Update" on packagist.org. Verify with:

```bash
composer show <vendor>/<package> --available | grep "$VERSION"
```

---

## Cross-references

- `modules/php-7.4/skills/php-modern-pro/SKILL.md` — language idioms,
  dual-version-floor library packaging (polyfill / class_alias /
  trait-shim patterns). Pairs with this skill: php-modern-pro picks the
  idiom, this skill ships the package.
- `modules/php-7.4/references/static-checks.md` — the lint + static
  analysis pipeline that should be passing before any release.
- `skills/feature-dev/SKILL.md` (plugin-level) — general feature flow
  this skill plugs into at the release step.
