---
name: legacy-code-characterization
description: "Write characterization tests for untested legacy code to lock current behavior before refactoring. Use when users want to safely refactor legacy controllers/models/services, add regression safety nets, or prepare code for extraction. Trigger words: characterization test, lock behavior, legacy test, safe refactor, 行為鎖定, 特徵測試, 安全重構. Not for: greenfield code, already well-tested modules, or pure bug fixes. Output: characterization test files + coverage delta report."
---

# Legacy Code Characterization Skill

## 概述

針對無測試或低測試覆蓋率的 legacy code，撰寫 characterization tests（特徵測試）以鎖定現有行為，為後續重構提供安全網。

此技術來自 Michael Feathers 的《Working Effectively with Legacy Code》。核心思想：
**先觀察程式實際在做什麼，把觀察到的輸出寫成 assertion，讓它通過（GREEN），再開始重構。**

## When to Use

- 準備重構超過 300 行的 legacy class / controller
- 需要為關鍵業務邏輯建立回歸測試，但無法修改現有結構
- 測試覆蓋率提升計畫中的 legacy 模組
- 提取 Service / Repository 前的行為快照

## When NOT to Use

- 新功能開發（用 TDD 流程）
- 已有充分測試的模組
- 純 bug fix 且根因明確

---

## Characterization Test 生命週期

Characterization tests 不是永久存在的，有明確三段生命週期：

1. **鎖定（Lock）**：寫 characterization test，執行確認 GREEN → 行為已鎖定
2. **重構（Refactor）**：安全重構目標程式碼，測試持續 GREEN 代表行為不變
3. **提取（Extract）**：重構完成後，抽出 pure unit test 承接輸出契約；characterization test 可退役或保留為回歸

> 典型路徑：`LegacyClassCharacterizationTest`（鎖定原始行為）→ 抽出 `XxxNormalizer` → `XxxNormalizerTest`（pure unit 承接）→ characterization test 退役

---

## 工作流程

### Phase 1: 行為盤點

1. 閱讀目標檔案，列出所有公開方法
2. 識別外部依賴（DB query、外部 API、全域 state、singleton）
3. 標記高風險方法（涉及金額、付款、庫存、資料寫入）
4. 確認既有測試覆蓋狀況
5. 產出方法清單 + 依賴清單

```
格式：
| 方法 | 行數 | 依賴 | 風險等級 | 現有測試 |
|------|------|------|---------|---------|
| actionCheckout | 45-120 | DB, PaymentAPI | HIGH | 無 |
| calcDiscount   | 30-55  | 無              | LOW  | 無 |
```

**大型 class（trait-heavy / 數千行）注意事項：**
- 不嘗試整體覆蓋；以**高風險方法優先**
- 多 trait 混入時，明確標記測試覆蓋的是哪個 trait 的行為
- 優先選擇**邊界清楚的 public methods**，避免深度依賴 HTTP 或 global state

### Phase 2: 測試策略選擇

根據依賴類型選擇測試層級：

| 依賴類型 | 建議層級 | 特性 |
|---------|---------|------|
| 純計算（無外部依賴） | Unit test | 最快、最穩定 |
| 需要 DB，但可 mock | Unit test + stub | 隔離 DB，測試邏輯 |
| 需要真實 DB 讀寫 | Integration test | 使用 transaction rollback 隔離 |
| 需要外部 API | Integration/Unit + mock | mock 外部 API，觀察本地邏輯 |
| 需要完整 HTTP 流程 | Functional / E2E | 成本最高，謹慎使用 |

**選擇原則**：盡量往上移（unit 優先），只有在真正需要真實環境時才選 integration/functional。

#### DB Transaction Isolation 模式

需要真實 DB 的 integration tests，用 transaction rollback 防止污染：

```php
class OrderControllerCharacterizationTest extends TestCase
{
    private $transaction;

    protected function setUp()
    {
        parent::setUp();
        // 搜尋你的專案是否有提供 transaction base class
        // 若沒有，手動管理：
        $this->transaction = Yii::app()->db->beginTransaction(); // Yii 範例
        // 或 PDO：$this->pdo->beginTransaction();
    }

    protected function tearDown()
    {
        if ($this->transaction) {
            $this->transaction->rollback();
        }
        parent::tearDown();
    }
}
```

**提示**：許多框架已提供 transaction base class（如 Laravel 的 `RefreshDatabase` trait、Yii 的自訂 `IntegrationTestCase`）。先搜尋你的測試目錄是否已有這類工具，避免重複造輪子。

### Phase 3: 撰寫 Characterization Tests

**核心原則：測試現有行為，不是預期行為。**

