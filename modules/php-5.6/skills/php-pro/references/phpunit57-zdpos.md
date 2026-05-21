# PHPUnit 5.7 + PHP 5.6 測試規範（<your-project> 專用）

> ⚠️ **注意**：本文件針對 <your-project> 專案（PHP 5.6 + PHPUnit 5.7）。若參考 `testing-quality.md` 中的 PHP 8.3+ 語法，會導致程式碼無法執行。

## 內容索引

- 與 testing-quality.md 的關鍵差異
- PHPUnit 5.7 API 對照表
- assertEquals vs assertSame 決策樹
- float 精度問題與測試處理
- setExpectedException 與 @expectedException
- getMockBuilder 與 createMock 安全轉換
- 測試方法命名規範（禁止 shouldXxx / it_xxx）
- MySQL collation 與排序驗證
- SELECT 欄位與測試驗證對齐
- PHPUnit 5.7 特殊行為
- 常見陷阱清單
- 參考資源

## 與 testing-quality.md 的關鍵差異

| 功能 | testing-quality.md（PHP 8.3+） | <your-project>（PHP 5.6 + PHPUnit 5.7） |
|------|------|------|
| 測試命名 | `#[Test]` attribute | ❌ 禁用 `@test`（Wave 5 已全面移除） / ✅ 用 `testXxx()` 命名 |
| 數據提供者 | `#[DataProvider]` attribute | ✅ `@dataProvider` PHPDoc |
| 異常驗證 | `expectException()` 方法 | ❌ PHPUnit 6+ / ✅ `setExpectedException()` |
| 型別斷言 | `assertIsArray()` / `assertIsString()` | ❌ PHPUnit 6+ / ✅ `assertInternalType()` |
| 返回型別 | `function setUp(): void` | ❌ PHP 5.6 不支援 / ✅ `function setUp()` |
| 嚴格型別 | `declare(strict_types=1)` | ❌ PHP 5.6 不支援 / ✅ 禁用 |
| PHPDoc | Optional（有型別提示時） | ✅ **必須**（無型別提示） |

---

## PHPUnit 5.7 API 對照表

### 斷言方法

| 操作 | PHPUnit 5.7 語法 | 備註 |
|------|------|------|
| 驗證相等 | `$this->assertEquals($expected, $actual)` | 會進行型別轉換（如 `'5'` == `5` 通過） |
| 驗證完全相等 | `$this->assertSame($expected, $actual)` | 嚴格型別檢查（`'5'` === `5` 失敗） |
| 驗證布林 | `$this->assertTrue($actual)` / `assertFalse()` | 對象 / 流程 |
| 驗證 null | `$this->assertNull($actual)` | 驗證變數為 null |
| 驗證非 null | `$this->assertNotNull($actual)` | 驗證變數非 null |
| 驗證陣列鍵 | `$this->assertArrayHasKey($key, $array)` | 驗證陣列鍵存在 |
| 驗證型別 | `$this->assertInternalType($type, $value)` | `$type` = `'array'`, `'string'`, `'int'`, `'float'`, `'bool'` |
| 驗證異常 | `$this->setExpectedException(ExceptionClass::class)` | 放在 act 之前；或用 PHPDoc `@expectedException` |
| 驗證計數 | `$this->assertEquals(2, count($array))` | 用 assertEquals 或 assertCount |

### 異常測試

**PHPUnit 5.7 語法（本專案）：**

```php
// 方式 1：setExpectedException（推薦）
public function testCalculateThrowsOnNegative() {
    $this->setExpectedException('InvalidArgumentException', 'cannot be negative');

    $service = new OrderService();
    $service->calculateTotal(-10); // 應拋出異常
}

// 方式 2：@expectedException PHPDoc
/**
 * @expectedException InvalidArgumentException
 * @expectedExceptionMessage cannot be negative
 */
public function testCalculateThrowsOnNegative() {
    $service = new OrderService();
    $service->calculateTotal(-10);
}
```

❌ **PHPUnit 6+ 語法（禁用）：**
```php
$this->expectException(InvalidArgumentException::class);
$this->expectExceptionMessage('cannot be negative');
```

### Mock / Stub

**PHPUnit 5.7 語法：**

