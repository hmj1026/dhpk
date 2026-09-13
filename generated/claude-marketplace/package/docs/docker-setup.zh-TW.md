# dhpk Docker 設定

> **語言**：[English](./docker-setup.md) · **繁體中文**

本文件說明 consumer 明確註冊 Docker workflow 時使用的 `docker_containers`
plugin option。Installer 與 `/dhpk:setup` 預設都不會加入 Docker hook。若專案不用
Docker，將 `docker_containers` 留空即可；dhpk 的預設 hook 不會探測 Docker。

## dhpk 如何使用 Docker

`userConfig.docker_containers` 非空時，它只是 consumer 自行註冊 Docker workflow
的設定；dhpk 不會自動執行 SessionStart check 或 export container variable。
Consumer script 可以執行 `docker ps --format '{{.Names}}'`，並採用「第一個名稱為
PHP、第二個為 MySQL」的 positional convention。空清單代表未設定。

## 前置需求

| 工具 | 安裝 | 驗證 |
|---|---|---|
| Docker Engine | macOS/Windows/WSL 使用 Docker Desktop；Linux 使用 docker-ce | `docker version` |
| Docker Compose v2 | Docker Desktop 內附；Linux 安裝 compose plugin | `docker compose version` |
| 執行中的 daemon | 啟動 Docker Desktop 或 `sudo systemctl start docker` | `docker ps` 無錯誤 |

## WSL2 注意事項

- 在 Docker Desktop → Settings → Resources → WSL Integration 啟用使用中的 distro。
- 啟用後 WSL 內的 `docker` 會連到 Windows host daemon，不需另跑 `dockerd`。
- Container root 建立的檔案會在 WSL host 成為 root-owned。優先用
  `docker compose run --user "$(id -u):$(id -g)"`，或事後執行
  `sudo chown -R "$(id -u):$(id -g)" .`。

## Container 命名慣例

| 位置 | Env var | 常見角色 |
|---:|---|---|
| 第 1 個 | `DHPK_PHP_CONTAINER` | PHP-FPM / PHP-CLI |
| 第 2 個 | `DHPK_MYSQL_CONTAINER` | MySQL/MariaDB/Postgres |

名稱必須與 `docker ps` 的 `NAMES` 欄完全一致，也就是 `compose.yml` 的
`container_name:`，除非它剛好與 service name 相同。

```yaml
services:
  php-fpm:
    image: php:5.6-fpm
    container_name: php-fpm
    volumes:
      - .:/var/www/html
    working_dir: /var/www/html

  mysql:
    image: mysql:5.7
    container_name: mysql
    environment:
      MYSQL_ROOT_PASSWORD: dev
      MYSQL_DATABASE: app
```

```bash
docker compose up -d
docker ps
bash ~/projects/dhpk/scripts/install.sh
# 在 consumer 明確註冊的 Docker workflow 使用：
# docker_containers=php-fpm,mysql
```

## 疑難排解

- **Container 存在但 workflow 仍警告**：確認名稱完全一致。未設定
  `container_name` 時，Compose 會產生含 project/service 的名稱。
- **WSL 內找不到 docker**：在 PowerShell 執行 `wsl --shutdown` 後重新開啟。
- **Workflow 沒觸發**：設定 `docker_containers` 後，仍須明確註冊 consumer script。
- **暫時停用**：移除 consumer hook registration，或清空 `docker_containers`。

相關 SSOT：`manifests/module-catalog.json`、`scripts/install.sh`、`/dhpk:setup`。
