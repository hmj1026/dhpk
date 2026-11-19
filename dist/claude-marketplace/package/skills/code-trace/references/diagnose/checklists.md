# Investigation Checklists

Use this checklist to track evidence and handoff state in the response. The
main skill owns the read-only boundary and artifact-writing rule.

## Five-phase checklist

### Phase 1: Clarify

- [ ] State expected behavior and the observed symptom as a checkable assertion.
- [ ] Mark the reproduction or probe as available, unavailable, blocked, or flaky.
- [ ] Capture the exact command or interaction and relevant output when a probe ran.
- [ ] For flaky behavior, record observed attempts, successes, and known conditions.
- [ ] Record only the sample identifiers or context needed, with sensitive values redacted.
- [ ] Name unresolved access, environment, or data gaps.

### Phase 2: Gather evidence

- [ ] Inspect existing logs, traces, code, and state before adding a new probe.
- [ ] If database evidence is needed, use an authorized, bounded, read-only query.
- [ ] Record the source and scope of each observation; redact sensitive values.
- [ ] Compare layers or related records only where they can distinguish hypotheses.

### Phase 3: Trace and confirm

- [ ] Map the relevant call, control, or data path from the observed symptom.
- [ ] Rank falsifiable hypotheses and record evidence for and against each.
- [ ] Choose the smallest safe check that distinguishes the leading hypotheses.
- [ ] For performance symptoms, record a comparable workload and available baseline.
- [ ] Minimize inputs one at a time only when bounded and useful for preserving the signal.
- [ ] Mark the cause confirmed only when the check supports it; otherwise report the blocker.

### Phase 4: Design the fix

- [ ] Describe evidence-backed repair options, tradeoffs, risks, and verification intent.
- [ ] Name the existing workflow or role that owns implementation and verification.
- [ ] Keep this diagnosis at the handoff; do not edit implementation or run repair tests.

### Phase 5: Preserve knowledge

- [ ] State the confirmed finding or unresolved blocker and the evidence anchors.
- [ ] Include the single next handoff and any constraints it must preserve.
- [ ] Create or update a knowledge artifact only when explicitly authorized.
