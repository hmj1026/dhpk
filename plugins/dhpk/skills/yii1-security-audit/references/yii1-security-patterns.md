# Yii 1.1 安全模式參考表

此文件為 `yii1-security-audit` skill 的快速查閱表。
收錄 Yii 1.1（PHP 5.6）中常見的安全 vs 不安全模式對照。

API 均經 Context7 查閱 `<framework-source>/` 原始碼確認。

---

## 1. 訪問控制（AUTH）

### accessRules() 基本結構

```php
// 安全：filters() + accessRules() 明確宣告
class OrderController extends Controller
{
    public function filters()
    {
        return array('accessControl');
    }
    public function accessRules()
    {
        return array(
            array('allow', 'roles' => array('@'), 'actions' => array('create', 'update', 'delete')),
            array('deny', 'users' => array('*')),  // 最後一條必須是 catch-all deny
        );
    }
}

// 安全：<your-project> 自訂 checkPermission filter
public function filters()
{
    return array('checkPermission');  // 觸發 Controller::filterCheckPermission()
}

// 不安全：完全無 filters() / accessRules() → 所有 action 公開存取
class SensitiveController extends Controller
{
    // 無 filters()，無 accessRules()
    public function actionDelete() { ... }
}

// 不安全：accessRules() deny 規則在 allow 之後（永遠不會觸發）
array('allow', 'users' => array('*')),   // 已允許所有人
array('deny', 'users' => array('?')),    // 永遠不會到達
```

### 物件歸屬校驗（IDOR 防護）

```php
// 不安全：只驗證「有無權限」，未驗證「資源是否屬於此用戶/店家」
public function actionUpdate($id)
{
    if (!Yii::app()->user->checkAccess('order_update')) {
        throw new CHttpException(403);
    }
    $order = Order::model()->findByPk($id);  // $id 未驗證歸屬
}

// 安全：驗證權限 + 資源歸屬（store_no 綁定）
public function actionUpdate($id)
{
    if (!Yii::app()->user->checkAccess('order_update')) {
        throw new CHttpException(403);
    }
    $storeNo = Yii::app()->user->getState('store_no');
    $order = Order::model()->find(
        'order_id = :id AND store_no = :store',
        array(':id' => $id, ':store' => $storeNo)
    );
    if ($order === null) {
        throw new CHttpException(404);
    }
}
```

---

## 2. CSRF 防護

### main.php 設定（Context7 確認欄位名稱）

```php
// 不安全（Yii 1.1 預設）：enableCsrfValidation 預設 false
'request' => array(
    'class' => 'CHttpRequest',
),

// 安全：啟用 CSRF + cookie 驗證
'request' => array(
    'class' => 'CHttpRequest',
    'enableCsrfValidation' => true,
    'enableCookieValidation' => true,
    'csrfTokenName' => 'YII_CSRF_TOKEN',   // 預設值即此；可覆寫
),
```

### View 中的 CSRF Token

```php
// 安全：使用 CActiveForm（自動嵌入 CSRF token）
<?php $form = $this->beginWidget('CActiveForm', array(
    'id' => 'order-form',
)); ?>
    <!-- CActiveForm 自動輸出 hidden CSRF token -->
<?php $this->endWidget(); ?>

// 安全：手動嵌入（需配合 enableCsrfValidation=true）
<input type="hidden"
    name="<?php echo Yii::app()->request->csrfTokenName; ?>"
    value="<?php echo Yii::app()->request->csrfToken; ?>">

// 不安全：手工 <form> 未嵌入 CSRF token
<form method="POST" action="<?php echo $this->createUrl('order/delete'); ?>">
    <!-- 無 CSRF token -->
</form>
```

---

## 3. 輸出編碼與 XSS

```php
// 安全：CHtml::encode() 包裹用戶資料
// 內部是 htmlspecialchars($text, ENT_QUOTES, Yii::app()->charset)
echo CHtml::encode($model->customer_name);
echo CHtml::encode($row['description']);

// 安全：JS 中用 CJSON::encode()
<script>var name = <?php echo CJSON::encode($model->name); ?>;</script>

// 不安全：直接輸出未編碼的用戶可控資料
echo $model->customer_name;         // XSS
echo $_GET['keyword'];              // XSS

// 不安全：JS 區塊中嵌入未編碼資料
<script>var name = '<?php echo $model->name; ?>';</script>  // XSS
```

