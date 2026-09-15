# Anti-loop — worked example

SSOT: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Anti-loop & output.

## Example — same approach, three failures

1. Run `phpunit tests/CheckoutTest.php` → fails on assertion X.
2. Edit the assertion's neighboring line, re-run → same failure, same stack trace.
3. Re-run again with no code change, hoping for a flake → same failure.

This is the same approach three times (same test, same failing signal, no new information) — STOP and report, per the SSOT's "Stop and escalate" conditions, rather than trying a fourth variant of the same edit.

## Example — NOT the same approach

1. `Read` the file to find a symbol → wrong location.
2. `cx definition --name Checkout::total` → finds it precisely.

A genuinely different tool/technique for the same question does not count toward the 3x ceiling.

See §Anti-loop & output in the SSOT for the full stop conditions and the required blocked-report shape.
