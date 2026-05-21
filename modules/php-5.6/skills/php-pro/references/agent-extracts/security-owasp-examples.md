# OWASP Security Examples (從 security-reviewer-<your-project> agent 提取)

> 本檔為 agent spec 瘦身後的 code example 參考。由 agent 按需載入。

## A1: SQL 注入

```php
// ❌ SQL 注入漏洞
$orderId = $_GET['orderId'];
$sql = "SELECT * FROM order WHERE orderId = " . $orderId;

// ✅ 參數綁定
$orderId = Yii::app()->request->getQuery('orderId');
$sql = "SELECT * FROM order WHERE orderId = :orderId";
$result = Yii::app()->db->createCommand($sql)
    ->bindParam(':orderId', $orderId, PDO::PARAM_INT)
    ->queryAll();

// ✅ ActiveRecord
$order = Order::model()->findByPk($orderId);

// ORDER BY/LIMIT 安全
$limit = (int) Yii::app()->request->getQuery('limit', 10);
```

## A3: XSS

```php
// ❌ XSS 漏洞
<?php echo $userComment; ?>
<input value="<?php echo $userInput; ?>">

// ✅ CHtml::encode()
<?php echo CHtml::encode($userComment); ?>
<input value="<?php echo CHtml::encode($userInput); ?>">

// JSON 回應
json_encode($data, JSON_HEX_TAG | JSON_HEX_APOS);
```

```javascript
// ❌ innerHTML XSS
document.getElementById('output').innerHTML = userInput;

// ✅ textContent
document.getElementById('output').textContent = userInput;
$('#output').text(userInput);
```

## A2: CSRF

```php
// Yii 自動 CSRF
<?php $form = $this->beginWidget('CActiveForm'); ?>

// 手動表單
<?php echo CHtml::hiddenField(
    Yii::app()->request->csrfTokenName,
    Yii::app()->request->csrfToken
); ?>
```

```javascript
// AJAX CSRF
$.ajax({
    url: '/order/create',
    type: 'POST',
    data: {
        YII_CSRF_TOKEN: $('[name=YII_CSRF_TOKEN]').val(),
        orderId: 123
    }
});
```

## A7: 身份驗證與授權

```php
// ✅ 登入檢查
public function actionDelete() {
    if (Yii::app()->user->isGuest) {
        throw new CHttpException(403, '需登入');
    }
    // 所有權驗證
    $order = Order::model()->findByPk($orderId);
    if ($order->customerId != Yii::app()->user->id) {
        throw new CHttpException(403, '無權限操作此訂單');
    }
}
```

## A5: 敏感資料外洩

```php
// ❌ 硬編碼密鑰
$apiKey = 'sk_live_abc123def456';

// ✅ 環境變數
$apiKey = getenv('STRIPE_API_KEY');
if (!$apiKey) {
    throw new Exception('STRIPE_API_KEY 環境變數未設置');
}

// ❌ 洩露 SQL 詳情
echo "Error: " . $e->getMessage();

// ✅ 通用訊息
EILogger::slog(['method' => __METHOD__, 'error' => $e->getMessage()], 'Error');
echo "發生錯誤，請聯絡管理員";

// 密碼 hash
$user->password = password_hash($password, PASSWORD_BCRYPT);
if (password_verify($inputPassword, $user->password)) { /* ok */ }
```

## A4: XXE

```php
$dom = new DOMDocument();
libxml_disable_entity_loader(true);
$dom->load($xmlFile);
```

## A6: 不安全反序列化

```php
// ❌
$data = unserialize($_SESSION['user_data']);
// ✅
$data = json_decode($_SESSION['user_data'], true);
```

## A8: 檔案上傳

```php
$file = Yii::app()->request->getFiles('attachment');
$allowedExtensions = ['pdf', 'doc', 'docx'];
$maxSize = 5 * 1024 * 1024;

$ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
if (!in_array($ext, $allowedExtensions)) {
    throw new CHttpException(400, '不支援的檔案類型');
}
if ($file['size'] > $maxSize) {
    throw new CHttpException(400, '檔案過大');
}
$safeFilename = md5(uniqid() . $file['name']) . '.' . $ext;
move_uploaded_file($file['tmp_name'], Yii::app()->basePath . '/uploads/' . $safeFilename);
```

## A10: 速率限制

```php
class RateLimitFilter extends CFilter {
    public $limit = 10;
    public $window = 3600;

    protected function preFilter($filterChain) {
        $userId = Yii::app()->user->id ?: Yii::app()->request->userHostAddress;
        $key = "rate_limit:{$userId}:{$filterChain->action->id}";
        $count = Yii::app()->cache->get($key);
        if ($count >= $this->limit) {
            throw new CHttpException(429, 'Rate limit exceeded');
        }
        Yii::app()->cache->set($key, ($count ?: 0) + 1, $this->window);
        return true;
    }
}
```

## 安全標頭

```php
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
header('X-XSS-Protection: 1; mode=block');
header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
```

## JavaScript 安全

```javascript
// ❌ eval / Function
eval(userInput);
new Function(userInput)();
setTimeout(userInput, 1000);

// ✅ 安全替代
JSON.parse(userInput);
setTimeout(() => { /* 固定程式碼 */ }, 1000);
```
