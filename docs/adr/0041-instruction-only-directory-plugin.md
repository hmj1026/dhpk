# Instruction-only Directory Plugin, Full Plugin through the Repository Marketplace

Status: accepted (2026-11-20); amends the Directory Plugin parts of
[ADR-0040](0040-two-published-packages.md). Its single version source,
on-demand Host trees, and `dhpk-stacks` split stay in force.

Anthropic's Claude plugin directory portal refuses, from any organization it has
not made Verified, a plugin that carries command hooks, files other than
Markdown, text, JSON, YAML, or allowed images, files starting with `#!`,
`allowed-tools` entries beyond Read, Grep, Glob, and LS, or frontmatter keys
outside an unpublished allowlist. Anthropic chooses Verified organizations and
offers no way to apply. The published docs do not state these rules; the portal
enforces them (validation of `main @ d21b2c6`, 2026-11-20). The package at
`dist/claude-marketplace/package` was both the submitted folder and the
`dhpk@dhpk` marketplace source, so making it pass would have removed hooks and
scripts from every existing install.

We decided:

- **Three committed Published Packages.** The Full Plugin keeps everything
  dhpk ships for Claude Code and stays at `dist/claude-marketplace/package`,
  the unchanged `dhpk@dhpk` Repository Marketplace source, so existing installs
  keep their hooks and scripts. The Directory Plugin becomes an
  instruction-only reduction generated at `dist/claude-directory/package`,
  the folder submitted to the directory from `main`. The Public Plugin is
  unchanged.
- **The Directory Plugin carries no code that runs on the user's computer**:
  no hooks, no scripts, no `userConfig`, and no skill or agent whose main
  purpose needs a shipped script. Script-dependent skills that already document
  a fallback stay; frontmatter keeps only the keys known to pass (skills:
  `name`, `description`; agents: `name`, `description`, `model`, `color`,
  `tools`). Canonical sources are not edited; the generator reduces.
- **Each Published Package has a distinct plugin name.** The Directory Plugin
  is `dhpk-lite`; the Full Plugin stays `dhpk`. Because the name is the skill
  and agent namespace, the generator rewrites `dhpk:` references in the
  Directory Plugin. The future ChatGPT listing takes its own name.
- **A repository gate enforces the portal rules** on the Directory Plugin,
  because the directory rescans every `main` commit and the local
  `claude plugin validate --profile directory` does not run these checks.
- **`dhpk-stacks` is not submitted** to the directory; it stays in the
  Repository Marketplace and depends on the Full Plugin.

## Considered Options

- Keep the full package at the submitted path and wait for Verified status:
  rejected; no application path exists.
- Put the Directory Plugin at `dist/claude-marketplace/package` and move the
  Full Plugin: rejected; it changes the source of every existing install and
  reuses "full", the name of retired profile artifacts, for a live path. The
  submitted path is one portal field.
- Submit a compliant tree from a separate branch or tag: rejected; the
  maintainer submits `main`, and ADR-0040 left non-default refs unverified.
- Keep a second prose copy of each script-dependent skill for the Directory
  Plugin: rejected; a parallel SKILL.md drifts from the canonical source.
  Instead, each such skill keeps one canonical source and adds a Manual
  Procedure (`references/manual-procedure.md`) that reaches the script's result
  with standard tools or the consumer project's own commands. The skill runs
  its script when present and loads the procedure otherwise. A test keeps the
  procedure's stage IDs equal to the stage IDs the script declares.
- Move the scripts to a pinned `npx` package or an MCP server: rejected; the
  code still runs on the user's computer, and it adds an npm release surface.
- Reuse the name `dhpk` for both packages: rejected; the two cannot be told
  apart in listings or when both are installed, and a ChatGPT listing follows.

## Consequences

- The Directory Plugin lacks the Codex and AGY CLI agents. Until a follow-up
  change adds their Manual Procedures, it also lacks `flow-guide`,
  `opsx-apply-resume`, `git-smart-commit`, `harness-setup`, `precommit`, and
  `release-creator` (added in that order). Its README states the difference
  and how to install the Full Plugin. References to absent skills stay in the
  reduced text and are reported, not rewritten.
- In a Manual Procedure the skill's safety rules still hold (human merge gate
  and tag confirmation, stop on error, no PASS for a stage that did not run),
  and the report says `mode: manual`. Results lose the script's caching and
  exact retry control. The Full Plugin keeps the scripted behavior unchanged.
- Skills in the Directory Plugin lose `disable-model-invocation` and
  `argument-hint`, so a user-only skill may be invoked by the model there.
  User-only skills therefore state in their body and description that they run
  only on an explicit user request and otherwise stop and ask.
- Policy holds (credential text in trap sheets, the repository-root
  `package.json` behind install phrases) remain for human review rather than
  being edited away before a refusal shows they must be.
