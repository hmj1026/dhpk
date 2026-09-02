---
name: dhpk-codebase-exploration
description: "Explore an unfamiliar codebase with a focused symbol/flow trace, optionally run an isolated independent perspective, or request a depth-controlled explanation. Purpose: trace execution, understand architecture, or diagnose a code path. Not for: change review, security audit, or implementation. Output: evidence-backed flow findings with explicit gaps."
metadata:
  dhpk-invocation-class: "explicit-only"
---

# Codebase exploration

Use the smallest mode that answers the question. The default is a single
current-model perspective: locate the entry point, follow callers and callees,
and report evidence with file and line references. Do not turn a simple lookup
into a review or a speculative architecture redesign.

An independent perspective is opt-in. `--dual` dispatches a fresh, isolated,
read-only general-purpose subagent as the standard dual perspective; pass only the original question,
repository path, and requested depth so the perspectives remain blind to one
another. A caller may additionally name `--second-opinion=codex-exec` to obtain
one additive, read-only CLI perspective. Neither option changes the primary
model's report or permits a hidden fallback.

## Modes

| Invocation | Behavior | Additional reading |
|---|---|---|
| default | Symbol/flow trace with one coherent report | `references/search-patterns.md` when search strategy is unclear |
| `--dual` | Run the primary model and an isolated subagent independently, then reconcile agreements and gaps. Pass the second perspective only the question and project path, never the primary conclusion. | `references/dual-perspective.md` |
| `--explain --depth brief\|normal\|deep` | Ask for an explanation of a target file or symbol. `brief` is one sentence; `normal` adds flow and concepts; `deep` adds dependencies, complexity, and risks. | `references/explain.md` |

If `--dual` and `--explain` are combined, use the explanation depth for both
perspectives and still keep their research independent. If depth is omitted,
use `normal`.

## Default workflow

1. Identify the question, repository root, and target symbol or entry point.
2. Inspect definitions and references; prefer symbol-level evidence over
   loading unrelated files.
3. Trace the data/control flow until the observable output or failure edge is
   accounted for.
4. Record assumptions, edge cases, and unresolved links. A clean prompt and
   independent evidence matter more than a large file dump.
5. When `--dual` is selected, dispatch the isolated subagent and reconcile its
   evidence only after the primary trace is complete. If no independent mode is
   selected, report the primary trace alone and do not label it independently
   confirmed.

## When NOT to Use

- Implementing or fixing code (use `dhpk-adaptive-dev-workflow` or the confirmed
  OpenSpec apply route).
- Reviewing a proposed diff (use `dhpk-change-review`).
- Security-specific analysis (use `dhpk-security-review`).

## Output

```markdown
## Exploration report: <topic>
- Mode and depth: <default|dual|explain> / <brief|normal|deep>
- Entry point: <file:line or symbol>
- Flow: <ordered caller -> callee path>
- Evidence: <file:line observations>
- Findings and gaps: <actionable conclusions, or what remains unknown>
```

For `--dual`, include separate primary-model and isolated-subagent findings
followed by an agreement/difference table and an integrated conclusion. For
`--explain`, keep the requested depth; do not emit deep complexity claims in
`brief` mode. An explicit `--second-opinion=codex-exec` may add a one-shot CLI
perspective; this path is always caller-selected.

## Verification

- [ ] Entry point and callers/callees are evidence-backed.
- [ ] The selected mode and depth are stated.
- [ ] Independent perspectives were not contaminated by sharing conclusions.
- [ ] Unknowns and edge cases are explicit rather than guessed.
