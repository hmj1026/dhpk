# PHP Testing (PHPUnit 5.7, <your-project>)

> Extends `~/.claude/rules/common/testing.md`. Full standards: `<PROJECT_TEST_STANDARDS>`.

## Suite Layout

- `unit/` — no `Yii::app()` / DB
- `integration/` — Yii + DB; InnoDB → `IntegrationTestCase` (auto rollback); MyISAM → manual setUp/tearDown cleanup
- `functional/` — E2E

## Docker Commands (`-i` required, else WSL hangs)

```bash
docker exec -i -w <container-workdir> ${PHP_CONTAINER:-php} phpunit -c protected/tests/phpunit.xml [--testsuite unit|integration]
docker exec -i -w <container-workdir> ${PHP_CONTAINER:-php} phpunit -c protected/tests/phpunit-fast.xml  # ~330ms, Domain+Infrastructure only
```

## PHPUnit 5.7

- `public function testXxx()` — not `@test`
- `assertSame()` over `assertEquals()` (strict type + value)
- Exceptions: `@expectedException` or `setExpectedException()`
- `createMock()` (all stubbed, returns null) ≠ `getMockBuilder()->setMethods(null)` (calls real methods)
- Naming: `test[Subject]_[Condition]_[ExpectedOutcome]` — e.g. `testGoldMemberPurchase1000_shouldReceive100Discount()` (rule body in common/testing.md `Test Naming`)

## Bad Test Patterns — PHPUnit 5.7 syntax mapping
>
> Pattern names (Giant / Inspector / Flicker / Silent / Chain / Mockery) are defined in `~/.claude/rules/common/testing.md`; the table below lists only the PHPUnit 5.7 symptom and fix.

| Pattern | PHPUnit 5.7 Symptom | Fix |
|---------|---------------------|-----|
| Giant | `setUp()` > 30 lines | Extract `createXxx($overrides = array())` factory |
| Inspector | `expects($this->once())->method('internalStep')` | Assert observable output only |
| Flicker | `date()` / `time()` / `rand()` in test body | Inject clock via constructor |
| Silent | `assertTrue(true)` / empty `catch {}` | `addToAssertionCount(1)` or assert real outcome |
| Chain | Test B relies on static state from Test A | Each test seeds own fixtures; reset in `tearDown()` |
| Mockery | Mock stubs > assertions; mocks non-existent contracts | Mock direct deps only |

## Common Traps

| Trap | Fix |
|------|-----|
| `unit/` uses `Yii::app()` / DB | Move to `integration/` |
| ORDER BY asserted with `strcmp()` | Use `strcasecmp()` (MySQL utf8_unicode_ci) |
| SELECT omits asserted column | Add column to SELECT |
| Integration no rollback | `tearDown()`: `$txn->rollback()` |
| MyISAM table + `IntegrationTestCase` | MyISAM has no tx support; use manual cleanup; `SHOW TABLE STATUS` to confirm engine |
| Fixture class name 不匹配 production guard regex（如測 `^(Test\|Debug)\w*Controller$` 卻命名 `FakeTestController`） | Fixture 命名要實際匹配 guard pattern（如 `TestFixtureGuardController` 而非 `FakeTestGuardController`），否則 positive case 被擋在 guard 外、test 變成 silent |
| ob_start 包覆 action 但只斷 exit code，echo 內的 `[ERROR]` 訊息被吞掉找不到原因 | exit 非 0 時先 `var_dump($stdout)` 看 echo 訊息（如 BackfillSystexGhostRedeemCommand 的 `auditOut 超出 projectRoot 範圍`） |
| Print_r style log parser fixture 時間戳含日期前綴（`2026-05-18 09:30:00`） | parser regex 只命中 bare `HH:MM:SS`；含日期前綴的行被忽略、entry time 留空。fixture 必只放 bare 時間戳行 |

## E2E

Login accounts and full login flow: see skill `<your-project>-environment`, section "POS UI Login (playwright-cli)" (credentials live in the gitignored local file `.claude/artifacts/accounts.md` — never checked in).
```bash
playwright-cli snapshot https://<app-host>/dev3/<controller>/<action>
```
UI / post-fix verification only. Business logic → PHPUnit.

## Baseline invariant（hard rule）

`develop` 與 `main` long-lived branch 的 PHPUnit baseline MUST 為 0 error / 0 failure / 0 skip / 0 risky。任何 PR 進入 develop 前 MUST 維持此 invariant。

| 違反情境 | 處理 |
|---------|------|
| Source class 刪除 → 留下 orphan test | PR 同時 `git rm` 對應 test 檔（`include() failed` errors 必清） |
| Test mock 對應 createCommand，但 impl 已升級至 queryBuilder | 改寫 mock 對齊新 API；無法重寫者刪除（test 對 impl 0 命中是「假通過」） |
| 對應 schema 欄位本機 / dev DB 不存在 | 建 migration 補欄位後 enable test，或刪除 test + 標明「待 schema migration 後加回」 |
| 動到 super-global（$_SESSION / $_SERVER） | 補 setUp/tearDown snapshot/restore（cf. `integration-test-state-isolation` capability） |
| MyISAM 表（無 transaction rollback） | 補手動 `tearDown()` DELETE；用 sentinel pre-key 而非 prod-style key 避免衝突 |

**Skip 政策**：暫時 skip 必須在 commit message 標明 `WHY: <原因>` + `TRACKED IN: <ticket-id>` + `REMOVE BY: <YYYY-MM-DD or condition>`。長期 skip = 該 test 已不應存在，刪除而非 skip。

> 詳細治理：`openspec/specs/phpunit-baseline-zero/spec.md`（從 `cleanup-develop-phpunit-baseline-debt` change archive 同步）。
