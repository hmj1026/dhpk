# 多層防護驗證（Defense-in-Depth）

## 概述

修正 bug 時在單點加檢查常覺得「應該夠了」，但不同路徑、重構或 mock 可能繞過這個檢查。

**核心原則：** 在資料會經過的每一層都做驗證，讓問題「結構上不可能發生」。

## 為什麼要多層

單點驗證："修了 bug"
多層驗證："讓 bug 無法再發生"

不同層可以攔截不同型態的錯誤：
- 入口驗證擋掉明顯錯誤
- 業務邏輯驗證擋掉邊界案例
- 環境防護避免危險情境
- 偵錯紀錄提供鑑識資訊

## 四層防護

### Layer 1: 入口驗證
**目的：** 在 API/入口即擋掉不合法資料

```typescript
function createProject(name: string, workingDirectory: string) {
  if (!workingDirectory || workingDirectory.trim() === '') {
    throw new Error('workingDirectory cannot be empty');
  }
  if (!existsSync(workingDirectory)) {
    throw new Error(`workingDirectory does not exist: ${workingDirectory}`);
  }
  if (!statSync(workingDirectory).isDirectory()) {
    throw new Error(`workingDirectory is not a directory: ${workingDirectory}`);
  }
  // ... proceed
}
```

### Layer 2: 業務邏輯驗證
**目的：** 確保這個操作在語意上合理

```typescript
function initializeWorkspace(projectDir: string, sessionId: string) {
  if (!projectDir) {
    throw new Error('projectDir required for workspace initialization');
  }
  // ... proceed
}
```

### Layer 3: 環境防護
**目的：** 特定情境下避免危險行為

```typescript
async function gitInit(directory: string) {
  // In tests, refuse git init outside temp directories
  if (process.env.NODE_ENV === 'test') {
    const normalized = normalize(resolve(directory));
    const tmpDir = normalize(resolve(tmpdir()));

    if (!normalized.startsWith(tmpDir)) {
      throw new Error(
        `Refusing git init outside temp dir during tests: ${directory}`
      );
    }
  }
  // ... proceed
}
```

### Layer 4: 偵錯儀表
**目的：** 發生問題時保留可用的鑑識線索

```typescript
async function gitInit(directory: string) {
  const stack = new Error().stack;
  logger.debug('About to git init', {
    directory,
    cwd: process.cwd(),
    stack,
  });
  // ... proceed
}
```

## 套用流程

1. **追蹤資料流**：找出不良值來源與使用點
2. **列出所有關卡**：資料經過的每個層級
3. **每一層加驗證**：入口、業務、環境、偵錯
4. **逐層測試**：刻意繞過 Layer 1，確認 Layer 2 能攔截

## 重點提醒

- 每一層都可能捕捉到其他層漏掉的問題
- 測試與 mock 常會繞過入口驗證
- 異常環境（CI、Windows、容器）需要額外防護

**不要只停在一個驗證點。**
