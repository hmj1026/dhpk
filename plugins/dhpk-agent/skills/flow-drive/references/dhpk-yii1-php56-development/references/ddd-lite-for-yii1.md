# DDD Lite For Yii 1.x

Use this file to decide which layer owns a responsibility and whether a DDD building block earns its place.
Source basis: dhpk-authored guidance on general layering practice, written without copying upstream text.

## Stance

- Treat DDD as a way to separate concerns, not as a ritual to perform.
- Measure success by sharper change boundaries, not by the number of classes added.

## Where things live in a Yii 1.x app

| Layer | Owns |
|-------|------|
| Presentation | Controller actions, input (form) models, shaping the response |
| Application | Orchestrating a use case, opening and committing transactions, permission checks, coordinating several repositories or services |
| Domain | Entities, value objects, policies, calculations, invariants |
| Infrastructure | `CActiveRecord`, DAO, cache, HTTP clients, queue adapters, filesystem, third-party integrations |

## Add a Value Object when

- The concept carries rules that go past "is it a string / int".
- Two instances should be equal when their values are equal.
- The same formatting or normalization code keeps reappearing.
- A mistake is expensive: money, status, identifiers, quantities, date ranges.

## Add an Application Service when

- A single request touches more than one repository or model.
- The flow interleaves validation, authorization, persistence, and side effects.
- The controller action is turning into an orchestration script.

## Add a Domain Service when

- The rule does not naturally belong to any one entity or value object.
- A calculation or policy needs several domain inputs at once.
- The behavior is business logic, not transport or storage plumbing.

## Add a Repository when

- The domain should not care whether data comes from AR, DAO, cache, or another system.
- Query detail is drowning out what the use case is actually doing.
- Tests need a stable persistence seam to substitute.

## Keep it light

Do not force layers. When the task is plain CRUD with little business logic, skip these patterns:

- A thin service method plus one AR model is often the whole design.
- An abstraction that only mirrors a framework class adds names, not meaning.
- Introduce a building block only when one of the triggers above is actually present.
