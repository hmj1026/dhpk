"""Bounded shell lexer for the credential guard.

`lex` turns one command into the word tokens, the command-substitution bodies,
and the heredoc expansions the policy judges. Every view reads the text through
`_Cursor`, the guard's only quote, escape, and comment state machine. Each view
fails closed by raising `ValueError` with a fixed reason that never contains
command text.

The views keep the decisions of the scanners they replaced (#1259): the word
view lexes substitution bodies inline, while the substitution view skips them,
and heredoc headers use a line-based comment rule. Changing a view's rules
changes allow/block outcomes, so it needs the decision snapshot regenerated.

A heredoc declared inside a `$(...)` outside single quotes belongs to that body,
so quotes in it are data (#1396, #1407). An unquoted substitution in
non-assignment position, or a command that may run text a substitution prints,
keeps the pre-#1396 reading. `<<` inside arithmetic, `${...}` or `$[...]` is
never a heredoc.
"""

from dataclasses import dataclass, field
import re

OPERATOR_CHARS = ';&|<>()'
TWO_CHAR_OPERATORS = ('&&', '||', '<<', '>>', '<>', '>&', '<&', ';;', '|&')
WORD_SPACES = ' \t\r\n'
# 雙引號中的反斜線只跳脫這些字元；其他情況反斜線本身保留為字面值。
DOUBLE_QUOTE_ESCAPES = '$`"\\\n'
HEREDOC_SHELLS = ('sh', 'bash', 'dash', 'zsh', 'ksh', 'ash', 'mksh', 'fish', 'csh', 'tcsh', 'busybox', 'rbash', 'yash', 'posh', 'script', 'at', 'su', 'source', 'eval', '.')
HEREDOC_DELIMITER = re.compile(
    r'<<(-?)[ \t]*((?:[A-Za-z0-9_]+|\x27[A-Za-z0-9_]*\x27|"[A-Za-z0-9_]*"|\\[A-Za-z0-9_])+)(?=[ \t;|&<>\n]|$)')
MAX_SUBSTITUTION_DEPTH = 64
# shell 出現在任何位置、或指令位置的包裝器，都可能執行命令替換產生的文字。
EXEC_SHELLS = frozenset((
    'sh', 'bash', 'dash', 'zsh', 'ksh', 'ash', 'mksh', 'fish', 'csh', 'tcsh', 'busybox', 'script', 'ssh',
    'python', 'python3', 'perl', 'ruby', 'node', 'php', 'awk', 'gawk'))
EXEC_WRAPPERS = frozenset((
    'eval', 'trap', 'source', '.', 'command', 'builtin', 'exec', 'env', 'nohup', 'time', 'nice', 'timeout', 'sudo', 'doas', 'xargs',
    'stdbuf', 'setsid', 'chroot', 'ionice', 'taskset', 'watch', 'su', 'runuser', 'unbuffer', 'flock',
    'nsenter', 'unshare', 'strace', 'ltrace', 'parallel', 'find'))
# 讀取標準輸入並據以建立檔名或指令的詞。
RESOLVABLE_SUBSTITUTIONS = frozenset(('pwd', 'git rev-parse --show-toplevel'))
QUOTED_FEEDERS = frozenset(('xargs', 'parallel'))
INPUT_FEEDERS = frozenset(('xargs', 'parallel', 'read', 'readarray', 'mapfile', 'exec'))
RESERVED_WORDS = frozenset(('!', '{', 'if', 'then', 'elif', 'else', 'while', 'until', 'do', 'time', 'coproc'))
SEGMENT_OPERATORS = (';', '&&', '||', '|', '|&', '&', ';;', '(', ')')
# 任何參數展開：值可能成為指令字、eval、trap 或函式本體的內容。
PARAMETER = re.compile(r'\$[A-Za-z0-9_{@*#?!$-]')
DESCRIPTORS = frozenset((digit, False) for digit in '0123456789')
# 其引數只會被當成資料的指令：雙引號中含 heredoc 的替換輸出在這些指令的引數位置才視為資料。
DATA_COMMANDS = frozenset(('git', 'gh', 'glab', 'echo', 'printf'))
# git、gh、glab 只在這些子命令的訊息選項中把值當成文字儲存；其他選項（--exec、-c、alias 等）可能執行它。
TEXT_SUBCOMMANDS = {
    'git': frozenset(('commit', 'tag', 'merge', 'notes', 'stash')),
    'gh': frozenset(('issue', 'pr', 'release')),
    'glab': frozenset(('issue', 'mr', 'release')),
}
TEXT_OPTIONS = {
    'git': frozenset(('-m', '-am', '--message')),
    'gh': frozenset(('-b', '--body', '-t', '--title', '-n', '--notes')),
    'glab': frozenset(('-d', '--description', '-t', '--title', '-m', '--message')),
}
GIT_VALUE_OPTIONS = frozenset(('-C', '-c', '--git-dir', '--work-tree', '--namespace'))
ASSIGNMENT = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*\+?=')

CONTINUATION = 'continuation'
COMMENT = 'comment'
ESCAPE = 'escape'
QUOTE = 'quote'
CHAR = 'char'


@dataclass
class Token:
    value: str
    glob: bool = False
    dynamic: bool = False
    operator: bool = False
    # text of the first command substitution (`$(` or a backtick) outside single
    # quotes in the word, or '' when it has none or its body is resolvable
    substitution: str = ''
    # an unquoted parameter expansion: the shell splits and globs its value into words
    bare: bool = False
    # (#1427) the word's pieces when it holds a parameter expansion or an
    # unquoted brace list: `(char, quoted)` pairs and `Expansion` items; else None
    parts: object = None
    # (#1427) set by the policy's expansion step when the word's value cannot be resolved
    unresolved: bool = False
    # (#1453) the literal text left once each parameter expansion with no visible
    # source is removed; '' when the word has no such expansion
    residue: str = ''
    # an unquoted digit directly before `<` or `>`: a file descriptor, not a word.
    # One digit only: zsh reads a longer number as a word.
    descriptor: bool = False


