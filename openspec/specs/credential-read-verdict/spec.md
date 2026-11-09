# credential-read-verdict Specification

## Purpose

Define how the Claude Bash credential-read guard reaches and reports its
decision: Reader adapters describe an invocation as a Read Plan, one policy
judges it, and one Credential Verdict names the outcome, its reason, and the
recovery hint. The terms are defined in `GLOSSARY.md` under Credential Guard;
the Absence Proof bounds come from ADR 0032.

## Requirements

### Requirement: REQ-1 One Credential Verdict per command

The credential-read guard SHALL decide each agent Bash command with exactly one
Credential Verdict. A Verdict SHALL have a `kind` from the closed set `allow`,
`protected`, `unsupported`, `ambiguous_target`, `recursive_unproven`, and
`inspection_failure`, plus a `detail` and a recovery `hint`. Verdicts SHALL be
built only by the Verdict module. The guard entrypoint SHALL print a blocked
Verdict as `[bash-guard] blocked: <reason>[: <detail>]; <hint>` and SHALL NOT
choose the reason or hint by matching message text. Any kind other than `allow`
SHALL exit 2.

#### Scenario: Blocked command prints its Verdict

- **WHEN** an agent runs `cat .env`
- **THEN** the hook exits 2 and stderr reads `[bash-guard] blocked: protected path;` followed by a space and the `protected` hint

#### Scenario: Invalid payload is an inspection failure

- **WHEN** the hook receives a payload that is not JSON, or a policy that is not a JSON array of strings
- **THEN** the hook exits 2 with reason `credential inspection failure`

### Requirement: REQ-2 Allow/block outcome is unchanged

The refactored guard SHALL reach the same allow or block outcome as the guard
before this change for every command, working directory, filesystem state, and
credential policy. Only the reason and hint text of a blocked command MAY differ.

#### Scenario: Decision snapshot matches

- **WHEN** the decision snapshot recorded before the refactor is replayed against the refactored guard
- **THEN** every entry has the same allow or block outcome

### Requirement: REQ-3 Reader adapters produce a Read Plan

Each Reader (`cat`, `less`, `head`, `tail`, `sed`, `awk`, `grep`, `rg`) SHALL
have an adapter that parses its arguments with that Reader's own option grammar
into a Read Plan or reports unsupported syntax. A Read Plan SHALL state its
targets, auxiliary inputs, whether it recurses, whether it follows directory
links, the exclusions it states, and whether those exclusions can serve as an
Exclusion Proof. An adapter SHALL NOT decide whether the read is allowed.

#### Scenario: Grep plan records an auxiliary input and recursion

- **WHEN** the `grep` adapter parses `-r -f patterns.txt src`
- **THEN** the Read Plan has target `src`, auxiliary input `patterns.txt`, and is recursive without following links

#### Scenario: Unknown option is unsupported

- **WHEN** the `grep` adapter parses `-Z needle ordinary`
- **THEN** it reports unsupported syntax and the guard blocks with reason `unsupported reader syntax`

#### Scenario: Ambiguous shell syntax is unsupported

- **WHEN** an agent runs `cat <<'EOF' |` followed by `cat .env`, `EOF`, and `bash` on separate lines
- **THEN** the guard blocks with reason `unsupported reader syntax` and detail `shell syntax: ambiguous heredoc pipeline`, not `credential inspection failure`

### Requirement: REQ-4 One policy judges every Read Plan

A single Reader-independent policy SHALL judge every Read Plan for Protected
Paths, Exclusion Proof coverage, and the ADR-0032 Absence Proof. A Protected Path
target or auxiliary input SHALL yield `protected`. A recursive plan with neither
an Exclusion Proof nor an Absence Proof SHALL yield `recursive_unproven` with the
scan findings as detail.

#### Scenario: Protected auxiliary input

- **WHEN** an agent runs `grep -f .env needle ordinary`
- **THEN** the guard blocks with reason `protected path`

#### Scenario: Recursive read over a tree with a Protected Path

- **WHEN** an agent runs `rg foo .` in a directory that contains `.env`
- **THEN** the guard blocks with reason `recursive read without credential exclusions` and the detail names `.env`

### Requirement: REQ-5 Ambiguous targets are reported as such

A read target whose path cannot be known statically SHALL yield
`ambiguous_target` with reason `ambiguous read target`. This SHALL cover a glob
positional target, a glob input-redirect target, a glob or dynamic auxiliary
input, and a glob or dynamic operand of the command carried by `ssh`. Its hint
SHALL ask for explicit literal paths.

#### Scenario: Glob positional target

- **WHEN** an agent runs `cat *.pem`
- **THEN** the guard blocks with reason `ambiguous read target`, not `protected path`

#### Scenario: Glob input redirect

- **WHEN** an agent runs `cat < *.txt`
- **THEN** the guard blocks with reason `ambiguous read target`

#### Scenario: Dynamic auxiliary input

- **WHEN** an agent runs `rg --ignore-file "$VAR" foo ordinary.js`
- **THEN** the guard blocks with reason `ambiguous read target`

#### Scenario: Dynamic ssh operand

- **WHEN** an agent runs `ssh example cat "$FILE"`
- **THEN** the guard blocks with reason `ambiguous read target`, not `unsupported reader syntax`

### Requirement: REQ-6 Remote Wrapper is not a Reader

`ssh` SHALL be treated as a Remote Wrapper: the command it carries SHALL be
analyzed with no local working directory, so no Absence Proof applies to it.

#### Scenario: Remote recursive read needs an Exclusion Proof

- **WHEN** an agent runs `ssh example "rg foo ."` in a directory with no Protected Path
- **THEN** the guard blocks with reason `recursive read without credential exclusions`

### Requirement: REQ-7 Recovery hint names the Reader's own syntax

The hint for `unsupported` and `recursive_unproven` SHALL describe exclusion
syntax only for the Reader that was used: `--glob "!pattern"` for `rg` and
`--exclude="pattern"` for `grep`. Readers that do not recurse SHALL get no
exclusion syntax. Every such hint SHALL mention default and custom credential
patterns where exclusion syntax is given, and SHALL say Grep/Read may be used if
available.

#### Scenario: rg hint

- **WHEN** `rg needle .` is blocked as a recursive read
- **THEN** the hint contains `--glob` and does not contain `--exclude`

#### Scenario: grep hint

- **WHEN** `grep -r needle .` is blocked as a recursive read
- **THEN** the hint contains `--exclude` and does not contain `--glob`

### Requirement: REQ-8 Existing reason strings are kept

The guard SHALL keep the exact text of the reasons `protected path`,
`unsupported reader syntax`, and `recursive read without credential exclusions`.
A command with several segments SHALL be decided by its first blocked segment.

#### Scenario: First blocked segment decides

- **WHEN** an agent runs `cat ordinary; grep -Z x ordinary; cat .env`
- **THEN** the guard blocks with reason `unsupported reader syntax`

### Requirement: REQ-9 Bash fallback only for an unavailable analyzer

`pre-bash-guard.sh` SHALL print its own block text only when Python or the
analyzer is unavailable, or the analyzer exits without a recognizable Verdict
line. It SHALL NOT carry any other decision text.

#### Scenario: Missing analyzer module

- **WHEN** a credential analyzer module is missing
- **THEN** the hook exits 2 with the Bash fallback text and no Python traceback
