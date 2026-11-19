# PHP5.6 / PHPUnit5.7 legacy tests

Use after confirming the target PHP floor, installed runner and repository test
configuration. These are legacy-project conventions, not universal API
introduction dates. An API supported by PHPUnit5.7 can still be outside a
project's established convention; inspect its runner before changing tests.

## Runtime and runner

- PHP5.6 test methods and lifecycle methods have no return types and use
  PHPDoc for parameters/return contracts. Keep scalar types, strict_types,
  attributes, modern union types and other newer syntax out of this path.
- Use public `testXxx()` names and public PHPDoc `@dataProvider` methods.
  Preserve a repository convention against `@test`/BDD names where one exists.
- Preserve `setExpectedException()` or `@expectedException` when those are the
  project's chosen exception convention. A move to another exception API needs
  confirmed runner compatibility and a deliberate test change; this reference
  does not classify `expectException()` as a PHPUnit6-only method.
- Use `assertInternalType()` for legacy type assertions rather than assuming
  newer assertion APIs. Prefer `assertSame()` for exact scalar/type contracts.

## Observable outcomes and seams

Write or retain the failing regression before changing behavior. Assert a
caller-visible value, failure, or persisted transition; inject deterministic
repository, service, filesystem, clock and transport fakes at actual boundaries.
Do not mock value objects or private implementation details to manufacture GREEN.

Use `getMockBuilder()`/`setMethods()` when selecting particular methods. Replace
an old mock with `createMock()` only after checking that its selected-method,
constructor and expected-call behavior is preserved; a textual replacement is
not proof of equivalence.

For database-free tests use explicit deterministic fixtures. Real persistence
belongs in the configured integration harness and an owned disposable target;
shared databases need explicit write authority. A transaction alone is not
isolation proof. Match selected columns to asserted fields and preserve the
actual driver return types rather than assuming integer casts.

## Comparisons, money, and ordering

- Use strict assertions when exact types belong to the contract; when a DB
  driver returns numeric strings, cast intentionally or use a justified loose
  comparison rather than accidentally weakening every assertion.
- Compare floating point with the runner's documented tolerance argument;
  inspect its signature instead of guessing the positional delta parameter.
  Prefer integer minor units or the project's decimal representation for money.
- For an ASCII identifier ordering check under a case-insensitive MySQL
  collation, `strcasecmp()` avoids `strcmp()`'s case ordering mismatch. For
  general Unicode/collation semantics use database evidence; a PHP comparison
  is not a complete MySQL collation implementation.
- Missing fixtures or extensions are explicit skipped/unavailable evidence;
  unfinished work is incomplete. Neither is a passed test.

## Framework boundary and reporting

Yii AR/DAO semantics belong to the Yii1 family. This runtime reference does not
assume Yii, Laravel, or a framework bootstrap for a standalone PHP service.
Keep the project-native harness when testing a real framework route.

Report the configured command, PHP and PHPUnit versions, tested scope, and
actual failure/error/skipped/incomplete/pass result. Modern local PHP parser
success does not establish PHP5.6 compatibility. Read `testing-quality.md` only
for the selected quality concern and retain this target's syntax floor.

Official runner reference: <https://phpunit.de/manual/5.7/en/>.
