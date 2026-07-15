# Shared reviewer dispatch contract

Every reviewer prompt is composed from these fields, in this order:

1. **Scope** — the implementation wave and exact changed paths.
2. **Specialist charter** — the lane-specific checks only this reviewer owns.
3. **Evidence commands** — commands the reviewer must run or explain as unavailable.
4. **Artifact path** — the review document location and fresh-artifact requirement.
5. **Verdict** — the role's existing `APPROVE|WARNING|BLOCK` or `PASS|WARNING|FAIL` vocabulary.
6. **Confirm-only** — named findings to confirm when this is a bounded re-review; omit for a new wave.

The orchestrator batches one applicable reviewer dispatch per implementation
wave. A no-op or missing artifact fails the gate, receives exactly one corrected retry,
then is replaced or left pending with a recorded reason. A third
identical retry is prohibited. Specialist prompts reference this contract once;
they retain only their unique checks and output vocabulary.
