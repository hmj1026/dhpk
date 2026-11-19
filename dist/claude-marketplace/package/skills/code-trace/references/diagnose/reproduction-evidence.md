# Reproduction and Probe Evidence

Use this reference during symptom clarification and evidence gathering. The
main skill owns the read-only, shared-resource, and artifact-writing
boundaries.

## Choose a symptom-specific check

Start with the smallest command, interaction, or read-only probe that can
expose the reported symptom. State what output or condition would count as the
symptom. Avoid broad exploratory runs before this check unless missing access
or context makes it impossible to select one.

Record:

- the exact command or interaction, with secrets and sensitive values redacted;
- the relevant output, status, or observation;
- the expected result and the assertion that matched or failed;
- the environment and input context needed to interpret that result.

If the reproduction cannot be run, say why and separate existing evidence from
inference. Name the smallest missing input, permission, or environment fact
that would unblock the next check. Do not treat a static code path or a
plausible report as a confirmed reproduction.

## Confirm a forced mutation

Use this section when a reproduction or probe is already red because code was
edited, a fault was injected, or a fixture was altered. The clean copy is the
executed tree without that mutation. Confirm the mutation that is already
present. Applying a new mutation, or repairing a setup, belongs to the
authorized isolated workflow named by the main skill.

1. Name the clean copy and the mutated tree that produced the red result.
   - Uncommitted mutation: the clean copy is `HEAD` and the mutated tree is
     the worktree. Run `git diff HEAD`.
   - Committed mutation: the clean copy is the revision that lacks the
     mutation, and the mutated tree is the commit that contains that mutation
     without later unrelated commits. Run `git diff <clean-copy> <mutated>`.
2. Record the command and a redacted summary of the diff. Leave the index,
   refs, and worktree unchanged.
3. The verdict is `valid forced-mutation evidence` when the diff shows the
   intended mutation, including an intentional fixture change, and the
   observed failure matches that mutation.
4. The verdict is `setup problem` when the diff contains an edit that is not
   the intended mutation, such as an unrelated syntax error or missing
   dependency, or when the failure is an environment problem the mutation
   does not explain. Hand the setup repair to the authorized isolated
   workflow, rerun the check, and replace this verdict only when a later diff
   meets step 3.

Record the clean copy, the mutated tree, the diff command, the redacted diff
summary, the failing assertion, and the verdict.

## Report intermittent behavior

For a flaky signal, preserve the observations rather than forcing them into a
binary result. Report the number of attempts and observed successes, plus
conditions that appear relevant, such as input shape, environment, ordering, or
timing. State what was held constant and what varied when known. There is no
required retry count or pass-rate threshold; use the evidence actually
available and keep uncertainty visible.

## Compare performance evidence

For a performance symptom, report a baseline when one is available and
identify the workload and environment for both measurements. Compare like
inputs, data volume, configuration, and runtime conditions where possible.
Include the measured quantity and the observation method. If the baseline or a
comparable workload is unavailable, mark that gap; do not substitute an
arbitrary time limit or infer a regression from incomparable runs.

## Minimize only when useful

When changing inputs can distinguish hypotheses, vary one relevant input at a
time and check whether the symptom remains. Keep the exploration bounded to
plausible causes, preserve the original failing case, and stop once the
evidence answers the question or the signal is lost. Do not require reducing
every factor, and do not continue if the check risks a destructive effect or
shared state.

## Keep facts and conclusions separate

Keep the command, output, symptom assertion, observed counts, and any
forced-mutation diff summary as facts.
List explanations separately as ranked hypotheses, each with a discriminating
check and evidence that would reject it. A missing reproduction or baseline is
a reported limitation, not evidence for a particular cause.
