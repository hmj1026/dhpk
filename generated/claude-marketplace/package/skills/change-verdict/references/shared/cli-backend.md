# CLI backend

Use `scripts/review-cli.sh` when the Codex CLI is available and a full-disk read
review is appropriate. It validates `--backend cli`, `--scope`, and `--depth`,
passes arguments as a shell array, and returns the CLI's exit status.

```bash
bash skills/change-verdict/scripts/review-cli.sh \
  --backend cli --scope diff --depth fast
```

The wrapper accepts `diff`, `branch`, `doc`, `security`, or `tests` scopes and
`fast` or `full` depth. A branch review requires `--base`; the wrapper resolves
and pins a non-empty `git merge-base` before invoking Codex. A diff review pins
`HEAD` and includes the uncommitted tree. Custom titles/prompts are literal
data, not shell code. The prompt records separate Standards and Spec axes.
The transport is only enabled by an explicit second-opinion option. If the CLI
is unavailable or the selected scope cannot be resolved, report a degraded or
inconclusive review instead of silently claiming readiness. The transport may
read the repository and return text, but must not write an artifact or change
repository state.
