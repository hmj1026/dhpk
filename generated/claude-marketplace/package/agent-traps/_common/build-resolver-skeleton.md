# Build-Resolver Shared Skeleton

Shared procedure and framing referenced by the three language-specific build-resolver agents (`python-build-resolver`, `rust-build-resolver`, `swift-build-resolver`). Each resolver keeps its own Diagnose commands, error→cause→fix table, and language-specific escape-hatch list inline — those are the genuinely differentiating content; only the surrounding procedure is shared here.

## Principles (shared framing)

- **Smallest fix that preserves intent.** One root cause, re-run, next error. Don't refactor opportunistically.
- **Never silence a check to make it pass.** Suppressing a linter/compiler diagnostic converts a real failure into a latent bug — each resolver documents its own forbidden escape hatches inline (e.g. blanket `# type: ignore`, `#[allow(...)]`, force-unwrap `!`).
- **Re-run/re-build after every change.** A fix is unverified until the command exits 0 / the build is green.
- **Preserve workspace state.** Inspect `git status --short` before a mutating
  repair. Keep dirty and untracked work, source files, and existing lockfiles.
- **Scope state changes to evidence and authority.** Reset or clean only when
  the failure points to stale or corrupt state, the affected paths are known,
  and that scope is authorized. Ask before changing shared or user-level
  environments or caches. Never use `git reset` or `git clean` to discard work.
- **Keep dependency resolution narrow.** Update only dependencies implicated
  by the failure. When a repair requires lockfile regeneration, inspect the
  lockfile diff, include it in the proposed repair, and re-run the failing
  command. A necessary lockfile change does not authorize a commit or push.

## Stop conditions (escalate, don't loop)

Per the Anti-Loop Protocol, **stop after 3 failed attempts on the same error** and report. Also stop when the fix introduces more errors than it removes, the failure needs an architectural change (propose it, don't force it), or the failure is environmental / needs a user action. Each resolver names its own examples for the last two.

On stop, output: the attempt log (what was tried + each error), ≥2 alternative paths with trade-offs, and a recommendation.

## Handoff

After a green run, hand the diff to `code-reviewer` (and `security-reviewer` if the change touched auth/crypto/privacy/file paths) — this agent fixes the build; it does not self-approve the change.

Report the files changed, including any required lockfile, and list the
failing command rerun with its result. Keep unrelated observations separate
from the assigned repair and state when a required cleanup or broader action
remains unperformed.
