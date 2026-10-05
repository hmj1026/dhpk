# Laravel review traps

Confirm the Laravel version and PHP support floor from the project configuration before recommending framework APIs. Apply a PHP 5.6 compatibility exception only to code explicitly required to run on that legacy target; it does not change the floor for other paths.

## Validation and mass assignment

**Trigger:** Request data flows into a model create, fill, update, or bulk write.

**Check and act:** Trace the accepted fields from validation through the write. Confirm unvalidated request fields cannot set protected attributes, and verify authorization separately from data validation. Laravel documents request validation and Form Request authorization as separate responsibilities, and protects Eloquent models against mass assignment by default; check the project’s installed version and model configuration. [Laravel validation](https://laravel.com/docs/validation), [Eloquent mass assignment](https://laravel.com/docs/eloquent#mass-assignment)

**Do not apply when:** The write uses a fixed internal payload with no request-controlled fields. Do not flag use of create or fill alone without tracing the data and model configuration.

## Casts and returned values

**Trigger:** A cast, accessor, mutator, date conversion, JSON field, or encrypted attribute changes.

**Check and act:** Compare the stored representation, value returned to callers, and serialized response. Add or update tests for nulls, malformed values, and round trips when relevant. [Eloquent casts](https://laravel.com/docs/eloquent-mutators)

**Do not apply when:** The cast is unchanged and the change does not alter persistence or serialization. Do not prescribe a cast based only on a column name.

## Relationship loading

**Trigger:** A loop accesses Eloquent relationships, or a query changes its loading strategy.

**Check and act:** Inspect query count and result cardinality for representative callers. Add only the relationships needed for the response; eager loading can prevent N+1 queries, but relation traversal can still create them. [Eloquent relationships](https://laravel.com/docs/eloquent-relationships)

**Do not apply when:** The affected path does not load relations or has no repeated query behavior. Do not eager-load every relation as a general rule.

## Transaction ownership

**Trigger:** A use case performs multiple writes, or a failure can leave partial state.

**Check and act:** Find the existing transaction owner and follow success, exception, and rollback behavior. Laravel’s transaction helper commits successful closures and rolls back when they throw; assess the installed version and the full side-effect path before recommending a boundary. [Laravel database transactions](https://laravel.com/docs/database#database-transactions)

**Do not apply when:** The operation is read-only, atomic under its existing owner, or has an explicit recovery contract that does not use a database transaction. Do not add nested or controller-level transactions without tracing ownership.

## Specialist handoffs

**Trigger:** A review requires query plans, locking, isolation, schema strategy, or detailed authorization/security analysis.

**Check and act:** Send database behavior to database-reviewer, security findings to security-reviewer, and DDL or migration deployment concerns to migration-reviewer. Include the query or state transition that establishes the concern.

**Do not apply when:** The issue is limited to a local validation, cast, or relation contract that this review can establish.
