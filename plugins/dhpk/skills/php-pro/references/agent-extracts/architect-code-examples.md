# Architecture Code Examples (從 architect-<your-project> agent 提取)

> 本檔為 agent spec 瘦身後的 code example 參考。由 agent 按需載入。

## Controller 範例（Interface Layer）

```php
<?php
class OrderController extends Controller
{
    public function actionCreate()
    {
        if (Yii::app()->user->isGuest) {
            throw new CHttpException(403, '需登入');
        }
        if (!Yii::app()->request->isPost) {
            $this->render('create');
            return;
        }
        $postData = Yii::app()->request->getPost('Order');
        $orderService = new OrderProcessingService($repository, $notificationService);
        try {
            $order = $orderService->createOrder(Yii::app()->user->id, $postData);
            $this->response(['success' => true, 'orderId' => $order->id]);
        } catch (InvalidArgumentException $e) {
            $this->response(['success' => false, 'message' => $e->getMessage()]);
        }
    }
}
```

## Domain Service 範例

```php
<?php
namespace Domain\Services;

class OrderProcessingService
{
    private $orderRepository;
    private $notificationService;

    public function __construct(IOrderRepository $orderRepository, NotificationServiceInterface $notificationService)
    {
        $this->orderRepository = $orderRepository;
        $this->notificationService = $notificationService;
    }

    /**
     * @param int $customerId
     * @param array $orderData
     * @return Order
     * @throws InvalidArgumentException
     */
    public function createOrder($customerId, array $orderData)
    {
        if (empty($orderData['items'])) {
            throw new InvalidArgumentException('訂單必須包含至少一項商品');
        }
        $amount = $this->calculateOrderAmount($orderData['items']);
        $tax = new Money($amount->getCents() * 0.1, 'TWD');
        $total = $amount->add($tax);
        $order = new Order($customerId, $amount, $tax, $total);
        $this->orderRepository->save($order);
        $this->notificationService->notifyOrderCreated($order);
        return $order;
    }
}
```

## Entity 與 ValueObject 範例

```php
<?php
// Entity: 有 ID、可變
namespace Domain\Entities;
class Order
{
    private $id;
    private $customerId;
    private $subtotal;
    private $tax;
    private $total;
    private $createdAt;

    public function __construct($customerId, Money $subtotal, Money $tax, Money $total)
    {
        $this->customerId = $customerId;
        $this->subtotal = $subtotal;
        $this->tax = $tax;
        $this->total = $total;
        $this->createdAt = new DateTime();
    }
}

// ValueObject: 無 ID、不可變
namespace Domain\ValueObjects;
class Money
{
    private $cents;
    private $currency;

    public function __construct($cents, $currency = 'TWD')
    {
        if (!is_int($cents) || $cents < 0) {
            throw new InvalidArgumentException('金額必須為非負整數');
        }
        $this->cents = $cents;
        $this->currency = $currency;
    }

    public function add(Money $other)
    {
        return new Money($this->cents + $other->cents, $this->currency);
    }
}
```

## Infrastructure Repository 範例

```php
<?php
namespace Infrastructure\Repositories;

class OrderRepository implements IOrderRepository
{
    public function save(Order $order)
    {
        $transaction = Yii::app()->db->beginTransaction();
        try {
            $model = new OrderModel();
            $model->customer_id = $order->getCustomerId();
            $model->subtotal = $order->getSubtotal()->getAmount();
            $model->tax = $order->getTax()->getAmount();
            $model->total = $order->getTotal()->getAmount();
            if (!$model->save()) {
                $transaction->rollback();
                return false;
            }
            $order->setId($model->id);
            $transaction->commit();
            return true;
        } catch (Exception $e) {
            $transaction->rollback();
            throw $e;
        }
    }

    public function findById($orderId)
    {
        $model = OrderModel::model()->findByPk($orderId);
        if (!$model) return null;
        return new Order(
            $model->customer_id,
            new Money($model->subtotal * 100, 'TWD'),
            new Money($model->tax * 100, 'TWD'),
            new Money($model->total * 100, 'TWD')
        );
    }
}
```

## ADR 格式範例

```markdown
# ADR-001: DDD 分層架構

## 背景
<your-project> 是遺留系統，需要現代化同時保持 PHP 5.6 相容。

## 決策
採用 DDD-like 分層：Interface → Domain → Infrastructure

## 結果
+ 業務邏輯獨立於框架
+ 易於測試與維護
- 需要額外適配層 (Repository)

## 例外
簡單查詢可直接在 Repository 中；大量舊程式碼保持原狀
```
