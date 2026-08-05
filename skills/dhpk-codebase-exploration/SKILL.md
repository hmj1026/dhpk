---
name: dhpk-codebase-exploration
argument-hint: '<investigation target or question> [--dual] [--explain --depth brief|normal|deep]'
description: 'Explore an unfamiliar codebase with a focused symbol/flow trace, optionally run an independent second perspective, or request a depth-controlled explanation. Use when: tracing execution, understanding architecture, or diagnosing a code path. Not for: change review, security audit, or implementation. Output: evidence-backed flow findings with explicit gaps.'
allowed-tools: 'Read, Grep, Glob, Bash(ls:*), Bash(find:*), Bash(git:*), mcp__codex__codex, mcp__codex__codex-reply'
context: fork
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Codebase exploration

Use the smallest mode that answers the question. The default is a single
perspective symbol/flow trace: locate the entry point, follow callers and
callees, and report evidence with file and line references. Do not turn a
simple lookup into a review or a speculative architecture redesign.

## Modes

| Invocation | Behavior | Additional reading |
|---|---|---|
| default | Symbol/flow trace with one coherent report | `references/search-patterns.md` when search strategy is unclear |
| `--dual` | Run Claude and Codex independently, then reconcile agreements and gaps. Keep the Codex prompt clean: pass the question and project path, never Claude's conclusion. | `references/dual-perspective.md` |
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

## Output

```markdown
## Exploration report: <topic>
- Mode and depth: <default|dual|explain> / <brief|normal|deep>
- Entry point: <file:line or symbol>
- Flow: <ordered caller -> callee path>
- Evidence: <file:line observations>
- Findings and gaps: <actionable conclusions, or what remains unknown>
```

For `--dual`, include separate Claude and Codex findings followed by an
agreement/difference table and an integrated conclusion. For `--explain`, keep
the requested depth; do not emit deep complexity claims in `brief` mode.

## Verification

- [ ] Entry point and callers/callees are evidence-backed.
- [ ] The selected mode and depth are stated.
- [ ] Independent perspectives were not contaminated by sharing conclusions.
- [ ] Unknowns and edge cases are explicit rather than guessed.
