# code-reviewer — Yii 1.1 traps

- Use `Yii::app()->request->getPost()`, never `$_POST` / `$_GET`.
- AR: `public static function model($className=__CLASS__) { return parent::model($className); }`.
- `queryRow()` returns `false` (not `null`) — check `if (!$result)`.
- All SQL via `:param` PDO binding, no string concatenation.
- Deeper Yii security patterns: `.codex/skills/yii1-security-audit/references/yii1-security-patterns.md`.