```php
// 建立 Mock（有期望）
$mock = $this->getMock('ClassName');
$mock->expects($this->once())
    ->method('save')
    ->willReturn(true);

// 建立 Mock（無期望，方法返回固定值）
$stub = $this->getMock('ClassName');
$stub->method('findById')
    ->willReturn($order);

// 建立 Mock（含 setMethods，常見於遺留代碼）
$mock = $this->getMock('ClassName', ['save', 'delete']);

// 建立簡單 Mock（PHPUnit 5.7 可用，但需檢查環境）
$mock = $this->createMock('ClassName'); // 無 setMethods，檔案改後才安全轉換
```

---

## assertEquals vs assertSame 決策樹

**關鍵原則**：<your-project> 大部分測試應使用 `assertSame`（嚴格型別），但有例外。

### 型別相同時 → assertSame

```php
// String 比較
$this->assertSame('pending', $order->status);

// Integer 比較
$this->assertSame(100, $order->amount);

// Boolean 比較
$this->assertSame(true, $service->isValid());

// Null 比較
$this->assertNull($result); // 同 assertSame(null, $result)
```

### 型別不一致或浮點數 → assertEquals 或例外

**情景 1：DB 轉型（字串 → 整數）**

```php
// ❌ 錯誤：MySQL 返回字串，但程式轉為整數，assertSame 會失敗
$result = $this->repository->findById(1);
$this->assertSame(100, $result['amount']); // DB 返回 '100'（字串）

// ✅ 正確做法 A：使用 assertEquals（允許型別轉換）
$this->assertEquals(100, $result['amount']);

// ✅ 正確做法 B：明確轉型後再用 assertSame
$this->assertSame(100, (int)$result['amount']);

// ✅ 正確做法 C：記錄到 TEST_QUALITY_OVERRIDES.md
// 原因：MySQL utf8_unicode_ci 轉換字串，程式需手動轉型
```

**情景 2：浮點數精度問題**

```php
// ❌ 錯誤：浮點數四捨五入誤差
$this->assertSame(0.3, 0.1 + 0.2); // 失敗：0.1 + 0.2 = 0.30000000000000004

// ✅ 正確做法 A：assertEquals 加 delta（容差）
$this->assertEquals(0.3, 0.1 + 0.2, 0.0001);

// ✅ 正確做法 B：使用四捨五入
$this->assertSame(30, round((0.1 + 0.2) * 100));

// ✅ 正確做法 C：記錄例外
// 原因：IEEE 754 浮點誤差，超過 delta 範圍需人工審查
```

**情景 3：金錢計算（應避免浮點，改用分）**

```php
// ❌ 反模式：浮點金額
$amount = 100.50 * 0.08; // 稅金計算易誤差
$this->assertEquals(8.04, $amount);

// ✅ 正確做法：整數（分）
$amountInCents = 10050 * 8 / 100; // 804 分 = 8.04 元
$this->assertSame(804, $amountInCents);
```

---

## float 精度問題與測試處理

### 問題原因

IEEE 754 浮點標準導致運算誤差：

```php
var_dump(0.1 + 0.2);       // float(0.30000000000000004)
var_dump(0.1 + 0.2 === 0.3); // bool(false)
```

### 測試策略

| 場景 | 方案 | 程式碼 |
|------|------|--------|
| 精度 < 4 位小數 | 使用 `assertEquals($expected, $actual, $delta)` | `assertEquals(0.3, 0.1+0.2, 0.0001)` |
| 精度要求高 | 使用整數（分、厘、毫） | `assertSame(30, round((0.1+0.2)*100))` |
| 金額運算 | BCMath 或 Decimal | `assertEquals('0.30', bcadd('0.1', '0.2', 2))` |
| 例外情況 | 記錄到 TEST_QUALITY_OVERRIDES.md | 附註：浮點誤差已接受 |

---

## setExpectedException 與 @expectedException

**PHPUnit 5.7 官方推薦**：使用 `setExpectedException()` 或 `@expectedException` PHPDoc。

### setExpectedException 簽名

```php
/**
 * @param string|null $exception Expected exception class name (or null)
 * @param string|null $message Expected exception message (or null, REGEX match)
 * @param int|null $code Expected exception code (or null)
 */
public function setExpectedException($exception, $message = null, $code = null)
```

