# Resume Phase

Resume restores context from a saved handoff and then transfers execution to
the canonical external OpenSpec apply capability. The live worktree, not a
commit or compact note, is authoritative.

## Package and path contract

Resolve `HANDOFF_PATH` before reading state:

| Host | Handoff |
| --- | --- |
| Claude | `.claude/artifacts/apply-resume/latest.md` |
| Codex | `.dhpk/artifacts/apply-resume/latest.md` |

`$SKILL_DIR` denotes the physical directory containing the selected `SKILL.md`;
it is path notation, not an ambient environment variable or repository-root
lookup. Resolve it before invoking helpers from an arbitrary consumer cwd.

Pass `HANDOFF_PATH` explicitly as the phase/state helpers' trailing path
argument and to the local context procedure. The package-local
`"$SKILL_DIR/scripts/set-handoff-state.sh"` accepts the explicit path for
`consuming` and `saved` recovery. Missing required package assets are
`BLOCKED_RESOURCE_MISSING`. Missing state/continuation resources stop before
dependent mutation or external apply. The context procedure preserves the
compact extractor diagnostic while allowing embedded-handoff recovery; this
does not establish complete package delivery.

## Context check

If the current session already contains substantial work, show the Host-native
warning about duplicated context. Claude may ask whether to continue in place;
Codex may continue in the current turn or start a new turn, with no required
`/fork`, `/new`, or `/model` command.

## Steps

1. **Load the handoff.** Read `HANDOFF_PATH` and parse `change_id`,
   `model_suggestion` when present, `risk_level`, `precommit`, `commit`,
   optional `compact_json_path`, optional `claude_mem_obs_id`, Next Actions
   (or legacy Remaining Tasks), and Completion Criteria. A missing or
   malformed handoff is `BLOCKED`. A missing legacy `model_suggestion` is
   displayed as `unavailable`; display an existing suggestion as advisory,
   without recalculating it from task count or switching models automatically.
2. **Load context.** Follow [load-context](load-context.md) with the explicit
   handoff path and parsed fields. It owns memory → compact JSON → handoff,
   usable-content checks, optional carry-forward precedence, and cross-session
   context. Stop before mutation on its blocking result. Resume never posts
   observations.
3. **Validate the change.** Confirm
   `openspec/changes/<change-id>/tasks.md` exists. If it does not, stop and
   report that the change may have been archived or renamed; do not continue.
4. **Display the restore summary.** Show the Host, change, context source,
   goal, completed/in-progress items, Next Actions, advisory model suggestion,
   and prior precommit/commit states. Keep failed, skipped, unavailable, and
   not-configured evidence distinct.
5. **Mark in flight.** After the handoff and external capability are valid,
   update its state to `consuming` through
   `"$SKILL_DIR/scripts/set-handoff-state.sh" consuming "$HANDOFF_PATH"` with
   the explicit path. The handoff remains on disk. If apply fails, leave
   `consuming` for retry; recovery uses the same helper to set `saved`.
6. **Invoke external apply.** Use the canonical `openspec-apply-change` Skill
   with `<change-id>`; never pass the `/opsx:apply` alias to a Skill tool and
   never edit the external skill. Claude may use native Skill dispatch; Codex
   uses an available projected `openspec-apply-change` skill. If no such skill
   is available, record `UNAVAILABLE`, preserve the current `saved` or
   `consuming` state without starting a new transition, and stop with one
   resume command.
7. **Archive only after success.** After successful completion, set `consumed`
   and move `latest.md` to a timestamped `consumed-*.md` beside it. Never
   delete the handoff. If apply did not complete, keep `latest.md` in
   `consuming` state.
8. **Choose the next route.** Re-read live tasks. Remaining tasks recommend
   another apply (and a future handoff when context grows); all tasks done with
   no P0 issue recommend verification then archive. A P0 issue recommends
   fixing it before verification. This is a route suggestion, not completion
   evidence.

## Output and verification

Return a restore summary, `CONTEXT_SOURCE`, explicit handoff path, state, apply
availability/result, archive path when successful, and exactly one next action.

- [ ] Handoff and change were validated before `consuming`.
- [ ] The first successful context tier was recorded; optional failures did
      not erase the embedded summary.
- [ ] Legacy `Remaining Tasks` and existing model-suggestion values remain
      readable; the suggestion is advisory and does not trigger a model change.
- [ ] External continuation used only the canonical available skill.
- [ ] `consumed-*` exists only after success; failed apply retains recoverable
      `latest.md`.
- [ ] Live worktree status, uncommitted files, and provider limitations remain
      visible.
