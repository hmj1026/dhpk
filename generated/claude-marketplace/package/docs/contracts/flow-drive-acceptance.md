# Flow Drive acceptance evidence

The public scenarios are the REQ-01 through REQ-16 acceptance table in
[issue #917](https://github.com/hmj1026/dhpk/issues/917). Their scenario names,
observable expectations, and executable source IDs are mapped in
[requirements.json](../../tests/fixtures/flow-drive/requirements.json).
Source IDs establish traceability; their existence does not establish PASS.

Report each requirement and evidence surface independently. `PASS` requires
executed, applicable evidence; `FAIL` records a checked expectation that did
not hold; `BLOCKED` records an unmet prerequisite or acceptance gate;
`NOT_RUN` records an unexecuted check. Fixture PASS establishes the simulated
public behavior, including expected refusals. It does not establish live
Host/Provider execution, real DEV/DB safety, package provenance, hosted CI,
release, publication, or deployment.

## Focused review-fix checkpoint

These commands actually ran on 2026-10-08 in the isolated review-fix worktree,
based on `9d1178cf33b842a14f502ae986fb1a159f6adc48` with unstaged canonical
fixes. The checkpoint applies to the source content below, rather than to
test-source discovery alone. Reassess it when the covered sources or their
dependencies change.

Source fingerprint: `7a275e9eaf80fbbe37177d8911c63821e3b287840ff7de6b7ae0c167f268e41f`.
It binds the runner sources, test suites/helpers, requirement map and fixed QA
inputs. Unchanged execution-bundle dependencies are bound by the base commit.
Reproduce it from the repository root with:

```sh
sha256sum skills/flow-drive/scripts/*.js tests/flow-drive*.test.js tests/_lib/flow-drive*.js tests/fixtures/flow-drive/requirements.json tests/fixtures/flow-drive/dev-qa-sanitized/*.json | sha256sum
```

Each row below was run as `node tests/<suite>.test.js`; every reported
assertion passed and each suite emitted its completed summary.

| Evidence ID | Suite | Result |
| --- | --- | --- |
| E1 | flow-drive-runner | PASS, 26/26 |
| E2 | flow-drive-coordination | PASS, 27/27 |
| E3 | flow-drive-provider-permissions | PASS, 20/20 |
| E4 | flow-drive-recovery | PASS, 16/16 |
| E5 | flow-drive-relocation | PASS, 7/7 |
| E6 | flow-drive-dev-qa | PASS, 7/7 |
| E7 | flow-drive-cli-dispatch | PASS, 19/19 |
| E8 | dispatch-engine | PASS, 88/88 |
| E9 | flow-drive-scope-baseline | PASS, 3/3 |
| E10 | flow-drive-lifecycle-safety | PASS, 10/10 |

| Public scenario | Executed evidence | Fixture/stub | Relocated consumer fixture | Live Host/Provider |
| --- | --- | --- | --- | --- |
| REQ-01: Small native task | E1, E5 | PASS | PASS | NOT_RUN |
| REQ-02: Unknown cause gates dependent writer | E2, E6 | PASS | PASS | NOT_RUN |
| REQ-03: Provider identity remains distinct from Route | E1, E8 | PASS | NOT_RUN | NOT_RUN |
| REQ-04: Answered additional Provider scope | E3, E5, E6 | PASS | PASS | NOT_RUN |
| REQ-05: Equivalent multi-provider answer forms | E3 | PASS | NOT_RUN | NOT_RUN |
| REQ-06: Prior grants and missing-answer boundaries | E3 | PASS | NOT_RUN | NOT_RUN |
| REQ-07: Current bound capability supersedes stale catalog | E1, E3, E5 | PASS | PASS | NOT_RUN |
| REQ-08: Strict target and truthful unknown identity | E2, E3, E8 | PASS | NOT_RUN | NOT_RUN |
| REQ-09: Independent progress and single writer including scratch | E2, E6 | PASS | PASS | NOT_RUN |
| REQ-10: Necessary independent review gap | E2, E5, E6 | PASS | PASS | NOT_RUN |
| REQ-11: Standalone relocation and optional prior evidence | E5 | PASS | PASS | NOT_RUN |
| REQ-12: Bounded recovery, timeout and partial writer | E4, E6, E9, E10 | PASS | PASS | NOT_RUN |
| REQ-13: Task inputs and structured authority | E1, E3 | PASS | NOT_RUN | NOT_RUN |
| REQ-14: Advanced compatibility and exact external grants | E1, E3, E7 | PASS | NOT_RUN | NOT_RUN |
| REQ-15: Canonical distribution and separate claims | E5, E8; package checks pending | PASS for fixture claims | PASS for copied Skill only | NOT_RUN |
| REQ-16: Sanitized fixed DEV QA representative case | E6 | PASS | PASS | NOT_RUN |

The simulated REQ-16 native run leaves A's missing-cause writer unlaunched,
repairs B to the independent literal total 900, verifies its tests and distinct
reviewer, and preserves the fixed PHP/DB/WIP/Git constraints. Its parent
acceptance is deliberately `BLOCKED` while A lacks evidence. The bad-repair
variant reports B verification `FAIL` (Host value `FAILED`) at total 1000;
missing review, stale/strict capability, and interrupted-writer variants retain
`BLOCKED` gates. Those observed non-passing task states are preserved by the
passing test expectations.

| Remaining evidence surface | State |
| --- | --- |
| Real DEV QA and real DB read/mutation | NOT_RUN |
| Actual provider calls and native Host role loading | NOT_RUN |
| Formal four-surface generated packages and provenance | NOT_RUN, integration owner checkpoint pending |
| Full repository verification and hosted CI | NOT_RUN, integration owner checkpoint pending |
| Release, publication and deployment | NOT_RUN |

The compatibility projection and resource checks ran separately:
`sync-skill-resources.js --check`, `validate-agents-skills.js`,
`validate-invocation-policy.js`, and `validate-js-guardrails.js` passed.
`openspec validate skill-invocation-policy --type spec --strict --no-interactive`
passed. These checks retain their static/local surface scope.
