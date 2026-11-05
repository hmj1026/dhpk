"""Bounded shell lexer: words retain whether wildcard characters were unquoted."""

from dataclasses import dataclass
import re


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


def substitutions(text, heredoc=False):
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
        if not heredoc and quote is None and ch == '#' and not word_started:
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
            if (heredoc and text[i + 1] in '$`\\\n') or (not heredoc and (quote != '"' or text[i + 1] in '$`"\\\n')):
                i += 2
                continue
        # heredoc 未引用的內文引號是一般資料，不能讓它隱藏仍會執行的替換。
        if not heredoc and ch in "'\"" and (quote is None or quote == ch):
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
                if heredoc and c in "'\"":
                    raise ValueError('ambiguous heredoc backtick')
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


def heredocs(text):
    """Return shell text with complete simple heredoc bodies removed and active expansions."""
    # splitlines 會把 CR 與 Unicode 分隔符當成換行，可能把註解誤判為 heredoc；shell 只以 LF 分行。
    pieces = text.split('\n')
    lines = [piece + '\n' for piece in pieces[:-1]]
    if pieces[-1]:
        lines.append(pieces[-1])
    output = []
    active = []
    i = 0
    quote = None
    while i < len(lines):
        line = lines[i]
        op = None
        j = 0
        while j < len(line):
            ch = line[j]
            if ch == '\\' and quote != "'":
                j += 2
                continue
            if ch in "'\"" and (quote is None or quote == ch):
                quote = None if quote else ch
            # shell 運算子後也是新字詞起點；註解內的 << 不能遮住後續命令。
            elif quote is None and ch == '#' and (j == 0 or line[j - 1].isspace() or line[j - 1] in ';&|<>()'):
                break
            elif quote is None and line.startswith('<<', j):
                if line.startswith('<<<', j):
                    return text, []
                if op is not None:
                    raise ValueError('ambiguous heredoc')
                op = j
                j += 1
            j += 1
        output.append(line)
        i += 1
        if op is None:
            continue
        # 引號可以跨越實體行；未閉合時不能判定 heredoc 從哪一行開始。
        if quote is not None:
            raise ValueError('ambiguous heredoc declaration quote')
        if line.endswith('\\\n'):
            raise ValueError('ambiguous heredoc declaration continuation')
        # shell 本身可能執行標準輸入；保留內文，避免將實際指令誤認為惰性資料。
        # 先做 shell 引號移除，否則 'bash' 或 ba''sh 可繞過原始字串比對。
        header_tokens = tokenize(''.join(output))
        # 管線的接收端可能出現在 heredoc 結束之後，未解析完成前不得隱藏內文。
        header_end = header_tokens[:-1] if header_tokens and header_tokens[-1].operator and header_tokens[-1].value == ';' and line.endswith('\n') else header_tokens
        if header_end and header_end[-1].operator and header_end[-1].value in ('|', '|&', '&&', '||'):
            raise ValueError('ambiguous heredoc pipeline')
        if any(not token.operator and token.value.rsplit('/', 1)[-1] in
               ('sh', 'bash', 'dash', 'zsh', 'ksh', 'source', 'eval', '.')
               for token in header_tokens):
            return text, []
        # 僅遮罩能完整證明 delimiter 與結尾的格式；不明形式保留原文交由既有保守檢查。
        match = re.match(r'<<(-?)[ \t]*((?:[A-Za-z0-9_]+|\x27[A-Za-z0-9_]*\x27|"[A-Za-z0-9_]*"|\\[A-Za-z0-9_])+)(?=[ \t;|&<>\n]|$)', line[op:])
        if not match:
            raise ValueError('unsupported heredoc delimiter')
        word = match.group(2)
        delimiter = word.replace("'", '').replace('"', '').replace('\\', '')
        body = []
        while i < len(lines):
            candidate = lines[i].rstrip('\n')
            if match.group(1):
                candidate = candidate.lstrip('\t')
            if candidate == delimiter:
                i += 1
                break
            body.append(lines[i])
            if lines[i].endswith('\\\n'):
                raise ValueError('ambiguous heredoc continuation')
            i += 1
        else:
            raise ValueError('unterminated heredoc')
        if "'" not in word and '"' not in word and '\\' not in word:
            active.extend(substitutions(''.join(body), heredoc=True))
    return ''.join(output), active
