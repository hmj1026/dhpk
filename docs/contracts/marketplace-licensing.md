# Marketplace licensing contract

## Current decision and completion boundary

Retain necessary capabilities through independently written implementations and
guidance; remove redundant material. Keep useful third-party dependencies with
their applicable notices. Preserve source history and the existing retirement
decisions. External links alone do not establish that upstream text was copied.

The remediation scope includes canonical scripts, agents, trap sheets, module and skill
references, supporting assets, and their declared package projections. A skill
ID's catalog label does not establish authorship of every file it can publish.
The root `LICENSE` states the license for dhpk-owned work; it does not replace
upstream notices or resolve an unidentified source.

The source findings below are confirmed or identified for review. Rewriting,
removal, final package inspection, and installed read-back remain pending.
Correcting this contract is not rights acceptance or publication readiness.

The [integrated delivery tracker](https://github.com/hmj1026/dhpk/issues/866)
owns the ordered remediation and public acceptance records. Local OpenSpec
changes and run evidence remain ignored working records, not fresh-checkout
requirements.

## Source findings and ordered remediation

### 1. ECC executable capabilities

The initial dhpk release, commit `6d142d4e` (2026-05-21), contains four files
with the same Git blob as earlier ECC revisions. Later relocation or renaming
does not change that provenance.

| Current canonical file | Earlier ECC source | Shared initial Git blob |
| --- | --- | --- |
| `skills/harness-audit/scripts/harness-audit.js` | [`scripts/harness-audit.js`, `b9a01d3c`, 2026-03-30](https://github.com/affaan-m/ECC/blob/b9a01d3c/scripts/harness-audit.js) | `836eb15a7cea3bf2e493b14e8920c4464c88df1c` |
| `skills/skill-scope/scripts/scan.sh` | [`skills/skill-stocktake/scripts/scan.sh`, `91b7ccf5`, 2026-02-22](https://github.com/affaan-m/ECC/blob/91b7ccf5/skills/skill-stocktake/scripts/scan.sh) | `5f1d12dbd14cbdb49f5b1acdea23b63ac81c98b1` |
| `skills/skill-scope/scripts/quick-diff.sh` | [`skills/skill-stocktake/scripts/quick-diff.sh`, `91b7ccf5`](https://github.com/affaan-m/ECC/blob/91b7ccf5/skills/skill-stocktake/scripts/quick-diff.sh) | `c145100a63972ac231e3386bf07db1361251e0fe` |
| `skills/skill-scope/scripts/save-results.sh` | [`skills/skill-stocktake/scripts/save-results.sh`, `91b7ccf5`](https://github.com/affaan-m/ECC/blob/91b7ccf5/skills/skill-stocktake/scripts/save-results.sh) | `32952007217c86c21a368c0b1c8096eaed5cba3a` |

At the review baseline `04419c4e`, `save-results.sh` still has the shared blob.
All four capabilities have current consumers. Independently rewrite them while
preserving CLI, environment, serialized output, exports, and storage behavior;
removal is not justified by overlap alone. Use functional requirements and
independent behavioral fixtures rather than the upstream implementation as the
writer's input.

### 2. Agents and trap sheets

The v0.19.0 port is recorded by commit `ba35df3c` and the historical changelog.
Remaining review targets include the `docs-lookup` description, `e2e-runner`
workflow and examples, `type-design-analyzer` assessment, and the architect and
security-reviewer guidance. Ported trap sheets also require source-aware review.
Some are now condensed or paraphrased; absence of a long exact match does not
resolve their provenance.

Rebuild necessary instructions and examples from dhpk's role responsibilities,
tool boundaries, evidence requirements, and current interfaces. Remove redundant
general lists. Preserve functional requirements and routing, not the upstream
wording or distinctive example organization.

### 3. References and other authors

| Material | Source or evidence | Decision |
| --- | --- | --- |
| Swift protocol DI, actor persistence, and approachable-concurrency module references, plus declared skill copies | Candidate text and example overlap with ECC's corresponding Swift skills at `e04ea0b9` | Review the specific spans, independently rebuild necessary examples from official technical facts, and synchronize the canonical resource owner. |
| PHP runtime-router testing-quality reference | Candidate overlap with ECC's Laravel TDD reference at `e04ea0b9` | Review specific spans and rewrite necessary guidance; ordinary API names are not an authorship finding. |
| `agent-traps/database-reviewer/postgres.md` | Explicit Supabase adaptation credit; [reviewed upstream skill revision](https://github.com/supabase/agent-skills/blob/544bfc56c89afe2b87b20017a59b2c6e9502a1fb/skills/supabase-postgres-best-practices/SKILL.md) | Independently rebuild the PostgreSQL guidance and examples. Its supporting-asset and package copies are in scope; the earlier candidate-ledger exclusion is not current package evidence. |
| `skills/module-design/references/dependency-and-tests.md` | Pinned [Matt Pocock reference](https://github.com/mattpocock/skills/blob/24fe0ef7737efae15c87225755e9f6f5965e4888/skills/engineering/codebase-design/DEEPENING.md) and retained category organization | Reorganize necessary guidance around dhpk's caller decisions and testing evidence; retain historical source provenance. |
| Writing-for-agents external reading link | The local guidance points to the external skill instead of vendoring it | Keep the link; distinguish local requirements from external reading. |
| Triage-label mapping | Unnecessary upstream-label comparison column | Keep the project label values and routing meanings; simplify the local presentation. |
| Four Yii/PHP 5.6 references | Earlier independent rewrite and recorded source basis | Recheck current bytes and package read-back; do not repeat the rewrite solely because its historical source record remains. |

### 4. Retained dependencies and notices

`harness-govern` retains `tomli` 1.0.3 under
`scripts/multi_ai_sync_lib/vendor/tomli/`, with its MIT license and Taneli
Hukkinen copyright notice beside the code. The existing
`tests/marketplace-selection.test.js` checks the license in applicable generated
packages. Its Host-only selection does not make it part of the OpenAI package.

The inspected [ECC license](https://github.com/affaan-m/ECC/blob/e04ea0b9cc8248686edf5ac751cadff550e162b8/LICENSE),
[Supabase license](https://github.com/supabase/agent-skills/blob/544bfc56c89afe2b87b20017a59b2c6e9502a1fb/LICENSE),
and [Matt Pocock license](https://github.com/mattpocock/skills/blob/24fe0ef7737efae15c87225755e9f6f5965e4888/LICENSE)
are MIT. Applicable copies or substantial portions require the copyright and
permission notices; a credit line or a repository link does not replace those
notices. Identify retained material and verify its notice alongside the actual
artifact. No completed notice repair is claimed by this documentation update.

## Historical review and removal decisions (2026-10-03)

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
| `dhpk-yii1-php56-development` references | Independent rewrite recorded earlier; each reference records its source basis. |
| Six `gitnexus-*` skills | Excluded. GitNexus owns them and distributes them through the optional external GitNexus tool. dhpk never requires GitNexus: `code-trace` selects a fallback (CX, then native Grep/Glob/Read) when GitNexus is absent. |

This historical scan is incomplete for the current canonical and package scope.
It does not support a claim that no other upstream text or code exists; the
findings above supersede that conclusion.

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

## Catalog classification and acceptance

The catalog's 75 active IDs carry the historical `first-party` label. Treat it
as a catalog-level classification awaiting file-level source disposition, not
proof that their scripts, references, or supporting resources are all authored
by dhpk. The six withdrawn GitNexus IDs remain upstream-owned and excluded from
dhpk publication; their existing external installation ownership is unchanged.

Complete each remediation wave with independent review, applicable behavioral
and metadata checks, owner-generated projections, actual package file lists,
notice checks, and installed read-back where required. Bind evidence to source
and artifact identity. Record unfinished or unavailable checks explicitly.

## Limits

The initial overlap check used ECC only. The current review also identifies
Supabase and Matt Pocock sources and retained Tomli code; it is not an exhaustive
rights audit of all possible sources. Exact matches, structural similarities,
technical facts, and explicit source credits are different evidence classes.
Similarity scores or a search with no matches are not rights acceptance.

Independent rewriting uses a requirement brief without upstream expression,
followed by behavioral or semantic review and source comparison. Rewriting does
not automatically establish independence or remove notice obligations. Keep
source history and required notices while the applicable material remains.
Reassess affected evidence when source, selection, package bytes, or requirements
change. Publication, release, live cutover, and compatibility retirement remain
separate authorized checkpoints.
