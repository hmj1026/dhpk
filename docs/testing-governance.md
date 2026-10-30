# Testing governance

This page owns daily and change-scoped test policy. Local development ledgers,
timing comparisons, and run receipts belong in `docs/evidence/` and are not
installation or distribution artifacts.

## Script behavior

Add or extend automated tests when a script owns meaningful caller-visible
behavior, a safety decision, or a high-impact side effect that a test can
reliably exercise. Use an existing CLI, hook, installer, or package boundary
and assert the outcome a user or caller observes.

- A script or pure helper does not need a dedicated test by default.
- A thin wrapper may be covered through its real entry point; a helper with no
  independent behavior may remain untested.
- Choose behavioral or smoke checks according to the risk being protected.
  Smoke checks show that an operational script parses and safely starts; they
  do not claim full behavior coverage.
- Do not add a project-wide fixed coverage percentage or test-count target.

## Suite organization

Use the existing `tests/run-all.js` runner and organize suites around behavior
or a public contract. Keep shared fixture helpers under `tests/_lib/`; do not
create a coverage ledger merely to pair every production file with a test.

Daily pull-request CI remains the routine suite entry and uses the existing
light/selected/full router. It uses the runner's positional-file mode for
known script changes. Markdown edits require a semantic declaration reviewed
against the diff; file extension alone cannot establish a wording-only change.
The pull-request body carries exactly one inert `dhpk-ci-classification` JSON
fence, or local commands can read the same object with `--classification-file`:

```json
{"baseSha":"<base>","headSha":"<head>","entries":[{"path":"skills/example/SKILL.md","kind":"wording","reason":"Clarifies an existing example without changing task behavior."}]}
```

Each changed path is declared exactly once, including both old and new names
for a rename. Kinds are `wording`, `behavior`, `shared-core`, and `unknown`;
entries cannot choose suites or request a plan mode. The declaration is an
author's reviewable assertion, not machine proof of meaning. Review it with the
changed content, especially Markdown that may alter authorization, task scope,
stopping conditions, invocation semantics, or required evidence. Missing,
malformed, incomplete, duplicate, extra, or base/head-stale declarations route
to full. PR body edits rerun CI. Planning, aggregate verification, and shard
verification independently read the event declaration and recompute against
Git changes; a downloaded plan is evidence, not classification authority.

`wording` can use light only for canonical content and bounded, exact generated
companions after applicable consistency checks. `behavior` selects existing
owner suites, including the explicit harness-setup installer mapping; unmapped
behavior falls back to full. Shared-core paths, `shared-core`, `unknown`,
unmapped changes, and formal releases stay full. The planner records
classification status and reasons in its output. Its final verifier requires
every required job to pass and every skipped job to report skipped.

Daily CI's two operability gates are (a) Skill-script
operability smoke (`tests/skill-script-operability.test.js`) and (b) the
install/package keep-list suites. Help-only or start-fixture smoke MUST NOT
be recorded as representative isolated runtime PASS. The plan selects a union
of coarse owner suites for hooks, installer lifecycle, skill resources,
Skill-script operability, and manifest or adapter packages; a selected plan
runs one shard with four workers. A full plan keeps four shards with four
workers. Shared core, runner or CI changes, unknown paths, missing owner
suites, and unavailable diffs fail closed to the full plan. The selected plan
records its test files, and shard verification requires the trusted plan's
exact union without omissions, extras, or duplicates. Installer, hook, and
resource-runtime owner changes also run the macOS installer job. Unknown
paths still fail closed to the full plan, which keeps that job.

This routing is an execution optimization and does not create a
script-to-test coverage obligation. Tests do not assert live prose wording,
section order, examples, or body length; human semantic review determines the
declaration, and shared metadata and resource checks continue through their
existing owner validators.

Test shared behavior once through the common path. Add Host-specific checks
when a Host has a distinct behavior or contract. Run `consumer-gate` only when
a change affects installation, update, removal, receipt ownership, conflict,
or recovery behavior; ordinary document and skill-content edits do not trigger
it.

