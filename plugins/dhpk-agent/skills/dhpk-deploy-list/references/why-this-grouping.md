# Why these decisions — sorting / filtering / grouping rationale

> Progressive disclosure: SKILL.md gives the quick reference; this file
> records the design rationale and the alternatives that were tried and
> dropped.

## 1. Sort order: dependency-direction (domain → infra → app → assets → entry bundle)

**Rationale**: deploy operations should follow dependency direction so a
partial deploy doesn't break loading.

| Layer | Why it deploys first |
|-------|---------------------|
| `domain/` (when present) | Pure value objects / interfaces — small surface, broad impact; must arrive before infrastructure can reference it. |
| `infrastructure/` (when present) | Repository / adapter implementations depend on `domain` interfaces; must arrive before application code. |
| Framework application layer (Yii `protected/`, Laravel `app/`, Rails `app/`, etc.) | Controller / Model / View; depends on domain + infrastructure. |
| Static assets (`css/`, `themes/`, `images/`, `fonts/`) | Cache-sensitive but order-insensitive relative to backend. Comes after backend so the browser doesn't fetch broken-cache references mid-deploy. |
| Frontend JS bundle | Last because it usually forces a browser reload. Legacy monoliths with a feature-flag toggle (modular ↔ legacy) handle their fallback via the rollback hint. |

**Rejected alternatives**:

- Alphabetical: no semantic meaning; reviewer can't internalise the order.
- Diff-size descending: order is non-deterministic across runs; defeats muscle memory.
- Flat (no grouping): high risk of skipping a layer during manual deploy.

## 2. Filter rules

Universal filter covers dev-time-only artifacts and configuration files
that should never reach a production deploy:

- Test directories (`tests/`, `__tests__/`, `__mocks__/`,
  framework-specific test paths).
- Documentation (`docs/`, `README*`, `CHANGELOG*`, `LICENSE`).
- AI harness directories (`.claude/`, `.codex/`, `.gemini/`, `.agents/`)
  and top-level agent docs (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`).
- CI / IDE meta (`.github/`, `.gitignore`, `.idea/`, `.vscode/`).
- Lock files (`composer.lock`, `package-lock.json`, `yarn.lock`,
  `poetry.lock`, `pnpm-lock.yaml`) — these are reproduced by the build
  pipeline, not copied.

**Why we DO ship view templates** (e.g. `protected/views/`,
`resources/views/`, `app/views/`): views are runtime artifacts, not dev
artifacts. The server-side framework renders them on every request.

## 3. Rollback hints (preset-specific)

The `🔁 Rollback hints` section emits only when a preset's
`PRESET_ROLLBACK_TRIGGER` regex matches a file in the main group. This is
intentional — most deploys don't need a rollback note, and noise reduces
signal.

When to wire a rollback trigger in your own preset:

- Your project has a feature-flag-driven `modular ↔ legacy` toggle that
  ops needs to flip in seconds when a deploy breaks the critical path.
- The toggle's location (which config file + which key) is stable enough
  to embed as a documented hint string.

The `extended-presets.example/php-yii-acmeshop.sh` example demonstrates
this pattern.

## 4. `--deploy-commits` (not `--tag`-driven) grouping

**Earlier design (rejected)**: derive groups by `git log --grep="[tag]"`
— find commits in `base..head` whose messages contain `[tag]`, treat
those as the main group, treat the rest as the warn group.

**Current design**: `--tag` is pure metadata for the header. Grouping is
driven by `--deploy-commits SHA1,SHA2,...`. If you don't pin commits,
the whole `base..head` becomes a single main group.

**Why tag-driven grouping doesn't work in practice**:

1. **Concept mismatch**: in real workflows, "tag" is an ops concept
   (store code, version, batch ID — assigned at deploy time) and
   "commit" is a dev concept (assigned at development time). Coupling
   them by `git log --grep` would force every developer to predict
   which deploy batch their commit will land in.
2. **Empirical fallback rate**: in pilot tests against real branches,
   nearly every commit fell through to the "whole base..head as one
   group" fallback — the grouping had become decorative.
3. **Case trap**: `[V1]` and `[v1]` are treated as different tags by
   `git log --grep`, but they mean the same thing operationally. `grep`
   alone can never close this gap cleanly.
4. **Escape hatch retained**: `--auto-detect-tag` (off by default, uses
   `grep -i`) is available for workflows where tag embedding actually
   makes sense.

## 5. Stats block design

`📊 Stats` and `🚫 Filtered out` are deliberately separate:

- **Stats** target the deploy executor (counts, language breakdown,
  commit count).
- **Filtered out** target the reviewer (sanity check that nothing
  important was excluded).

`main count + filtered count ≈ git diff total` (tolerance ≤ 2 because
rename rows show up as R-status; the script counts the new path while
`git diff` totals count the rename as one entry).

## 6. Why Claude must NOT post-process the script's output

Two reasons:

1. **Drift protection**: the output format is the interface contract
   (schema=v1). Any "helpful tidy-up" by Claude breaks the golden
   diffs and downstream parsers.
2. **Trust boundary**: deploy is a high-risk operation. The operator
   must be able to trust that what they see is exactly what the script
   produced. Claude must not become a well-meaning intermediary that
   silently edits the output.

The command spec and SKILL.md both list this rule explicitly: NEVER add
summaries, emoji, suggestions, or re-orderings to the script's stdout.
