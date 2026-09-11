# Squash-merge hygiene — worked example

SSOT: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Squash merge hygiene (recommended).

## Example — Unrelated Changes section

PR titled "Add CSV export to admin panel", squash-merged from 6 commits. The description includes:

```
## Unrelated Changes

- `src/services/AuthService.php` (private → protected, +3/-3 lines): needed a protected
  hook for an unrelated spike, left in by accident. Reviewer: @alice
- `.github/workflows/ci.yml` (+1/-1): bumped a Node version, not part of this feature.
  (Reformat/CI micro-tweak — included for transparency, doesn't require separate review.)
```

The visibility refactor counts as unrelated (per the SSOT's category table) and gets its own line with a reviewer; the CI tweak does not count as unrelated but is still called out for transparency.

See §Squash merge hygiene (recommended) in the SSOT for the full "what counts as unrelated" table and enforcement notes.