Canonical content may use the light CI route with exact owned Markdown,
receipt, fingerprint, or resource-ledger companions. The authoritative plan
records affected package surfaces and Claude checks, and preflight runs the
recorded checks. Claude generated checks selected for light or selected plans
run even for canonical prose; physical package checks follow affected
surfaces.
Unknown generated data, executables, generated-only changes, and runtime or
script changes remain full-plan work; the route does not skip their behavioral
suites. Existing CI plans retain the source harness structure, permission,
and route-safety checks. Preflight also runs `shellcheck --severity=warning`
on `scripts/hooks/*.sh` and `scripts/hooks/_lib/*.sh` for full and selected
plans, using a pinned GitHub-release binary. Canonical-content light plans
skip that step because those diffs cannot change hook scripts. Required CI
fails if the binary is missing, mismatched, or the install fails; a local
optional mode may SKIP when the tool is absent and must not claim PASS.
This repository has no npm lockfile, so this change does not add OSV or a
lockfile solely for scanning. The two extra workflow-policy rules
(`persist-credentials: false` on read-only `actions/checkout`, and no
`${{ }}` interpolation inside `run:` shells) are bounded repository-owned
checks beside actionlint; they do not replace `zizmor` and are not a weekly
`security.yml` scanner. If a later gap is concrete, evaluate that tool's
incremental coverage against pin and false-positive cost separately.

Skill and guidance Markdown is reviewed by people. Automated checks may parse
machine-readable metadata or verify required resources through shared tools,
but they do not assert the wording, section order, examples, or body length of
individual documents. Parser tests use small fixtures rather than live skill
prose. Content-size or discovery measurements may be requested as informational
reports; they do not create a prose-correctness contract. Actual Host and package
compatibility constraints remain enforced where they affect shipped behavior.

Runtime-guidance suites may opt into the existing JavaScript guardrail with
`// dhpk:runtime-guidance-test`. The lexical check rejects raw content-reader
APIs in marked test source; use executable routes, shared metadata parsers,
or resource-existence checks. It is a bounded source check, not cross-file
dataflow analysis or a document-wording gate.

For long local runs, choose `DHPK_TEST_JOBS` explicitly; `2` is a recommended
starting point when local resources allow, and the runner default remains
`1`. A typical progress-enabled run is:

```sh
DHPK_TEST_JOBS=2 DHPK_TEST_PROGRESS=1 npm test
```

Runner owner fixtures exercise progress with both `DHPK_TEST_JOBS=1` and `2`
in [verify-test-shards.test.js](../tests/verify-test-shards.test.js); do not
repeat the full local suite solely to observe progress in both modes.

Progress emits compact test-start and completion updates on stderr. Ordered
stdout, assertion accounting, timing reports, and the aggregate exit status
remain authoritative; progress output does not establish a timing improvement.

Model-driven or GUI sessions and live context, budget, count, or benchmark
measurements are on-demand research, not routine CI gates. Those research
budget and benchmark tests live under `tests/on-demand/` and run with
`npm run test:research-budgets`; the aggregate runner skips that directory.
CI may retain redacted shard timing artifacts as execution evidence;
performance benchmarks and comparisons remain on demand. Research CLIs and
libraries remain available on demand, and stable fixture tests for their
calculations and CLI behavior remain in the suite. Do not assert live checkout
prose or variable numerical quotas. Run Host runtime checks only for a new
integration, a loader, role, or tool-mapping change, a reproducible activation
defect, or an explicitly authorized request.

For a handoff or closeout, record the plan's base/head/checkout identity,
classification status and reason, required and skipped jobs, their observed
results, and remaining gaps. A plan does not itself prove that its required
checks passed. When the accepted plan mode is `full` and Hosted CI will run
the `tests` job, a local `npm test` already recorded on that same head is
reusable evidence. Do not start a second full suite only because another
instruction also asks for one. When no local full run exists, Hosted CI is
the suite evidence. Focused checks that protect the edit still run locally
before the pull request. This daily and change-scoped policy does not retire
release or publication acceptance; those gates remain in the
[plugin development contract](agent-guidance/plugin-development.md#release-acceptance).

## Darwin installer subset

The macOS CI job `macos-installer` executes the Darwin-differential files in
`tests/_lib/macos-installer-files.js` (`MACOS_INSTALLER_FILES`). That list is
filesystem, symlink-canonicalization, descriptor-relative writer, portable
runner, and Host-unique installer smoke — not a replay of Linux owner
matrices. Schema, receipt-variant, evidence-normalization, and stub-CLI
suites stay on Ubuntu. Adding or removing a Host-unique installer suite from
the Ubuntu aggregate runner must update that list in the same change; the job
already runs the list. `macos-installer-darwin` keeps `TMPDIR=/private/tmp` on
Darwin. Linux PASS does not stand in for Darwin PASS.
