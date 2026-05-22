# Recommended `.claude/settings.local.json` permissions

dhpk does **not** ship a `.claude/settings.json` with `permissions.allow`
entries. Plugin-level pre-granted permissions are presumptuous — every
project's threat model and tooling install differs.

Instead, this doc catalogues the common allowlist patterns by stack.
Copy the lines that match your project into your project's
`.claude/settings.local.json` (the `local` variant is gitignored, so
each developer can tune it).

## Universal — safe in any project

```json
{
  "permissions": {
    "allow": [
      "Bash(git:*)",
      "Bash(grep:*)",
      "Bash(rg:*)",
      "Bash(find:*)",
      "Bash(ls:*)",
      "Bash(head:*)",
      "Bash(tail:*)",
      "Bash(cat:*)",
      "Bash(echo:*)",
      "Bash(printf:*)",
      "Bash(sort:*)",
      "Bash(uniq:*)",
      "Bash(wc:*)",
      "Bash(awk:*)",
      "Bash(sed:*)",
      "Bash(test:*)",
      "Bash(stat:*)",
      "Bash(xargs:*)",
      "Bash(mkdir:*)",
      "Bash(cp:*)",
      "Bash(mv:*)"
    ]
  }
}
```

Read-only inspection commands plus the standard text-processing toolbox.
`Bash(mv:*)` and `Bash(cp:*)` are listed because they're commonly used
during refactors — drop them if your threat model treats file moves as
sensitive.

## PHP / Yii projects

```json
"Bash(php:*)",
"Bash(composer:*)",
"Bash(vendor/bin/phpunit:*)",
"Bash(vendor/bin/phpstan:*)",
"Bash(vendor/bin/php-cs-fixer:*)",
"Bash(docker compose:*)",
"Bash(docker exec:*)"
```

The two `docker` entries are for projects that run PHP / MySQL in
containers (typical of legacy PHP 5.6 + Yii 1.1 stacks). Combine with
the `docker_containers` userConfig to surface SessionStart status.

## JavaScript / Node projects

```json
"Bash(npm:*)",
"Bash(npx:*)",
"Bash(node:*)",
"Bash(yarn:*)",
"Bash(pnpm:*)",
"Bash(eslint:*)",
"Bash(tsc:*)",
"Bash(jest:*)",
"Bash(vitest:*)",
"Bash(playwright:*)"
```

If the JS module is enabled, the post-edit and pre-commit hooks call
`npx eslint` and `npm run <lint|typecheck>` — both are covered by the
`npm:*` and `npx:*` entries above.

## Python projects

```json
"Bash(python3:*)",
"Bash(pip:*)",
"Bash(pip3:*)",
"Bash(pytest:*)",
"Bash(ruff:*)",
"Bash(mypy:*)",
"Bash(black:*)",
"Bash(poetry:*)",
"Bash(uv:*)"
```

## Auxiliary tooling

```json
"Bash(cx:*)",
"Bash(openspec:*)",
"Bash(playwright-cli:*)",
"Bash(gh:*)"
```

- `cx` — code-navigation tool referenced throughout the harness.
- `openspec` — OpenSpec CLI; only enable if the project uses the
  OpenSpec workflow.
- `playwright-cli` — Playwright browser automation; only enable if you
  use it.
- `gh` — GitHub CLI for PR / issue operations.

## MCP server permissions

MCP server entries (`mcp__*`) belong **only** in
`.claude/settings.local.json` (or your user-level settings). They reflect
the MCP servers actually installed on your machine and the trust level
you have with each. Examples to inspect, not to blindly enable:

```
mcp__claude_ai_Gmail__*
mcp__claude_ai_Google_Calendar__*
mcp__plugin_context7_context7__*
mcp__plugin_claude-mem_mcp-search__*
mcp__codex__codex
```

Audit each entry against the MCP server's documented capabilities before
adding.

## How to verify your allowlist

```bash
jq '.permissions.allow' .claude/settings.local.json
```

Should list everything you intend to auto-approve. If the list is empty
or missing, Claude Code falls back to per-call prompts — slow but safe.
