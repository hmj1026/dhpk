# Diagnosis Examples

These short examples show how to state evidence and its limits in the
response. Replace placeholders with observed facts; they are not pass-rate or
performance thresholds. See [`reproduction-evidence.md`](reproduction-evidence.md)
for the probe details.

## Reproduction unavailable

```text
Expected: [observable behavior]
Observed: [symptom in the report or existing evidence]
Reproduction: BLOCKED — [missing environment, input, or access]
Probe run: none; [why it could not be run safely or with current access]
Finding: root cause unconfirmed; current evidence shows [fact], not [inference]
Next handoff: [owner/workflow] to provide [smallest missing evidence]
```

The blocked status does not prevent reporting a code path or existing trace,
but those observations remain separate from a confirmed reproduction.

## Intermittent signal

```text
Command/interaction: [exact redacted operation]
Observed: [successes] successes in [attempts] attempts
Conditions: [known input/environment/order differences, or unknown]
Assertion: [the output or condition used to classify the symptom]
Finding: [what these observations support; what remains uncertain]
```

The counts describe the runs that occurred. They do not imply a minimum sample
size or a universal flaky-test cutoff.

## Performance comparison

```text
Workload: [same request or operation, input/data volume, and configuration]
Baseline: [measurement, environment, and observation method]
Current: [measurement, environment, and observation method]
Comparison: [comparable dimensions and any differences]
Finding: [supported change, or why the comparison is inconclusive]
```

If a comparable baseline is unavailable, state that limitation and leave the
performance cause unconfirmed. Do not label a run a regression based only on
an arbitrary duration or a different workload.

## Read-only diagnosis handoff

```text
Confirmed cause: [cause and confirming evidence] / not confirmed
Evidence: [commands, output excerpts, code locations, or authorized read-only records]
Hypotheses: [ranked alternatives with discriminating checks]
Constraints: [access, shared-resource, or side-effect boundary]
Next handoff: [existing workflow/owner and one next check]
```

Return this report in the response by default. A knowledge document or other
artifact is created only when explicitly authorized under the main skill's
artifact-writing rule.
