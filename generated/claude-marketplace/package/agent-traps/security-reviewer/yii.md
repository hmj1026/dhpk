# security-reviewer — Yii 1.1 traps

Yii 1.1 OWASP lanes for `security-reviewer`. Deeper Yii security patterns: `skills/dhpk-yii1-security-audit/references/yii1-security-patterns.md`. Headers / cookie flags / Strict-Transport-Security — see `modules/yii-1.1/references/security.md`.

| Trigger | Action | Non-apply |
| --- | --- | --- |
| CRITICAL — SQL string concat | `:param` + `bindParam` or `CDbCriteria::compare()` | |
| CRITICAL — Uncast input in `ORDER BY` / `LIMIT` | Whitelist + `(int)` cast | |
| CRITICAL — Unescaped echo of user data | `CHtml::encode($x)` | JSON APIs use `CJSON::encode` / `json_encode`, not `CHtml::encode` |
| CRITICAL — Sensitive action without `Yii::app()->user->isGuest` | Throw `CHttpException(403)` | |
| CRITICAL — Resource ownership not checked | Compare `owner_id` vs `Yii::app()->user->id` | |
| CRITICAL — Hardcoded secret | `getenv('X')` + `.env` | |
| CRITICAL — Plain / MD5 / SHA1 password | `password_hash($pw, PASSWORD_BCRYPT)` + `password_verify` | |
| CRITICAL — User data into `eval` / string-arg `setTimeout` / `Function` ctor | `JSON.parse` or whitelisted mapper | |
| HIGH — `unserialize($userData)` | `json_decode($userData, true)` + schema | |
| HIGH — Manual POST form lacks CSRF | `CActiveForm` or `CHtml::hiddenField(Yii::app()->request->csrfTokenName, ...)` | |
| HIGH — Error response leaks SQL / stack | Generic msg in the response; detail routed to the project's structured logger | |
| HIGH — Logs hold PAN / passwords / tokens | Mask: PAN last-4, mid-mask phone, password `[REDACTED]` | |
| HIGH — File upload: ext / MIME / size unchecked | Whitelist + `finfo_file()` + cap + outside webroot | |
| HIGH — XML parse without entity loader off | `libxml_disable_entity_loader(true)` | |
| MEDIUM — Login / API endpoint without rate limit | Per-IP login counter; per-user API counter (Yii cache or redis) | |
| MEDIUM — State-changing form without anti-replay | Idempotency key or single-use nonce | |

## Worked example

```php
// BAD — no ownership check: any logged-in user can read any order
$order = Order::model()->findByPk($_GET['id']);
// GOOD — scope the resource to the current principal
$order = Order::model()->findByPk($_GET['id']);
if ($order->owner_id !== Yii::app()->user->id) throw new CHttpException(403);
```
