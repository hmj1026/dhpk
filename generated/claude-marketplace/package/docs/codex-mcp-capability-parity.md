# Codex MCP capability-parity matrix

This guide maps retired MCP-backed capabilities to their current workflow
owners. [Skill platform migration](skill-platform-migration.md) owns retirement
and version-pin policy; [distribution inventory](../manifests/distribution-inventory.json)
owns active identity and availability. Historical run results and the original
migration matrix are local records under `docs/evidence/`.

## Review ownership

Code verdict and pr-review hygiene remain separate modes of `change-verdict`.
The code mode judges a fixed-point diff; the pr mode judges PR completeness
and hygiene for its declared merge method. Neither is an implementation owner.

## Current capability contract

Optional CLI opinions are explicitly requested and additive. The primary path
does not silently invoke Codex MCP. A retired name is a migration identifier,
not a discovery alias. Test generation remains owned by `tdd-workflow`.

| Original capability | Original MCP behavior | New owner | Retained transport | Gate / verification | Session-continuity difference | Migration evidence | Rollback path |
|---|---|---|---|---|---|---|---|
| `codex-architect`: Design, review, compare, and adversarial architecture. | Discussion and reply continuity. | `module-design`. | Explicit optional CLI opinion. | Four modes, independent criteria, recommendation. | Record an explicit evidence packet. | Required check: `node tests/codex-mcp-retirement.test.js`; contract: [skills/proposal-analyze/references/module-design/SKILL.md](../skills/proposal-analyze/references/module-design/SKILL.md). | Version-pin `0.51.0` for the last compatible MCP-backed release. |
| `codex-implement`: Ordered implementation against confirmed acceptance. | Implementation and reply continuity. | `flow-drive`. | Confirmed handoff; explicit worker options. | Ordered tasks, verification, review and authorization checkpoints. | Carry the confirmed artifacts and task evidence. | Required check: `node tests/codex-mcp-retirement.test.js`; contract: [skills/flow-drive/SKILL.md](../skills/flow-drive/SKILL.md). | Version-pin `0.51.0` for the last compatible MCP-backed release. |
| `codex-code-review`: Independent fixed-point code verdict. | Diff review and reply continuity. | `change-verdict --mode=code`. | Primary model; optional CLI opinion. | Standards/spec evidence, severity, freshness and degradation. | Re-read pinned diff and evidence for every review. | Required check: `node tests/codex-mcp-retirement.test.js`; contract: [skills/change-verdict/SKILL.md](../skills/change-verdict/SKILL.md). | Version-pin `0.51.0` for the last compatible MCP-backed release. |
| `doc-review`: Document correctness and consistency verdict. | Document review and reply continuity. | `change-verdict --mode=docs`. | Primary model; optional CLI opinion. | Document findings, consistency and explicit verdict. | Re-read the current document snapshot. | Required check: `node tests/codex-mcp-retirement.test.js`; contract: [skills/change-verdict/SKILL.md](../skills/change-verdict/SKILL.md). | Version-pin `0.51.0` for the last compatible MCP-backed release. |
| `test-review`: Test adequacy and acceptance traceability. | Test review and reply continuity. | `change-verdict --mode=tests`. | Primary model; optional CLI opinion. | Owned assertions, missing coverage and acceptance evidence. | Pass explicit source/test snapshots. | Required check: `node tests/codex-mcp-retirement.test.js`; contract: [skills/change-verdict/SKILL.md](../skills/change-verdict/SKILL.md). | Version-pin `0.51.0` for the last compatible MCP-backed release. |
| `codebase-exploration`: Symbol and flow exploration. | Additional perspective and reply continuity. | `code-trace --mode=explore`. | Primary trace; explicitly requested dual perspective. | Entry/caller/callee evidence, assumptions and gaps. | Fresh isolated perspective receives the original question. | Required check: `node tests/codex-mcp-retirement.test.js`; contract: [skills/code-trace/SKILL.md](../skills/code-trace/SKILL.md). | Version-pin `0.51.0` for the last compatible MCP-backed release. |
| `feature-verify`: Read-only runtime verification. | Independent final confirmation. | `dhpk-feature-verify`. | Explicit optional independent reviewer. | Safety charter, evidence, confidence and degraded result. | Reviewer receives the bounded evidence packet. | Required check: `node tests/codex-mcp-retirement.test.js`; contract: [skills/repo-verify/references/dhpk-feature-verify/SKILL.md](../skills/repo-verify/references/dhpk-feature-verify/SKILL.md). | Version-pin `0.51.0` for the last compatible MCP-backed release. |
| `issue-analyze` + `feasibility-study`: Issue actionability and quantified option comparison. | Blind issue verdict and feasibility discussion. | `dhpk-issue-analyze`; `module-design --mode=compare`. | Primary work; explicitly selected independent comparison. | Issue thresholds, assumptions, options and degradation. | Fresh independent opinion receives explicit constraints. | Required check: `node tests/codex-mcp-retirement.test.js`; contract: [skills/proposal-analyze/references/dhpk-issue-analyze/SKILL.md](../skills/proposal-analyze/references/dhpk-issue-analyze/SKILL.md). | Version-pin `0.51.0` for the last compatible MCP-backed release. |