### 使用示例

```php
public function testProcessOrderThrowsOnInvalidAmount() {
    // 設定異常期望（在 act 之前）
    $this->setExpectedException('InvalidArgumentException', 'Amount must be positive');

    // Act - 執行會拋出異常的程式碼
    $service = new OrderService();
    $service->calculateTotal(-10);
}

// 或使用訊息 REGEX
public function testPaymentThrowsOnNetworkError() {
    $this->setExpectedException('PaymentException', '/Connection timeout/');

    $gateway = new PaymentGateway();
    $gateway->charge($amount); // 訊息需符合 regex
}
```

---

## getMockBuilder 與 createMock 安全轉換

### 轉換條件

| 原始程式碼 | 能否轉換 | 轉換規則 |
|----------|--------|--------|
| `$this->getMock('Class')` | ✅ 是 | → `$this->createMock('Class')` |
| `$this->getMock('Class', ['method1', 'method2'])` | ❌ 否（有 setMethods） | 保留 getMock，不轉換 |
| `$this->getMock('Class', null)` | ✅ 是 | → `$this->createMock('Class')` |

### 安全檢查清單

```bash
# 檢查是否含 setMethods
grep -n "setMethods()" protected/tests/unit/YourTest.php

# 如果有結果 → 不能轉換 getMock
# 如果無結果 → 可安全轉換為 createMock
```

### 轉換範例

**之前：**
```php
$mock = $this->getMock('OrderRepository');
$mock->expects($this->once())
    ->method('save')
    ->willReturn(true);
```

**之後：**
```php
$mock = $this->createMock('OrderRepository');
$mock->expects($this->once())
    ->method('save')
    ->willReturn(true);
```

---

## 測試方法命名規範（禁止 shouldXxx / it_xxx）

### 強制規範

<your-project> 統一使用 `testXxx()` 命名，禁止 shouldXxx 與 it_xxx：

| 命名方式 | 狀態 | 原因 |
|---------|------|------|
| `testCalculateTotalWithTax()` | ✅ 必須 | PHPUnit 官方約定，自動識別測試 |
| `shouldCalculateTotalWithTax()` | ❌ 禁止 | 非標準，Wave 1-3 已統一改為 testXxx |
| `it_calculates_total_with_tax()` | ❌ 禁止 | BDD 風格，本專案無使用 |
| `@test public function ...()` | ❌ 禁止 | Wave 1-5 已全面移除，禁止新增 |

### 標準化完成狀態（Wave 1-5，2026-03-02）

| Wave | 範圍 | 狀態 |
|------|------|------|
| Wave 1-3 | `shouldXxx` → `testXxx` 改名（41 檔） | ✅ 完成 |
| Wave 4 | `shouldXxx` 殘留 2 檔 + `@test` 移除 21 檔 + `assertEquals` → `assertSame` 15 檔 | ✅ 完成 |
| Wave 5 | PointRecordTest 無效方法 3 個 + `@test` 殘留 16 檔 + `getMockBuilder` 簡化 3 檔 | ✅ 完成（getMockBuilder 放棄，不等效） |

**最終結果**：993 tests passed，全部使用 `testXxx` 命名，`@test` 註解為 0

---

## MySQL collation 與排序驗證

<your-project> 資料庫使用 `utf8_unicode_ci`（大小寫不敏感排序）。PHP `strcmp()` 與之不相容。

### strcasecmp vs strcmp

```php
// MySQL utf8_unicode_ci 排序規則
// 結果順序：E_Ticket < ipass < ND（大小寫不敏感）

// ❌ 錯誤：PHP strcmp() 是 ASCII 比較，與 MySQL 不一致
// strcmp('ipass', 'ND') 返回 27（'i'=105 > 'N'=78） → 假失敗
$this->assertLessThanOrEqual(0, strcmp($curr['pay_type'], $next['pay_type']));

// ✅ 正確：strcasecmp() 大小寫不敏感，與 MySQL utf8_unicode_ci 一致
$this->assertLessThanOrEqual(0, strcasecmp($curr['pay_type'], $next['pay_type']));
```

### 測試 MySQL 排序結果範例

