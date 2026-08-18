# Harness Directory Contract

All harness-facing skills resolve the active directory through this contract.

1. An explicit `--dir` value wins and is passed unchanged to every script.
2. A caller-provided environment hint wins next; a Claude invocation uses
   `.claude` even when `.gemini/` or `.codex/` also exists.
3. Without either, discover `.claude/`, `.gemini/`, and `.codex/`. Exactly one
   directory is required; zero directories block, and multiple directories
   require an explicit `--dir`.

Set `HARNESS_DIR` to the selected directory and derive the matching primary
rule file (`CLAUDE.md`, `GEMINI.md`, or `AGENTS.md`) before scanning. Never
silently switch directories or treat a missing script directory as an empty
harness. The owning implementation and deterministic examples live in
`skills/dhpk-harness-revise/SKILL.md` and its `scripts/` directory.