@dataclass(frozen=True)
class Expansion:
    """One `$name` or `${name<op>arg}` parameter expansion inside a word."""
    text: str
    name: str
    op: str
    arg: str
    quoted: bool


@dataclass
class Lexed:
    """Everything the policy reads from one command."""
    tokens: list = field(default_factory=list)
    # heredoc expansions first, then substitutions in text order
    bodies: list = field(default_factory=list)
    # Substitution bodies whose output the command may run, read from the
    # unmasked text: each must be judged with its heredoc text as code.
    executed_bodies: list = field(default_factory=list)
    # True for a body judged that way; its own bodies are executed too
    executed: bool = False


class _Cursor:
    """The only shell quote, escape, and comment state machine.

    `next()` consumes one lexical unit and returns `(kind, char)`:

    - `CONTINUATION`: a backslash-newline outside single quotes; it leaves the
      word state unchanged.
    - `COMMENT`: an unquoted `#` at a comment start, skipped up to the newline.
    - `ESCAPE`: a backslash outside single quotes and the character it escapes
      (`''` when the backslash ends the text and the view allows it).
    - `QUOTE`: a quote character that opens or closes the current quote.
    - `CHAR`: any other character; `quote` holds the state it was read in.

    Options:

    - `comments`: `'word'` starts a comment where no word has started,
      `'line'` where the previous character is a space or an operator, and
      `None` never.
    - `spaces`: the predicate that ends a word for the `'word'` rule.
    - `quotes`: False reads quote characters as data (heredoc bodies).
    - `unfinished_escape`: the reason raised for a trailing backslash, or
      `None` to accept it.
    """

    def __init__(self, text, start=0, comments='word', spaces=str.isspace, quotes=True, unfinished_escape=None):
        self.text = text
        self.i = start
        self.quote = None
        # (#1427) True inside an ANSI-C quote: `quote` stays a single quote so every
        # view still reads it as single-quoted text, but a backslash escapes the next character.
        self.ansi = False
        self._dollar = False
        self.word = False
        self.comments = comments
        self.spaces = spaces
        self.quotes = quotes
        self.unfinished_escape = unfinished_escape

    def at_end(self):
        return self.i >= len(self.text)

    def seek(self, i):
        """Move to `i` without reading the skipped text, keeping quote and word state.

        Views use it to consume a second operator character or a span another
        reader already handled (a substitution body, a masked heredoc).
        """
        self.i = i

    def _comment_starts(self, i):
        if self.comments == 'word':
            return not self.word
        if self.comments == 'line':
            return i == 0 or self.text[i - 1].isspace() or self.text[i - 1] in OPERATOR_CHARS
        return False

    def next(self):
        text, i, quote = self.text, self.i, self.quote
        ch = text[i]
        dollar, self._dollar = self._dollar, False
        # 反斜線換行在 shell 詞法中消失，不應改變原有字詞起點狀態。
        if ch == '\\' and quote != "'" and i + 1 < len(text) and text[i + 1] == '\n':
            self.i = i + 2
            return CONTINUATION, '\n'
        # 註解只在未加引號的起點生效；略過內容，避免引號污染後續掃描。
        if quote is None and ch == '#' and self._comment_starts(i):
            end = text.find('\n', i)
            self.i = len(text) if end < 0 else end
            return COMMENT, ''
        self.word = quote is not None or not (self.spaces(ch) or ch in OPERATOR_CHARS)
        if ch == '\\' and (quote != "'" or self.ansi):
            if i + 1 >= len(text):
                if self.unfinished_escape:
                    raise ValueError(self.unfinished_escape)
                self.i = len(text)
                return ESCAPE, ''
            self.i = i + 2
            return ESCAPE, text[i + 1]
        if self.quotes and ch in '\'"' and (quote is None or quote == ch):
            self.quote = None if quote else ch
            self.ansi = not quote and ch == "'" and dollar
            self.i = i + 1
            return QUOTE, ch
        self.i = i + 1
        self._dollar = quote is None and ch == '$'
        return CHAR, ch


def _lone_digit(text, end):
    """True when the raw word before `end` is one digit; empty quotes or a split word beside it make it a word."""
    i = end - 1
    if text[i] not in '0123456789':
        return False
    while text[max(0, i - 2):i] == '\\\n':
        i -= 2
    return i == 0 or text[i - 1] in WORD_SPACES or text[i - 1] in OPERATOR_CHARS


