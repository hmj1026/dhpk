# Standard output shape — worked example

SSOT: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Anti-loop & output.

## Example — successful turn

```
Conclusion → Added `--csv` flag to the export command.
Changed files → src/commands/export.js:42, tests/export.test.js:18
Verification → `npm test -- export.test.js` (12/12 passing)
Risks/Open questions → none
```

## Example — blocked turn

```
Blocker → `npm test` hangs on the `db-migrate` step, no output after 5 min.
Tried → (1) re-ran with `--verbose`, same hang; (2) killed and re-ran with a fresh DB container, same hang.
Next viable option → (a) skip migrations in the test DB and seed directly [recommended]; (b) ask infra to check the migration runner for a lock.
```

See §Anti-loop & output in the SSOT for what belongs in each section and the tone/format rules.
