#!/usr/bin/env bash
# check-portability.sh — static portability gate for plugin shell scripts.
#
# Two passes over every shipped .sh file:
#   1. bash -n syntax check
#   2. grep for bash-4+/GNU-only idioms that break stock macOS (bash 3.2 +
#      BSD userland): declare -A, mapfile/readarray, ${var,,}/${var^^},
#      grep -P, date -d, readlink -f, sort -V, find -printf without a Darwin
#      branch nearby (heuristic: flagged for manual review), and heredocs
#      inside $(...) command substitution (fails in Bash 3.2 parser).
#
# Exit non-zero when any file fails — wire into CI.

set -o pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

# Bash 3.2 rejects or misparses heredocs (<< / <<-) inside $(...).
# Use a lexical scanner so comments, arithmetic $((...)), here-strings <<<,
# and quoted literals (e.g. ch="<<-") never trigger false positives.
_dhpk_check_cmdsubst_heredoc() {
    DHPK_PORTABILITY_FILES="$1" DHPK_PORTABILITY_SELF="$2" python3 <<'PY'
import os
import sys


def scan_file(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        src = f.read()

    n = len(src)
    i = 0
    line = 1
    stack = []
    arith_paren_depth = []
    pending_heredocs = []
    at_cmd_start = True
    word_buf = []
    findings = []

    def top():
        return stack[-1] if stack else None

    def in_cmdsubst():
        return "cmdsubst" in stack

    def in_code_context():
        for frame in reversed(stack):
            if frame in ("dquote", "squote", "ansiquote", "arith", "bracket_arith", "param"):
                return False
            if frame in ("cmdsubst", "paren", "case_head", "case_pat", "case_pat_paren", "case_body"):
                return True
        return True

    def flush_word():
        nonlocal at_cmd_start
        if not word_buf:
            return
        w = "".join(word_buf)
        word_buf.clear()
        if not in_code_context():
            return
        t = top()
        if w == "case" and at_cmd_start and t != "case_pat":
            stack.append("case_head")
            at_cmd_start = False
            return
        if w == "in" and t == "case_head":
            stack[-1] = "case_pat"
            at_cmd_start = True
            return
        if w == "esac" and t in ("case_pat", "case_body"):
            stack.pop()
            at_cmd_start = False
            return
        if w in ("then", "do", "else", "elif", "!"):
            at_cmd_start = True
            return
        if at_cmd_start and "=" in w:
            lhs = w.split("=", 1)[0]
            if lhs and (lhs[0].isalpha() or lhs[0] == "_") and all(c.isalnum() or c == "_" for c in lhs):
                return
        at_cmd_start = False

    def consume_heredocs():
        nonlocal i, line
        while pending_heredocs and i < n:
            delim, strip_tabs = pending_heredocs.pop(0)
            while i < n:
                nl = src.find("\n", i)
                if nl == -1:
                    raw_line = src[i:]
                    i = n
                else:
                    raw_line = src[i:nl]
                    i = nl + 1
                    line += 1
                check_line = raw_line.lstrip("\t") if strip_tabs else raw_line
                if check_line == delim:
                    break

    def read_heredoc_delim(pos):
        j = pos
        while j < n and src[j] in (" ", "\t"):
            j += 1
        delim_chars = []
        while j < n:
            c = src[j]
            if c in (" ", "\t", "\n", ";", "&", "|", "<", ">", "(", ")"):
                break
            if c == "'":
                j += 1
                while j < n and src[j] != "'":
                    delim_chars.append(src[j])
                    j += 1
                if j < n:
                    j += 1
            elif c == '"':
                j += 1
                while j < n and src[j] != '"':
                    if src[j] == "\\" and j + 1 < n and src[j + 1] in ('"', "\\", "$", "`", "\n"):
                        j += 1
                        if src[j] != "\n":
                            delim_chars.append(src[j])
                    else:
                        delim_chars.append(src[j])
                    j += 1
                if j < n:
                    j += 1
            elif c == "\\" and j + 1 < n:
                j += 1
                if src[j] != "\n":
                    delim_chars.append(src[j])
                j += 1
            else:
                delim_chars.append(c)
                j += 1
        return "".join(delim_chars), j

    while i < n:
        ch = src[i]
        t = top()

        if t == "squote":
            if ch == "'":
                stack.pop()
            elif ch == "\n":
                line += 1
            i += 1
            continue

        if t == "ansiquote":
            if ch == "\\" and i + 1 < n:
                if src[i + 1] == "\n":
                    line += 1
                i += 2
                continue
            if ch == "'":
                stack.pop()
            elif ch == "\n":
                line += 1
            i += 1
            continue

        if t == "dquote":
            if ch == "\\" and i + 1 < n:
                if src[i + 1] == "\n":
                    line += 1
                i += 2
                continue
            if ch == '"':
                stack.pop()
                i += 1
                continue
            if ch == "$" and i + 1 < n:
                nxt = src[i + 1]
                if nxt == "(":
                    if i + 2 < n and src[i + 2] == "(":
                        stack.append("arith")
                        arith_paren_depth.append(0)
                        i += 3
                        continue
                    stack.append("cmdsubst")
                    at_cmd_start = True
                    i += 2
                    continue
                if nxt == "{":
                    stack.append("param")
                    i += 2
                    continue
                if nxt == "[":
                    stack.append("bracket_arith")
                    i += 2
                    continue
            if ch == "\n":
                line += 1
            i += 1
            continue

        if t == "param":
            if ch == "\\" and i + 1 < n:
                if src[i + 1] == "\n":
                    line += 1
                i += 2
                continue
            if ch == "'":
                stack.append("squote")
                i += 1
                continue
            if ch == '"':
                stack.append("dquote")
                i += 1
                continue
            if ch == "}":
                stack.pop()
                i += 1
                continue
            if ch == "$" and i + 1 < n:
                nxt = src[i + 1]
                if nxt == "(":
                    if i + 2 < n and src[i + 2] == "(":
                        stack.append("arith")
                        arith_paren_depth.append(0)
                        i += 3
                        continue
                    stack.append("cmdsubst")
                    at_cmd_start = True
                    i += 2
                    continue
                if nxt == "{":
                    stack.append("param")
                    i += 2
                    continue
                if nxt == "'":
                    stack.append("ansiquote")
                    i += 2
                    continue
            if ch == "\n":
                line += 1
            i += 1
            continue

        if t == "arith":
            if ch == "\\" and i + 1 < n:
                if src[i + 1] == "\n":
                    line += 1
                i += 2
                continue
            if ch == "'":
                stack.append("squote")
                i += 1
                continue
            if ch == '"':
                stack.append("dquote")
                i += 1
                continue
            if ch == "$" and i + 1 < n:
                nxt = src[i + 1]
                if nxt == "(":
                    if i + 2 < n and src[i + 2] == "(":
                        stack.append("arith")
                        arith_paren_depth.append(0)
                        i += 3
                        continue
                    stack.append("cmdsubst")
                    at_cmd_start = True
                    i += 2
                    continue
                if nxt == "{":
                    stack.append("param")
                    i += 2
                    continue
            if ch == "(":
                arith_paren_depth[-1] += 1
                i += 1
                continue
            if ch == ")":
                if arith_paren_depth[-1] > 0:
                    arith_paren_depth[-1] -= 1
                    i += 1
                    continue
                if i + 1 < n and src[i + 1] == ")":
                    stack.pop()
                    arith_paren_depth.pop()
                    i += 2
                    continue
            if ch == "\n":
                line += 1
            i += 1
            continue

        if t == "bracket_arith":
            if ch == "\\" and i + 1 < n:
                if src[i + 1] == "\n":
                    line += 1
                i += 2
                continue
            if ch == "]":
                stack.pop()
                i += 1
                continue
            if ch == "\n":
                line += 1
            i += 1
            continue

        if ch == "\\" and i + 1 < n:
            if src[i + 1] == "\n":
                line += 1
                i += 2
                continue
            word_buf.append(src[i + 1])
            i += 2
            continue

        if ch == "#" and not word_buf:
            nl = src.find("\n", i)
            i = n if nl == -1 else nl
            continue

        if ch == "\n":
            flush_word()
            line += 1
            i += 1
            if pending_heredocs:
                consume_heredocs()
            at_cmd_start = True
            continue

        if ch in (" ", "\t"):
            flush_word()
            i += 1
            continue

        if ch == "'":
            word_buf.append("'")
            stack.append("squote")
            i += 1
            continue

        if ch == '"':
            word_buf.append('"')
            stack.append("dquote")
            i += 1
            continue

        if ch == "$" and i + 1 < n:
            nxt = src[i + 1]
            if nxt == "(":
                flush_word()
                if i + 2 < n and src[i + 2] == "(":
                    stack.append("arith")
                    arith_paren_depth.append(0)
                    i += 3
                    continue
                stack.append("cmdsubst")
                at_cmd_start = True
                i += 2
                continue
            if nxt == "{":
                word_buf.append("${")
                stack.append("param")
                i += 2
                continue
            if nxt == "[":
                word_buf.append("$[")
                stack.append("bracket_arith")
                i += 2
                continue
            if nxt == "'":
                word_buf.append("$'")
                stack.append("ansiquote")
                i += 2
                continue

        if ch in ("<", ">") and i + 1 < n and src[i + 1] == "(":
            flush_word()
            stack.append("paren")
            at_cmd_start = True
            i += 2
            continue

        if ch == "<" and i + 1 < n and src[i + 1] == "<":
            flush_word()
            if i + 2 < n and src[i + 2] == "<":
                i += 3
                continue
            strip_tabs = False
            after_op = i + 2
            if after_op < n and src[after_op] == "-":
                strip_tabs = True
                after_op += 1
            heredoc_line = line
            delim, next_i = read_heredoc_delim(after_op)
            if delim:
                if in_cmdsubst():
                    findings.append(heredoc_line)
                pending_heredocs.append((delim, strip_tabs))
                i = next_i
                continue
            i = after_op
            continue

        if ch == "(":
            flush_word()
            if top() == "case_pat":
                stack.append("case_pat_paren")
            elif at_cmd_start and i + 1 < n and src[i + 1] == "(":
                stack.append("arith")
                arith_paren_depth.append(0)
                i += 2
                continue
            else:
                stack.append("paren")
                at_cmd_start = True
            i += 1
            continue

        if ch == ")":
            flush_word()
            cur = top()
            if cur == "case_pat_paren":
                stack.pop()
                if top() == "case_pat":
                    stack[-1] = "case_body"
                at_cmd_start = True
            elif cur == "case_pat":
                stack[-1] = "case_body"
                at_cmd_start = True
            elif cur in ("cmdsubst", "paren"):
                stack.pop()
                at_cmd_start = False
            i += 1
            continue

        if ch == ";":
            flush_word()
            if top() == "case_body" and i + 1 < n and src[i + 1] in (";", "&"):
                if i + 2 < n and src[i + 1] == ";" and src[i + 2] == "&":
                    i += 3
                else:
                    i += 2
                stack[-1] = "case_pat"
                at_cmd_start = True
                continue
            at_cmd_start = True
            i += 1
            continue

        if ch in ("&", "|", "{"):
            flush_word()
            if ch in ("&", "|") and i + 1 < n and src[i + 1] == ch:
                i += 2
            else:
                i += 1
            at_cmd_start = True
            continue

        if ch in ("<", ">"):
            flush_word()
            i += 1
            continue

        word_buf.append(ch)
        i += 1

    flush_word()
    return findings


self_path = os.environ.get("DHPK_PORTABILITY_SELF", "")
raw_files = os.environ.get("DHPK_PORTABILITY_FILES", "")
failed = 0
for path in raw_files.splitlines():
    if not path or path == self_path:
        continue
    for line_no in scan_file(path):
        print(
            f"[portability] NON-PORTABLE IDIOM 'heredoc inside $(...)' in: {path}:{line_no}",
            file=sys.stderr,
        )
        failed = 1
sys.exit(failed)
PY
}

# Collect candidate scripts (POSIX find — no GNU extensions).
SCRIPTS="$(find "$PLUGIN_ROOT/scripts" "$PLUGIN_ROOT/modules" -type f -name '*.sh' 2>/dev/null)"
[ -z "$SCRIPTS" ] && { echo "[portability] no scripts found"; exit 1; }

SELF="$PLUGIN_ROOT/scripts/check-portability.sh"

while IFS= read -r f; do
    [ -z "$f" ] && continue
    # The checker carries the forbidden patterns as literal strings — skip self.
    [ "$f" = "$SELF" ] && continue

    if ! bash -n "$f" 2>/dev/null; then
        echo "[portability] SYNTAX FAIL: $f" >&2
        bash -n "$f" 2>&1 | head -3 >&2
        fail=1
    fi

    # bash-4-only / GNU-only idioms. Comments are stripped first so prose
    # mentions (like this header) don't trip the gate.
    stripped="$(sed 's/[[:space:]]*#.*$//' "$f")"
    for pattern in 'declare -A' 'grep -P' 'grep -[a-zA-Z]*P[a-zA-Z]* ' 'date -d ' 'readlink -f' 'sort -V'; do
        if grep -q -- "$pattern" <<<"$stripped"; then
            # 'date -d' is fine as the GNU-first attempt when a BSD 'date -j'
            # fallback exists in the same file.
            if [ "$pattern" = 'date -d ' ] && grep -q -- 'date -j' <<<"$stripped"; then
                continue
            fi
            echo "[portability] NON-PORTABLE IDIOM '$pattern' in: $f" >&2
            fail=1
        fi
    done
    # mapfile / readarray as a command. A builtin name inside a case pattern or
    # a regex of builtin names is data (the hook inspector lists them).
    if grep -Eq '(^|[;&|({]|[[:space:]]then|[[:space:]]do|[[:space:]]else)[[:space:]]*(mapfile|readarray)([[:space:]]|$)' <<<"$stripped"; then
        echo "[portability] NON-PORTABLE IDIOM 'mapfile/readarray' in: $f" >&2
        fail=1
    fi
    # ${var,,} / ${var^^} case conversion (bash 4+), including ${1,,} and
    # ${!name,,}. Piping a large file into grep -q would let grep exit early,
    # SIGPIPE the writer, and fail the pipeline under pipefail: a false
    # negative. Read the text through a here-string instead.
    if grep -Eq '\$\{!?[A-Za-z0-9_]+(,,|\^\^)\}' <<<"$stripped"; then
        echo "[portability] NON-PORTABLE IDIOM '\${var,,}/\${var^^}' in: $f" >&2
        fail=1
    fi
    # find -printf needs a Darwin branch (stat -f) in the same file.
    if grep -q -- '-printf' <<<"$stripped"; then
        if ! grep -q "Darwin" "$f"; then
            echo "[portability] 'find -printf' without a Darwin branch in: $f" >&2
            fail=1
        fi
    fi
done <<EOF_SCRIPTS
$SCRIPTS
EOF_SCRIPTS

if command -v python3 >/dev/null 2>&1; then
    if ! _dhpk_check_cmdsubst_heredoc "$SCRIPTS" "$SELF"; then
        fail=1
    fi
else
    echo "[portability] python3 required for heredoc-in-cmdsubst check" >&2
    fail=1
fi

if [ "$fail" -eq 0 ]; then
    echo "[portability] OK: all shipped scripts pass syntax + portability checks"
fi
exit "$fail"