def tokenize(text):
    """Word view: words keep whether wildcard or expansion characters were active.

    Substitution bodies are lexed inline, so `$(cat x)` yields `$`, `(`, `cat`,
    `x`, `)`; the policy judges those words in the outer command as well.

    ANSI-C (`$'..'`) words are decoded and a locale quote (`$".."`) reads as a
    plain double quote, so the word holds the characters the shell would pass on
    (#1427). A word with a parameter expansion or an unquoted brace list also
    keeps its `parts`, which the policy resolves from visible text.
    """
    cursor = _Cursor(text, spaces=WORD_SPACES.__contains__, unfinished_escape='unfinished escape')
    tokens = []
    value = []
    pieces = []
    glob = dynamic = started = bare = False
    substitution = ''
    has_expansion = False
    skip_until = 0

    def flush():
        nonlocal value, pieces, glob, dynamic, started, substitution, has_expansion, bare
        if started:
            parts = tuple(pieces) if has_expansion or _brace_list(pieces) else None
            tokens.append(Token(''.join(value), glob, dynamic, substitution=substitution, bare=bare, parts=parts))
        value, pieces, glob, dynamic, started, substitution, has_expansion, bare = [], [], False, False, False, '', False, False

    while not cursor.at_end():
        start = cursor.i
        kind, ch = cursor.next()
        if kind in (CONTINUATION, COMMENT):
            continue
        if kind == QUOTE:
            started = True
            if cursor.ansi:
                decoded, end = _ansi_c(text, cursor.i)
                value.append(decoded)
                pieces.extend((c, True) for c in decoded)
                cursor.seek(end)
                cursor.quote, cursor.ansi = None, False
            continue
        if kind == ESCAPE:
            # 雙引號中的反斜線只跳脫 shell 特殊字元，其他情況必須保留避免偽造 helper 路徑。
            if cursor.quote == '"' and ch not in DOUBLE_QUOTE_ESCAPES:
                value.append('\\')
                pieces.append(('\\', True))
            value.append(ch)
            pieces.append((ch, True))
            started = True
            continue
        quoted = cursor.quote is not None
        if not quoted and ch in WORD_SPACES:
            flush()
            if ch == '\n':
                tokens.append(Token(';', operator=True))
            continue
        if not quoted and ch in OPERATOR_CHARS:
            descriptor = ch in '<>' and len(pieces) == 1 and pieces[0] in DESCRIPTORS and _lone_digit(text, start)
            flush()
            if descriptor:
                tokens[-1].descriptor = True
            op = ch
            if text[start:start + 2] in TWO_CHAR_OPERATORS:
                op = text[start:start + 2]
                cursor.seek(cursor.i + 1)
            # `<<-` 是單一 heredoc 運算子；否則 `-EOF` 會被讀成指令選項。
            if op == '<<' and text.startswith('-', cursor.i):
                op = '<<-'
                cursor.seek(cursor.i + 1)
            tokens.append(Token(op, operator=True))
            continue
        if ch == '$' and cursor.quote is None and text[cursor.i:cursor.i + 1] in ('"', "'") and cursor.i < len(text):
            # `$"..."` and `$'...'` are quotes; the `$` is not part of the word.
            started = True
            continue
        if ch == '$' and cursor.quote != "'":
            end = _resolvable_end(text, cursor.i)
            if end is not None:
                # `$(pwd)/.env` 是一個字詞：保留整段，其後綴才會被政策逐字判斷。
                value.append(text[start:end])
                pieces.extend((c, True) for c in text[start:end])
                cursor.seek(end)
                dynamic = started = True
                continue
        piece, inside = (ch, quoted), start < skip_until
        if ch == '$' and cursor.quote != "'" and not inside:
            found = _parse_expansion(text, cursor.i, cursor.quote == '"')
            if found:
                piece, skip_until = found
                has_expansion = True
        if ch in '$`' and cursor.quote != "'":
            dynamic = True
            bare = bare or (not quoted and bool(PARAMETER.match(text, start)))
            substitution = substitution or _unresolved_substitution(text, cursor.i, ch)
        if ch in '*?[' and not quoted:
            glob = True
        value.append(ch)
        if not inside:
            pieces.append(piece)
        started = True
    if cursor.quote:
        raise ValueError('unfinished quote')
    flush()
    return tokens


NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
SPECIAL_PARAMETER = re.compile(r'[0-9@*#?$!-]')
# `${1}`, `${@}`, `${!x}` (indirect); `${#x}` is a length and stays an opaque word.
BRACED_SPECIAL = re.compile(r'\d+|[@*#?$!-](?![A-Za-z_0-9])|![A-Za-z_][A-Za-z0-9_]*')
ANSI_C_SIMPLE = {'a': '\a', 'b': '\b', 'e': '\x1b', 'E': '\x1b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t',
                 'v': '\v', '\\': '\\', "'": "'", '"': '"', '?': '?'}
ANSI_C_NUMERIC = {'x': ('0123456789abcdefABCDEF', 2, 16), 'u': ('0123456789abcdefABCDEF', 4, 16),
                  'U': ('0123456789abcdefABCDEF', 8, 16)}


def _brace_list(pieces):
    """True when unquoted text holds a `{a,b}` or `{1..3}` shape that the shell would expand."""
    plain = ''.join(p[0] for p in pieces if isinstance(p, tuple) and not p[1])
    return '{' in plain and (',' in plain or '..' in plain)


def _ansi_c(text, i):
    """Decode the `$'...'` body that starts at `i`; return (decoded, index past the closing quote).

    Mirrors the shell: simple escapes, 1-3 digit octal, `\\xHH`, `\\uHHHH`,
    `\\UHHHHHHHH`, `\\cX`; an unknown escape stays as written; a NUL ends the
    value (the rest of the quoted text is dropped).
    """
    out = []
    truncated = False
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "'":
            return ''.join(out), i + 1
        if ch != '\\' or i + 1 >= n:
            piece, i = ch, i + 1
        else:
            piece, i = _ansi_c_escape(text, i + 1)
        if piece == '\x00':
            truncated = True
        elif not truncated:
            out.append(piece)
    raise ValueError('unfinished quote')


def _ansi_c_escape(text, i):
    """Decode the escape whose letter is at `i`; return (text, next index)."""
    letter = text[i]
    if letter in ANSI_C_SIMPLE:
        return ANSI_C_SIMPLE[letter], i + 1
    if letter in '01234567':
        end = i + 1
        while end < min(i + 3, len(text)) and text[end] in '01234567':
            end += 1
        return chr(int(text[i:end], 8) & 0xFF), end
    if letter in ANSI_C_NUMERIC:
        digits, width, base = ANSI_C_NUMERIC[letter]
        end = i + 1
        while end < min(i + 1 + width, len(text)) and text[end] in digits:
            end += 1
        code = int(text[i + 1:end], base) if end > i + 1 else None
        if code is None or code > 0x10FFFF or 0xD800 <= code <= 0xDFFF:
            return '\\' + letter, i + 1
        return chr(code), end
    if letter == 'c' and i + 1 < len(text) and text[i + 1] != "'":
        return chr(ord(text[i + 1]) & 0x1F), i + 2
    return '\\' + letter, i + 1


