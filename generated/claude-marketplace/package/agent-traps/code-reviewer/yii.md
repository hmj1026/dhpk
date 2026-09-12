# code-reviewer — Yii 1.1 traps

PHP language floor → `modules/php-5.6/references/coding-style.md`. Deeper Yii
security patterns → `skills/dhpk-yii1-security-audit/references/yii1-security-patterns.md`.
SQL injection as an OWASP finding → `security-reviewer/php.md` / `security-reviewer/yii.md`.

| Trigger | Action | Non-apply |
|---|---|---|
| `$_POST` / `$_GET` subscript in Domain or Infrastructure | `Yii::app()->request->getPost($key)` / `$this->Request->getPost($key)` | Controller-only whole-POST after a `getPost($key)` presence check, as coding-style already allows |
| ActiveRecord class missing `public static function model($className=__CLASS__)` | add `return parent::model($className);` | non-AR classes |
| `queryRow()` compared to `null` | check `if (!$result)` — DAO returns `false` on miss | `findByPk()` / AR, which returns `null` |
| String-concatenated SQL in a reviewer-visible query | bind `:param` PDO parameters | a query with no user/runtime fragments (static SQL) |
