# silent-failure-hunter — PHP / Yii swallow patterns

Activate when `php-5.6` / `yii-1.1` is active (or `composer.json` declares `php` / `yiisoft/*`).

- A `catch (\Exception $e)` that neither logs (project convention: e.g. an app logger + domain logger) nor rethrows — flag per the project's catch policy.
- `queryRow()` returning `false` silently treated as success.