```php
public function testPayTypeSortingMatchesMysql() {
    $result = $this->repository->forPaymentMethods('0001'); // 按 pay_type ASC

    if (count($result) < 2) {
        $this->markTestSkipped('需要至少 2 筆資料驗證排序');
    }

    // 逐筆驗證排序順序
    for ($i = 0; $i < count($result) - 1; $i++) {
        $curr = $result[$i];
        $next = $result[$i + 1];

        // ✅ 使用 strcasecmp
        $this->assertLessThanOrEqual(
            0,
            strcasecmp($curr['pay_type'], $next['pay_type']),
            "pay_type '{$curr['pay_type']}' 應小於等於 '{$next['pay_type']}'"
        );
    }
}
```

---

## SELECT 欄位與測試驗證對齐

SQL SELECT 必須包含測試斷言驗證的所有欄位。

### 常見陷阱

```php
// ❌ 錯誤：SQL 只 ORDER BY dp.sort，未 SELECT dp.sort
$sql = "SELECT dp.pay_type, dp.pay_name FROM data_paytype dp ORDER BY dp.sort ASC";

$result = Yii::app()->db->createCommand($sql)->queryAll();
$this->assertArrayHasKey('sort', $result[0]); // ❌ 失敗：'sort' 鍵不存在

// ✅ 正確：確保 SELECT 包含測試需驗證的所有欄位
$sql = "SELECT dp.pay_type, dp.pay_name, dp.sort FROM data_paytype dp ORDER BY dp.sort ASC";

$result = Yii::app()->db->createCommand($sql)->queryAll();
$this->assertArrayHasKey('sort', $result[0]); // ✅ 通過
$this->assertInternalType('int', $result[0]['sort']);
```

---

## PHPUnit 5.7 特殊行為

### queryRow() 返回 false（非 null）

Yii CDbCommand 的 `queryRow()` 在無結果時返回 `false`，不是 `null`：

```php
$result = Yii::app()->db->createCommand("SELECT * FROM orders WHERE id = :id")
    ->bindParam(':id', 999, PDO::PARAM_INT)
    ->queryRow();

// ❌ 錯誤：is_null($result) 永遠為 false
if (is_null($result)) { /* 永不執行 */ }

// ✅ 正確：檢查 false 或使用 !==
if ($result === false) { /* 執行 */ }
if (!$result) { /* 執行 */ }
```

### queryAll() 返回空陣列（非 null）

```php
$results = Yii::app()->db->createCommand("SELECT * FROM orders WHERE status = :s")
    ->bindParam(':s', 'invalid_status', PDO::PARAM_STR)
    ->queryAll();

// $results = [] （空陣列，不是 null）
$this->assertEmpty($results); // ✅ 通過
$this->assertTrue(count($results) === 0); // ✅ 通過
```

---

## 常見陷阱清單

| 陷阱 | 症狀 | 預防 |
|------|------|------|
| shouldXxx 未轉換 | PHPUnit 不識別測試，"No tests found in class" | 必須使用 testXxx（Wave 1-5 已全面修正） |
| assertEquals 在浮點數 | 誤差導致測試不穩定 | 使用 assertEquals($exp, $act, $delta) 或轉整數 |
| strcmp 排序驗證 | 與 MySQL utf8_unicode_ci 不符 | 一律用 strcasecmp |
| SELECT 遺漏欄位 | assertArrayHasKey 靜默失敗 | 執行前檢查 SELECT 清單 |
| getMockBuilder + setMethods | 無法轉換為 createMock | 先 grep 檢查，判斷是否可轉換 |
| @test + testXxx 混用 | PHPUnit 行為不確定 | 禁止使用 @test（Wave 5 已全面移除） |
| queryRow 返回 false | is_null($result) 永遠為 false | 改用 `=== false` 或 `!$result` |

---

## 參考資源

- PHPUnit 5.7 官方文檔：https://phpunit.de/manual/5.7/en/
- 本專案 TDD 代理：`.claude/agents/tdd-guide-<your-project>.md`
- MySQL collation：`~/.claude/rules/common/testing.md`
- 型別決策：`.claude/skills/php-pro/references/testing-quality.md`（PHP 8.3+，參考用）
