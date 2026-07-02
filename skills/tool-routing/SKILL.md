---
name: tool-routing
description: 'Decide which code-exploration tool to use (gitnexus, cx, claude-mem, Read, Grep). Use when: where is X defined, what breaks if I change X, find callers, explore an unfamiliar module, rename X, recall past decisions, file overview, find a symbol — BEFORE Read-ing large files or grepping code. Not for: plain-text/log/doc search (use Grep), or once the tool is chosen. Output: chosen tool + exact command.'
---

# Tool Routing

Skill-form entry point into `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md`, the SSOT decision tree for code-exploration tool selection. This skill adds the extended rationale/edge-case reference and points to the rules file for the table itself, rather than restating it — a restated copy is how the two drifted (this file used to state find-and-replace was flatly forbidden; the rules file's fallback — `cx references` + scoped Edit when gitnexus is absent — is the correct, current behavior). Cost anchors live in `~/.claude/CX.md`.

## Decision tree

See `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` "Decision tree" and "Tie-breakers".

## When NOT to Use

- The tool is already chosen — just run it (this skill only routes)
- Plain-text, log-line, comment, or doc search → use `Grep` directly
- A single known small file you must read in full → use `Read`
- Non-code questions (config values, prose) — no AST tool needed

## gitnexus_impact timing and append-only exemption

See `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` "gitnexus_impact timing" and `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` Glossary (append-only exemption).

## Sub-agent prompts

See `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` "Sub-agent prompts" — sub-agents do not inherit this skill; paste the relevant block from `${CLAUDE_PLUGIN_ROOT}/docs/subagent-prompt-template.md` into the agent prompt.

## Top anti-patterns

See `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` "Top anti-patterns".

## Output

- The selected tool for the intent, plus the exact command / MCP call to run
- A named fallback tool to try if the primary returns nothing

## Verification

- [ ] Chose the primary per the decision tree (cx > gitnexus when both apply)
- [ ] Ran `gitnexus_impact` before any Edit/Write on an existing symbol body/signature
- [ ] Did not Read a large file or Grep code where `cx` (AST) was the right call

Extended edge cases and rationale: `references/decision-tree.md`.