def _parse_expansion(text, i, quoted):
    """Parse the `$name` or `${name<op>arg}` whose text after the `$` starts at `i`.

    Returns `(Expansion, end index)`, or None for any other `$` form (`$1`,
    `$(..)`, `${#x}`, an unclosed brace), which stays an opaque dynamic word.
    """
    found = NAME.match(text, i)
    if found:
        return Expansion(text[i - 1:found.end()], found.group(), '', '', quoted), found.end()
    # (#1453) positional and special parameters are expansions whose value no text shows.
    special = SPECIAL_PARAMETER.match(text, i)
    if special and not text.startswith('{', i):
        return Expansion(text[i - 1:special.end()], special.group(), '', '', quoted), special.end()
    if not text.startswith('{', i):
        return None
    depth, k = 1, i + 1
    while k < len(text) and depth:
        if text[k] == '\\':
            k += 1
        elif text.startswith('${', k):
            depth, k = depth + 1, k + 1
        elif text[k] == '}':
            depth -= 1
        k += 1
    if depth:
        return None
    inner = text[i + 1:k - 1]
    named = NAME.match(inner)
    if not named:
        named = BRACED_SPECIAL.match(inner)
        if not named:
            return None
        rest = inner[named.end():]
        # (#1460) A positional parameter default spells its word; `=` is not split, as bash rejects it there.
        positional = re.match(r':?[-+?]', rest) if re.fullmatch(r'\d+|[@*]', named.group()) else None
        if positional:
            return Expansion(text[i - 1:k], named.group(), positional.group(), rest[positional.end():], quoted), k
        # No other operator semantics are modelled for these: the word stays an unknown value.
        return Expansion(text[i - 1:k], named.group(), 'other' if rest else '', rest, quoted), k
    rest = inner[named.end():]
    operator = re.match(r':?[-=+?]', rest)
    if operator:
        op, arg = operator.group(), rest[operator.end():]
    else:
        op, arg = ('', '') if not rest else ('other', rest)
    return Expansion(text[i - 1:k], named.group(), op, arg, quoted), k


def _unresolved_substitution(text, i, ch):
    """Text of the substitution that starts at `ch` (index `i - 1`), or '' when none or resolvable."""
    if ch == '`':
        try:
            return text[i - 1:_backtick_end(text, i, False) + 1]
        except ValueError:
            return '`'
    if not text.startswith('(', i):
        return ''
    try:
        end = _paren_end(text, i + 1)
    except ValueError:
        return text[i - 1:i + 1]
    return text[i - 1:end]


def _resolvable_end(text, i):
    """Index past the `$(...)` whose `(` is at `i` when its body is a resolvable one, else None."""
    if not text.startswith('(', i) or text.startswith('((', i):
        return None
    try:
        end = _paren_end(text, i + 1)
    except ValueError:
        return None
    return end if text[i + 1:end - 1].strip() in RESOLVABLE_SUBSTITUTIONS else None


class _Nesting:
    """Unclosed `${`, `$[` and arithmetic `((` at the cursor.

    bash never reads `<<` inside them as a heredoc, so a scanner must not skip
    the lines after it as a body. Feed every unquoted `CHAR`.

    A `$(...)` or backtick body inside them has its own frame: a `}` or `]`
    in that body does not close the outer `${` or `$[`, and a `<<` in it is a
    heredoc again. `[` inside `$[` nests, so `$[ a[1] << y ]` stays open.
    """

    SUBSTITUTION = ')'
    BACKTICK = '`'

    def __init__(self):
        self.stack = []

    @staticmethod
    def _expansion_frame(text, position):
        # the opening bracket is fed next and counted, so a bracket frame starts at -1 to cancel it
        return ['}', 0] if text[position + 1] == '{' else [']', -1]

    def inside(self):
        return bool(self.stack) and self.stack[-1][0] not in (self.SUBSTITUTION, self.BACKTICK)

    def feed(self, text, position, ch):
        top = self.stack[-1] if self.stack else None
        kind = top[0] if top is not None else None
        if kind == self.BACKTICK:
            if ch == '`':
                self.stack.pop()
            elif ch == '$' and text.startswith(('{', '['), position + 1):
                self.stack.append(self._expansion_frame(text, position))
            return
        if ch == '`':
            self.stack.append([self.BACKTICK, 0])
        elif ch == '$' and text.startswith('(', position + 1) and not text.startswith('((', position + 1):
            self.stack.append([self.SUBSTITUTION, 0])
        elif ch == '$' and text.startswith(('{', '['), position + 1):
            self.stack.append(self._expansion_frame(text, position))
        elif ch == '(' and kind == '))':
            top[1] += 1
        elif ch == '(' and text.startswith('((', position):
            self.stack.append(['))', 1])
        elif ch == '(' and kind == self.SUBSTITUTION:
            top[1] += 1
        elif ch == ')' and kind in ('))', self.SUBSTITUTION):
            top[1] -= 1
            if (kind == '))' and not top[1]) or (kind == self.SUBSTITUTION and top[1] <= 0):
                self.stack.pop()
        elif ch == '[' and kind == ']':
            top[1] += 1
        elif top is not None and ch == kind:
            if top[1]:
                top[1] -= 1
            else:
                self.stack.pop()


def _paren_end(text, start, heredocs=True):
    """Index just past the `)` that closes a `$(` body starting at `start`.

    With `heredocs`, a heredoc declared in the body is skipped up to its
    delimiter line, so quotes in it are data (#1396). An arithmetic `$((`
    body or a delimiter this lexer cannot read keeps its text as code.
    """
    cursor = _Cursor(text, start, unfinished_escape='unfinished substitution escape')
    heredocs = heredocs and not text.startswith('(', start)
    depth = 1
    pending = []
    nesting = _Nesting()
    while depth and not cursor.at_end():
        position = cursor.i
        kind, ch = cursor.next()
        # 註解與引號內的括號不是 shell 語法，不能提早結束命令替換。
        if kind != CHAR or cursor.quote is not None:
            continue
        nesting.feed(text, position, ch)
        # 算術、${...} 與 $[...] 內的 << 不是 heredoc；其後各行仍是指令。
        if heredocs and ch == '<' and text.startswith('<<', position) and not nesting.inside():
            cursor.seek(_heredoc_operator(text, position, pending))
        elif heredocs and ch == '\n' and pending:
            for match in pending:
                cursor.seek(_heredoc_end(text, cursor.i, match, substitution=True)[0])
            pending = []
        elif ch == '(':
            depth += 1
            if depth > MAX_SUBSTITUTION_DEPTH:
                raise ValueError('substitution depth')
        elif ch == ')':
            depth -= 1
    if depth:
        raise ValueError('unfinished substitution')
    return cursor.i


