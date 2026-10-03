# Yii 1.x Backend Patterns

Use this file for controllers, validation, models, DAO, and request handling on a Yii 1.1 baseline.
Source basis: dhpk-authored guidance; general practice and public Yii 1.1 / PHP / PHPUnit facts, written without copying upstream text.

## Controllers

Keep actions thin. An action should only:

- read request data;
- pick or build the scenario;
- hand off to an application or domain service, or to a model;
- turn the result into a redirect, a rendered view, JSON, or an error.

Validation rules, calculations, and persistence-heavy logic do not belong in the controller; trivial glue code is the only exception. Business rules and SQL orchestration always live outside it.

## Validation and scenarios

- Declare rules in `rules()`; use scenarios to decide which of them apply.
- The rules active in a scenario define which attributes are safe for that scenario.
- An attribute that needs no validation but must be mass-assignable needs an explicit `safe` rule.
- For mass assignment, set the scenario first, then assign only a trusted, expected array.
- Never assume every posted attribute is safe, and never mass-assign attributes not declared safe for the active scenario.

```php
$form = new ProfileForm('update');
$input = Yii::app()->request->getPost('ProfileForm', []);
$form->attributes = is_array($input) ? $input : [];
if (!$form->validate()) {
    $this->render('edit', ['model' => $form]);
    return;
}
$this->profileService->update(Yii::app()->user->id, $form);
```

## CFormModel or CActiveRecord

Use a `CFormModel` or another dedicated input model when:

- the request shape does not match a table;
- validation belongs to one use case rather than to the stored record;
- several models or side effects are involved.

Use `CActiveRecord` when:

- persistence is single-table and table-centric;
- you need relations, scopes, and standard CRUD.

Keep AR to persistence mapping plus local invariants. As workflows start spanning entities, move them out into services.

## Active Record baseline

- Provide the standard `public static function model($className = __CLASS__)`.
- Declare `tableName()` explicitly.
- Use relations, scopes, and finders for table concerns.
- Do not let AR grow into the entire application layer.

## DAO and query safety

- Write custom queries in a DAO or repository and bind every parameter.
- Never concatenate request data into SQL.
- If part of the SQL structure varies, validate that part first, then bind the values.
- Identifiers and sort input go through an allow-list.

## Request handling

- Read input through the request component or a dedicated input adapter.
- Normalize and validate before anything reaches domain logic.
- Treat mass-assigned data, filters, sort parameters, and identifiers as hostile until validated.
