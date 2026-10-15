# Save observation

Read only when Save selects its enabled, permitted optional memory provider.
Resume never enters this procedure. Service denial, unavailable tooling, or
failure records `claude_mem_obs_id: null` with `memory: UNAVAILABLE` or
`memory: FAILED`; a disabled provider records `memory: SKIPPED`. Required
package resources remain required: a missing local observer is
`BLOCKED_RESOURCE_MISSING` before dependent action, and is never replaced by a
peer or ambient copy.

## Build and launch

Build one JSON object with `title` from compact L0, `content` as one string,
and `concepts` as a string array. Join session_goal, in-progress tasks,
decisions/reasons, and failed-approach lessons with newlines using JSON
serialization. Keep quoted text and shell metacharacters as data.

Concepts include the lowercase change ID and `opsx-apply-resume`. If L0
contains `Stage (S[\w.]+)` or `Wave ([A-Z])`, add lowercase tags such as
`stage-s9c.8.8` and `wave-c`; omit unparsed tags. All concepts have no spaces.
If optional compact data is empty, `{}` is valid input; it makes no persistence
claim and does not replace the embedded live-worktree summary.

Allocate a private temporary directory with `mktemp -d`, and write the JSON
through the Host's file writer to its `payload.json`. Keep `OBS_WORK_DIR`,
`OBS_PAYLOAD_FILE`, and `OBS_RESULT_FILE` explicit. A failure to allocate/write
the optional payload records `memory: FAILED` and leaves `OBS_PID=null`.
Resolve the observer from this family's physical directory, then launch:

```bash
bash "$SKILL_DIR/scripts/post-obs.sh" "$OBS_PAYLOAD_FILE" > "$OBS_RESULT_FILE" &
OBS_PID=$!
```

Return PID and result path immediately. Continue Save's change identification
and risk/model snapshot while the bounded POST runs. The local helper reports
one nonnegative integer ID or `null`; it deduplicates only a successful integer
result. HTTP denial, transport error, malformed response, and invalid IDs
remain retryable rather than cached as successful persistence.

## Collect before writing

After Save's intervening steps and before writing the handoff, collect the
pending process. This is asynchronous overlap, not fire-and-forget:

```bash
CLAUDE_MEM_OBS_ID=null
if [[ "$OBS_PID" != null ]]; then
  if wait "$OBS_PID"; then
    OBS_VALUE=$(cat "$OBS_RESULT_FILE" 2>/dev/null)
    if [[ "$OBS_VALUE" =~ ^[0-9]+$ ]]; then
      CLAUDE_MEM_OBS_ID="$OBS_VALUE"
    fi
  fi
fi
```

An integer records `memory: POSTED` and the ID; an invalid/null result records
the observed unavailable/failure state with ID `null`. A failed wait also
records failure/null. Remove only this operation's private temporary files
after collection. A native memory provider must satisfy the same pending-result
collection and ID/null contract.

Return ID/null, tags, and provider state to Save. Save can write a valid handoff
with a null observation ID using its embedded summary, while explicitly
reporting that memory persistence was not established. Handoff completion
requires collection of every launched observation and successful required
handoff writing; launching a POST alone proves neither.
