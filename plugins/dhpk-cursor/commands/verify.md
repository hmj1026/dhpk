---
name: verify
description: "Run a repository verification loop with runner-first execution, deterministic stages, and explicit PASS/FAIL/SKIP output. Use for fast or full validation of a consumer repository. Not for: mutation, fixing failures, dependency remediation, or merge approval. Output: runner summary or a complete fallback stage table."
---
Load the canonical `$repo-verify` Skill from [SKILL.md](https://github.com/hmj1026/dhpk/blob/main/skills/repo-verify/SKILL.md) and follow it with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
