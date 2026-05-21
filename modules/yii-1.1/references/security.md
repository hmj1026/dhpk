# PHP Security (<your-project>-specific)

> Extends `~/.claude/rules/common/security.md`. Generic OWASP / authn / XSS assumed known; this file lists only Yii 1.1 mappings and project traps.

## Yii 1.1 Mappings

| Topic | Rule |
|-------|------|
| **SQL** | PDO bind: `$cmd->bindParam(':id', $id, PDO::PARAM_INT)`; or AR `Order::model()->findByPk($id)` |
| **IN / NOT IN** | `$c = new CDbCriteria(); $c->addInCondition('col', $ids);` — **forbidden**: `"col IN ({$str})"` string interpolation |
| **XSS** | All output via `CHtml::encode($v)` |
| **CSRF** | `CActiveForm::beginWidget()` auto-attaches; hand-rolled forms must add `<?= Yii::app()->request->csrfTokenName ?>` |
| **Auth** | `if (Yii::app()->user->isGuest) throw new CHttpException(403);` |
| **Authz** | Verify resource ownership before mutation (not just isGuest) |
| **Input** | Model `rules()`: `['email','email']`, `['status','in','range'=>[...]]` |
| **Secrets** | `getenv('API_KEY')` from `.env`; no hardcoding |
| **Upload** | Extension whitelist + `$_FILES['size']` check + store outside webroot |
| **Session** | cookie `httponly => true, secure => true` |
| **Headers** | Base controller `header('X-Frame-Options: SAMEORIGIN')` |

## Commit-time checklist

PDO bind for SQL / IN via `CDbCriteria` / output via `CHtml::encode` / controller checks `!isGuest` + ownership / no hardcoded secrets / upload whitelist / cookie httponly+secure.

> Examples → `php-pro` skill `references/php56-legacy.md`.
