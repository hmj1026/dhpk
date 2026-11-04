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
            # Shell 的反斜線換行會先移除；保留換行會把敏感檔名切開而漏判。
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
