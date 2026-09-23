---
name: verify
description: "Short Claude front door for the runner-first $repo-verify Skill."
---
# `/dhpk:verify`

Forward `[fast|full] [--integration <path>] [--e2e <path>]` unchanged to the
canonical `$repo-verify` Skill. The public command remains `/dhpk:verify`,
while `$repo-verify` owns normalization, runner precedence, fallback stages,
and the PASS/FAIL/SKIP report. This front door adds no verification grammar.

Not for: mutation, fixing failures, dependency remediation, or merge approval.

Completion: relay the Skill result and preserve its `PASS`, `FAIL`,
`BLOCKED`, `NOT_RUN`, or `UNAVAILABLE` evidence state.
