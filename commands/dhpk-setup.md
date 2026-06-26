---
description: 'Interactive (re)configuration of dhpk plugin options — modules, docker, review agents, hook profile.'
argument-hint: '[--show]'
allowed-tools: 'Read, Write, Edit, Bash(git rev-parse:*), Bash(ls:*), AskUserQuestion'
disable-model-invocation: true
---

## Context

- Project root: !`git rev-parse --show-toplevel 2>/dev/null || pwd`
- Plugin catalog: `${CLAUDE_PLUGIN_ROOT}/manifests/module-catalog.json`
- Current local settings: `.claude/settings.local.json`
- Docker reference: `${CLAUDE_PLUGIN_ROOT}/docs/docker-setup.md`

## Task

Walk the user through configuring (or reconfiguring) the dhpk plugin **after**
it is installed. The first install is typically done with the shell wrapper
(`bash $CLAUDE_PLUGIN_ROOT/scripts/install.sh`); this command is the in-session
counterpart for adjusting choices without leaving Claude Code.

The flow mirrors the wrapper so the user sees the same questions:

1. **Stacks (multi-select)** — read `manifests/module-catalog.json` and ask
   which `.stacks[].id` to enable. Empty = generic core only.
2. **Per-stack version** — for each chosen stack, read the stack's
   `.selection` field (default `exclusive`).
   - If `exclusive`: single-select from `.versions[].id`.
   - If `additive`: **multi-select** from `.versions[].id` — library packages
     spanning multiple versions of a stack (e.g. PHP 7.4 → 8.x) enable
     several at once and get cumulative guidance.
   - For each picked version, resolve its `module` + `requires_module` and
     auto-include the dependency, telling the user it was added.
   - Honour per-version `.exclusive: true` (only meaningful under additive):
     if any picked version has this flag set AND the user also picked
     siblings in the same stack, drop the siblings and surface a warning —
     an exclusive version cannot combine with others in the same stack
     (e.g. `php-5.6` forbids ≥7.0 syntax so it contradicts `php-7.4`).
3. **Docker** — first display the prerequisite block from
   `docs/docker-setup.md` (summarise: docker installed? compose? WSL trap?
   container names match `docker ps`?). Then ask if the user wants to enable
   the SessionStart docker check; if yes, ask for the comma-separated container
   names. Remind that position matters: first → `DHPK_PHP_CONTAINER`, second →
   `DHPK_MYSQL_CONTAINER`.
4. **Review agents** — offer to override the three defaults
   (`code-reviewer`, `database-reviewer`, `security-reviewer`). Useful for
   projects whose agents live under different names (e.g. `code-reviewer-foo`).
5. **Hook profile** — single-select from `.hook_profiles[].id`
   (`minimal | standard | strict`).

After collecting answers:

- Read the current `.claude/settings.local.json` (create empty `{}` if missing).
- Write the resolved values under the `plugins.dhpk` namespace (use whatever
  key path the rest of this project already uses for plugin options — check
  the existing file first; do not invent a new shape).
- Print a side-by-side diff of "before → after" so the user can confirm.
- Tell the user that **module changes** (`modules=…`) require the plugin to
  reload its skill list. The cleanest in-session path is
  `/plugin configure dhpk@dhpk` (Claude Code's native userConfig editor — it
  re-applies hooks and skill listings on save). From the terminal, the
  equivalent is `claude plugin uninstall dhpk@dhpk && claude plugin install
  dhpk@dhpk --config modules=<csv>`. Settings-only overrides apply on next
  session.

### Arguments

```
$ARGUMENTS
```

| Argument | Description |
|----------|-------------|
| `--show` | Skip the questions; just print the current effective configuration. |

## Use AskUserQuestion

This command **must** drive the conversation with `AskUserQuestion` calls — one
per logical step. Do not ask in free-form text. Map each step above to a single
`AskUserQuestion` call with appropriate `multiSelect` and an "Other" escape for
free-text overrides (agent names, container CSV).

## Mirror, don't diverge

Keep this command's question text and ordering aligned with
`scripts/install.sh`. If you change one, update the other so users get a
consistent experience whether they configure from outside or inside Claude
Code. The catalog (`manifests/module-catalog.json`) is the only place where new
stacks/versions should be added.

## Output

A confirmation block:

```
Updated plugin options:
  modules           : <csv>            (was: <csv>)
  docker_containers : <csv or empty>   (was: <csv>)
  review_agents     : <csv>            (was: <csv>)
  hook_profile      : <minimal|standard|strict>   (was: <…>)

Next steps:
  • Module changes take effect after:
      /plugin configure dhpk@dhpk          (recommended, in-session)
    or, from the terminal:
      claude plugin uninstall dhpk@dhpk \
        && claude plugin install dhpk@dhpk --config modules=<csv>
  • Other changes apply on next session.
  • Docker reference: $CLAUDE_PLUGIN_ROOT/docs/docker-setup.md
```

## Examples

```
/dhpk:setup            # full interactive flow
/dhpk:setup --show     # print current config and exit
```