def _heredoc_operator(text, position, pending):
    """Index after a `<<` operator at `position`; a readable heredoc joins `pending`."""
    if text.startswith('<<<', position):
        return position + 3
    match = HEREDOC_DELIMITER.match(text, position)
    if not match:
        return position + 2
    pending.append(match)
    return match.end()


def _backtick_end(text, start, heredoc):
    """Index of the backtick that closes a body starting at `start`."""
    cursor = _Cursor(text, start)
    while not cursor.at_end():
        if heredoc and text[cursor.i] in '\'"':
            raise ValueError('ambiguous heredoc backtick')
        position = cursor.i
        kind, ch = cursor.next()
        if kind == CHAR and ch == '`' and cursor.quote is None:
            return position
    raise ValueError('unfinished substitution')


def _substitutions(text, heredoc=False, heredocs=True):
    """Substitution view: active `$(…)` and backtick bodies, balanced, in order.

    In a heredoc body quote characters are data and comments do not exist, so
    a quote there cannot hide a substitution that still runs.
    """
    cursor = _Cursor(text, comments=None if heredoc else 'word', quotes=not heredoc,
                     unfinished_escape='unfinished escape')
    result = []
    while not cursor.at_end():
        kind, ch = cursor.next()
        if kind != CHAR or cursor.quote == "'":
            continue
        if ch == '$' and text.startswith('(', cursor.i):
            start = cursor.i + 1
            end = _paren_end(text, start, heredocs and cursor.quote != "'")
            result.append(text[start:end - 1])
            cursor.seek(end)
        elif ch == '`':
            start = cursor.i
            end = _backtick_end(text, start, heredoc)
            result.append(text[start:end])
            cursor.seek(end + 1)
    return result


class _NoHeredocs(Exception):
    """The command must be read without masking any heredoc body."""


def _heredoc_end(text, start, match, substitution=False):
    """Return (index after the delimiter line, body) for the heredoc `match` declares."""
    word = match.group(2)
    delimiter = word.replace("'", '').replace('"', '').replace('\\', '')
    i = start
    while i < len(text):
        newline = text.find('\n', i)
        stop = len(text) if newline < 0 else newline + 1
        raw = text[i:stop]
        candidate = raw.rstrip('\n')
        if match.group(1):
            candidate = candidate.lstrip('\t')
        if candidate == delimiter:
            return stop, text[start:i]
        # bash 可在 $(...) 內以 `EOF)` 結束 heredoc；無法確定時不得把後續文字當資料。
        if substitution and candidate.startswith(delimiter) and ')' in candidate[len(delimiter):]:
            raise ValueError('ambiguous heredoc delimiter')
        if raw.endswith('\\\n'):
            raise ValueError('ambiguous heredoc continuation')
        i = stop
    raise ValueError('unterminated heredoc')


def _heredoc_body(text, start, header, line, heredocs=True):
    """Mask one heredoc: return (index after its delimiter line, expansions)."""
    # 僅遮罩能完整證明 delimiter 與結尾的格式；不明形式保留原文交由既有保守檢查。
    match = HEREDOC_DELIMITER.match(line, header)
    if not match:
        raise ValueError('unsupported heredoc delimiter')
    end, body = _heredoc_end(text, start, match)
    word = match.group(2)
    if "'" in word or '"' in word or '\\' in word:
        return end, []
    return end, _substitutions(body, heredoc=True, heredocs=heredocs)


def _substitution_span(text, i, heredocs, quote):
    """End of the `$(` body outside single quotes that starts at `i`, or None when it is not one to mask."""
    # 單引號內字元已是字面值，而算術 $(( 與無法定位結尾的替換也維持原本逐字掃描，
    # 錯誤留給後續檢視回報；外層未加引號但非賦值位置的字詞切割則由 _runs_output 處理。
    if not heredocs or quote == "'" or not text.startswith('(', i) or text.startswith('((', i):
        return None
    try:
        return _paren_end(text, i + 1)
    except ValueError:
        return None


