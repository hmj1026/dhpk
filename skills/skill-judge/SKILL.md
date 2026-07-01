---
name: skill-judge
description: 'Evaluate Agent Skill design quality against official specs and best practices via multi-dimensional scoring. Use when reviewing, auditing, or improving a SKILL.md file or skill package and you want a deep rubric-based grade with actionable fixes. Not for: quick structural lint (use skill-health-check), batch auditing many skills at once (use skill-stocktake), or creating/refactoring a skill (use create-skill). Depth split: skill-health-check = structural lint of one skill · skill-judge = deep rubric of one · skill-stocktake = batch-audit of many. Output: a graded evaluation report with per-dimension scores, critical issues, and top improvements.'
---

# Skill Judge

Evaluate Agent Skills against official specifications and patterns derived from 17+ official examples. The verdict is driven by one lens: **knowledge delta** — what the Skill adds beyond what Claude already knows.

> Good Skill = Expert-only Knowledge − What Claude Already Knows.

## When to Use

- Deep-reviewing a single SKILL.md or skill package for design quality
- Auditing whether a skill earns its tokens (expert content vs. redundant tutorial)
- Producing a scored, graded report with concrete improvement guidance
- Calibrating a skill against the 5 official patterns (Mindset / Navigation / Philosophy / Process / Tool)

## When NOT to Use

- **Quick structural lint** (frontmatter, routing cues, line count) → use `skill-health-check`
- **Batch audit of many skills** at once → use `skill-stocktake`
- **Creating or refactoring** a skill → use `create-skill`
- **Scoring an agent's completed run OUTPUT** (not the skill definition) → use the `agent-evaluator` agent (the run-output sibling of this skill)
- Code review or document review → use the respective code/doc review skills

## Core Workflow

A five-step evaluation protocol. Steps 1 and 3 require the reference files — load them when you reach the step, not before.

### Step 1: First Pass — Knowledge Delta Scan

Read the target SKILL.md completely. For each section ask: *"Does Claude already know this?"* and mark it:

- **[E] Expert**: Claude genuinely doesn't know this — value-add
- **[A] Activation**: Claude knows but a brief reminder is useful — acceptable
- **[R] Redundant**: Claude definitely knows this — should be deleted

Calculate the rough ratio E:A:R.
- Good Skill: >70% Expert, <20% Activation, <10% Redundant
- Mediocre Skill: 40-70% Expert, high Activation
- Bad Skill: <40% Expert, high Redundant

**Load `references/philosophy.md`** if you need the full knowledge-delta model (What is a Skill, Tool vs Skill, the three knowledge types) to make these calls.

### Step 2: Structure Analysis

```
[ ] Check frontmatter validity (name, description)
[ ] Count total lines in SKILL.md
[ ] List all reference files and their sizes
[ ] Identify which pattern the Skill follows
[ ] Check for loading triggers (if references exist)
```

### Step 3: Score Each Dimension

**MANDATORY — READ ENTIRE FILE**: Before scoring, you MUST read `references/scoring-rubric.md` completely. It defines the 8 dimensions, score bands, green/red flags, examples, and the grade scale. Do not score from memory.

| Dimension | Max |
|-----------|-----|
| D1: Knowledge Delta (the core dimension) | 20 |
| D2: Mindset + Appropriate Procedures | 15 |
| D3: Anti-Pattern Quality | 15 |
| D4: Specification Compliance (esp. description) | 15 |
| D5: Progressive Disclosure | 15 |
| D6: Freedom Calibration | 15 |
| D7: Pattern Recognition | 10 |
| D8: Practical Usability | 15 |
| **Total** | **120** |

For each dimension: (1) find specific evidence (quote lines), (2) assign a score with a one-line justification, (3) note specific improvements if below max.

### Step 4: Calculate Total & Grade

`Total = D1 + … + D8` (max 120). Map to a grade (A ≥90%, B 80-89%, C 70-79%, D 60-69%, F <60%) — see the grade scale in `references/scoring-rubric.md`.

### Step 5: Generate Report

Produce the report in the **Output** format below. If a score is hard to name, consult `references/failure-patterns.md` to label the failure mode precisely, and run its Quick Reference Checklist before finalizing.

## NEVER Do When Evaluating

- **NEVER** give high scores just because it "looks professional" or is well-formatted
- **NEVER** let length impress you — a 43-line Skill can outperform a 500-line Skill
- **NEVER** forgive explaining basics with "but it provides helpful context"
- **NEVER** overlook a missing anti-pattern (NEVER) list — that is a significant gap
- **NEVER** undervalue the description field — poor description = skill never gets used

(Full evaluator guardrails: `references/failure-patterns.md`.)

## Output

```markdown
# Skill Evaluation Report: [Skill Name]

## Summary
- **Total Score**: X/120 (X%)
- **Grade**: [A/B/C/D/F]
- **Pattern**: [Mindset/Navigation/Philosophy/Process/Tool]
- **Knowledge Ratio**: E:A:R = X:Y:Z
- **Verdict**: [One sentence assessment]

## Dimension Scores

| Dimension | Score | Max | Notes |
|-----------|-------|-----|-------|
| D1: Knowledge Delta | X | 20 | |
| D2: Mindset + Procedures | X | 15 | |
| D3: Anti-Pattern Quality | X | 15 | |
| D4: Specification Compliance | X | 15 | |
| D5: Progressive Disclosure | X | 15 | |
| D6: Freedom Calibration | X | 15 | |
| D7: Pattern Recognition | X | 10 | |
| D8: Practical Usability | X | 15 | |

## Critical Issues
[Must-fix problems that significantly impact effectiveness]

## Top 3 Improvements
1. [Highest impact improvement with specific guidance]
2. [Second priority]
3. [Third priority]

## Detailed Analysis
[For each dimension < 80%: what's missing, examples from the Skill, concrete fixes]
```

## Verification

- [ ] First Pass completed — every section marked E/A/R, ratio computed
- [ ] `references/scoring-rubric.md` read in full before assigning any score
- [ ] All 8 dimensions scored with quoted evidence and justification
- [ ] Total summed correctly and mapped to the right grade band
- [ ] Report includes Critical Issues + Top 3 Improvements (not just scores)
- [ ] Meta-question applied: would a domain expert say "this took me years to learn"?

## References

- `references/scoring-rubric.md` — Full 8-dimension rubric, score bands, green/red flags, examples, grade scale. **Read in Step 3 before scoring.**
- `references/philosophy.md` — Knowledge-delta model, Tool vs Skill, three knowledge types, the meta-question. Read in Step 1 when deciding E/A/R or when a score feels off.
- `references/failure-patterns.md` — 9 common failure patterns, the full "NEVER Do When Evaluating" list, and the exhaustive Quick Reference Checklist. Read in Step 5 to name failure modes and final-check the report.
