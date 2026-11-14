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
HEREDOC_SHELLS = ('sh', 'bash', 'dash', 'zsh', 'ksh', 'source', 'eval', '.')
HEREDOC_DELIMITER = re.compile(
    r'<<(-?)[ \t]*((?:[A-Za-z0-9_]+|\x27[A-Za-z0-9_]*\x27|"[A-Za-z0-9_]*"|\\[A-Za-z0-9_])+)(?=[ \t;|&<>\n]|$)')
MAX_SUBSTITUTION_DEPTH = 64
# shell 出現在任何位置、或指令位置的包裝器，都可能執行命令替換產生的文字。
EXEC_SHELLS = frozenset((
    'sh', 'bash', 'dash', 'zsh', 'ksh', 'ash', 'mksh', 'fish', 'csh', 'tcsh', 'busybox', 'script', 'ssh',
    'python', 'python3', 'perl', 'ruby', 'node', 'php', 'awk', 'gawk'))
EXEC_WRAPPERS = frozenset((
    'eval', 'source', '.', 'command', 'builtin', 'exec', 'env', 'nohup', 'time', 'nice', 'timeout', 'sudo', 'doas', 'xargs',
    'stdbuf', 'setsid', 'chroot', 'ionice', 'taskset', 'watch', 'su', 'runuser', 'unbuffer', 'flock',
    'nsenter', 'unshare', 'strace', 'ltrace', 'parallel', 'find'))
SEGMENT_OPERATORS = (';', '&&', '||', '|', '|&', '&', ';;', '(', ')')
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


@dataclass
class Lexed:
    """Everything the policy reads from one command."""
    tokens: list = field(default_factory=list)
    # heredoc expansions first, then substitutions in text order
    bodies: list = field(default_factory=list)


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
        if ch == '\\' and quote != "'":
            if i + 1 >= len(text):
                if self.unfinished_escape:
                    raise ValueError(self.unfinished_escape)
                self.i = len(text)
                return ESCAPE, ''
            self.i = i + 2
            return ESCAPE, text[i + 1]
        if self.quotes and ch in '\'"' and (quote is None or quote == ch):
            self.quote = None if quote else ch
            self.i = i + 1
            return QUOTE, ch
        self.i = i + 1
        return CHAR, ch


def tokenize(text):
    """Word view: words keep whether wildcard or expansion characters were active.

    Substitution bodies are lexed inline, so `$(cat x)` yields `$`, `(`, `cat`,
    `x`, `)`; the policy judges those words in the outer command as well.
    """
    cursor = _Cursor(text, spaces=WORD_SPACES.__contains__, unfinished_escape='unfinished escape')
    tokens = []
    value = []
    glob = dynamic = started = False

    def flush():
        nonlocal value, glob, dynamic, started
        if started:
            tokens.append(Token(''.join(value), glob, dynamic))
        value, glob, dynamic, started = [], False, False, False

    while not cursor.at_end():
        start = cursor.i
        kind, ch = cursor.next()
        if kind in (CONTINUATION, COMMENT):
            continue
        if kind == QUOTE:
            started = True
            continue
        if kind == ESCAPE:
            # 雙引號中的反斜線只跳脫 shell 特殊字元，其他情況必須保留避免偽造 helper 路徑。
            if cursor.quote == '"' and ch not in DOUBLE_QUOTE_ESCAPES:
                value.append('\\')
            value.append(ch)
            started = True
            continue
        quoted = cursor.quote is not None
        if not quoted and ch in WORD_SPACES:
            flush()
            if ch == '\n':
                tokens.append(Token(';', operator=True))
            continue
        if not quoted and ch in OPERATOR_CHARS:
            flush()
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
        if ch in '$`' and cursor.quote != "'":
            dynamic = True
        if ch in '*?[' and not quoted:
            glob = True
        value.append(ch)
        started = True
    if cursor.quote:
        raise ValueError('unfinished quote')
    flush()
    return tokens


class _Nesting:
    """Unclosed `${`, `$[` and arithmetic `((` at the cursor.

    bash never reads `<<` inside them as a heredoc, so a scanner must not skip
    the lines after it as a body. Feed every unquoted `CHAR`.
    """

    def __init__(self):
        self.stack = []

    def inside(self):
        return bool(self.stack)

    def feed(self, text, position, ch):
        top = self.stack[-1] if self.stack else None
        if ch == '$' and text.startswith(('{', '['), position + 1):
            self.stack.append(['}' if text[position + 1] == '{' else ']', 0])
        elif ch == '(' and top is not None and top[0] == '))':
            top[1] += 1
        elif ch == '(' and text.startswith('((', position):
            self.stack.append(['))', 1])
        elif ch == ')' and top is not None and top[0] == '))':
            top[1] -= 1
            if not top[1]:
                self.stack.pop()
        elif top is not None and ch == top[0]:
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
                headers.append(position)
                cursor.seek(cursor.i + 1)
            if (kind == CHAR and ch == '\n') or kind == CONTINUATION:
                cursor.seek(end_line(cursor.i))
        if line_start < len(text):
            end_line(len(text))
    except _NoHeredocs:
        return text, text, []
    return ''.join(output), ''.join(deep), active


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


def _lex(text, heredocs):
    # 原本把 heredoc 資料誤當指令；只遮罩完整辨識的內文並保留可執行替換。
    masked, deep, expansions = _heredocs(text, heredocs)
    tokens = tokenize(deep)
    # 使用平衡掃描保留引號及巢狀括號，避免命令替換包住可辨識讀取時漏判。
    return Lexed(tokens, list(expansions) + _substitutions(masked, heredocs=heredocs))


def lex(text):
    """Lex one command; raise ValueError with a fixed reason when it is ambiguous."""
    if '<<' not in text:
        return _lex(text, False)
    lexed = _lex(text, True)
    # 替換輸出可能被當成指令執行時，heredoc 內文不能視為資料，改用 #1396 前的讀法。
    if _runs_output(lexed.tokens):
        return _lex(text, False)
    return lexed
