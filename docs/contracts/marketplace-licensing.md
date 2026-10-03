# Marketplace licensing contract

## Review result (task 3.4, 2026-10-03)

The review covered every skill directory that a Host package could publish at
the time: 76 IDs, which excluded the 8 then-withdrawn IDs. Two checks were run:

- **Attribution scan:** a search for copyright lines, license names, SPDX tags,
  "adapted/ported/derived from" wording, vendored code, and links to other
  repositories.
- **Overlap check:** a line-by-line comparison of agents, trap sheets, skill
  entries, and skill references with a local clone of the third-party project
  ECC (`https://github.com/affaan-m/ECC`, MIT, Copyright (c) 2026 Affaan
  Mustafa). dhpk agents and trap sheets were ported from ECC in v0.19.0.

| Finding | Decision |
| --- | --- |
| `harness-govern` bundles `tomli` 1.0.3 (MIT, Copyright (c) 2021 Taneli Hukkinen) under `scripts/multi_ai_sync_lib/vendor/tomli/` | Keep. Its `LICENSE` ships beside the code in every generated package; `tests/marketplace-selection.test.js` fails if a package drops it. `harness-govern` is Host-only and not part of the OpenAI package. |
| `agent-architecture-audit` SKILL.md is 79% line-identical to ECC with no retained notice | Removed from every package (user decision, 2026-10-03). |
| `skill-forge` references are 40–66% line-identical to ECC with no retained notice | Removed from every package (user decision, 2026-10-03). |
| `agents/agent-evaluator.md` and `agents/spec-miner.md` contain distinctive text from ECC with no retained notice | Removed from every package (user decision, 2026-10-03). The `spec-mine` skill and `/dhpk:spec-mine` command existed only to front `spec-miner`, so they were removed with it. |
| `dhpk-yii1-php56-development` references | Clean-room rewrite completed earlier in this change; each reference records its source basis. |
| Six `gitnexus-*` skills | Excluded. GitNexus owns them and distributes them through the optional external GitNexus tool. dhpk never requires GitNexus: `code-trace` selects a fallback (CX, then native Grep/Glob/Read) when GitNexus is absent. |

No other third-party text or code was found in the published skill
directories. The remaining hits from the attribution scan were ordinary words
(for example, guidance about vendored files in a consumer project).

## Removal from all packages (2026-10-03)

On 2026-10-03 the `agent-architecture-audit`, `skill-forge`, and `spec-mine`
skills, the `/dhpk:spec-mine` command, and the `agent-evaluator` and
`spec-miner` agents were removed from every generated package: the Claude
marketplace and profiles, the Codex native package, the Cursor package, the
Agent plugin, and the AGY package. Their source directories were deleted from
the tree; git history keeps them. Each removed skill has a
`retired_skills` row in `manifests/distribution-inventory.json` with
`reasonCode: third-party-text-overlap`, `retiredIn: 0.65.0`, and rollback
release `0.64.4`.

## Classification state

The 75 published IDs are `first-party`: dhpk-authored work covered by the root
`LICENSE`, plus the `tomli` notice above. The 6 withdrawn GitNexus IDs are
`excluded`.

## Limits

The overlap check compared only against ECC, the one known porting source. The
attribution scan found no other upstream. Re-run both checks when content is
imported from a new source, and keep each package's file list and notices in
the 7.1 artifact evidence.
