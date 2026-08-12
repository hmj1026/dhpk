## 1. Baseline and regression tests

- [x] 1.1 Record #155/#156 source evidence, current document paths, projection
  manifest counts, and the applicable docs validators in implementation notes.
- [x] 1.2 Add a RED test that asserts the platform-installation verification
  blocks separate consumer-root receipt checks from `DHPK_ROOT` source checks.
- [x] 1.3 Add a RED test that derives the expected 16 direct / 12 generated
  counts from `codex/agents/*.toml` and `codex/agent-projection-manifest.json`.

## 2. Documentation implementation

- [x] 2.1 Update the English and Traditional Chinese platform-installation
  verification blocks with explicit consumer and checkout roots.
- [x] 2.2 Update the English and Traditional Chinese basic-operation and
  configuration role-roster wording to 16 direct / 12 generated roles.
- [x] 2.3 Preserve historical documents and existing support-status boundaries;
  confirm bilingual command/link parity.

## 3. Verification and handoff

- [x] 3.1 Run the focused documentation tests and confirm the new tests fail on
  the pre-fix baseline and pass after the edits.
- [x] 3.2 Run relevant metadata/link validators, `openspec validate --all
  --strict --no-interactive`, and review the scoped diff for unrelated changes.
- [x] 3.3 Record completion evidence and leave #155/#156 open until their direct
  repair evidence is available for the later issue-closure step.
