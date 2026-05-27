---
description: UI/UX verification. By default, compares the currently-changed OpenSpec specs against the actually-rendered page.
argument-hint: "[<url>] [spec:<path>]"
allowed-tools: Read, Grep, Glob, Bash(git:*), Task
---

⚠️ **This command delegates to the `ui-ux-verifier` agent via the Task tool.**

Agent body: `${CLAUDE_PLUGIN_ROOT}/agents/ui-ux-verifier.md`

> Requires the external OpenSpec plugin for the Default Mode flow (which lists `openspec/changes/*/specs/**/spec.md` files changed on the current branch). URL Mode and Combined Mode work without OpenSpec installed.

## Context

- Current branch: !`git branch --show-current`
- Base branch: master
- Changed spec files: !`git diff master..HEAD --name-only | grep -E '^openspec/changes/[^/]+/specs/.+/spec\.md$' || true`

## Arguments

```
$ARGUMENTS
```

| Invocation | Behavior |
|---|---|
| `/ui-ux-verify` | **Default Mode**: list `openspec/changes/*/specs/**/spec.md` changed on the current branch relative to master, prompt the user to pick one, then delegate to the agent |
| `/ui-ux-verify <url>` | **URL Mode**: pass the URL to the agent; spec is auto-searched by the agent |
| `/ui-ux-verify <url> spec:<path>` | **Combined Mode**: URL + explicit spec path delivered to the agent together |
| `/ui-ux-verify spec:<path>` | **Spec-Only Mode**: spec only; URL is derived by the agent from spec contents |

URL format must match `https://www.<app-host>/<route-prefix>/<controller>/<action>` (the actual host and route-prefix are project-specific; the agent has a built-in regex validation that the consuming project can override).

## Workflow

1. **Parse `$ARGUMENTS`**
   - Empty string → Default Mode (step 2)
   - Contains `https://` → URL Mode or Combined Mode (jump to step 4)
   - Starts with `spec:` and no URL → Spec-Only Mode (jump to step 3)

2. **Default Mode — pick a changed spec**
   - Read the `Changed spec files` list injected into the Context block above
   - **Empty list** → cross-verify with `Glob` against `openspec/changes/*/specs/**/spec.md`; if still empty, report: "the current branch has no spec.md changes relative to `master`; please use `/ui-ux-verify <url>` to target a page directly." Then stop — do **not** enter the agent
   - **Single file** → use it; proceed to step 3
   - **Multiple files** → list as a numbered table, wait for user reply (e.g. `1`). One spec at a time, to avoid context explosion

3. **Single-spec pre-process** (all modes share this)
   - Use Read to grab the first 80 lines of the chosen spec.md
   - Extract candidate `controller`, `action`, "target page", and `https://` keywords as delegation hints (advisory only; the agent has the final word)

4. **Delegate to the `ui-ux-verifier` agent**

   Using the Task tool:

   ```
   subagent_type: ui-ux-verifier
   description: Audit <controller>/<action> against spec
   prompt: |
     Source: /ui-ux-verify project command
     Target spec: <spec path or "auto-search">
     Target URL: <url or "extract controller/action from the chosen spec contents, complete to full URL; if not derivable, stop and ask the user, do not guess">
     User's raw arguments: <$ARGUMENTS>

     Please follow the agent's input protocol and run Steps 1–4 of the full verification flow:
       1. Load the spec, list R1/R2/R3 ... pending verification items
       2. playwright-cli open/snapshot to capture the live screen
       3. Three-perspective comparison: Content / Structure / Behavior
       4. Produce a CRITICAL / HIGH / MEDIUM / LOW findings report

     Write the report to `.claude/artifacts/reviews/ui-ux-<timestamp>-<controller>-<action>.md`.
   ```

5. **Result return**
   - Pass the agent's report path and findings summary (CRITICAL / HIGH / MEDIUM / LOW counts) through to the user
   - The "create a fix change" y/n gate is handled by the agent itself; **this command does not intervene**

## Key Rules

- This command only does "collect the changed spec list → delegate"; it does not read playwright snapshots itself, nor produce the audit report itself
- **Forbidden**: `git add` / `git commit` / `git push` (per `dhpk:execution-policy` "Git pipeline")
- One spec per invocation; multiple changed specs require the user to re-invoke `/ui-ux-verify` to switch targets

## Examples

```bash
# Default Mode — list specs changed on the current branch and let the user pick
/ui-ux-verify

# URL Mode — direct page, agent searches the spec
/ui-ux-verify https://www.<your-host>/<route>/report/dailySalesSummary

# Combined Mode — URL + spec passed together
/ui-ux-verify https://www.<your-host>/<route>/report/dailySalesSummary spec:openspec/changes/custom-reports/specs/daily-sales-summary/spec.md

# Spec-Only Mode — spec only, agent derives URL from spec contents
/ui-ux-verify spec:openspec/changes/custom-reports/specs/inventory-detail/spec.md
```

## References

| Topic | Path |
|---|---|
| Agent body | `${CLAUDE_PLUGIN_ROOT}/agents/ui-ux-verifier.md` |
| playwright-cli command list | `playwright-cli` skill (if installed in your harness) |
| Anti-Loop Protocol | `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` |
