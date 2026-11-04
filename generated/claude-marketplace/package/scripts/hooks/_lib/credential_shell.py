"""Bounded shell lexer: words retain whether wildcard characters were unquoted."""

from dataclasses import dataclass


@dataclass
class Token:
    value: str
    glob: bool = False
    dynamic: bool = False
    operator: bool = False


def tokenize(text):
    tokens = []
    value = []
    quoted = False
    glob = False
    dynamic = False
    started = False
    i = 0

    def flush():
        nonlocal value, glob, dynamic, started
        if started:
            tokens.append(Token(''.join(value), glob, dynamic))
        value, glob, dynamic, started = [], False, False, False

    while i < len(text):
        ch = text[i]
        if not quoted and ch == '#' and not started:
            while i < len(text) and text[i] != '\n':
                i += 1
            continue
        if not quoted and ch in ' \t\r\n':
            flush()
            if ch == '\n':
                tokens.append(Token(';', operator=True))
            i += 1
            continue
        if not quoted and ch in ";&|<>()":
            flush()
            op = ch
            if i + 1 < len(text) and text[i:i + 2] in ('&&', '||', '<<', '>>', '<>', '>&', '<&', ';;', '|&'):
                op = text[i:i + 2]
                i += 1
            tokens.append(Token(op, operator=True))
            i += 1
            continue
        if ch in "'\"" and (not quoted or quoted == ch):
            quoted = False if quoted else ch
            started = True
            i += 1
            continue
        if ch == '\\' and quoted != "'":
            i += 1
            if i >= len(text):
                raise ValueError('unfinished escape')
            # 雙引號中的反斜線只跳脫 shell 特殊字元，其他情況必須保留避免偽造 helper 路徑。
            if quoted == '"' and text[i] not in '$`"\\\n':
                value.append('\\')
            if text[i] != '\n':
                value.append(text[i])
                started = True
            i += 1
            continue
        if ch in '$`' and quoted != "'":
            dynamic = True
        if ch in '*?[' and not quoted:
            glob = True
        value.append(ch)
        started = True
        i += 1
    if quoted:
        raise ValueError('unfinished quote')
    flush()
    return tokens


def substitutions(text):
    """Extract active literal command substitutions with balanced parentheses."""
    result = []
    quote = None
    word_started = False
    i = 0
    while i < len(text):
        ch = text[i]
        # 反斜線換行在 shell 詞法中消失，不應改變原有字詞起點狀態。
        if ch == "\\" and quote != "'" and i + 1 < len(text) and text[i + 1] == '\n':
            i += 2
            continue
        # 註解只在未加引號的字詞起點生效；忽略註解內容，避免引號污染後續掃描。
        if quote is None and ch == '#' and not word_started:
            while i < len(text) and text[i] != '\n':
                i += 1
            continue
        if quote is None and (ch.isspace() or ch in ';|&<>()'):
            word_started = False
        else:
            word_started = True
        if ch == "\\" and quote != "'":

            if i + 1 >= len(text):
                raise ValueError('unfinished escape')
            if quote != '"' or text[i + 1] in '$`"\\\n':
                i += 2
                continue
        if ch in "'\"" and (quote is None or quote == ch):
            quote = None if quote else ch
            i += 1
            continue
        if quote != "'" and text.startswith('$(', i):
            start = i + 2
            j = start
            depth = 1
            inner_quote = None
            inner_word = False
            while j < len(text) and depth:
                c = text[j]
                if c == "\\" and inner_quote != "'" and j + 1 < len(text) and text[j + 1] == '\n':
                    j += 2
                    continue
                # 註解內的括號不是 shell 語法，不能提早結束命令替換。
                if inner_quote is None and c == '#' and not inner_word:
                    while j < len(text) and text[j] != '\n':
                        j += 1
                    continue
                if inner_quote is None and (c.isspace() or c in ';|&<>()'):
                    inner_word = False
                else:
                    inner_word = True
                if c == "\\" and inner_quote != "'":
                    if j + 1 >= len(text):
                        raise ValueError('unfinished substitution escape')
                    if inner_quote != '"' or text[j + 1] in '$`"\\\n':
                        j += 2
                        continue
                if c in "'\"" and (inner_quote is None or inner_quote == c):
                    inner_quote = None if inner_quote else c
                elif inner_quote is None and c == '(':
                    depth += 1
                    if depth > 64:
                        raise ValueError('substitution depth')
                elif inner_quote is None and c == ')':
                    depth -= 1
                j += 1
            if depth:
                raise ValueError('unfinished substitution')
            result.append(text[start:j - 1])
            i = j
            continue
        if quote != "'" and ch == '`':
            start = i + 1
            j = start
            inner_quote = None
            inner_word = False
            while j < len(text):
                c = text[j]
                if c == "\\" and inner_quote != "'" and j + 1 < len(text) and text[j + 1] == '\n':
                    j += 2
                    continue
                if inner_quote is None and c == '#' and not inner_word:
                    while j < len(text) and text[j] != '\n':
                        j += 1
                    continue
                if c == '`' and inner_quote is None:
                    break
                if inner_quote is None and (c.isspace() or c in ';|&<>()'):
                    inner_word = False
                else:
                    inner_word = True
                if c == "\\" and inner_quote != "'":
                    j += 2
                    continue
                if c in "'\"" and (inner_quote is None or inner_quote == c):
                    inner_quote = None if inner_quote else c
                j += 1
            if j >= len(text):
                raise ValueError('unfinished substitution')
            result.append(text[start:j])
            i = j + 1
            continue
        i += 1
    return result
