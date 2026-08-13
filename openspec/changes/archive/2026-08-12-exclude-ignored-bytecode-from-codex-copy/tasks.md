## 1. RED regression

- [x] 1.1 Record #157 reproduction evidence: current unfiltered hash/copy
  points, ignored source patterns, and release consumer-gate caller.
- [x] 1.2 Add a fake-plugin installer test that injects `__pycache__` and `.pyc`,
  asserts copy omission, and asserts fingerprint stability after bytecode
  changes.
- [x] 1.3 Run the new focused test against the current implementation and
  capture the intended RED failure rather than a fixture/setup failure.

## 2. Minimal implementation

- [x] 2.1 Add one embedded-Python distribution filter for exact `__pycache__`
  directory names and `.pyc` basenames.
- [x] 2.2 Apply the filter to directory hashing and source inventory traversal.
- [x] 2.3 Apply the same filter to normal and atomic `copytree` materialization,
  preserving symlink mode and existing receipt/ownership behavior.
- [x] 2.4 Apply the same bytecode exclusions to the release consumer-gate
  project fingerprint and add a direct fingerprint-stability regression test.

## 3. Verification and handoff

- [x] 3.1 Run the installer regression suite and confirm ordinary source,
  update, migration, collision, and rollback cases remain green.
- [x] 3.2 Run installer and release consumer-gate checks, distribution checks,
  strict OpenSpec validation, and a scoped diff review; confirm no receipt
  schema change was introduced.
- [x] 3.3 Record completion evidence and leave #157 open until direct repair
  evidence is collected for the later issue-closure step.
