# Own invocation class in each distributed entry

dhpk records `explicit-only` or `implicit-eligible` in each Distributed Skill's `SKILL.md` as the nested `metadata` key `dhpk-invocation-class`; an unpaired Distributed Command records the same nested field in its own frontmatter, while a paired command inherits the skill's class. Claude's `disable-model-invocation` and Codex's `policy.allow_implicit_invocation` are validated projections, not independent decisions. This keeps authority policy beside the entry it governs, covers optional and experimental packages, and avoids a second central inventory that can drift.

## Considered Options

- A command/skill pairing manifest would not cover unpaired skills or commands.
- A broader central distribution inventory would separate policy changes from the packages they govern.
- Inferring class from descriptions or current runtime flags would turn existing drift into policy.

## Consequences

Every distributed entry must be explicitly classified before enforcement becomes blocking. All entries remain directly human-invocable; model-only entries are rejected until both Claude and Codex can represent and validate that state consistently.
