# Premise verification and independent doubt

## Raw issue-intent intake

Use this bounded check only when an inbound issue still lacks a settled
outcome or acceptance. A confirmed specification, approved task, or resumed
handoff already carries intent; continue from that evidence without repeating
intake.

1. Start with the user's current request and issue material already in context.
   If the user supplied an issue reference and a read-only tracker view is
   available, read that issue and only the relevant discussion. Do not list or
   reprocess a backlog.
2. Reconcile new information with the open questions already recorded.
   Incorporate a reporter's `needs-info` reply, retain only unanswered
   decisions, and call out material conflicts with older statements. Do not
   repeat questions that the discussion or current request already answers.
3. Check a relevant ADR or repository decision/retirement note when one is
   identified or found through a bounded concept lookup. Then inspect current
   behavior by the request's domain terms when that can establish whether the
   behavior already exists. Cite the decision or behavior and state whether
   new information changes its applicability; distinguish observation from
   inference.
4. Recommend one next route from the remaining evidence. If intent is still
   unsettled, state only the decision or information that blocks the route.

This check is read-only: do not change issue fields or labels, post comments,
close issues, or consult, create, or update an out-of-scope/rejection database.
Finding an existing implementation or prior decision is evidence for the
requester to review, not authority to close or reject the issue.

## Multi-AI / dual-perspective independence

When a step uses a second AI or perspective, each side MUST form its own conclusion from the source. The secondary prompt carries only the question, project path, stack, artifact, and contract—not the first model's analysis, verdict, or theory. Avoid leading questions, scope pre-filtering, and reused threads; compare independent conclusions and report divergences.

Violation creates false consensus that masks shared blind spots. This applies to change-verdict review paths (including `--mode tests`), flow-drive implementation, multi-ai-sync, feature-verify, code-trace `--dual`, and issue-analyze.

## In-flight doubt cycle

Before a non-trivial decision stands—branching logic, module/service boundaries, compiler-unverifiable invariants, or irreversible operations—run a bounded doubt pass. Skip mechanical work, obvious one-line changes, or explicit speed-over-verification requests.

Cycle: **CLAIM** (name the decision and stakes) → **EXTRACT** (smallest artifact plus contract) → **DOUBT** (fresh-context adversarial review) → **RECONCILE** → **STOP**.

- Pass ARTIFACT + CONTRACT only, never the claim or conclusion.
- Reconcile findings as contract-misread, valid/actionable, valid trade-off, or noise.
- Stop at three cycles, trivial-only findings, or explicit “ship it.” Three unresolved cycles require escalation; two substantive cycles with no actionable classification indicates doubt theatre.
- Safety-critical cross-model doubt requires explicit per-invocation authorization, a read-only sandbox, and stdin/temp-file prompt delivery. In non-interactive contexts it is skipped and the skip is announced.

Cross-verify a premise-overturning discovery independently before reframing. After agreement, sweep the whole change directory for stale wording from the disproven premise before doc review.
