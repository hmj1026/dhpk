---
name: dhpk-codex-architect
argument-hint: '"<question>" [--context <files>] [--mode design|review|compare|adversarial]'
description: 'Codex architecture consulting, including bounded adversarial option convergence. Use when: designing features, evaluating architecture, comparing options, or running independent proposal and critique rounds. Not for: implementation (use dhpk-codex-implement), code review (use dhpk-change-review). Output: architecture advice + design recommendations.'
allowed-tools: 'Read, Grep, Glob, mcp__codex__codex, mcp__codex__codex-reply, Agent'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Codex Architect Skill (Third Brain)

## When NOT to Use

- Code implementation (use /dhpk:dhpk-codex-implement)
- Code review (use /codex-review)

## Usage

```bash
/dhpk:dhpk-codex-architect "<question>"
/dhpk:dhpk-codex-architect "Evaluate this design" --context src/xxx.ts --mode review
/dhpk:dhpk-codex-architect "Redis vs MongoDB?" --mode compare
/dhpk:dhpk-codex-architect "Which design should we ship?" --mode adversarial
```

## Modes

| Mode    | Purpose                 | When                       |
| ------- | ----------------------- | -------------------------- |
| design  | Provide design advice   | Starting from scratch (default) |
| review  | Evaluate existing design | Validate solution, find issues |
| compare | Compare multiple options | Tech selection             |
| adversarial | Run independent proposals and bounded critique rounds | Former brainstorm-style exploration with explicit decision criteria |

## Adversarial Mode

`--mode adversarial` is the successor route for brainstorm-style architecture exploration. Load [`references/adversarial-option-convergence.md`](references/adversarial-option-convergence.md) before research; it owns the independent-proposal, critique-round, decision-criteria, unresolved-disagreement, and final-recommendation contract. Keep the rounds bounded and report disagreement when the evidence does not support convergence.

## Core Principle

```
User -> Claude -> Codex -> Integrate
          |         |         |
    Initial thinking  Third perspective  Combined advice
```

## Codex Prompt Template

When using `mcp__codex__codex`, must include the following:

```typescript
mcp__codex__codex({
  prompt: `You are a senior architect. Please provide architecture advice for the following question.

## Question
${QUESTION}

## Mode
${MODE} (design/review/compare/adversarial)

## Mode contract
When `${MODE}` is `adversarial`, produce an independent Proposal B without
Claude's proposal, including the research summary, assumptions,
decision-criteria score, and failure modes that could overturn it. The
bounded integrated report uses three critique rounds by default and never
more than five; it must preserve any material unresolved disagreement and
end with a final recommendation rather than implying convergence.

## IMPORTANT: You must independently research the project

Before providing architecture advice, you **must** perform the following research:

### Research Steps
1. Understand project structure: \`ls src/\`, \`ls src/service/\`, \`ls src/provider/\`
2. Search related modules: \`grep -r "keyword" src/ --include="*.ts" -l | head -10\`
3. Read existing implementations: \`cat <relevant files> | head -150\`
4. Understand existing architecture patterns and conventions

### Verification Focus
- What does the existing architecture look like?
- What are the existing code style and patterns?
- What similar features can be referenced?

## Output

1. First describe which files you researched
2. Provide advice based on current project state
3. Consider consistency with existing architecture

...(other review dimensions)`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

## Workflow Integration

```
/dhpk:dhpk-codex-architect -> /dhpk:dhpk-tech-spec -> /review-spec -> /dhpk:dhpk-codex-implement -> /codex-review-fast
    Design           Plan          Review          Implement          Code Review
```

## Verification

- Report includes Codex advice + Claude perspective
- Consensus and divergence points clearly marked
- Final recommendation integrates both perspectives
- In adversarial mode, report each independent proposal, critique round, decision criteria, unresolved disagreement, and final recommendation; do not claim convergence when the evidence leaves a material disagreement.

## References

- `references/project-knowledge.md` - Project architecture knowledge + report template
- `references/adversarial-option-convergence.md` - Adversarial mode procedure and report contract

## Examples

```
Input: /dhpk:dhpk-codex-architect "How to design a high-concurrency cache?"
Action: Codex analysis -> Claude supplement -> Integrated output
```

```
Input: /dhpk:dhpk-codex-architect "Any issues with this API design?" --mode review
Action: Codex evaluation -> Claude verification -> Output issues + recommendations
```
