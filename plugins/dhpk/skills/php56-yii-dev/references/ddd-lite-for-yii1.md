# Pragmatic DDD For Yii 1.x

Use DDD as a tool for separating responsibilities, not as mandatory ceremony.

Source basis: Context7 queries against `/lunarstorm/laravel-ddd`, adapted as lightweight structural guidance rather than framework-specific rules.

## Layer mapping

Use this default mapping:

- Presentation: Controller, input model, response formatting
- Application: use case orchestration, transactions, permission checks, coordination across repositories or services
- Domain: entities, value objects, policies, calculations, invariants
- Infrastructure: CActiveRecord, DAO, cache, HTTP clients, queue adapters, filesystem, third-party integrations

This structure is adapted from Context7 DDD examples that separate Domain, Application, and Infrastructure concerns, then translated into Yii 1.x terms.

## Introduce a Value Object when

- the concept has rules beyond primitive validation
- equality by value matters
- the same formatting or normalization logic repeats
- mistakes would be costly, such as money, status, identifier, quantity, or date range

## Introduce an Application Service when

- one request coordinates multiple repositories or models
- a workflow spans validation, authorization, persistence, and side effects
- the Controller is becoming orchestration-heavy

## Introduce a Domain Service when

- a rule does not naturally belong to a single Entity or Value Object
- a calculation or policy needs multiple domain inputs
- the behavior is domain logic, not transport or persistence logic

## Introduce a Repository when

- the domain logic should not know whether the data comes from CActiveRecord, DAO, cache, or another system
- query complexity is obscuring the use case
- tests need a stable boundary around persistence

## Keep it light

Do not force DDD patterns when:

- the action is simple CRUD with little business logic
- a thin service method and one AR model already express the behavior clearly
- extra abstractions would only mirror the framework without adding meaning

The goal is clearer change boundaries, not a larger class count.
