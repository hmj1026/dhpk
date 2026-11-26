# Repo Intake

`$SKILL_DIR` denotes the physical directory containing the selected `REFERENCE.md`;
it is path notation, not an ambient environment variable or repository-root
lookup. Resolve it before running intake from an arbitrary consumer cwd.

## When to Use

- First time onboarding a project
- Rebuilding cache after major project structural changes
- Cache expired, needs updating

## When NOT to Use

- Already familiar with project structure (read cache directly)
- Only need to find specific files (use Glob/Grep)
- Day-to-day development (cache already exists)

## Workflow

```
Docs -> Entrypoints -> Tests Map -> Next Steps
```

## Usage

> Not shipped in the Directory Plugin: `intake_cached.js`. Report this step as `NOT_RUN` and use the documented fallback.

## Cache Location

Cache stored at: `~/.claude/cache/repo-intake/<repoKey>/`

| File          | Description             |
| ------------- | ----------------------- |
| `latest.md`   | Latest scan results     |
| `latest.json` | Latest scan results (JSON) |
| `LATEST.json` | Cache metadata          |

## Output

```markdown
## Overview

<summary>

## Entrypoints

- {CONFIG_FILE}
- {BOOTSTRAP_FILE}

## Test Map

| Type        | Pattern           |
| ----------- | ----------------- |
| Unit        | test/unit/        |
| Integration | test/integration/ |
| E2E         | test/e2e/         |

## Next Steps

- <questions>
```

## Verification

- Output includes Overview, Entrypoints, Test Map, Next Steps
- Entrypoints correctly identify `{CONFIG_FILE}`, `{BOOTSTRAP_FILE}`
- Test Map covers Unit/Integration/E2E layers

## References

- `references/archived/MIDWAY_HEURISTICS.md` — Legacy MidwayJS heuristics (archived, for reference only)

## Scripts

| Script | Purpose |
|--------|---------|
| `intake_cached.js` (not shipped in the Directory Plugin) | Main intake with caching |
| `scan_repo.js` (not shipped in the Directory Plugin) | Full repo scanner (framework-agnostic) |
| `scan_delta.js` (not shipped in the Directory Plugin) | Delta scan for changed files |

## Examples

```
Input: repo-intake
Action: Execute intake script -> Output project map
```

```
Input: repo-intake save
Action: Execute intake script -> Output and write to docs/ai/intake/
```
