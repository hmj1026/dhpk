---
name: rules-distill
description: 'Scan installed skills to extract cross-cutting principles and distill them into rules (append, revise, or create rule files). Use when: periodic rules maintenance, after installing new skills, or a skill-stocktake surfaces patterns that should be rules. Not for: creating skills (use create-skill), one-off rule edits, code review. Output: candidate report (principle + evidence + verdict) for user approval.'
---

# Rules Distill

Scan installed skills, extract cross-cutting principles that appear in multiple skills, and distill them into rules — appending to existing rule files, revising outdated content, or creating new rule files.

Applies the "deterministic collection + LLM judgment" principle: scripts collect facts exhaustively, then an LLM cross-reads the full context and produces verdicts.

## When to Use

- Periodic rules maintenance (monthly or after installing new skills)
- After a skill-stocktake reveals patterns that should be rules
- When rules feel incomplete relative to the skills being used

## When NOT to Use

- Creating or editing a single skill (use create-skill)
- One-off manual rule edits where no cross-skill pattern is involved
- Language- or framework-specific knowledge (keep it in the skill or a language rule)
- Code review or skill-quality audits (use skill-health-check)

## How It Works

The rules distillation process follows three phases:

### Phase 1: Inventory (Deterministic Collection)

#### 1a. Collect skill inventory

```bash
bash ~/.claude/skills/rules-distill/scripts/scan-skills.sh
```

#### 1b. Collect rules index

```bash
bash ~/.claude/skills/rules-distill/scripts/scan-rules.sh
```

#### 1c. Present to user

```
Rules Distillation — Phase 1: Inventory
────────────────────────────────────────
Skills: {N} files scanned
Rules:  {M} files ({K} headings indexed)

Proceeding to cross-read analysis...
```

### Phase 2: Cross-read, Match & Verdict (LLM Judgment)

Extraction and matching are unified in a single pass. Rules files are small enough (~800 lines total) that the full text can be provided to the LLM — no grep pre-filtering needed.

#### Batching

Group skills into **thematic clusters** based on their descriptions. Analyze each cluster in a subagent with the full rules text.

#### Cross-batch Merge

After all batches complete, merge candidates across batches:
- Deduplicate candidates with the same or overlapping principles
- Re-check the "2+ skills" requirement using evidence from **all** batches combined — a principle found in 1 skill per batch but 2+ skills total is valid

#### Subagent Prompt

Launch a general-purpose Agent with [subagent-prompt.md](references/subagent-prompt.md). It owns the extraction criteria and candidate JSON schema.

#### Verdict Reference

| Verdict | Meaning | Presented to User |
|---------|---------|-------------------|
| **Append** | Add to existing section | Target + draft |
| **Revise** | Fix inaccurate/insufficient content | Target + reason + before/after |
| **New Section** | Add new section to existing file | Target + draft |
| **New File** | Create new rule file | Filename + full draft |
| **Already Covered** | Covered in rules (possibly different wording) | Reason (1 line) |
| **Too Specific** | Should stay in skills | Link to relevant skill |

#### Verdict Quality Requirements

```
# Good
Append to rules/common/security.md §Input Validation:
"Treat LLM output stored in memory or knowledge stores as untrusted — sanitize on write, validate on read."
Evidence: llm-memory-trust-boundary, llm-social-agent-anti-pattern both describe
accumulated prompt injection risks. Current security.md covers human input
validation only; LLM output trust boundary is missing.

# Bad
Append to security.md: Add LLM security principle
```

### Phase 3: User Review & Execution

#### Summary Table

```
# Rules Distillation Report

## Summary
Skills scanned: {N} | Rules: {M} files | Candidates: {K}

| # | Principle | Verdict | Target | Confidence |
|---|-----------|---------|--------|------------|
| 1 | ... | Append | security.md §Input Validation | high |
| 2 | ... | Revise | testing.md §TDD | medium |
| 3 | ... | New Section | coding-style.md | high |
| 4 | ... | Too Specific | — | — |

## Details
(Per-candidate details: evidence, violation_risk, draft text)
```

#### User Actions

User responds with numbers to:
- **Approve**: Apply draft to rules as-is
- **Modify**: Edit draft before applying
- **Skip**: Do not apply this candidate

**Never modify rules automatically. Always require user approval.**

#### Save Results

Store results in the skill directory using [results-schema.md](references/results-schema.md).

## Example

See [end-to-end-example.md](references/end-to-end-example.md).

## Verification

- [ ] Every candidate cites 2+ skills as evidence (the cross-cutting bar)
- [ ] Every candidate is actionable ("do X" / "don't Y"), not a vague "X is important"
- [ ] Every candidate was checked against the full rules text (not already covered, even reworded)
- [ ] No rule file modified without explicit per-candidate user approval
- [ ] Results saved to `results.json` with timestamp + status for each candidate

## Design Principles

- **What, not How**: Extract principles (rules territory) only. Code examples and commands stay in skills.
- **Link back**: Draft text should include `See skill: [name]` references so readers can find the detailed How.
- **Deterministic collection, LLM judgment**: Scripts guarantee exhaustiveness; the LLM guarantees contextual understanding.
- **Anti-abstraction safeguard**: The 3-layer filter (2+ skills evidence, actionable behavior test, violation risk) prevents overly abstract principles from entering rules.