def _heredocs(text, heredocs=True):
    """Heredoc view: the text with complete simple heredoc bodies removed, the
    same text with the heredoc bodies inside `$(...)` removed as well, and the
    substitutions still active in unquoted bodies.

    With `heredocs` False the view keeps its pre-#1396 reading: one heredoc
    per line, and `$(...)` bodies are read as part of the outer text.
    """
    if '<<' not in text:
        return text, text, []
    # shell 只以 LF 分行；heredoc 宣告以實體行判斷，註解以前一個字元判斷起點。
    cursor = _Cursor(text, comments='line')
    output = []
    deep = []
    active = []
    masks = []
    headers = []
    header_tokens = []
    tokenized_at = 0
    nesting = _Nesting()
    line_start = 0

    def emit(end):
        nonlocal masks
        output.append(text[line_start:end])
        pieces = []
        at = line_start
        for begin, stop, inner in masks:
            pieces.extend((text[at:begin], inner))
            at = stop
        pieces.append(text[at:end])
        deep.append(''.join(pieces))
        masks = []

    def end_line(end):
        nonlocal line_start, headers, tokenized_at
        line = text[line_start:end]
        emit(end)
        if not headers:
            line_start = end
            return end
        # 引號可以跨越實體行；未閉合時不能判定 heredoc 從哪一行開始。
        if cursor.quote is not None:
            raise ValueError('ambiguous heredoc declaration quote')
        if line.endswith('\\\n'):
            raise ValueError('ambiguous heredoc declaration continuation')
        # shell 本身可能執行標準輸入；先做 shell 引號移除，否則 'bash' 或 ba''sh 可繞過比對。
        new_tokens = tokenize(''.join(deep[tokenized_at:]))
        header_tokens.extend(new_tokens)
        tokenized_at = len(deep)
        # 管線的接收端可能出現在 heredoc 結束之後，未解析完成前不得隱藏內文。
        header_end = header_tokens
        if header_tokens and header_tokens[-1].operator and header_tokens[-1].value == ';' and line.endswith('\n'):
            header_end = header_tokens[:-1]
        if header_end and header_end[-1].operator and header_end[-1].value in ('|', '|&'):
            raise ValueError('ambiguous heredoc pipeline')
        # xargs、parallel 與讀取迴圈把 heredoc 內文當成檔名或指令；內文不是資料，且此處無法判定其內容。
        # 必須先於 shell 檢查，否則同一行的 eval 或 bash -c 會讓這個檢查被略過。
        shell_code = any(not token.operator and token.value.rsplit('/', 1)[-1] in HEREDOC_SHELLS for token in new_tokens)
        if _feeds_unresolved(new_tokens, shell_code, text):
            raise ValueError('heredoc text may run through xargs, parallel, exec or a read loop')
        if _dynamic_command(new_tokens):
            raise ValueError('heredoc read by an unresolved command')
        if any(not token.operator and token.value.rsplit('/', 1)[-1] in HEREDOC_SHELLS for token in new_tokens):
            raise _NoHeredocs()
        # 同一行可宣告多個 heredoc，內文依宣告順序接續讀取。
        for header in headers:
            end, expansions = _heredoc_body(text, end, header - line_start, line, heredocs)
            active.extend(expansions)
        line_start, headers = end, []
        return end

    try:
        while not cursor.at_end():
            position = cursor.i
            kind, ch = cursor.next()
            if kind == CHAR and ch == '$' and cursor.quote != "'":
                # 單引號外的 $(...) 內 heredoc 屬於替換本體；跳過整段，引號狀態不受內文影響。
                span = _substitution_span(text, cursor.i, heredocs, cursor.quote)
                if span is not None:
                    inner = text[cursor.i + 1:span - 1]
                    if headers and '\n' in inner:
                        raise ValueError('ambiguous heredoc substitution')
                    if '<<' in inner:
                        masks.append((cursor.i + 1, span - 1, _heredocs(inner)[1]))
                    cursor.seek(span)
                    continue
            if kind == CHAR and cursor.quote is None:
                nesting.feed(text, position, ch)
            # 算術、${...} 與 $[...] 內的 << 不是 heredoc；其後各行仍是指令。
            if kind == CHAR and cursor.quote is None and text.startswith('<<', position) and not nesting.inside():
                if text.startswith('<<<', position):
                    raise _NoHeredocs()
                if headers and not heredocs:
                    raise ValueError('ambiguous heredoc')
                # `exec 3<<EOF` 把內文留給之後的指令讀取；內文不是資料。
                if position and text[position - 1].isdigit() and (
                        position == 1 or text[position - 2].isspace() or text[position - 2] in OPERATOR_CHARS):
                    raise ValueError('heredoc text may run through xargs, parallel, exec or a read loop')
                headers.append(position)
                cursor.seek(cursor.i + 1)
            if (kind == CHAR and ch == '\n') or kind == CONTINUATION:
                cursor.seek(end_line(cursor.i))
        if line_start < len(text):
            end_line(len(text))
    except _NoHeredocs:
        return text, text, []
    return ''.join(output), ''.join(deep), active


def _feeds_arguments(word, shell_code=False):
    """True for a word that turns its standard input into arguments or commands.

    `shell_code` means a shell on the same line runs quoted strings as programs,
    so every feeder name counts inside them.
    """
    names = [part.rsplit('/', 1)[-1] for part in word.split()]
    # 含空白的字詞來自引號字串：其中只認 xargs、parallel（例如 sh -c 'xargs cat'）；
    # read、exec 等字樣出現在標題或訊息文字裡是資料，除非同一行的 shell 會把它當程式執行。
    if len(names) > 1 and not shell_code:
        return any(name in QUOTED_FEEDERS for name in names)
    return any(name in INPUT_FEEDERS for name in names)


# xargs 選項：不帶值的旗標、帶值的選項，以及選用值（附在選項上）的替換字串選項（#1433）。
XARGS_FLAGS = frozenset(('--', '-0', '-r', '-t', '-x', '--null', '--no-run-if-empty', '--verbose', '--exit',
                         '-o', '--open-tty', '-p', '--interactive', '-e', '--eof'))
XARGS_INTERACTIVE = frozenset(('-o', '--open-tty', '-p', '--interactive'))
XARGS_VALUE_OPTIONS = frozenset(('-n', '-L', '-P', '-s', '-d', '-E'))
XARGS_FLAG_CLUSTER = re.compile(r'^-[0rtxop]{2,}$')
XARGS_INTERACTIVE_CLUSTER = re.compile(r'^-[0rtxop]*[op][0rtxop]*$')
# (#1468) A flag cluster ending in a value option: `-rn1` (value attached) or `-rn 1` (value is the next word).
XARGS_VALUE_CLUSTER = re.compile(r'^-[0rtx]+([nLPsdE])(.*)$', re.S)
XARGS_ATTACHED_VALUE = re.compile(r'^-[nLPsdEe].+$')
XARGS_LONG_VALUE = re.compile(r'^--(max-args|max-lines|max-procs|max-chars|delimiter|eof)=.+$')
# 只印出參數、不會把參數當檔名或指令的 xargs 命令。
INERT_XARGS_COMMANDS = frozenset(('echo',))
# 只把文字存進一般變數的讀取內建命令及其可用選項。
READ_BUILTINS = {'read': frozenset(('-r',)), 'readarray': frozenset(('-t',)), 'mapfile': frozenset(('-t',))}
PLAIN_VARIABLE = re.compile(r'^[a-z_][a-z0-9_]*$')


