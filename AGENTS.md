<!-- gitnexus:start -->
# dhpk Agent Guidance

This checkout is the dhpk plugin source. Use the GitNexus gates before symbol
edits and commits; use the linked topic pages for branch-specific mechanics.

## Universal gates

- Before editing a function, class, method, or indexed symbol, run upstream
  GitNexus impact and report direct callers, processes, and risk.
- Warn before HIGH/CRITICAL impact; before committing, run
  `gitnexus_detect_changes()` against the actual worktree.
- Prefer `cx` overview/definition/references, then GitNexus query/context, then
  focused `rg`/Read fallback. Never blind-rename an indexed symbol.

## Detailed guidance

- [Agent guidance index](docs/agent-guidance/README.md)
- [GitNexus and exploration](docs/agent-guidance/gitnexus.md)
- [Plugin development and release gates](docs/agent-guidance/plugin-development.md)
- [Writing for agents](docs/agent-guidance/writing-for-agents.md)
- [Codex projection contract](codex/AGENTS.md)

If GitNexus reports a stale index, run `npx gitnexus analyze` before relying on
impact or process results.
<!-- gitnexus:end -->
