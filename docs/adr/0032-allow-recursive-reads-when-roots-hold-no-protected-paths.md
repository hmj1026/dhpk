# Allow recursive reads when roots hold no Protected Paths

Status: accepted

## Context

The credential-read guard approved in #1206 blocks every recursive `rg` or
`grep` read unless the command carries an Exclusion Proof for every default
and custom credential pattern. That contract deliberately did not list
directories, so a recursive search of a tree that holds no Protected Path is
blocked anyway. Agents meet this false positive constantly (#1211, #1219).

## Decision

A local recursive read also passes on an Absence Proof. For each effective
pattern, the command must either exclude it (Exclusion Proof) or a scan of
every search root must find no Protected Path that matches it. Any other
outcome keeps today's block, and the message names the patterns that matched
and up to three matching files.

The Absence Proof is bounded and fails closed:

- Local only. Remote readers (`ssh` and similar) and hooks without a known
  `cwd` keep the strict #1206 contract.
- A root that is missing, unreadable, or itself a Protected Path blocks, and
  so does any unreadable directory below it.
- Matching reuses the existing policy function: same defaults, custom
  patterns, template exemption, and basename, suffix, and absolute matching.
- The scan counts every entry. It does not model `.gitignore`, `rg` hidden
  rules, or include filters. A fixed cap of 20,000 entries or 300 ms blocks
  when exceeded; the caps are constants, not consumer settings.
- Symlinks: the link path and its resolved target are both checked. A
  symlinked root is resolved and its target scanned, as both tools follow
  command-line links. Symlinked directories inside the root are skipped when
  the command does not follow them (`rg`, `grep -r`) and block when it does
  (`grep -R`; `rg -L` stays unsupported syntax).
- Under an Absence Proof, options that only narrow or widen which files below
  the root are read (`--include`, `--exclude-dir`, `--type`, `--iglob`,
  positive `-g`, `--hidden`, `--no-ignore*`, `--exclude-from`,
  `--ignore-file`) no longer void the proof. `--files-from` and `--pre` still
  block, because they reach files outside the scanned tree. The Exclusion
  Proof keeps its existing rules.

## Consequences

- A protected file created between the check and the command's execution is
  read (TOCTOU). This is accepted: the guard prevents accidental agent reads,
  not an adversary racing the hook, and closing the race would require the
  hook to run the command itself.
- Large trees (for example with `node_modules`) still need an Exclusion Proof
  or explicit file targets once they exceed the scan cap.
- The hook now performs filesystem enumeration on recursive reads, which adds
  bounded latency to those commands only.

## Alternatives considered

### Keep the strict #1206 contract

Rejected. It blocks searches in trees with no Protected Path at all, and the
recovery advice forces long exclusion lists onto every recursive search.

### Model the readers' ignore rules to shrink the scan

Rejected. Reproducing `rg` ignore precedence exactly is error-prone, and any
mismatch would let a Protected Path through.

### Block whenever any symlink is present

Rejected. Most JavaScript projects carry symlinks in `node_modules/.bin`, so
the exception would rarely apply.
