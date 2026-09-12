# silent-failure-hunter — PHP / Yii swallow patterns

Activate when `php-5.6` / `yii-1.1` is active (or `composer.json` declares `php` / `yiisoft/*`).

| Trigger | Action | Non-apply |
|---------|--------|-----------|
| `catch (\Exception $e)` that neither logs nor rethrows | Flag per the project's catch policy (project convention: e.g. an app logger + domain logger) | Catch that logs then returns a documented fallback |
| `queryRow()` returning `false` silently treated as success | Flag the silent success; `false` is not a row | AR `findByPk` null (that's AR, not DAO `queryRow`) |
