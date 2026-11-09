# Credential guard runs read-only git listings at check time

Status: accepted

## Context

The credential guard judges only the Readers it knows. `git` subcommands that
print file contents were not among them (#1262): `git show HEAD:.env`,
`git cat-file -p`, `git diff`, and `git log -p` were allowed unconditionally,
and `git grep` was judged with GNU `grep` rules, so `git grep x` (whole
repository) and a quoted pathspec such as `'*.env'` passed. Ignore rules do not
close the gap: consumers protect tracked configuration files through custom
patterns, the case that motivated the guard in #1206.

Which files a git read opens often depends on repository state rather than on
the command text. `git diff`, `git show <commit>`, and `git grep x` name no
path at all.

## Decision

Content-reading git subcommands become Readers: `grep`, `show`, `cat-file`,
`diff`, `log` and `whatchanged` with a patch or line-range option, `blame`, and
`stash show -p`. Other subcommands, and output forms that print only names or
counts (`--stat`, `--name-only`, `--name-status`, `--numstat`) without a patch,
stay allowed.

When the command text does not determine the files, the guard runs one
read-only git listing with the same revisions, ranges, limits, and pathspecs,
asking only for names: `diff --name-only`, `show --name-only --format=`,
`log --name-only --format=`, `ls-files`, or `ls-tree -r --name-only`. A bare
object id is typed with `cat-file -t` first; a blob without a path is
ambiguous. Every listing passes `--no-pager --no-ext-diff --no-textconv`, so no
configured external program runs. The listed names are judged by the existing
policy function, and that listing is the read's Absence Proof.

The listing fails closed:

- It is bounded by the existing 300 ms and 20,000-entry caps; exceeding either
  blocks as an unproven recursive read and asks for a pathspec or `-n` limit.
- A listing error, an unknown option in the original command, or a repository
  relocation option (`--git-dir`, `--work-tree`, `--namespace`, `-c`, or
  `GIT_DIR`/`GIT_WORK_TREE` prefixes) blocks. `git -C <literal dir>` changes
  the working directory as `cd` does.
- Pathspecs with wildcards or magic other than exclude are ambiguous; git
  pathspec matching is not modelled. Git reads accept no Exclusion Proof.
- `<rev>:<path>` is resolved repository-relative, or working-directory-relative
  for `./`, and judged as a literal target.

## Consequences

- `git diff`, `git show <commit>`, and `git grep` keep working in repositories
  that track no Protected Path, at a measured cost of 10 to 20 ms per listing
  in this repository (4,187 tracked files).
- An unranged `git log -p` in a long history exceeds the cap and blocks; the
  full path history of this repository takes about 2 s to list.
- Aliases, `archive`, `format-patch`, `bundle`, and other unlisted
  subcommands remain unjudged. As with ADR 0032, the guard prevents accidental
  agent reads, not an adversary, and the time-of-check/time-of-use gap is
  accepted.
- The hook now executes `git`, so its behaviour depends on the installed git
  version and on the listing options above remaining side-effect free.

## Alternatives considered

### Never execute programs; require an explicit pathspec

Rejected. It would block `git diff` and `git show <commit>`, which agents run
constantly, and push them toward unjudged readers.

### Block every git subcommand not known to be name-only

Rejected. Agents run many git commands per session; any unlisted or new
subcommand would be blocked.

### Model git pathspec and exclude matching

Rejected for the reason ADR 0032 rejected modelling `rg` ignore rules: a
mismatch would let a Protected Path through.
