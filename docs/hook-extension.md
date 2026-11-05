# Hook extension model

> **Languages**: **English** · [繁體中文](./hook-extension.zh-TW.md)

dhpk registers a deliberately small default lifecycle. The complete default
mapping is [`hooks/hooks.json`](../hooks/hooks.json). The machine-readable
default event manifest is [`hooks/default-events.json`](../hooks/default-events.json):
the three event groups listed there are wired by default. Events listed under
`optionalEvents` remain source assets until a consumer explicitly registers
them; optional events are not registered by default and are not silently active.

| Event | Script | Deterministic responsibility |
|---|---|---|
| `PreToolUse(Edit\|Write\|MultiEdit)` | `pre-edit-guard.sh` | protected-path and secret safety |
| `PreToolUse(Bash)` | `pre-bash-dispatch.sh` | shell safety plus Git branch-safety gates |
| `SessionStart` | `session-start.sh` | validate and activate configured modules |
| `SubagentStop` | `subagent-stop-verify.sh` | clean up stopped fast-worker liveness state; append each subagent's model (last transcript assistant model) and effort (hook-input value, may be session-level) to `.claude/artifacts/sessions/subagent-dispatch.jsonl` with no output |

`session-start.sh` activates modules only; it does not create snapshots, probe
Docker, inspect install health, inject prompt hints, or emit orchestration
advice.

## Credential read protection

The Claude `PreToolUse(Bash)` dispatcher inspects calls that reach it, including
subagent calls reaching the same gate. It does not cover other Hosts, Read or
MCP tools, or shell commands outside this integration. Python 3 is required;
when it is missing the Bash gate returns exit 2.

By default the gate protects `.env`, `.env.*`, `my.cnf`, `debian.cnf`,
`*.pem`, `id_rsa*`, and `credentials*` basenames. The exact basenames
`.env.example`, `.env.sample`, `.env.dist`, and `.env.template` are exempt
only from the default `.env` rule; suffix variants are not exempt, and a
custom rule can protect a template. The `.pem` and `id_rsa*` rules intentionally
include public-looking files.

Set `credential_read_paths` to a JSON array of strings in the plugin string
option, or a native array in project settings. It adds to the defaults; invalid
policy blocks the gate. For example, preserve spaces in JSON strings:

```json
{"pluginConfigs":{"dhpk@dhpk":{"options":{"credential_read_paths":["private keys/*", "custom.secret"]}}}}
```

A pattern without `/` matches a basename at any depth; a relative pattern with
`/` matches a complete path-component suffix; an absolute pattern matches the
full normalized path. `*` and `?` do not cross `/`. Literal `.` and `..`,
repeated separators, and shell quoting are normalized lexically without opening
the target. The same rules apply to supported literal SSH operands without
resolving remote paths against the local filesystem.

The bounded parser covers `cat`, `less`, `head`, `tail`, `sed`, `awk`, `grep`,
and `rg`, including options, multiple targets, input redirects, pipelines,
command separators, and literal SSH commands. Each target is assessed: an
allowed template or metadata command never exempts a protected sibling.
Plain `ls` and `stat` and ordinary reads remain allowed. Recursive content
search is permitted when each protected pattern is excluded or a bounded local
scan finds no matching protected path in any root. Only global exact basename excludes
for the effective final component, or `*`, can provide that proof; ignore and
reinclude rules cannot prove exclusion. The scan counts all entries without
modeling ignore rules and blocks on errors, 20,000 entries, or 300 ms; remote
commands and unknown working directories retain strict exclusion requirements.
It checks symlink paths and targets, skips internal directory links unless the
reader follows them, and blocks followed directory links. A path created after
the scan remains an accepted time-of-check/time-of-use risk. For a local `rg` regular non-symlink
file, the gate can use `lstat`; this check has a time-of-check/time-of-use
limit. Identifiable protected reads with syntax the gate cannot safely classify
are blocked. Submitted shell text is not executed or expanded for inspection.

For supported complete heredocs, quoted delimiter bodies are data and unquoted
bodies are checked for active command substitutions. Ambiguous delimiters,
multiple heredocs on one line, and continued body lines fail closed. Commands
and protected write targets around the heredoc remain subject to their gates.
For recursive searches, use `rg --glob '!pattern'` or `grep --exclude='pattern'`
for every default and custom protected pattern, or target explicit
non-protected files. Grep/Read tools are alternatives only if available.

### Controlled extraction

For a local protected file containing only a supported MySQL PDO DSN, the gate
recognizes exactly one simple invocation, using the absolute Python executable
used by the hook and the absolute installed helper path:

```text
/absolute/path/to/python3 -I -S /absolute/installed/plugin/scripts/hooks/credential-extract.py --file /absolute/path/to/file --fields host,dbname
```

