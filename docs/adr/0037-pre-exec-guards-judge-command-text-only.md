# Pre-execution guards judge only the command text

Status: accepted

## Context

The Bash hooks (the Credential Guard and the Git Gate, see
[GLOSSARY](../../GLOSSARY.md)) inspect an agent
command before it runs. Reviews for #1389, #1392, and #1396 found bypasses
that no text inspection can see: a script written and then executed in the
same command (`cat <<'EOF' > s.sh ... EOF; sh s.sh`), and an interpreter's
code string (`python3 -c 'open(".env")'`, and the node, ruby, and perl
equivalents). Closing them would mean blocking every write-then-execute and
every interpreter code argument, which would block many legitimate commands.

## Decision

Pre-execution guards defend against habitual or accidental bypasses, not
against an agent that deliberately searches for one. Their Text Guard Scope
is what the command text itself states, the same boundary that
[ADR 0034](0034-credential-guard-runs-read-only-git-listings.md) keeps when it
runs read-only git listings only for what the text names. Content produced or written at run
time is out of scope and is accepted, not fixed. Permission mode and review
cover that content.

Inside the scope, a guard that meets a construct it cannot resolve still
fails closed. The Credential Verdict and the Git Verdict both block when a
sensitive token (a Protected Path, or the word `git` in command position) appears next to `eval`,
`source`, `cd -`, `CDPATH`, or a here-string fed to a shell.

## Consequences

- A bypass report is triaged by asking whether the command text states the
  bypass. Write-then-execute and interpreter code strings are closed as
  accepted, with a pointer to this ADR.
- When guards disagree about one command, the result follows how bash parses
  that command. The guard layers share one parser so they cannot disagree.
- A bypass report inside the scope is accepted only with the command an agent
  produced in a real session. A shape that a review constructed to defeat the
  guard is closed as accepted (#1473): write-then-execute, an interpreter code
  string, and removing `.git/hooks/pre-commit` stay open by this decision, so
  closing one more shell or git-config variant does not make a deliberate
  bypass harder. From #1380 to #1468 such reports grew the shared parser from
  about 500 to 8,251 lines and added false blocks.
- A false block of a legitimate command is always accepted as a bug.
- Reviews of guard changes check for regressions and false blocks. They are
  not asked to search for new bypass shapes.
- Verification that must hold against a deliberate bypass belongs on the
  server: a required status check on the protected branch.