---

## 4. SQL 注入（CDbCommand）

```php
// 不安全：字串插值（SQL Injection）
$itemNo = Yii::app()->request->getPost('item_no');
Yii::app()->db->createCommand(
    "SELECT * FROM data_item WHERE item_no = '$itemNo'"
)->queryAll();

// 不安全：字串拼接
Yii::app()->db->createCommand(
    "DELETE FROM data_model WHERE model_no='" . $modelNo . "'"
)->execute();

// 安全：inline params 陣列（params 是第二個引數！）
Yii::app()->db->createCommand(
    'SELECT * FROM data_item WHERE item_no = :item'
)->queryAll(true, array(':item' => $itemNo));

// 安全：bindValue()（有型別）
Yii::app()->db->createCommand(
    'SELECT * FROM orders WHERE id = :id AND status = :s'
)->bindValue(':id', $id, PDO::PARAM_INT)
 ->bindValue(':s', $status, PDO::PARAM_STR)
 ->queryAll();

// 安全：Query Builder where()
Yii::app()->db->createCommand()
    ->select('*')
    ->from('data_item')
    ->where('item_no = :item', array(':item' => $itemNo))
    ->queryRow();

// 注意：queryRow() 無結果時回傳 false（非 null）
$row = Yii::app()->db->createCommand('...')->queryRow();
if (!$row) {  // 正確
    // 無結果
}
if ($row === null) {  // 錯誤：永遠不會是 null
    // 錯誤判斷
}
```

---

## 5. SQL 注入（CDbCriteria）

```php
// 不安全：condition 字串插值
$criteria = new CDbCriteria();
$criteria->condition = "store_no = '$storeNo' AND item_no = '$itemNo'";

// 不安全：addCondition 字串拼接
$criteria->addCondition("item_class = '$value'");

// 安全：condition + params 分離
$criteria = new CDbCriteria();
$criteria->condition = 'store_no = :store AND item_no = :item';
$criteria->params = array(':store' => $storeNo, ':item' => $itemNo);

// 安全：addCondition 後加 params
$criteria->addCondition('item_class = :class');
$criteria->params[':class'] = $value;

// 安全：compare() 內部自動綁定
$criteria->compare('status', $status);           // 自動 = 比較
$criteria->compare('name', $name, true);         // true = LIKE 比較
$criteria->addInCondition('id', $idArray);       // 安全 IN 子句

// 動態 ORDER BY — 必須用白名單
$allowed = array('create_time', 'customer_no', 'sales_sum');
$sort = in_array($_GET['sort'], $allowed) ? $_GET['sort'] : 'create_time';
$criteria->order = $sort . ' ASC';
```

---

## 6. Mass Assignment

```php
// 不安全：rules() 宣告 '*' safe，敏感欄位可被覆寫
public function rules()
{
    return array(
        array('customer_no, name, email, level, is_admin, store_no', 'safe'),
        // level / is_admin / store_no 不應允許 mass assignment
    );
}
$model->attributes = Yii::app()->request->getPost('Customer');  // level 可被覆寫！

// 安全：明確設定 unsafe 欄位
public function rules()
{
    return array(
        array('customer_no, name, email', 'safe', 'on' => 'create,update'),
        array('level, is_admin, store_no', 'unsafe'),
    );
}

// 安全：Controller 中設定 scenario 後再 mass assign
$model->scenario = 'update';
$model->attributes = Yii::app()->request->getPost('Customer');
```

---

## 7. 文件上傳（CUploadedFile）

