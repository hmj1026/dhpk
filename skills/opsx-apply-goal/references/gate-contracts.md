# Compact goal gate contracts

The `/goal` condition uses these short, transcript-checkable tokens instead of
copying the full policy into every generated condition. All measurements are
UTF-8 bytes, the unit produced by `wc -c`.

| Token | Evidence contract |
|---|---|
| `TEST` | The named runner reports zero failures, or a separately proven pre-existing failure is recorded. |
| `COVERAGE` | The configured coverage command reports the required threshold. |
| `BUILD` / `LINT` | The named command reports zero errors. |
| `SMOKE` | A first-line `Verdict: PASS` plus one observed output line, or an evidenced runtime escape hatch. |
| `REVIEW` | Applicable reviewers run once for the implementation wave; known findings use one confirm-only re-review. |
| `ARTIFACT` | The edited-file list and fresh review artifact are present. |
| `VERDICT` | `.unresolved-verdict` is absent or explicitly reported as a blocker. |
| `TURN` | The bounded turn checkpoint writes the resume note before stopping. |

The fixed core must preserve orientation, self-locating policy lookup, the
`opsx:apply` kickoff, the hard-rule carve-out, the Unknown-skill fallback, the
worker roster, and sentinel/unresolved-verdict gates. The normal target is
`<=3,400` UTF-8 bytes; `>4,000` bytes is a hard Block A error. Required gates
are never deleted to fit the budget.
