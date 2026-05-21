# Docker Setup for dhpk

Reference for the `docker_containers` plugin option. The interactive installer
(`scripts/install.sh`) and `/dhpk:setup` slash command will both ask for the
container names this document explains.

> **TL;DR** — If your project does not use Docker, leave `docker_containers`
> empty and skip this doc. The `SessionStart` hook is a no-op in that case.

---

## What dhpk does with Docker

When `userConfig.docker_containers` is non-empty:

1. **SessionStart hook** runs `docker ps --format '{{.Names}}'` and verifies each
   configured container is present. Missing containers surface as a warning
   (with `hook_profile=strict`) or are silently skipped (`minimal`/`standard`).
2. **Container name exports** — the list is positional. The first entry is
   exported as `DHPK_PHP_CONTAINER`, the second as `DHPK_MYSQL_CONTAINER`. Some
   downstream hooks and module helpers read these for `docker exec` commands.

Empty list (`docker_containers=[]`) disables the check entirely — useful for
host-native projects or CI.

## Prerequisites

| Tool | Install | Verify |
|------|---------|--------|
| Docker Engine | [Docker Desktop](https://docs.docker.com/desktop/) (macOS/Windows/WSL) or [docker-ce](https://docs.docker.com/engine/install/) (Linux) | `docker version` |
| Docker Compose v2 | Bundled with Docker Desktop; Linux: `sudo apt-get install docker-compose-plugin` | `docker compose version` |
| Running daemon | Start Docker Desktop, or `sudo systemctl start docker` | `docker ps` returns without error |

## WSL2 specifics

If you run Claude Code inside WSL2:

- **Enable WSL integration** in Docker Desktop → Settings → Resources → WSL
  Integration. Toggle on for the distro you use (`Ubuntu`, etc.).
- **Daemon socket** — once integration is on, `docker` inside WSL talks to the
  Windows-hosted daemon. No separate `dockerd` needed in WSL.
- **Root-owned files trap** — files created inside a container by the root user
  (the default for many official images) appear on the WSL host as root-owned.
  This breaks `git status`, `git add`, and editor saves. Two fixes:
  - Run containers with your UID: `docker compose run --user "$(id -u):$(id -g)"`
  - Add a post-run fixup: `sudo chown -R "$(id -u):$(id -g)" .`
- See your global `~/.claude/CLAUDE.md` for the broader WSL trap discussion.

## Container naming convention

The plugin's hooks assume a positional convention:

| Position | Env var | Typical role |
|---------:|---------|--------------|
| 1st | `DHPK_PHP_CONTAINER` | PHP-FPM / PHP-CLI container |
| 2nd | `DHPK_MYSQL_CONTAINER` | Database container (MySQL/MariaDB/Postgres) |

So `docker_containers=php-fpm,mysql` exports:

```
DHPK_PHP_CONTAINER=php-fpm
DHPK_MYSQL_CONTAINER=mysql
```

The names must match what `docker ps` shows under the `NAMES` column — the
`container_name:` value in `compose.yml`, **not** the service name (unless they
coincide).

## Minimal compose.yml example

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
    ports:
      - "3306:3306"
```

Bring it up before launching Claude Code:

```bash
docker compose up -d
docker ps   # confirm 'php-fpm' and 'mysql' show under NAMES
```

Then install dhpk with matching names:

```bash
bash ~/projects/dhpk/scripts/install.sh
# When prompted: "Container names (comma-separated, …):"
#   php-fpm,mysql
```

## Troubleshooting

**`docker ps` shows my container, but SessionStart still warns.**
Names must match exactly. `container_name: php-fpm` produces `php-fpm`;
omitting `container_name:` produces `<project>_<service>_1` (compose v1) or
`<project>-<service>-1` (compose v2). Update either side until they match.

**`docker: command not found` after WSL integration toggle.**
Restart the WSL distro: `wsl --shutdown` (from PowerShell) then reopen.

**Hook never fires.**
`docker_containers` defaults to `[]` (disabled). Re-run `/dhpk:setup` (inside
Claude) or `scripts/install.sh` (outside) and explicitly pass the list.

**Want to disable the check temporarily.**
Set `docker_containers=[]` via `claude plugin reinstall dhpk@dhpk --plugin-option docker_containers=`
or remove the key from `.claude/settings.local.json`.

## Related

- `manifests/module-catalog.json` — declares the positional container-role order
- `hooks/hooks.json` — SessionStart wiring
- `scripts/install.sh` / `/dhpk:setup` — interactive entry points
