# Premise verification and independent doubt

## Multi-AI / dual-perspective independence

When a step uses a second AI or perspective, each side MUST form its own conclusion from the source. The secondary prompt carries only the question, project path, stack, artifact, and contract—not the first model's analysis, verdict, or theory. Avoid leading questions, scope pre-filtering, and reused threads; compare independent conclusions and report divergences.

Violation creates false consensus that masks shared blind spots. This applies to codex review/implementation paths, multi-ai-sync, feature-verify, test-review, code-investigate, and issue-analyze.

## In-flight doubt cycle

Before a non-trivial decision stands—branching logic, module/service boundaries, compiler-unverifiable invariants, or irreversible operations—run a bounded doubt pass. Skip mechanical work, obvious one-line changes, or explicit speed-over-verification requests.

Cycle: **CLAIM** (name the decision and stakes) → **EXTRACT** (smallest artifact plus contract) → **DOUBT** (fresh-context adversarial review) → **RECONCILE** → **STOP**.

- Pass ARTIFACT + CONTRACT only, never the claim or conclusion.
- Reconcile findings as contract-misread, valid/actionable, valid trade-off, or noise.
- Stop at three cycles, trivial-only findings, or explicit “ship it.” Three unresolved cycles require escalation; two substantive cycles with no actionable classification indicates doubt theatre.
- Safety-critical cross-model doubt requires explicit per-invocation authorization, a read-only sandbox, and stdin/temp-file prompt delivery. In non-interactive contexts it is skipped and the skip is announced.

Cross-verify a premise-overturning discovery independently before reframing. After agreement, sweep the whole change directory for stale wording from the disproven premise before doc review.
