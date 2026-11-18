# dhpk

dhpk is a development harness for Claude Code. It adds role-based agents, workflow skills, and slash commands that route software-delivery work through planning, implementation, review, and verification. Stack modules (PHP, Yii, Laravel, JavaScript, Python, React, Next.js, iOS/Swift) ship in the separate dhpk-stacks plugin, which requires this one.

Requires Claude Code 2.1.295 or newer. The edit guard blocks on failure only from that version.

## What this plugin installs

- Skills, agents, and commands under `skills/`, `agents/`, and `commands/`.
- No stack modules. Install `dhpk-stacks` (`/plugin install dhpk-stacks@dhpk`) to add them; it owns the `modules` setting. `/dhpk:harness-setup` detects your stack and tells you when `dhpk-stacks` is missing.
- Hook scripts under `scripts/hooks/`, and rules under `rules/`.

## Hooks

The plugin registers four hooks in `hooks/hooks.json`. They run local shell scripts and send nothing over the network.

| Event | Matcher | Script | Purpose |
| --- | --- | --- | --- |
| PreToolUse | Edit, Write, MultiEdit | `pre-edit-guard.sh` | Blocks edits to `.env` files, `.git/`, and package-manager lock files. Fails closed on error or timeout (5 seconds). |
| PreToolUse | Bash | `pre-bash-dispatch.sh` | Runs the security guard, credential-read guard, and git branch-safety gate before a shell command. |
| SessionStart | all | `session-start.sh` | Prints a fixed dispatch note. Takes no snapshots and inspects no project files. |
| SubagentStop | all | `subagent-stop-verify.sh` | Non-blocking. Clears a worker liveness marker and appends one record per stopped subagent to a local dispatch log. |

## Setup writes files

The `/dhpk:harness-setup` command (the `harness-setup` skill) is explicit-only. When you run it with `--install`, it copies selected hooks, rules, or scripts into the project's `.claude/` directory and writes a project rules stub at `.claude/rules/dhpk-overrides.md`. It never overwrites a differing file without `--force`, and `--dry-run` prints the plan without writing. It does not run unless you invoke it.

## External tools

- The `codex-reasoner`, `codex-reviewer`, and `codex-worker` agents call the Codex CLI. They need `codex` installed and signed in, and report BLOCKED when it is missing.
- The `agy-worker` agent calls the `agy` CLI and needs it installed.
- Several agents use `git`, `node`, and `bash`. Stack modules in `dhpk-stacks` call their own toolchains only when you select them.

## MCP tools referenced but not bundled

The plugin ships no MCP server. Some agents list MCP tools that you must provide yourself:

- `mcp__gitnexus__impact`, `mcp__gitnexus__query`, and `mcp__gitnexus__rename` from a GitNexus MCP server, used by the reviewer and refactor agents.
- `mcp__context7__resolve-library-id` and `mcp__context7__query-docs` from a Context7 MCP server, used by the `docs-lookup` agent.

Without these servers the affected agents still load, but the listed tools are unavailable and the agents fall back to `Read` and `Grep`.

## Configuration

Options such as `hook_profile`, `review_agents`, and the dispatch targets are set through the plugin's `userConfig` prompts when you enable it. Defaults work without changes.

## Support and license

Source and issues: https://github.com/hmj1026/dhpk. Licensed under MIT; see `LICENSE`.