def _replace_string(value, following):
    """The replace string an xargs `-I`, `-i` or `--replace` option sets and how many words it uses; None when unclear."""
    if value == '-I':
        return (following, 2) if following is not None else None
    if value == '--replace':
        return '{}', 1
    if value.startswith('--replace='):
        return value.split('=', 1)[1], 1
    if value.startswith('-I'):
        return value[2:], 1
    return value[2:] or '{}', 1


def xargs_command(words, head):
    """The words of the command an xargs invocation runs and its replace string.

    Returns `(command_words, replace)` or None when an option is not one of the
    inert, fully understood forms: an unknown option may read a file or the tty.
    """
    replace = None
    index = head + 1
    while index < len(words):
        word = words[index]
        value = word.value
        if word.dynamic or word.glob:
            return None
        if not value.startswith('-') or value == '-':
            return words[index:], replace
        if value in XARGS_FLAGS or XARGS_FLAG_CLUSTER.match(value) or XARGS_LONG_VALUE.match(value) or XARGS_ATTACHED_VALUE.match(value):
            index += 1
        elif XARGS_VALUE_CLUSTER.match(value):
            attached = XARGS_VALUE_CLUSTER.match(value).group(2)
            if not attached and index + 1 >= len(words):
                return None
            index += 1 if attached else 2
        elif value in XARGS_VALUE_OPTIONS:
            if index + 1 >= len(words):
                return None
            index += 2
        elif value.startswith(('-I', '-i', '--replace')):
            found = _replace_string(value, words[index + 1].value if index + 1 < len(words) else None)
            if found is None:
                return None
            replace = found[0]
            index += found[1]
        else:
            return None
    return [], replace


def _inert_xargs(words, head):
    """True when xargs only prints the heredoc text: its command is echo (the default) and nothing is substituted into the command word."""
    found = xargs_command(words, head)
    if found is None:
        return False
    command, replace = found
    # (#1460) An interactive option reads the tty, so the heredoc text is not the only input.
    if any(word.value in XARGS_INTERACTIVE or XARGS_INTERACTIVE_CLUSTER.match(word.value) for word in words[head + 1:len(words) - len(command)]):
        return False
    if not command:
        return True
    name = command[0]
    if name.dynamic or name.value.rsplit('/', 1)[-1] not in INERT_XARGS_COMMANDS:
        return False
    return replace is None or replace not in name.value


def _inert_read(words, head, text):
    """True when a read builtin only stores the heredoc text in plain lowercase variables.

    Stored text can run only through an expansion, and a text with no dollar sign
    and no backtick anywhere holds none, so the stored value cannot become a command.
    """
    if '$' in text or '`' in text:
        return False
    allowed = READ_BUILTINS[words[head].value]
    names = []
    for word in words[head + 1:]:
        if word.dynamic or word.glob:
            return False
        if word.value.startswith('-'):
            if word.value not in allowed:
                return False
        elif PLAIN_VARIABLE.match(word.value):
            names.append(word.value)
        else:
            return False
    return bool(names) and (words[head].value == 'read' or len(names) == 1)


def _inert_feeder(words, head, text):
    """True when the feeder at `head` is proven to only print or store the heredoc text."""
    if words[head].dynamic or words[head].glob:
        return False
    if words[head].value.rsplit('/', 1)[-1] == 'xargs':
        return _inert_xargs(words, head)
    return words[head].value in READ_BUILTINS and _inert_read(words, head, text)


def _command_words(tokens):
    """Word lists of the commands between segment operators, without redirect targets."""
    segments, current, redirect = [], [], False
    for token in tokens:
        if token.operator and token.value in SEGMENT_OPERATORS:
            segments.append(current)
            current, redirect = [], False
        elif token.operator:
            redirect = True
        elif redirect:
            redirect = False
        else:
            current.append(token)
    segments.append(current)
    return segments


def _feeds_unresolved(tokens, shell_code, text):
    """True when a feeder on the heredoc header line may turn the text into arguments or commands.

    A feeder word that is only text (an argument of echo, a message option of a
    recognised consumer) is data. A feeder at the head of its command is judged
    by what it does with its input; any other feeder word stays unresolved.
    """
    for words in _command_words(tokens):
        head = _head_index(words)
        for index, word in enumerate(words):
            if not _feeds_arguments(word.value, shell_code):
                continue
            if _data_argument(words, head, index):
                continue
            if index == head and _inert_feeder(words, head, text):
                continue
            return True
    return False


def _dynamic_command(tokens):
    """True when a command word is built by an expansion, so its name is unknown."""
    head = True
    for token in tokens:
        if token.operator:
            head = head or token.value in SEGMENT_OPERATORS
            continue
        if not head:
            continue
        if token.value in RESERVED_WORDS or ASSIGNMENT.match(token.value):
            continue
        if token.dynamic:
            return True
        head = False
    return False


def _holds_heredoc_substitution(token):
    # A masked substitution body can leave token.substitution as just the opener, so the word
    # itself is checked for a heredoc marker; an assignment word counts whenever it has a substitution.
    return not token.operator and bool(token.substitution) and ('<<' in token.value or bool(ASSIGNMENT.match(token.value)))


def _segments(tokens):
    """Word lists of the commands between segment operators."""
    segments, current = [], []
    for token in tokens:
        if token.operator and token.value in SEGMENT_OPERATORS:
            segments.append(current)
            current = []
        elif not token.operator:
            current.append(token)
    segments.append(current)
    return segments


def _defines_function(tokens):
    for index, token in enumerate(tokens):
        if not token.operator and token.value == 'function':
            return True
        if (not token.operator and index + 2 < len(tokens)
                and tokens[index + 1].operator and tokens[index + 1].value == '('
                and tokens[index + 2].operator and tokens[index + 2].value == ')'):
            return True
    return False


def _head_index(words):
    return next((i for i, word in enumerate(words) if word.value not in RESERVED_WORDS and not ASSIGNMENT.match(word.value)), None)


def _git_subcommand(words, head):
    """The git subcommand named after the global options, or '' when none is visible."""
    skip = False
    for word in words[head + 1:]:
        if skip:
            skip = False
        elif word.value in GIT_VALUE_OPTIONS:
            skip = True
        elif not word.value.startswith('-'):
            return word.value
    return ''