```php
/**
 * 鎖定 LegacyClassName 現行行為契約的 characterization 測試。
 *
 * 這些測試記錄「程式目前怎麼做」而非「程式應該怎麼做」。
 * 重構後若此測試失敗，代表行為改變，需人工確認是否預期。
 *
 * 重構出口：(1) 抽出 XxxService，(2) 以 pure unit test 承接輸出契約
 *
 * @group characterization
 * @covers LegacyClassName
 */
class LegacyClassNameCharacterizationTest extends TestCase
{
    /**
     * 鎖定：calcDiscount 在折扣率 0.1 時返回原價 * 0.9。
     * 觀察到的現有行為，未驗證業務正確性。
     */
    public function testCalcDiscount_WithRate01_Returns90PercentOfOriginal()
    {
        $calculator = new LegacyClassName();

        // Step 1: 呼叫方法，觀察輸出
        $result = $calculator->calcDiscount(100, 0.1);

        // Step 2: 將觀察到的輸出寫成 assertion（不是「應該」的值，是「目前」的值）
        $this->assertSame(90.0, $result);
    }
}
```

#### 測試命名規則

- 類別名：`{OriginalClass}CharacterizationTest`
- 方法名：`testMethodName_WithCondition_ReturnsObservedBehavior`

#### 撰寫順序

1. 先寫一個最簡單的 happy path test
2. 執行確認 GREEN
3. 逐步增加 edge case（null input, 空陣列, boundary values）
4. 每個 test 都必須先 GREEN 才繼續下一個

#### Logger / Singleton 隔離

若目標 class 依賴 logger singleton 或其他 global instance，查看你的測試工具箱：
- 框架通常有對應的 test double（NullLogger、TestLogger）
- 若沒有，在 `setUp()` 替換 singleton instance，在 `tearDown()` 還原

#### External API 的 mocking

```php
// 用 mock 取代外部 API，觀察本地邏輯對 API 回應的處理
$paymentApi = $this->createMock(PaymentApiInterface::class);
$paymentApi->method('charge')
    ->willReturn(['status' => 'success', 'transaction_id' => 'T123']);

$service = new CheckoutService($paymentApi);
$result = $service->processPayment(100);

// 鎖定本地邏輯對 API 回應的處理行為
$this->assertSame('T123', $result->transactionId);
```

### Phase 4: 覆蓋率驗證

執行測試並檢視覆蓋率。**輸出此段時，保留通用佔位符，不填入任何專案特定的容器名稱、路徑或工具名稱。**

```bash
# 標準 Composer 專案
vendor/bin/phpunit --coverage-text --whitelist=src/LegacyClass.php tests/LegacyClassCharacterizationTest.php

# 全域安裝 phpunit
phpunit --coverage-text --whitelist=src/LegacyClass.php tests/LegacyClassCharacterizationTest.php

# 容器化環境（{container} 為佔位符，使用者自行替換為實際容器名稱）
docker exec -i {container} vendor/bin/phpunit --coverage-text \
  --whitelist=path/to/LegacyClass.php tests/LegacyClassCharacterizationTest.php
```

> 注意：輸出測試計畫時，容器化範例必須使用 `{container}` 佔位符，不可替換為目前專案的實際容器名稱或路徑。

**目標：目標 class 的公開方法覆蓋率 >= 60%**

高風險方法（涉及金額、付款、資料寫入）建議 100% 覆蓋。

### Phase 5: 文件記錄

在測試檔案頂部 PHPDoc 記錄：
- 哪些行為被鎖定
- 已知的 code smell 或技術債
- 重構出口（Extract exit path）

若測試放置目錄與依賴類型不符（例如 unit/ 目錄裡有 DB 依賴），在團隊的 test docs 中登錄例外與處理計畫。

---

## Output

- `tests/integration/{Module}/{ClassName}CharacterizationTest.php`（有 DB 依賴）
- `tests/unit/{Module}/{ClassName}CharacterizationTest.php`（純計算）
- 覆蓋率報告數據

## Verification

- [ ] 所有 characterization tests 均為 GREEN（不是 RED）
- [ ] 已加 `@group characterization` annotation
- [ ] 高風險方法（金額、付款）100% 覆蓋
- [ ] 每個 test PHPDoc 說明鎖定的行為
- [ ] 每個 test PHPDoc 有「重構出口」說明
- [ ] 測試不依賴執行順序（可獨立跑）
- [ ] 未修改任何 production code（純增加測試）
- [ ] Integration tests 有 transaction rollback（或等效清理機制）

## 注意事項

- **不修改 production code**：characterization test 的目的是記錄現況，不是修正
- **失敗的 assertion 代表你的理解有誤**，不是程式有 bug；修改 assertion，不是程式
- **`createMock()` ≠ partial mock**：`createMock()` stub 所有方法（全返回 null）；若需執行真實方法，用 `getMockBuilder()->setMethods(null)`，不可互換
- **越少 mock 越好**：characterization test 應盡量測試真實路徑，只 mock 無法控制的外部系統
