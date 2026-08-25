# Adversarial Option-Convergence Mode

Use this reference when `dhpk-codex-architect` is invoked with
`--mode adversarial`. It is the successor route for brainstorm-style
architecture exploration: retain independent proposals and adversarial
learning, then converge only as far as the evidence supports.

## Operating contract

1. **Frame the decision.** State the question, constraints, in-scope files or
   systems, risks, and explicit decision criteria before proposing a solution.
2. **Form independent proposals.** Claude writes Proposal A from the available
   evidence. Ask Codex for Proposal B in a separate prompt that contains the
   question and constraints, but not Claude's analysis. Record the research
   each side performed and the assumptions each proposal makes.
3. **Run bounded critique rounds.** Use three rounds by default and never more
   than five. Each round records a concrete attack against the other proposal,
   the response or concession, and any changed recommendation. A round must
   test a failure mode, a constraint, or an assumption; general preference is
   not a sufficient critique.
4. **Apply decision criteria.** Compare the surviving proposals against the
   criteria named in step 1. Separate evidence from inference, and identify
   which risks are mitigated, accepted, or still open.
5. **Stop honestly.** Conclude `converged` only when the remaining differences
   do not change the recommendation under the stated criteria. Otherwise mark
   `unresolved disagreement`, preserve both positions, and name the smallest
   next experiment or decision needed.

## Codex prompts

The first Codex call must preserve independent research:

```typescript
mcp__codex__codex({
  prompt: `You are a critical-thinking technical architect.

## Problem
${QUESTION}

## Constraints and decision criteria
${CONSTRAINTS}
${DECISION_CRITERIA}

## Independent research requirement
Research the repository and relevant runtime or deployment constraints before
forming a position. Do not assume Claude's analysis or proposal; produce your
own evidence-backed proposal first.

## Output
1. Research summary with files, symbols, and existing patterns inspected.
2. Proposal B with its assumptions and decision-criteria score.
3. Failure modes, constraints, and risks that could overturn the proposal.`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

For each subsequent round, use `mcp__codex__codex-reply` with only the prior
round record and the new attack. Ask Codex to rebut, concede, or update its
proposal and to identify whether a material disagreement remains. Keep Claude's
next critique independent of Codex's response until the critique is recorded.

## Required final report

```markdown
# Adversarial Architecture Report

## Question and constraints
...

## Decision criteria
...

## Independent Proposal A (Claude)
...

## Independent Proposal B (Codex)
...

## Critique rounds
### Round 1
- Attack:
- Response or concession:
- Proposal update:
### Round 2
...

## Evidence and trade-offs
...

## Convergence status
`converged` or `unresolved disagreement`

## Final recommendation
...

## Follow-up experiment or decision
...
```

The final recommendation must name the selected option, why it wins against
the decision criteria, the residual risks, and the owner or next step. If the
status is `unresolved disagreement`, do not collapse the positions into a
false consensus or present the recommendation as proved.