def _text_option_value(words, head, index, name):
    """True when `words[index]` is the value of a message option of a recognised subcommand."""
    subcommand = _git_subcommand(words, head) if name == 'git' else next(
        (word.value for word in words[head + 1:] if not word.value.startswith('-')), '')
    if subcommand not in TEXT_SUBCOMMANDS[name]:
        return False
    options = TEXT_OPTIONS[name]
    value = words[index].value
    return words[index - 1].value in options or any(
        option.startswith('--') and value.startswith(option + '=') for option in options)


def _data_argument(words, head, index):
    """True when the command at `head` only prints or stores `words[index]` as text.

    The consumer and the option decide: `echo` and `printf` print every argument;
    git, gh and glab store the value of a message option of a recognised
    subcommand. An unquoted parameter is split into words that may name options,
    and `${x@P}` expands prompt escapes that run substitutions, so neither is text.
    """
    if head is None or index <= head or words[head].dynamic:
        return False
    word = words[index]
    if '@P' in word.value or any(other.value == '-v' for other in words):
        return False
    name = words[head].value.rsplit('/', 1)[-1]
    if name in ('echo', 'printf'):
        return True
    if name not in TEXT_OPTIONS or word.bare:
        return False
    return _text_option_value(words, head, index, name)


def _output_may_run(tokens):
    """True unless every heredoc-bearing substitution is a data argument.

    Data position: the message value of a data consumer (`git commit -m
    "$(cat <<EOF ...)"`, `gh issue create --body "$(...)"`, `echo "$(...)"`),
    with no function in the command. A substitution assigned to a variable is
    data only while every parameter expansion in the command is such an
    argument, because any other use could run the stored text later.
    """
    if _defines_function(tokens):
        return True
    segments = [(words, _head_index(words)) for words in _segments(tokens)]
    expands = any(word.dynamic and PARAMETER.search(word.value) and not ASSIGNMENT.match(word.value)
                  and not _data_argument(words, head, index)
                  for words, head in segments for index, word in enumerate(words))
    for words, head in segments:
        for index, word in enumerate(words):
            if not _holds_heredoc_substitution(word):
                continue
            if ASSIGNMENT.match(word.value):
                if expands:
                    return True
                continue
            if not _data_argument(words, head, index):
                return True
    return False


def _runs_output(tokens):
    """True when a command may run or word-split text a substitution produced.

    A shell, eval or source anywhere, a dynamic or wrapper command word, or
    an unquoted command substitution in non-assignment position can execute or
    split a heredoc body that `$(cat <<EOF ...)` prints.
    """
    head = True
    target = False
    for index, token in enumerate(tokens):
        if token.operator:
            head = head or token.value in SEGMENT_OPERATORS
            target = token.value not in SEGMENT_OPERATORS
            continue
        next_is_sub = (
            token.dynamic
            and index + 1 < len(tokens)
            and tokens[index + 1].operator
            and tokens[index + 1].value == '('
        )
        if next_is_sub and (target or not head):
            return True
        if target:
            target = False
            continue
        name = token.value.rsplit('/', 1)[-1]
        if name in EXEC_SHELLS:
            return True
        if not head or ASSIGNMENT.match(token.value):
            continue
        if token.dynamic or name in EXEC_WRAPPERS:
            return True
        head = False
    return False


def _tokenize_by_line(text):
    """Tokenize `text`; when quotes do not balance, read it one line at a time.

    A heredoc body read as code often holds prose with an apostrophe. Each line
    is judged on its own, and a line whose quotes still do not balance is read
    with its quote and escape characters as separators, so a Reader command on
    it stays visible instead of blocking the whole command.
    """
    try:
        return tokenize(text)
    except ValueError:
        pass
    tokens = []
    for line in text.split('\n'):
        try:
            tokens.extend(tokenize(line))
        except ValueError:
            tokens.extend(tokenize(re.sub(r'[\'"\\]', '', line)))
        tokens.append(Token(';', operator=True))
    return tokens


def _lex(text, heredocs, executed=False):
    """Lex `text`; `executed` reads it whole, heredoc text included, as code."""
    if executed:
        # 此文字是會被執行的替換本體：heredoc 內文就是之後執行的命令，不得遮罩。
        return Lexed(tokens=_tokenize_by_line(text), executed_bodies=_substitutions(text), executed=True)
    # 原本把 heredoc 資料誤當指令；只遮罩完整辨識的內文並保留可執行替換。
    masked, deep, expansions = _heredocs(text, heredocs)
    tokens = tokenize(deep)
    # 使用平衡掃描保留引號及巢狀括號，避免命令替換包住可辨識讀取時漏判。
    return Lexed(tokens=tokens, bodies=list(expansions) + _substitutions(masked, heredocs=heredocs))


def lex(text, executed=False):
    """Lex one command; raise ValueError with a fixed reason when it is ambiguous.

    `executed` marks a substitution body whose output the caller found may be
    run as commands; its heredoc text is then code, not data.
    """
    if executed or '<<' not in text:
        return _lex(text, False, executed)
    lexed = _lex(text, True)
    # 含 heredoc 的替換輸出只有在資料位置才是資料；否則它可能被保留字、函式、包裝器或 trap 執行。
    stored = any('<<' in body for body in lexed.bodies) and _output_may_run(lexed.tokens)
    # 替換輸出可能被當成指令執行時，heredoc 內文不能視為資料，改用 #1396 前的讀法。
    if _runs_output(lexed.tokens):
        legacy = _lex(text, False)
        # 輸出被執行：另以未遮罩的原文判讀替換本體，其中的 heredoc 文字即為指令。
        return Lexed(tokens=legacy.tokens, bodies=legacy.bodies, executed_bodies=_substitutions(text))
    if stored:
        executed = [body for body in _substitutions(text) if '<<' in body]
        return Lexed(tokens=lexed.tokens, bodies=lexed.bodies, executed_bodies=executed)
    return lexed
