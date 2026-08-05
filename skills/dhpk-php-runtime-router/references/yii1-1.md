# Yii 1.1 Reference

## Contents

- Scope
- Upgrade-Ready Principles (Yii 1.1 + PHP 5.6)
- Entry Script
- Application Configuration
- Controllers and Actions
- Filters and Access Control
- URL Routing
- Active Record Basics
- Active Record Relations
- Fragment Caching
- Upgrade Tips Toward PHP 7.4
- Notes
- References

## Scope

Use this reference for legacy Yii 1.1 applications. Prefer patterns that keep the codebase upgrade-ready for PHP 7.4.
If the repository is `<your-project>`, also read `CLAUDE.md` and `references/phpunit57-<your-project>.md` for project-specific runtime and testing traps.

## Upgrade-Ready Principles (Yii 1.1 + PHP 5.6)

- Keep controllers thin; move business logic to services or model methods.
- Add PHPDoc for properties and method signatures to prepare for future type hints.
- Avoid dynamic property creation; define all model properties and accessors explicitly.
- Centralize configuration and avoid runtime `require` scattering.
- Use dependency injection patterns where possible (even if manual) to reduce globals.
- Validate scenario-safe attributes before mass assignment.
- Keep DAO / SQL queries on bound parameters and repository-proven query patterns.
- Add tests for controllers and models before refactors.
- Avoid deprecated PHP features listed in `references/php56-legacy.md`.

## Entry Script

```php
<?php
// remove the following line when in production mode
defined('YII_DEBUG') or define('YII_DEBUG', true);
require_once('path/to/yii/framework/yii.php');
$configFile = 'path/to/config/file.php';
Yii::createWebApplication($configFile)->run();
```

## Application Configuration

```php
<?php
return array(
    'import' => array(
        'application.models.*',
        'application.components.*',
    ),
    'modules' => array(
        'gii' => array(
            'class' => 'system.gii.GiiModule',
            'password' => 'pick a password',
        ),
    ),
);
```

## Controllers and Actions

```php
<?php
class SiteController extends CController
{
    public function actionIndex()
    {
        // ...
    }

    public function actionContact()
    {
        // ...
    }
}
```

## Filters and Access Control

```php
<?php
class PostController extends CController
{
    public function filters()
    {
        return array(
            'accessControl',
            'postOnly + edit, create',
        );
    }
}
```

## URL Routing

```php
<?php
return array(
    'post/<year:\\d{4}>/<title>' => 'post/read',
);
```

## Active Record Basics

```php
<?php
class Post extends CActiveRecord
{
    public static function model($className=__CLASS__)
    {
        return parent::model($className);
    }

    public function tableName()
    {
        return 'tbl_post';
    }
}
```

## Active Record Relations

```php
<?php
class User extends CActiveRecord
{
    public function relations()
    {
        return array(
            'posts' => array(self::HAS_MANY, 'Post', 'author_id',
                'order' => 'posts.create_time DESC',
                'with' => 'categories'),
            'profile' => array(self::HAS_ONE, 'Profile', 'owner_id'),
        );
    }
}
```

## Fragment Caching

```php
<?php if ($this->beginCache($id)) { ?>
    <!-- cached content -->
<?php $this->endCache(); } ?>
```

## Upgrade Tips Toward PHP 7.4

- Start replacing array-based configs with explicit classes gradually (when possible).
- Remove any `create_function()` usage in extensions or helpers.
- Ensure all models use `__construct` if custom constructors exist.
- Add CI checks to run the app under PHP 7.4 in a staging environment.

## Notes

- Prefer `CActiveRecord` for DB access and `CController` for request handling.
- Use `import` to autoload models and components.
- Use `filters()` and `accessControl` for authorization.
- Gii is optional and should be disabled in production.

## References

- Yii 1.x Guide and API (Yii GitHub docs)
