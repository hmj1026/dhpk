"""Resolve the words a command spells with visible brace lists and parameters (#1427).

The shell builds a path word from brace lists (`.{e,}nv`), parameter expansions
(`$f`, `${x:-.env}`) and values assigned earlier in the same text. The guard
judges command text only (ADR 0037), so this module reads those visible sources
and nothing else: it never reads the environment or a file. A word whose source
is not visible stays as written; a word whose visible source cannot be
resolved is marked ambiguous (`unresolved` and `glob`) so a Reader that targets
it is blocked instead of silently allowed.

Resolution over-approximates: a variable assigned twice yields both values, and
`${x:+a}` yields both `a` and the empty word. Each combination is judged as its
own command, so any dangerous reading blocks.
"""

from dataclasses import replace
import itertools
import re

from credential_shell import Token, tokenize

MAX_ALTERNATIVES = 64
MAX_VALUES = 32
MAX_DEPTH = 4
ASSIGNMENT = re.compile(r'([A-Za-z_][A-Za-z0-9_]*)(\+?)=', re.S)
SEQUENCE = re.compile(r'(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$|([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?\d+))?$')
GLOB_CHARS = re.compile(r'[*?\[]')
# Private-use stand-ins keep quoted braces and expansions out of brace parsing.
QUOTED_BRACES = {'{': '\ue100', '}': '\ue101', ',': '\ue102'}
RESTORE = {ord(mark): char for char, mark in QUOTED_BRACES.items()}
EXPANSION_BASE = 0xE200
_UNKNOWN = object()
_KEEP = object()
_UNRESOLVED = object()


class _TooMany(Exception):
    """Raised when a word would expand to more alternatives than the cap."""


def expand_variants(tokens):
    """Return alternative token lists for `tokens`, or None when no word needs resolving."""
    if not any(token.parts for token in tokens if not token.operator):
        return None
    variables = _variables(tokens)
    alternatives = [[[token]] if token.operator else _alternatives(token, variables, False, 0) for token in tokens]
    _limit(alternatives, tokens)
    return [[word for part in combination for word in part] for combination in itertools.product(*alternatives)]


def _limit(alternatives, tokens):
    """Replace the widest words with an unresolved copy until the combinations fit the cap."""
    while True:
        total = 1
        for options in alternatives:
            total *= len(options)
        if total <= MAX_ALTERNATIVES:
            return
        widest = max(range(len(alternatives)), key=lambda index: len(alternatives[index]))
        alternatives[widest] = [[_unresolved(tokens[widest])]]


def _unresolved(token):
    """A copy of `token` that every Reader treats as an unknown target."""
    return replace(token, glob=True, dynamic=True, unresolved=True)


def _variables(tokens):
    """Values each name may hold, from assignments and `for` loops visible in `tokens`."""
    variables = {}
    index = 0
    while index < len(tokens):
        token = tokens[index]
        index += 1
        if token.operator:
            continue
        if token.value == 'for' and index + 1 < len(tokens) and tokens[index + 1].value == 'in' and not tokens[index].operator:
            name = tokens[index].value
            end = index + 2
            while end < len(tokens) and not tokens[end].operator:
                for word in _words(tokens[end], variables):
                    _remember(variables, name, False, word)
                end += 1
            index = end
            continue
        found = ASSIGNMENT.match(token.value)
        if not found:
            continue
        for combined in _joined(token, variables):
            _remember(variables, found.group(1), bool(found.group(2)), combined[found.end():])
    return variables


def _joined(token, variables):
    """Whole-word values of an assignment, resolved without splitting or brace lists."""
    out = []
    for words in _alternatives(token, variables, True, 0):
        out.append(''.join(word.value for word in words))
    return out


def _words(token, variables):
    return [word.value for words in _alternatives(token, variables, False, 0) for word in words]


def _remember(variables, name, append, value):
    current = variables.get(name)
    if current is _UNKNOWN:
        return
    values = [] if current is None else list(current)
    additions = [old + value for old in values] + [value] if append else [value]
    for item in additions:
        if item not in values:
            values.append(item)
    variables[name] = _UNKNOWN if len(values) > MAX_VALUES else values


def _alternatives(token, variables, assignment, depth):
    """Alternative word lists the shell could build from `token`."""
    if not token.parts:
        return [[token]]
    expansions = [part for part in token.parts if not isinstance(part, tuple)]
    values = [_values(part, variables, depth) for part in expansions]
    if any(value is _UNRESOLVED for value in values):
        return [[_unresolved(token)]]
    template = _template(token.parts, expansions)
    try:
        templates = [template] if assignment else _brace_expand(template)
        combos = list(_combinations(values))
    except _TooMany:
        return [[_unresolved(token)]]
    if all(value is _KEEP for value in values) and templates == [template]:
        return [[token]]
    seen, out = set(), []
    for text in templates:
        for combination in combos:
            words = _build(token, text, expansions, combination, assignment)
            key = tuple((word.value, word.glob, word.dynamic) for word in words)
            if key not in seen:
                seen.add(key)
                out.append(words)
    return out