```php
// 不安全：無副檔名白名單，存到 webroot
$file = CUploadedFile::getInstance($model, 'image');
$file->saveAs(Yii::app()->basePath . '/../upload/' . $file->getName());
// 攻擊者可上傳 shell.php 直接執行

// 不安全：只靠 getType() 做 MIME（瀏覽器提供，可偽造）
if ($file->getType() !== 'image/jpeg') { ... }

// 安全：副檔名白名單 + 隨機命名 + 非 webroot 儲存
$allowed = array('jpg', 'jpeg', 'png', 'gif');
$file = CUploadedFile::getInstance($model, 'image');
if ($file === null || $file->getHasError()) {
    throw new CHttpException(400, '上傳失敗');
}
if (!in_array(strtolower($file->getExtensionName()), $allowed)) {
    throw new CHttpException(400, '不允許的檔案類型');
}
// 安全：使用 CFileHelper::getMimeType() 做伺服器端 MIME 驗證
$realMime = CFileHelper::getMimeType($file->getTempName());
$allowedMimes = array('image/jpeg', 'image/png', 'image/gif');
if (!in_array($realMime, $allowedMimes)) {
    throw new CHttpException(400, 'MIME 類型不符');
}
// 儲存至 webroot 外，使用隨機檔名
$savePath = Yii::app()->basePath . '/uploads/images/';
$filename = uniqid('img_', true) . '.' . $file->getExtensionName();
$file->saveAs($savePath . $filename);
```

---

## 8. Session 與 Cookie 安全

```php
// protected/config/main.php

// 不安全：未設定 httponly / secure（注意：key 全小寫）
'session' => array(
    'class' => 'CHttpSession',
),

// 安全：cookieMode=only + httponly + secure
'session' => array(
    'class' => 'CHttpSession',
    'cookieMode' => 'only',       // 最安全；禁止 URL session ID
    'cookieParams' => array(
        'httponly' => true,        // 全小寫，非 httpOnly
        'secure'   => true,        // 僅 HTTPS 環境啟用
        'lifetime' => 0,
    ),
    'timeout' => 1440,
),

// user 元件的 remember-me cookie
'user' => array(
    'allowAutoLogin' => true,
    'loginUrl'       => array('/site/login'),
    'identityCookie' => array(
        'httponly' => true,
        'secure'   => true,
    ),
),
```

---

## 9. PHP 5.6 特性注意事項

```php
// PHP 5.6 不存在 null coalescing (??)
$val = $data['key'] ?? 'default';  // 語法錯誤！

// 正確：使用 isset() 三元
$val = isset($data['key']) ? $data['key'] : 'default';

// 安全邊界常見場景
$id     = isset($_GET['id'])      ? intval($_GET['id'])          : 0;
$name   = isset($_POST['name'])   ? trim($_POST['name'])         : '';
$storeNo = isset(Yii::app()->user) && !Yii::app()->user->isGuest
          ? Yii::app()->user->getState('store_no') : null;

// 注意：intval() 對整數型 PK 是充分防護
//       字串型欄位仍需 createCommand 參數綁定
```

---

## 10. Yii 1.1 vs Yii2 API 對照表

| 功能 | Yii 1.1 | Yii2（不要用）|
|------|---------|------|
| 輸出編碼 | `CHtml::encode($val)` | `Html::encode($val)` |
| CSRF Token | `Yii::app()->request->csrfToken` | `Yii::$app->request->getCsrfToken()` |
| CSRF 設定 | `protected/config/main.php` request 元件 | `@app/config/web.php` request 元件 |
| 用戶鑑權 | `Yii::app()->user->checkAccess('role')` | `Yii::$app->user->can('role')` |
| 訪問控制 Filter | `filters()` + `accessRules()` | `behaviors()` + `AccessControl` |
| DB Query | `Yii::app()->db->createCommand()` | `Yii::$app->db->createCommand()` |
| 請求物件 | `Yii::app()->request->getPost('key')` | `Yii::$app->request->post('key')` |
| 框架入口 | `protected/yiic.php` + `CController` | `yii` CLI + `web/index.php` |
| MIME 驗證 | `CFileHelper::getMimeType($path)` | `FileHelper::getMimeType($path)` |
| Session cookie key | `'httponly' => true`（小寫） | `'httpOnly' => true`（駝峰）|