`--fields` accepts only `host`, `dbname`, or `host,dbname`. No environment
prefix, wrapper, composition, redirection, or extra output flag is allowed. The
gate checks that the installed helper is a regular non-symlink file with its
pinned digest. The file must be a whole MySQL PDO DSN with unique `host` and
`dbname`, and optional validated `port` and `charset`; unsupported or ambiguous
input produces no extracted output. The helper emits JSON containing only the
requested keys. The file must be a regular file of at most 1024 bytes; its
absolute path may contain no symlink, empty, `.` or `..` component. The ASCII
DSN may end in one LF. Semicolon-separated fields can appear in any order,
without extra fields or a trailing semicolon. `host` matches
`[A-Za-z0-9][A-Za-z0-9._-]{0,252}`, `dbname` matches `[A-Za-z0-9_]{1,64}`,
`charset` matches `[A-Za-z0-9_]{1,32}`, and `port` is 1–65535 without a
leading zero. PHP configuration and SSH extraction are unsupported in v1;
the helper does not execute PHP or source the file. On a block, use controlled
local extraction where supported or ask the user for non-secret information.
Diagnostics do not echo commands, configuration values, or file content.

This lexical guard is not complete data-loss prevention: dynamic paths, aliases,
symlink targets, encoded commands, arbitrary interpreters, and script bodies are
not proven covered. Concurrent changes by the same UID and trust in the installed
files are outside its boundary. Test with fake fixtures; a local hook test does
not prove actual Claude parent or subagent activation.

## Bash outer ceiling

The Bash `PreToolUse` command declares `timeout: 2100` and `onFailure: "block"`.
Claude Code 2.1.295 and newer can block the triggering command when that hook
times out or cannot run. Older versions are not claimed to fail closed the same
way. This declaration is not a measured 2100-second wait.

The `Edit|Write|MultiEdit` guard also declares `onFailure: "block"`, with
`timeout: 5`. Claude Code 2.1.295 and newer fail-close that guard: a failed or
timed-out hook blocks the edit. Older Claude Code ignores `onFailure`, so a
failed or timed-out guard still lets the edit proceed.

The supported default envelope is one commit root each for JS, Python, Swift,
and PHP, one Python project group on that root, and Swift build/test settings
no higher than 360/480 seconds. Inner deadlines plus one second of grace are
JS 212, Python 255, Swift 842, and PHP 423, totaling 1732 seconds. The
remaining 368 seconds are for preparation and cleanup. Steps with no inner
deadline are outside that sum. Extra roots, extra groups, a larger Swift
override, or any run that reaches the ceiling can be interrupted. An
interrupted or unfinished check is not PASS, and the triggering Bash command
is not released past the ceiling. Inner deadlines stay unchanged.
`SubagentStop` is outside this ceiling.

## Reviewer evidence

Reviewer dispatch is orchestrator-owned and advisory. A reviewer writes a
Markdown report; no hook or artifact enforces a review gate.

## Optional extensions

Other hook scripts remain source assets for explicit consumer setup. They are
not activated merely by enabling a module or setting a userConfig key. A
consumer who needs them must register its own hook command and own its runtime
cost, output, and failure policy. This includes prompt hints, session/install
health checks, Docker probes, completion or graduation scans, SessionEnd and
compaction work, learning observation, post-edit formatting/linting, and Stop
reminders.

Module hooks may still participate in the combined Bash dispatcher:
`pre-bash-*.sh` and `pre-commit-*.sh` receive Bash payloads for active modules;
non-zero exit status blocks that Bash call. They must self-skip outside their
applicable project/file context.

## Hook argument expansion

When the Claude Code plugin runtime invokes a hook, `${CLAUDE_PLUGIN_ROOT}` tokens
inside that hook entry's `args` are expanded to the installed plugin root before the
subprocess starts. This is observed behavior, not a published or guaranteed
contract; treat it as compatibility guidance and re-check it against the installed
runtime before changing hook argument paths. The source mapping remains
[`hooks/hooks.json`](../hooks/hooks.json).

## Copying assets to a consumer project

`/dhpk:setup --install hooks|rules|scripts|all` invokes
`scripts/setup/install-assets.sh`. Hooks and scripts copy into
`<project>/.claude/dhpk/{hooks,scripts}`. Default `--install rules` writes
`<project>/.claude/rules/dhpk-overrides.md` and does not copy upstream policy
into `.claude/dhpk/rules/`; `--vendor` restores that discouraged verbatim
copy. An existing `.claude/dhpk/rules/` tree is reported as legacy and left
in place. The installer never edits consumer hook settings. Use `--dry-run` to
inspect the full source/target plan; differing target files are conflicts and
require explicit `--force`. Executable source files retain their executable
bit. Any destination path with a symlink component is rejected even with
`--force`, including the rules stub path.
