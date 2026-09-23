# Harness Directory Contract

All harness-facing skills resolve the active directory through this contract.

1. An explicit `--dir` value wins only when it is exactly `.claude` or
   `.codex`, resolves to a physical directory inside the repository, and has
   no symlinked root. Every script revalidates this boundary before scanning.
2. A caller-provided environment hint wins next; a Claude invocation uses
   `.claude` even when `.codex/` also exists.
3. Without either, discover `.claude/` and `.codex/`. Exactly one
   directory is required; zero directories block, and multiple directories
   require an explicit `--dir`.

Normalize any environment hint through the same allowlist; never pass an
arbitrary path through unchanged. Set `HARNESS_DIR` to the selected directory and derive the matching primary
rule file (`CLAUDE.md` or `AGENTS.md`) before scanning. Never
silently switch directories or treat a missing script directory as an empty
harness. The owning implementation and deterministic examples live in
`skills/harness-govern/SKILL.md` and its `scripts/` directory.
