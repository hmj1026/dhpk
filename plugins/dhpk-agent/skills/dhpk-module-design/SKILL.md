---
name: dhpk-module-design
description: "Use when users need architecture decisions, module boundaries, or implementation guidance for software development tasks. Not for pure documentation editing or non-technical writing tasks. Output: actionable, stack-neutral architecture guidance with explicit seams, trade-offs, and implementation-ready recommendations."
metadata:
  dhpk-invocation-class: "implicit-eligible"
---

# Module design

Design the smallest deep module that makes the caller's next decision easy.
Keep this guidance stack-neutral until the repository evidence selects a
framework or language.

## Scope before scan

Start with the user's named module, subsystem, or pain point. When no direction
is named, use recent commit history to find the hot spots that keep changing and
weight the exploration there. Do not propose deepening across the whole
codebase before a real seam, caller, and near-term change are identified; this
is the YAGNI filter for architecture work.

## Boundary tests — SSOT: architecture/tests own runtime behavior; this skill owns boundary decisions

- **Caller leverage**: define the decision the caller should make and make the
  module absorb the policy and variation behind that decision.
- **Deletion test**: temporarily imagine deleting the proposed abstraction. If
  callers become simpler or no behavior is lost, delete it; a name alone is
  not a module boundary.
- **Interface-as-test-surface**: make the public interface the behavior seam;
  tests should assert caller-visible outcomes through it, not private helpers.
- Keep one hypothetical adapter inline. Introduce an abstraction only when
  there are two real adapters, or when a documented near-term boundary has a
  concrete test or deployment need. Do not design for speculative providers.
- Make the change easy before making the easy change: prefer a small
  prefactor that improves locality only when the next requested behavior needs
  it, and record speculative candidates as deferred rather than building them.

## Language and scenarios

- Maintain an **active glossary** for domain terms; challenge an
  **ambiguous-term** before it reaches an interface or event name.
- Write edge-case scenarios for empty, duplicate, partial, stale, and failed
  inputs as applicable. A happy path is not a boundary contract.
- Prefer domain-specific names and focused files. Avoid generic buckets that
  hide ownership or make deletion difficult.

## Decisions and output

Recommend a boundary, interface, data flow, and trade-offs. Record an ADR only
when the decision is surprising, hard-to-reverse, or likely to be revisited;
routine local choices belong in the implementation plan or tests.

## When NOT to Use

- Tracing an existing execution path without a boundary decision (use
  `dhpk-codebase-exploration`).
- Implementing an already-confirmed design (use `dhpk-adaptive-dev-workflow` or the
  matching OpenSpec apply route).
- Reviewing code or security controls (use `dhpk-change-review` or
  `dhpk-security-review`).

## Verification

- [ ] Caller leverage and the deletion test justify the boundary.
- [ ] The interface is an observable test surface with independent expected values.
- [ ] Adapter count and abstraction threshold are explicit.
- [ ] Glossary ambiguities and edge-case scenarios are named.
- [ ] ADR use is limited to surprising or hard-to-reverse decisions.
