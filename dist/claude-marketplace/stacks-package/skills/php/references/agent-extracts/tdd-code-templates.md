# TDD Code Templates (從 tdd-guide-<your-project> agent 提取)

> 本檔為 agent spec 瘦身後的 code template 參考。由 agent 按需載入。

## TDD RED-GREEN-REFACTOR 完整範例

### RED (寫失敗的測試)

```php
<?php
class OrderServiceTest extends CTestCase
{
    public function testCalculateTaxOnOrder()
    {
        $order = new Order();
        $order->subtotal = 100.00;
        $order->tax_rate = 0.10;

        $service = new OrderService();
        $total = $service->calculateTotal($order);

        $this->assertEquals(110.00, $total);
    }
}
```

### GREEN (最小實現)

```php
<?php
class OrderService
{
    /**
     * @param Order $order
     * @return float
     */
    public function calculateTotal(Order $order)
    {
        $tax = $order->subtotal * $order->tax_rate;
        return $order->subtotal + $tax;
    }
}
```

### REFACTOR (改進)

```php
<?php
class OrderService
{
    /**
     * @param Order $order
     * @return float
     * @throws InvalidArgumentException
     */
    public function calculateTotal(Order $order)
    {
        if ($order->subtotal < 0) {
            throw new InvalidArgumentException('金額不能為負');
        }
        if ($order->tax_rate < 0 || $order->tax_rate > 1) {
            throw new InvalidArgumentException('稅率應在 0-1 之間');
        }
        $tax = $order->subtotal * $order->tax_rate;
        return $order->subtotal + $tax;
    }
}
```

## Arrange-Act-Assert 模式

```php
public function testProcessOrderSuccess()
{
    // Arrange
    $order = new Order();
    $order->customerId = 1;
    $order->amount = 100.00;

    $mockRepository = $this->getMock('OrderRepository');
    $mockRepository->expects($this->once())
        ->method('save')
        ->with($this->equalTo($order))
        ->willReturn(true);

    // Act
    $service = new OrderService($mockRepository);
    $result = $service->processOrder($order);

    // Assert
    $this->assertTrue($result);
}
```

## setUp / tearDown 模式

```php
public function setUp()
{
    parent::setUp();
    $this->order = new Order();
    $this->service = new OrderService();
}

public function tearDown()
{
    parent::tearDown();
    Order::model()->deleteAll();
}
```

## 交易回滾（DB 測試）

```php
public function testSaveOrderToDatabase()
{
    $transaction = Yii::app()->db->beginTransaction();
    try {
        $order = new Order();
        $order->customerId = 1;
        $this->assertTrue($order->save());
        $loaded = Order::model()->findByPk($order->orderId);
        $this->assertNotNull($loaded);
    } finally {
        $transaction->rollback();
    }
}
```

## Mock vs Stub

```php
// Mock 驗證互動
$mockRepository = $this->getMock('OrderRepository');
$mockRepository->expects($this->once())
    ->method('save')
    ->willReturn(true);

// Stub 返回固定值
$mockRepository = $this->getMock('OrderRepository');
$mockRepository->method('findById')
    ->willReturn($order);
```

## 異常測試

```php
/**
 * @expectedException InvalidArgumentException
 * @expectedExceptionMessage 金額不能為負
 */
public function testCalculateTotalThrowsOnNegativeAmount()
{
    $order = new Order();
    $order->subtotal = -10.00;
    $service = new OrderService();
    $service->calculateTotal($order);
}
```

## Data Provider

```php
/**
 * @dataProvider taxRateProvider
 */
public function testCalculateTotalWithVaryingTaxRate($subtotal, $taxRate, $expected)
{
    $order = new Order();
    $order->subtotal = $subtotal;
    $order->tax_rate = $taxRate;
    $service = new OrderService();
    $this->assertEquals($expected, $service->calculateTotal($order));
}

public function taxRateProvider()
{
    return [
        [100, 0.05, 105.00],
        [100, 0.10, 110.00],
        [100, 0.15, 115.00],
        [0,   0.10, 0.00],
    ];
}
```

## JavaScript 測試範例

```javascript
describe('OrderCalculator', () => {
    test('should calculate total with tax', () => {
        const calculator = new OrderCalculator();
        const total = calculator.calculateTotal(100, 0.1);
        expect(total).toBe(110);
    });

    test('should throw on negative amount', () => {
        const calculator = new OrderCalculator();
        expect(() => calculator.calculateTotal(-100, 0.1)).toThrow('金額不能為負');
    });
});

// AJAX 測試
test('should handle MyApp.list.ajaxPromise', async () => {
    const mockAjax = jest.fn().mockResolvedValue({ success: true, data: { result: 'ok' } });
    MyApp.list.ajaxPromise = mockAjax;
    const result = await performAjaxOperation();
    expect(result.success).toBe(true);
});

// DOM 測試
test('should update DOM with message', () => {
    document.body.innerHTML = '<div id="message"></div>';
    MyApp.display.message('操作成功');
    expect(document.getElementById('message').textContent).toBe('操作成功');
});
```
