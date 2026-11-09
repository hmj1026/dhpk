scope: hooks
note: The Bash credential guard now judges content-reading git commands (`git grep`, `show`, `cat-file`, `diff`, `blame`, `stash show -p`, and `log -p`): `<rev>:<path>` and literal pathspecs are checked as targets, and a bounded names-only git listing proves the other reads touch no protected path (#1262).
