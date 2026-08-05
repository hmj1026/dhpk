# Docker Setup for dhpk

Reference for the `docker_containers` plugin option when a consumer explicitly
registers a Docker workflow. The installer and `/dhpk:setup` do not add a
Docker hook by default.

> **TL;DR** — If your project does not use Docker, leave `docker_containers`
> empty and skip this doc. No default dhpk hook probes Docker.

---

## What dhpk does with Docker

When `userConfig.docker_containers` is non-empty, it is configuration for an
explicitly registered consumer Docker workflow; dhpk does not automatically
run a SessionStart check or export container variables. A consumer script may
adopt the following convention:

1. **Probe** — a registered script can run `docker ps --format '{{.Names}}'`
   and choose its own warning/failure behavior.
2. **Container-name convention** — the list can be positional: first for PHP,
   second for MySQL. The registered script owns any environment exports.

Empty list (`docker_containers=[]`) leaves the optional workflow unconfigured.

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

An opt-in Docker script can use this positional convention:

| Position | Env var | Typical role |
|---------:|---------|--------------|
| 1st | `DHPK_PHP_CONTAINER` | PHP-FPM / PHP-CLI container |
| 2nd | `DHPK_MYSQL_CONTAINER` | Database container (MySQL/MariaDB/Postgres) |

For example, a consumer script can map `docker_containers=php-fpm,mysql` to:

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

Then register your Docker workflow with matching names:

```bash
bash ~/projects/dhpk/scripts/install.sh
# Configure your consumer's explicit Docker workflow with:
#   docker_containers=php-fpm,mysql
```

## Troubleshooting

**`docker ps` shows my container, but my registered workflow still warns.**
Names must match exactly. `container_name: php-fpm` produces `php-fpm`;
omitting `container_name:` produces `<project>_<service>_1` (compose v1) or
`<project>-<service>-1` (compose v2). Update either side until they match.

**`docker: command not found` after WSL integration toggle.**
Restart the WSL distro: `wsl --shutdown` (from PowerShell) then reopen.

**Workflow never fires.**
`docker_containers` defaults to `[]`; configure the list and register the
consumer Docker script explicitly.

**Want to disable the workflow temporarily.**
Remove its consumer hook registration or clear `docker_containers` in the
consumer configuration.

## Related

- `manifests/module-catalog.json` — declares the positional container-role order
- `scripts/install.sh` / `/dhpk:setup` — installation and configuration entry points
