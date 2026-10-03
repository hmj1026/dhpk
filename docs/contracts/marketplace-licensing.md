# Marketplace licensing contract

## Review result (task 3.4, 2026-10-03)

The review covered every skill directory that a Host package can publish: 76
IDs, which excludes the 8 withdrawn IDs. Two checks were run:

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
| `agent-architecture-audit` SKILL.md is 79% line-identical to ECC with no retained notice | Withdrawn from publication (user decision, 2026-10-03). |
| `skill-forge` references are 40–66% line-identical to ECC with no retained notice | Withdrawn from publication (user decision, 2026-10-03). |
| `agents/agent-evaluator.md` shares 6 of 42 long lines (14%) with ECC | Open item. Agents are not part of the OpenAI skills package; review it before the next Claude, Codex, or Cursor agent release. |
| `dhpk-yii1-php56-development` references | Clean-room rewrite completed earlier in this change; each reference records its source basis. |
| Six `gitnexus-*` skills | Excluded. GitNexus owns them and distributes them through the optional external GitNexus tool. dhpk never requires GitNexus: `code-trace` selects a fallback (CX, then native Grep/Glob/Read) when GitNexus is absent. |

No other third-party text or code was found in the published skill
directories. The remaining hits from the attribution scan were ordinary words
(for example, guidance about vendored files in a consumer project).

## Classification state

The 76 published IDs are `first-party`: dhpk-authored work covered by the root
`LICENSE`, plus the `tomli` notice above. The 8 withdrawn IDs are `excluded`.

## Limits

The overlap check compared only against ECC, the one known porting source. The
attribution scan found no other upstream. Re-run both checks when content is
imported from a new source, and keep each package's file list and notices in
the 7.1 artifact evidence.
