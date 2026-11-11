# Legacy journal recordings

Project trees that an installer of dhpk 0.72 / 0.73 left in flight. Those
producers are removed in js-projection-journal stage 5 (the Python installer and
the Publisher `hold` parameter), so recovery is tested against these
recordings. Each file is JSON; a tree maps a relative path to
`{ dir, mode }`, `{ mode, text }` or `{ link }`. `@@PROJECT@@`, `@@PLUGIN@@`
and `@@SOURCE@@` stand for the directories of the recording run and are
substituted on restore (`tests/_lib/legacy-journal-fixtures.js`).

| File | Recorded with | State |
| --- | --- | --- |
| `python-codex-host-journal.json` | `DHPK_INSTALLER_ENGINE=python`, `DHPK_TEST_KILL_AT=after-shared-projection`, `--copy --update --force` on a `fakePlugin()` (`tests/_lib/shared-projection-plugin.js`) whose `dhpk-codex-only` skill changed | `before` is the project after the first install; `interrupted` is the project after the killed update: a Codex Host journal with a held shared projection |
| `python-cursor-host-journal.json` | same, through `install-cursor-harness.sh`, with the portable skill and the review command changed | same, for the Cursor Host |
| `held-v3-install.json` | `materializeRelocatableAgentsSkillsProjection({ update: true, hold: { transactionId: 'run-1', host: 'codex' } })` over the sample skill changed to v2 | v3 Publisher journal in phase `held`, every effect done |
| `held-v3-install-killed.json` | the same call SIGKILLed on the first copy of the published `SKILL.md` | v3 Publisher journal still `publishing`, held by `run-1` |
| `held-v3-uninstall.json` | `uninstallAgentsSkillsProjection({ hold })` | the managed projection removed, held until commit |

`held-v3-*` recordings carry `before` (the project before the held call) and
`held` (the project afterwards). The recording scripts are not kept: the
producers they call no longer exist.
