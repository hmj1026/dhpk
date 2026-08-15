# Codex Build-Resolver Shared Skeleton

Shared procedure for language-specific build repair on the Codex surface.
Codex maps that work through the `worker` role and the language-build
capability, not through separate Claude resolver agents. Each language keeps
its own Diagnose commands, error-to-cause table, and escape-hatch list; only
the surrounding procedure is shared here.

## Principles (shared framing)

- **Smallest fix that preserves intent.** One root cause, re-run, next error. Don't refactor opportunistically.
- **Never silence a check to make it pass.** Suppressing a linter/compiler diagnostic converts a real failure into a latent bug — each language documents its own forbidden escape hatches inline.
- **Re-run/re-build after every change.** A fix is unverified until the command exits 0 / the build is green.

## Stop conditions (escalate, don't loop)

Stop after 3 failed attempts on the same error and report. Also stop when the
fix introduces more errors than it removes, the failure needs an architectural
change (propose it, don't force it), or the failure is environmental / needs a
user action.

On stop, output: the attempt log (what was tried + each error), at least two
alternative paths with trade-offs, and a recommendation.

## Handoff

After a green run, hand the diff to `code-reviewer` (and `security-reviewer` if
the change touched auth/crypto/privacy/file paths). This role fixes the build;
it does not self-approve the change.