def _combinations(values):
    total = 1
    for value in values:
        total *= 1 if value is _KEEP else len(value)
        if total > MAX_ALTERNATIVES:
            raise _TooMany
    return itertools.product(*[[_KEEP] if value is _KEEP else value for value in values])


def _template(parts, expansions):
    """The word as text where quoted braces and expansions are inert stand-ins."""
    out = []
    marks = {id(part): index for index, part in enumerate(expansions)}
    for part in parts:
        if isinstance(part, tuple):
            char, quoted = part
            out.append(QUOTED_BRACES.get(char, char) if quoted else char)
        else:
            out.append(chr(EXPANSION_BASE + marks[id(part)]))
    return ''.join(out)


def _build(token, template, expansions, combination, assignment):
    """Turn one filled-in template into words, splitting unquoted expansion values."""
    words, current, started, glob, dynamic = [], [], False, token.glob, False

    def close():
        nonlocal current, started, dynamic
        if started:
            words.append(Token(''.join(current).translate(RESTORE), glob, dynamic, substitution=token.substitution))
        current, started, dynamic = [], False, False

    for char in template:
        index = ord(char) - EXPANSION_BASE
        if not 0 <= index < len(expansions):
            current.append(char)
            started = True
            continue
        expansion, value = expansions[index], combination[index]
        if value is _KEEP:
            current.append(expansion.text)
            started = dynamic = True
        elif assignment or expansion.quoted:
            current.append(value)
            started = True
        else:
            glob = glob or bool(GLOB_CHARS.search(value))
            pieces = re.split(r'[ \t\n]+', value)
            for position, piece in enumerate(pieces):
                if position:
                    close()
                if piece:
                    current.append(piece)
                    started = True
    close()
    return words


def _values(expansion, variables, depth):
    """Candidate strings for one expansion, _KEEP when its source is not visible, or _UNRESOLVED."""
    known = variables.get(expansion.name)
    op = expansion.op
    if op == 'other':
        return _KEEP if known is None else _UNRESOLVED
    if known is _UNKNOWN:
        return _UNRESOLVED
    if not op:
        return _KEEP if known is None else known
    if op in (':?', '?'):
        return _KEEP if known is None else known
    given = _argument(expansion.arg, variables, depth + 1)
    if given is _UNRESOLVED:
        return _UNRESOLVED
    if op in (':+', '+'):
        return given + [''] if '' not in given else given
    return list(known or []) + [value for value in given if value not in (known or [])]


def _argument(arg, variables, depth):
    """Candidate strings for the default or alternative text of an expansion."""
    if not arg:
        return ['']
    if depth > MAX_DEPTH:
        return _UNRESOLVED
    try:
        words = [token for token in tokenize(arg) if not token.operator]
    except ValueError:
        return _UNRESOLVED
    if len(words) != 1:
        return [' '.join(token.value for token in words)]
    out = []
    for alternative in _alternatives(words[0], variables, False, depth):
        text = ' '.join(word.value for word in alternative)
        if any(word.unresolved for word in alternative):
            return _UNRESOLVED
        if text not in out:
            out.append(text)
    return out


def _brace_expand(template):
    """Expand `{a,b}` and `{1..3}` lists the way the shell does, up to the alternative cap."""
    results = _expand_first(template)
    if len(results) > MAX_ALTERNATIVES:
        raise _TooMany
    return results


def _expand_first(text):
    start = text.find('{')
    while start >= 0:
        end = _closing(text, start)
        if end < 0:
            return [text]
        items = _list_items(text[start + 1:end])
        if items is not None:
            results = []
            for item in items:
                results.extend(_expand_first(text[:start] + item + text[end + 1:]))
                if len(results) > MAX_ALTERNATIVES:
                    raise _TooMany
            return results
        start = text.find('{', start + 1)
    return [text]


def _closing(text, start):
    depth = 0
    for index in range(start, len(text)):
        if text[index] == '{':
            depth += 1
        elif text[index] == '}':
            depth -= 1
            if not depth:
                return index
    return -1


def _list_items(body):
    """Items of a brace body, or None when it is neither a comma list nor a sequence."""
    parts, depth, last = [], 0, 0
    for index, char in enumerate(body):
        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
        elif char == ',' and not depth:
            parts.append(body[last:index])
            last = index + 1
    if parts:
        return parts + [body[last:]]
    return _sequence(body)


def _sequence(body):
    found = SEQUENCE.match(body)
    if not found:
        return None
    if found.group(1) is not None:
        first, last, step = int(found.group(1)), int(found.group(2)), found.group(3)
        width = max(len(found.group(1)), len(found.group(2))) if any(
            re.match(r'-?0\d', bound) for bound in (found.group(1), found.group(2))) else 0
        convert = lambda number: str(number).zfill(width)
    else:
        first, last, step = ord(found.group(4)), ord(found.group(5)), found.group(6)
        convert = chr
    stride = abs(int(step)) or 1 if step else 1
    count = abs(last - first) // stride + 1
    if count > MAX_ALTERNATIVES:
        raise _TooMany
    direction = 1 if last >= first else -1
    return [convert(first + direction * stride * offset) for offset in range(count)]
