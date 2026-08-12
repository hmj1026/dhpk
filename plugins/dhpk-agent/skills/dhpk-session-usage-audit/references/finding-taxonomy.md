# Finding taxonomy and verification

## Candidate classes

The deterministic collector recognizes these package-facing classes:

| Class | Typical signals | Exclude when |
|---|---|---|
| `hook-failure` | dhpk hook timeout, non-zero hook exit, failed lifecycle event | failure is only an application command |
| `tool-access` | dhpk tool/command denied or permission mismatch | policy intentionally denied the tool |
| `metadata-validation` | frontmatter/YAML rejected, empty runtime metadata | only a local editor warning |
| `projection-drift` | stale receipt, projection mismatch, installed/source version drift | versions are deliberately pinned and documented |
| `agent-quality` | thin report, uncleared sentinel, repeated reviewer failure | no dhpk agent/hook evidence |

External provider failures, application exceptions, network outages, and
user-reported symptoms without dhpk evidence remain `non-dhpk` or
`needs-verification`; they are not issue candidates.

## Fingerprints

Fingerprint input is the lower-cased, whitespace-normalized tuple:

```text
category | component | normalized message | package version
```

The stored value is `sha256:<64 lowercase hex characters>`. Line numbers,
session ids, absolute paths, secrets, and timestamps do not affect the
fingerprint, so repeated observations can be grouped across sessions and
dates. A package version read from a session record is fingerprint evidence;
the currently installed version is labeled `current-install-inferred` and is
not used as the historical session version in the fingerprint.

## State machine

```text
observed → candidate → needs-verification → verified
                                      ↘ dismissed
verified + no duplicate + confirmation → issue-created
```

`verified` requires both independently recorded checks:

1. a minimal reproduction argv passes and demonstrates the package-facing
   symptom;
2. the relevant dhpk consumer/package gate argv passes in the expected
   consumer path; and
3. both exact argv arrays were inspected, bound by the verification-file
   digest, and executed by the collector in the current audit run.

The two canonical argv arrays must not be identical, and shell/interpreter
evaluation commands are rejected. The checks must not rely on the same log
observation.
`verifyFinding` records the commands and statuses without mutating the finding
input.

## Confidence

- strong dhpk evidence starts at `0.72`;
- weak evidence starts at `0.52`;
- repeated independent sessions (not duplicate rows from one session) add
  `0.10`, capped at `0.95`;
- the GitHub gate requires `>= 0.80` and state `verified`.

Confidence is a triage aid, not proof. Evidence references and verification
results remain mandatory.
