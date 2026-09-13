# Yii 1.1 Framework (quick reference)

Stock-Yii 1.1 conventions for projects enabling this module. Project-specific
extensions (custom service locators, query builders, repository base classes,
loggers, enum bases) belong in your project's own docs — not here.

## Path Aliases & Autoload

Yii 1.1's autoload is alias-driven. Common entry point: `protected/config/main.php`
sets `Yii::setPathOfAlias('Foo', __DIR__ . '/path/')` so namespace `Foo\Bar`
resolves to `<path>/Bar.php` (class file must match the last segment).

`class not found` triage:

1. **Case match** — Linux is case-sensitive; Yii classmap relies on file name = class name.
2. **First namespace segment** is registered with `setPathOfAlias`.
3. **Bootstrap path** — for non-default environments, confirm the env-specific
   config actually `require`s your alias-registration file before `return`.

Avoid touching `composer.json` for runtime classes unless your project has
intentionally migrated runtime autoload from Yii aliases to Composer PSR-4.

## Controllers

- Extend `CController` (or your project's base controller if one exists).
- Action methods: `actionXxx`. Routing: `controller/action[/param/value]`.
- Render: `$this->render('view', ['key' => $value])`; partial: `$this->renderPartial(...)`.
- Redirect: `$this->redirect($this->createUrl('foo/bar'))`.
- Errors: `throw new CHttpException(403|404, 'msg')` — never echo + exit.
- CSRF: enabled via `CHttpRequest::$enableCsrfValidation = true` (config) +
  `<?= Yii::app()->request->csrfTokenName ?>` hidden field in forms.

## Active Record (`CActiveRecord`)

- Define in `protected/models/<Name>.php`; `model()` static factory; relations
  via `relations()` returning `BELONGS_TO|HAS_MANY|HAS_ONE|MANY_MANY` arrays.
- Eager load: `Model::model()->with('rel1','rel2')->findAll($criteria)` — avoids N+1.
- Lazy access (`$model->rel`) is OK for a single hit; never inside a loop.
- `findByPk`, `findByAttributes`, `findAll`, `findAllByAttributes` return models
  or arrays; `false` is also possible on miss for `findByPk`. Always null-check.

## `CDbCriteria` & query patterns

- Build conditions: `$criteria = new CDbCriteria(); $criteria->compare('col', $v);`
- IN / NOT IN: `$criteria->addInCondition('col', array_values($ids))` — guard
  empty arrays before `addNotInCondition` (Yii 1.1 will throw on empty arrays).
- Order/limit: `$criteria->order = 't.id DESC'; $criteria->limit = 50;`.
- Joins: `$criteria->with = ['rel']; $criteria->together = true;` (single query).
- Never string-interpolate user input into SQL — use bound parameters via
  `$criteria->params` or `CDbCommand::bindParam(':id', $id, PDO::PARAM_INT)`.

## Validation

- Define in `Model::rules()`: e.g.
  `['name', 'length', 'max' => 100]`,
  `['status', 'in', 'range' => ['active', 'inactive']]`,
  `['custom', 'ext.validators.XxxValidator']` (external file convention).
- Custom validator: `class XxxValidator extends CValidator` and implement
  `protected function validateAttribute($object, $attribute) { ... }`.

## DI / Component Registration

```php
// protected/config/main.php
'components' => [
    'myService' => [
        'class' => 'application.services.MyService',
        // constructor-like properties
    ],
],
```

Access: `Yii::app()->myService` (auto-loads on first access; singleton per request).

## XSS / Output Encoding

- HTML-escape inside views: `<?= CHtml::encode($user->name) ?>`.
- URL: `CHtml::link(CHtml::encode($title), $url)`.
- Never echo unescaped user input. The default view file extension is `.php`,
  so always wrap dynamic content in `CHtml::encode()` or the framework helper
  matching the context (URL / JS / CSS).

## Sessions, Auth, AccessRules

- `Yii::app()->user->isGuest`, `->getId()`, `->getName()`.
- `protected function accessRules()` in controllers; rule order matters
  (first-match wins). Always end with `['deny', 'users' => ['*']]` to fail closed.

## Logging

Yii 1.1 ships `CLogRouter` with file / db / email routes (config: `log.routes`).
Call `Yii::log($msg, $level, $category)`. Levels: `trace|info|profile|warning|error`.
Projects often layer a custom structured logger on top — consult your project's
docs for the canonical logging entry point.
