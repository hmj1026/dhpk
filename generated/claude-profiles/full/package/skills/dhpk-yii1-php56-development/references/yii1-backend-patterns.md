# Yii 1.x Backend Patterns

This reference summarizes Yii guidance that remains safe for generic Yii 1.x backend work, with Yii 1.1 used as the primary behavioral baseline.

Source basis: Context7 queries against `/yiisoft/yii`.

## Controllers

Keep Controllers thin:

- read request data
- select or construct the right scenario
- delegate business work to an Application Service, Domain Service, or model boundary
- map the result to redirect, view, JSON, or error response

Do not put validation rules, calculations, or persistence-heavy logic directly in the Controller unless the code is trivial glue.

## Validation and scenarios

- Define validation in `rules()`.
- Use scenarios to control which rules apply.
- In Yii, validation rules also determine which attributes are safe for mass assignment in that scenario.
- If an attribute needs mass assignment without validation, declare it explicitly with the `safe` rule.

When using mass assignment:

- set the scenario first
- assign only trusted model arrays
- do not assume every posted attribute is safe

## FormModel and CActiveRecord

Prefer `CFormModel` or a dedicated input model when:

- the request shape differs from the persistence shape
- validation belongs to a use case rather than a table row
- multiple models or side effects participate in one action

Prefer `CActiveRecord` when:

- one table-centric persistence model is appropriate
- relations, scopes, or standard CRUD behavior are the main concern

Keep CActiveRecord focused on persistence mapping and local invariants. Move cross-entity workflows and domain rules outward when complexity grows.

## Active Record baseline

For Yii 1.x AR classes:

- include the standard static `model($className=__CLASS__)` method
- keep `tableName()` explicit
- use relations, scopes, and finder methods for table concerns
- avoid turning the AR class into the full application layer

## DAO and query safety

- Use DAO or repository methods with parameter binding for custom queries.
- Bind values instead of concatenating request data into SQL.
- If SQL structure must vary, validate the dynamic part first, then bind values normally.

## Safe request handling

- Read request values through the framework request boundary or a dedicated input adapter.
- Normalize and validate user input before it reaches domain logic.
- Treat mass assignment, query filters, sorting inputs, and identifiers as hostile until validated.
