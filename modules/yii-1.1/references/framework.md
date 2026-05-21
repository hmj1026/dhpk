# Yii 1.1 Framework (<your-project>-specific)

Framework source: `<YII_FRAMEWORK_PATH>`.

## DDD Call Chain

```
Controller → $this->app()->{service}->fetchXxx() → Repository->forXxx()
```

`$this->app()` defined in `protected/controllers/traits/DomainApplicable.php`.

## Namespace Autoload

Entry: **project root** `setPathOfAlias.php` (not in `protected/`); required by `protected/config/{env}.php` before `return`. Mounts:

```php
Yii::setPathOfAlias('Infrastructure', __DIR__ . '/infrastructure/');
Yii::setPathOfAlias('Domain',         __DIR__ . '/domain/');
```

New classes auto-load when filename + namespace align. **Do not** touch `composer.json` (its only role is `autoload-dev` for `application\tests\`).

`class not found` triage: (1) case match (Linux is case-sensitive); (2) first namespace segment matches an alias; (3) the current env config actually requires `setPathOfAlias.php`.

## PayTypeGroup Constants (`domain/Models/PayTypeGroup.php`)

No magic strings.

| Constant | Value |
|----------|-------|
| `THIRD_PARTY` | `'3rdParty'` |
| `MULTI_PAY` | `'multiPay'` |
| `TOTAL_PAY` | `'TotalPay'` |
| `TICKET` | `'ticket'` |

## Refs

- MySQL collation trap (`strcasecmp` vs `strcmp`) → `testing.md`
- EILogger usage → `.claude/docs/eilogger.md`
