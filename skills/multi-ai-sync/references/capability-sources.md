# Capability Sources

Last verified: 2026-03-02

## Claude
- Context7: `https://context7.com/anthropics/claude-code`
- Official docs: `https://code.claude.com/docs/en/slash-commands`

## Codex CLI
- Context7: `https://context7.com/openai/codex`
- Official docs: `https://developers.openai.com/codex`
- Official repo: `https://github.com/openai/codex`

## Gemini CLI
- Context7: `https://context7.com/google-gemini/gemini-cli`
- Official repo/docs: `https://github.com/google-gemini/gemini-cli`

## Antigravity
- Context7: `https://context7.com/websites/antigravity_google_home`
- Official site: `https://antigravity.google`
- Official blog reference: `https://blog.google/intl/nl-nl/product/zoeken-kijken/een-nieuw-tijdperk-van-intelligentie-met-gemini-3/`

## Source Arbitration
1. Prefer Context7 for quick capability lookup.
2. If Context7 is incomplete or conflicts, use official documentation as final authority.
3. If still ambiguous, mark `needs-review` in reasoning and avoid automatic migration.

## Conflict Registry
- File: `.codex/skills/multi-ai-sync/references/source-conflicts.json`
- Purpose: explicitly record Context7 vs official doc conflicts and override decisions.
- Each entry can scope by `target/category/feature_id/feature_name` and optionally override `status/reason/target_path`.
