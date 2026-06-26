# security-reviewer — Yii 1.1 traps

| Pattern | Severity | Fix |
|---------|----------|-----|
| SQL string concat | CRITICAL | `:param` + `bindParam` or `CDbCriteria::compare()` |
| Uncast input in `ORDER BY` / `LIMIT` | CRITICAL | Whitelist + `(int)` cast |
| Unescaped echo of user data | CRITICAL | `CHtml::encode($x)` |
| Sensitive action without `Yii::app()->user->isGuest` | CRITICAL | Throw `CHttpException(403)` |
| Resource ownership not checked | CRITICAL | Compare `owner_id` vs `Yii::app()->user->id` |
| Hardcoded secret | CRITICAL | `getenv('X')` + `.env` |
| Plain / MD5 / SHA1 password | CRITICAL | `password_hash($pw, PASSWORD_BCRYPT)` + `password_verify` |
| User data into `e​v​a​l` / string-arg `setTimeout` / `Function` ctor | CRITICAL | `JSON.parse` or whitelisted mapper |
| `unserialize($userData)` | HIGH | `json_decode($userData, true)` + schema |
| Manual POST form lacks CSRF | HIGH | `CActiveForm` or `CHtml::hiddenField(Yii::app()->request->csrfTokenName, ...)` |
| Error response leaks SQL / stack | HIGH | Generic msg in the response; detail routed to the project's structured logger |
| Logs hold PAN / passwords / tokens | HIGH | Mask: PAN last-4, mid-mask phone, password `[REDACTED]` |
| File upload: ext / MIME / size unchecked | HIGH | Whitelist + `finfo_file()` + cap + outside webroot |
| XML parse without entity loader off | HIGH | `libxml_disable_entity_loader(true)` |
| Login / API endpoint without rate limit | MEDIUM | Per-IP login counter; per-user API counter (Yii cache or redis) |
| State-changing form without anti-replay | MEDIUM | Idempotency key or single-use nonce |

JSON output uses `CJSON::encode()` / `json_encode()`, **not** `CHtml::encode()`. Headers / cookie flags / Strict-Transport-Security — see `.claude/rules/php/security.md`.

Deeper Yii security patterns: modules/yii-1.1/skills/yii1-security-audit/references/yii1-security-patterns.md
