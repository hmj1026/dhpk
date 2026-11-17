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
# `0=value` binds $0 for the code string of `bash -c CODE ARG0 ...` (credential_code writes it as a prefix).
ZERO_ARGUMENT = re.compile(r'(0)(\+?)=', re.S)
# A word that stands for an argument the text does not spell out: the name it is bound to is unknown.
UNKNOWN_ARGUMENT = '\ue1ff'
SEQUENCE = re.compile(r'(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$|([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?\d+))?$')
NAME_WORD = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
GLOB_CHARS = re.compile(r'[*?\[]')
# Private-use stand-ins keep quoted braces and expansions out of brace parsing.
QUOTED_BRACES = {'{': '\ue100', '}': '\ue101', ',': '\ue102'}
RESTORE = {ord(mark): char for char, mark in QUOTED_BRACES.items()}
EXPANSION_BASE = 0xE200
_UNKNOWN = object()
_KEEP = object()
_UNRESOLVED = object()
# A name set by `read` or `printf -v`: its value is unseen, so a word that mixes it with literal text is blocked.
_OPAQUE = object()
# (#1462) Key in a copy of the variables: the positionals the text proves set, as {position: literal}.
_DEFINITE = object()
BT = chr(96)


class _TooMany(Exception):
    """Raised when a word would expand to more alternatives than the cap."""


def expand_variants(tokens):
    """Return alternative token lists for `tokens`, or None when no word needs resolving."""
    if not any(token.parts for token in tokens if not token.operator):
        return None
    variables = _variables(tokens)
    definite = _definite_positionals(tokens, function_names(tokens))
    proven = None if definite is None else {**variables, _DEFINITE: definite[2]}
    alternatives = [[[token]] if token.operator else _alternatives(token, _view(variables, proven, definite, index), False, 0)
                    for index, token in enumerate(tokens)]
    _limit(alternatives, tokens)
    return [[word for part in combination for word in part] for combination in itertools.product(*alternatives)]


def visible_values(tokens):
    """(#1450) Values each name may hold as plain strings; a name with too many values is left out."""
    return {name: list(values) for name, values in _variables(tokens).items() if values not in (_UNKNOWN, _OPAQUE)}


def _view(variables, proven, definite, index):
    """The variables a token at `index` sees: the copy that also carries the proven positionals inside their range."""
    if definite is None or not definite[0] <= index < definite[1]:
        return variables
    return proven


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
    """Values each name may hold, from assignments and for loops visible in tokens."""
    variables = {}
    functions = function_names(tokens)
    _seed_positional(tokens, functions, variables)
    refs = {}
    head, declaring, nameref, shifted, lost = True, False, False, False, False
    index = 0
    while index < len(tokens):
        token = tokens[index]
        index += 1
        if token.operator:
            if token.value in HEAD_OPERATORS:
                head, declaring, nameref = True, False, False
            continue
        at_head = head and token.value not in HEAD_KEEPERS and not ASSIGNMENT.match(token.value)
        if head and at_head:
            head = False
            if token.value == 'set':
                _remember_positional(variables, _set_arguments(tokens, index))
            elif token.value in functions:
                _remember_positional(variables, _words_until_operator(tokens, index))
            elif token.value == 'shift':
                shifted = True
                lost = lost or _shift_exceeds_tracking(tokens, index)
            elif token.value in ('declare', 'typeset', 'local'):
                declaring = True
        if declaring and token.value.startswith('-') and 'n' in token.value:
            nameref = True
        if token.value == 'for' and index + 1 < len(tokens) and tokens[index + 1].value == 'in' and not tokens[index].operator:
            name = tokens[index].value
            end = index + 2
            while end < len(tokens) and not tokens[end].operator:
                for word in _words(tokens[end], variables):
                    _remember(variables, name, False, word)
                end += 1
            index = end
            continue
        if token.value == 'for' and index + 1 < len(tokens) and not tokens[index].operator and tokens[index + 1].operator and tokens[index + 1].value == ';':
            _loop_over_positional(variables, tokens[index].value)
            continue
        if token.value == 'read' and _read_here_string(tokens, index, variables):
            continue
        if token.value in ('read', 'mapfile', 'readarray', 'getopts', 'printf'):
            _mark_opaque(tokens, index, variables)
        found = ASSIGNMENT.match(token.value) or ZERO_ARGUMENT.match(token.value)
        if not found:
            if nameref and NAME_WORD.fullmatch(token.value):
                refs.setdefault(token.value, [])
            continue
        if nameref or found.group(1) in refs:
            refs.setdefault(found.group(1), []).extend(v[found.end():] for v in _joined(token, variables))
            continue
        if token.substitution:
            if _substitution_is_split(tokens, index, token, found.end()):
                variables[found.group(1)] = _UNKNOWN  # text follows the substitution in the same word
                continue
            value = _substitution_value(token, found.end())
            if value is not None:
                _remember(variables, found.group(1), bool(found.group(2)), value)
            continue
        for combined in _joined(token, variables):
            _remember(variables, found.group(1), bool(found.group(2)), combined[found.end():])
    if shifted:
        _shift_positional(variables)
    if lost:
        _forget_positional(variables, POSITIONAL_LIMIT)
    _resolve_namerefs(variables, refs)
    return variables


HEAD_OPERATORS = (';', '&&', '||', '|', '|&', '&', ';;', '(', ')')
HEAD_KEEPERS = frozenset(('!', '{', '}', 'if', 'then', 'elif', 'else', 'while', 'until', 'do', 'done', 'fi', 'time', 'coproc'))
POSITIONAL_LIMIT = 9


def function_names(tokens):
    defined = set()
    for index, token in enumerate(tokens[:-1]):
        if token.operator:
            continue
        following = tokens[index + 1:index + 3]
        if token.value == 'function' and not following[0].operator:
            defined.add(following[0].value)
        elif len(following) == 2 and [(t.operator, t.value) for t in following] == [(True, '('), (True, ')')]:
            defined.add(token.value)
    return defined


LITERAL_FREE = ('{', '$', BT)
SCOPE_OPENERS = frozenset(('{', '(', 'if', 'while', 'until', 'for', 'case', 'select', 'then', 'do', 'elif', 'else'))


def _definite_positionals(tokens, functions):
    """(#1462) (start, end, {position: literal}) when the text proves what the positionals hold, else None.

    Proves only in a structurally narrow text: no redirection, substitution or here-doc, no `shift`, at most one
    function and no nested one, and one positional source (one `set --`, or one call of that function).
    The range is where the proven values hold.
    """
    definitions = _definition_count(tokens)
    if definitions > 1 or not _is_plain(tokens) or _rebinds_positionals(tokens) or _may_rebind(tokens):
        return None
    if _mentions(tokens, 'shift') or len(functions) != definitions:
        return None
    sources = [i for i in _head_indexes(tokens) if _is_source(tokens, i, functions)]
    if len(sources) != 1:
        return None
    at, sets = sources[0], _mentions(tokens, 'set')
    if tokens[at].value == 'set':
        return _definite_set(tokens, at) if sets == 1 and not definitions else None
    return _definite_call(tokens, at) if not sets else None


def _command_words(tokens, start=0):
    """Indexes of the words in command position, reserved words such as `{` and `}` included."""
    head = True
    for index in range(start, len(tokens)):
        token = tokens[index]
        if token.operator:
            head = head or token.value in HEAD_OPERATORS
        elif head:
            yield index
            head = token.value in HEAD_KEEPERS or bool(ASSIGNMENT.match(token.value))


def _head_indexes(tokens):
    return [i for i in _command_words(tokens) if tokens[i].value not in HEAD_KEEPERS and not ASSIGNMENT.match(tokens[i].value)]


def _is_source(tokens, index, functions):
    word = tokens[index].value
    if word == 'set':
        return True
    return word in functions and not _is_definition_head(tokens, index)


def _is_definition_head(tokens, index):
    following = tokens[index + 1:index + 3]
    return [(t.operator, t.value) for t in following] == [(True, '('), (True, ')')]


def _rebinds_positionals(tokens):
    """A `for name;` loop walks the positionals, so no position is proven."""
    for index, token in enumerate(tokens):
        if token.operator or token.value != 'for':
            continue
        if index + 2 < len(tokens) and not tokens[index + 1].operator and tokens[index + 2].operator and tokens[index + 2].value == ';':
            return True
    return False


PLAIN_OPERATORS = frozenset((';', '&&', '||', '|', '(', ')'))


def _is_plain(tokens):
    """No redirection, here-doc, process or command substitution anywhere: only list operators and `()` of a definition."""
    for token in tokens:
        if token.operator and token.value not in PLAIN_OPERATORS:
            return False
        if not token.operator and (token.substitution or '$(' in token.value or BT in token.value):
            return False
    return True


def _definition_count(tokens):
    """Number of `name()` definitions, or 2 (too many) when parentheses appear anywhere else."""
    heads = sum(1 for i, token in enumerate(tokens) if not token.operator and _is_definition_head(tokens, i))
    opens = sum(1 for token in tokens if token.operator and token.value == '(')
    closes = sum(1 for token in tokens if token.operator and token.value == ')')
    return heads if opens == closes == heads else 2


REBINDERS = frozenset(('eval', 'source', 'trap', 'alias', 'builtin', 'command', 'getopts', 'shopt', 'exec', 'enable'))
INTERPRETER = re.compile(r'(?:ba|da|z|k|a|c|tc)?sh|fish|python[0-9.]*|perl|ruby|node|php|lua|g?awk')


def _may_rebind(tokens):
    """True when the text has a way to rebind the positionals that this module does not model (#1462)."""
    words = [token for token in tokens if not token.operator]
    if any(word.value in REBINDERS or INTERPRETER.fullmatch(word.value.rsplit('/', 1)[-1]) for word in words):
        return True
    return any(_is_dynamic_head(tokens[i]) or tokens[i].value == '.' for i in _head_indexes(tokens))


def _is_dynamic_head(token):
    return bool(token.parts or token.dynamic or '$' in token.value or BT in token.value)


def _literal_positionals(words):
    """{position: value} when every word is a plain literal that fits the tracked positions, else None."""
    if len(words) > POSITIONAL_LIMIT:
        return None
    for word in words:
        if word.parts or word.glob or word.dynamic or word.substitution or any(mark in word.value for mark in LITERAL_FREE):
            return None
    return {str(position): word.value for position, word in enumerate(words, 1)}


def _definite_set(tokens, at):
    """A top-level `set -- WORDS;` followed by the rest of the text."""
    if at and not (tokens[at - 1].operator and tokens[at - 1].value == ';'):
        return None
    if any(token.value in SCOPE_OPENERS for token in tokens[:at]):
        return None
    words = _words_until_operator(tokens, at + 1)
    end = at + 1 + len(words)
    if not words or words[0].value != '--' or end >= len(tokens) or tokens[end].value != ';':
        return None
    values = _literal_positionals(words[1:])
    return None if values is None else (end + 1, len(tokens), values)


def _definite_call(tokens, at):
    """The one call of the one function, defined before it: the positionals hold within the function body."""
    name = tokens[at].value
    named = [i for i, token in enumerate(tokens) if not token.operator and token.value == name]
    if len(named) != 2 or _mentions(tokens, name) != 2 or named[1] != at:
        return None
    body = _function_body(tokens, named[0])
    words = _words_until_operator(tokens, at + 1)
    values = _literal_positionals(words)
    if body is None or values is None or at < body[1] or not _is_top_level_statement(tokens, at, at + 1 + len(words)):
        return None
    if any(token.value in SCOPE_OPENERS for token in tokens[:named[0]] + tokens[body[1] + 1:at]):
        return None
    return (body[0], body[1], values)


def _is_top_level_statement(tokens, at, end):
    """The command at `at` follows a `;` (or starts the text) and a `;` (or the end) follows its words."""
    starts = at == 0 or (tokens[at - 1].operator and tokens[at - 1].value == ';')
    return starts and (end >= len(tokens) or (tokens[end].operator and tokens[end].value == ';'))


def _mentions(tokens, name):
    """How often `name` appears as a whole word inside any token, quoted strings included."""
    pattern = re.compile(r'(?<!\w)' + re.escape(name) + r'(?!\w)')
    return sum(len(pattern.findall(token.value)) for token in tokens if not token.operator)


def _function_body(tokens, index):
    """(first, closing) token indexes of the `{ ... }` body of `name() { ... }` at `index`, or None.

    Only a `{` or `}` in command position is a reserved word; one inside a quoted word is not counted.
    """
    if not _is_definition_head(tokens, index) or index + 3 >= len(tokens) or tokens[index + 3].operator or tokens[index + 3].value != '{':
        return None
    depth = 0
    for end in _command_words(tokens, index + 3):
        depth += {'{': 1, '}': -1}.get(tokens[end].value, 0)
        if not depth:
            return (index + 4, end)
    return None


def _words_until_operator(tokens, index):
    out = []
    for token in tokens[index:]:
        if token.operator:
            break
        out.append(token)
    return out


def _set_arguments(tokens, index):
    words = _words_until_operator(tokens, index)
    values = [w.value for w in words]
    if '--' in values:
        return words[values.index('--') + 1:]
    i = 0
    while i < len(words) and words[i].value and words[i].value[0] in '-+' and words[i].value not in ('-', '+'):
        i += 2 if words[i].value in ('-o', '+o') else 1
    return words[i:]


def _seed_positional(tokens, functions, variables):
    """Literal arguments of every visible set and function call, so a body that copies $1 sees them."""
    head = True
    for index, token in enumerate(tokens):
        if token.operator:
            head = head or token.value in HEAD_OPERATORS
            continue
        if not head or token.value in HEAD_KEEPERS or ASSIGNMENT.match(token.value):
            continue
        head = False
        if token.value == 'set':
            words = _set_arguments(tokens, index + 1)
        elif token.value in functions:
            words = _words_until_operator(tokens, index + 1)
        else:
            continue
        _remember_positional(variables, [w for w in words if not w.parts])


def _positional_names(count):
    return [str(n) for n in range(1, max(count, POSITIONAL_LIMIT) + 1)] + ['@', '*']


def _forget_positional(variables, count):
    """Positionals set beyond what is tracked stay unknown, so a Reader that uses one is blocked."""
    for name in _positional_names(count):
        variables[name] = _UNKNOWN


def _shift_exceeds_tracking(tokens, index):
    """True when `shift N` has an N that is dynamic or beyond the positionals this module tracks."""
    if index >= len(tokens) or tokens[index].operator:
        return False
    amount = tokens[index]
    return bool(amount.parts) or not amount.value.isdigit() or int(amount.value) > POSITIONAL_LIMIT


def _loop_over_positional(variables, name):
    """`for name; do` walks "$@": the loop name holds each tracked positional value, or is unknown with them."""
    values = variables.get('@')
    if isinstance(values, list):
        for value in values:
            _remember(variables, name, False, value)
    elif values is not None:
        variables[name] = _UNKNOWN


def _remember_positional(variables, words):
    if len(words) > POSITIONAL_LIMIT:
        _forget_positional(variables, len(words))
        return
    for position, word in enumerate(words[:POSITIONAL_LIMIT], 1):
        for value in _words(word, variables):
            _remember(variables, str(position), False, value)
            _remember(variables, '@', False, value)
            _remember(variables, '*', False, value)
    for name in [str(n) for n in range(1, POSITIONAL_LIMIT + 1)] + ['@', '*']:
        if variables.get(name) not in (None, _UNKNOWN, _OPAQUE):
            _remember(variables, name, False, '')


def _shift_positional(variables):
    names = [str(n) for n in range(1, POSITIONAL_LIMIT + 1)]
    pool = []
    for name in names:
        current = variables.get(name)
        if isinstance(current, list):
            pool += current
    for name in names:
        for value in pool:
            _remember(variables, name, False, value)


def _resolve_namerefs(variables, refs):
    """Give each nameref the values of its targets; a chain deeper than MAX_DEPTH is unknown."""
    for _ in range(MAX_DEPTH):
        _resolve_nameref_pass(variables, refs)
    before = {name: _copy(variables.get(name)) for name in refs}
    _resolve_nameref_pass(variables, refs)
    for name in refs:
        if variables.get(name) != before[name]:
            variables[name] = _UNKNOWN
    for name, targets in refs.items():
        for target in targets:
            if NAME_WORD.fullmatch(target) and target != name and variables.get(target) is None:
                _remember(variables, name, False, target)  # the target holds nothing visible: keep its name


def _copy(value):
    return list(value) if isinstance(value, list) else value


def _resolve_nameref_pass(variables, refs):
    for name, targets in refs.items():
        for target in targets:
            if not NAME_WORD.fullmatch(target) or target == name:
                variables[name] = _UNKNOWN
                continue
            known = variables.get(target)
            if known is None:
                continue
            if not isinstance(known, list):
                variables[name] = known
                continue
            for value in known:
                _remember(variables, name, False, value)


def _substitution_is_split(tokens, index, token, start):
    """True when the assigned word may continue past its first substitution (`x=$(echo .en)v`)."""
    rest, text = token.value[start:], token.substitution
    if not text.startswith(rest):
        return False
    if text.startswith('$('):
        if index >= len(tokens) or not (tokens[index].operator and tokens[index].value == '('):
            return False
        depth = 0
        for end in range(index, len(tokens)):
            if tokens[end].operator and tokens[end].value in ('(', ')'):
                depth += 1 if tokens[end].value == '(' else -1
                if not depth:
                    return end + 1 < len(tokens) and not tokens[end + 1].operator
        return False
    joined = rest
    for end in range(index, len(tokens)):
        if joined == text or len(joined) > len(text) or tokens[end].operator:
            break
        joined += ' ' + tokens[end].value
    return joined != text


def _substitution_value(token, start):
    text = token.substitution
    rest = token.value[start:]
    if not rest or not text.startswith(rest):
        return None
    if text.startswith('$(') and text.endswith(')'):
        body = text[2:-1]
    elif text.startswith(BT) and text.endswith(BT):
        body = text[1:-1]
    else:
        return None
    try:
        words = tokenize(body)
    except ValueError:
        return None
    if not words or any(w.operator or w.dynamic or w.glob or w.parts or w.substitution for w in words):
        return None
    head, args = words[0].value, [w.value for w in words[1:]]
    if head == 'echo':
        while args and args[0] in ('-n', '-e', '-E'):
            args = args[1:]
        return ' '.join(args)
    if head == 'printf' and len(args) == 1 and '%' not in args[0] and chr(92) not in args[0]:
        return args[0]
    return None


def _read_here_string(tokens, index, variables):
    words, text = [], None
    i = index
    while i < len(tokens):
        t = tokens[i]
        if t.operator and t.value == '<<' and i + 2 < len(tokens) and tokens[i + 1].operator and tokens[i + 1].value == '<' and not tokens[i + 2].operator:
            text = tokens[i + 2]
            i += 3
            continue
        if t.operator:
            if t.value in HEAD_OPERATORS:
                break
            if t.value.startswith('<'):
                return False  # another input redirect decides what `read` sees
            i += 2
            continue
        words.append(t)
        i += 1
    if text is None or text.dynamic or text.parts or text.substitution:
        return False
    names, skip, raw = [], False, False
    for w in words:
        if skip:
            skip = False
        elif w.value in ('-a', '-d', '-u'):
            return False
        elif w.value in ('-n', '-N', '-p', '-t', '-i'):
            skip = True
        elif w.value.startswith('-'):
            if any(c in w.value for c in 'adu'):
                return False
            raw = raw or 'r' in w.value
        elif NAME_WORD.fullmatch(w.value):
            names.append(w.value)
    if chr(92) in text.value and not raw:
        return False  # without -r a backslash joins or escapes characters
    if not names:
        names = ['REPLY']
    separators = set(' \t\n')
    for value in (variables.get('IFS') if isinstance(variables.get('IFS'), list) else []):
        separators |= set(value)
    pieces = [p for p in re.split('[%s]' % re.escape(''.join(sorted(separators))), text.value) if p]
    for name in names:
        for value in pieces + [text.value]:
            _remember(variables, name, False, value)
    return True


def _mark_opaque(tokens, index, variables):
    """Names that `read`, `mapfile`, `getopts` or `printf -v` set from input the text does not show."""
    words = []
    for token in tokens[index:]:
        if token.operator:
            break
        words.append(token.value)
    if tokens[index - 1].value == 'printf':
        names = [words[i + 1] for i, word in enumerate(words[:-1]) if word == '-v']
    else:
        names = [word for word in words if NAME_WORD.fullmatch(word)]
    for name in names:
        if variables.get(name) is None:
            variables[name] = _OPAQUE


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
    if value == UNKNOWN_ARGUMENT:
        variables[name] = _UNKNOWN
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
    literal = any(isinstance(part, tuple) for part in token.parts)
    values = [_values(part, variables, depth, literal) for part in expansions]
    if any(value is _UNRESOLVED for value in values):
        return [[_unresolved(token)]]
    template = _template(token.parts, expansions)
    try:
        templates = [template] if assignment else _brace_expand(template)
        combos = list(_combinations(values))
    except _TooMany:
        return [[_unresolved(token)]]
    if all(value is _KEEP for value in values) and templates == [template]:
        return [[replace(token, residue=_residue(template, len(expansions)))]]
    seen, out = set(), []
    for text in templates:
        for combination in combos:
            words = _build(token, text, expansions, combination, assignment)
            key = tuple((word.value, word.glob, word.dynamic) for word in words)
            if key not in seen:
                seen.add(key)
                out.append(words)
    return out


def _residue(template, count):
    """(#1453) The template's literal text without its expansion stand-ins."""
    kept = {chr(EXPANSION_BASE + index) for index in range(count)}
    return ''.join(char for char in template if char not in kept).translate(RESTORE)


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
    literal, opaque = [], False

    def close():
        nonlocal current, started, dynamic, literal
        if started:
            words.append(Token(''.join(current).translate(RESTORE), glob, dynamic, substitution=token.substitution,
                               residue=''.join(literal).translate(RESTORE) if opaque else ''))
        current, started, dynamic, literal = [], False, False, []

    for char in template:
        index = ord(char) - EXPANSION_BASE
        if not 0 <= index < len(expansions):
            current.append(char)
            literal.append(char)
            started = True
            continue
        expansion, value = expansions[index], combination[index]
        if value is _KEEP:
            current.append(expansion.text)
            started = dynamic = opaque = True
        elif assignment or expansion.quoted:
            current.append(value)
            literal.append(value)
            started = True
        else:
            glob = glob or bool(GLOB_CHARS.search(value))
            pieces = re.split(r'[ \t\n]+', value)
            for position, piece in enumerate(pieces):
                if position:
                    close()
                if piece:
                    current.append(piece)
                    literal.append(piece)
                    started = True
    close()
    return words


def _values(expansion, variables, depth, literal=False):
    """Candidate strings for one expansion, _KEEP when its source is not visible, or _UNRESOLVED."""
    known = variables.get(expansion.name)
    op = expansion.op
    if expansion.name.startswith('!') and not op:
        indirect = _indirect(expansion.name[1:], variables)
        if indirect is not None:
            return indirect
    if isinstance(known, list) and op == 'other' and not expansion.name.startswith('!'):
        changed = [_transform(value, expansion.arg) for value in known]
        return _UNRESOLVED if any(v is None for v in changed) else list(dict.fromkeys(changed))
    if expansion.name.startswith('!') or known is _OPAQUE:
        # Indirect expansion and read/printf -v values are unseen; next to literal text they could spell anything.
        return _UNRESOLVED if literal else _KEEP
    if op == 'other':
        return _KEEP if known is None else _UNRESOLVED
    if known is _UNKNOWN:
        return _UNRESOLVED
    if not op:
        return _KEEP if known is None else known
    if op in (':?', '?'):
        return _KEEP if known is None else known
    proven = _proven_value(expansion, variables)
    if proven is not None:
        return [proven]
    given = _argument(expansion.arg, variables, depth + 1)
    if given is _UNRESOLVED:
        return _UNRESOLVED
    if op in (':+', '+'):
        return given + [''] if '' not in given else given
    return list(known or []) + [value for value in given if value not in (known or [])]


def _proven_value(expansion, variables):
    """(#1462) The value a default is not used for: the name is proven set (to a non-empty word for `:-`)."""
    proven = variables.get(_DEFINITE)
    if not proven or expansion.name not in proven:
        return None
    value = proven[expansion.name]
    if expansion.op in (':-', ':=') and value or expansion.op in ('-', '='):
        return value
    return None


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


def _indirect(name, variables):
    known = variables.get(name)
    if not isinstance(known, list) or not known:
        return None
    out = []
    for target in known:
        values = variables.get(target) if NAME_WORD.fullmatch(target) else None
        if not isinstance(values, list):
            return None
        out += [v for v in values if v not in out]
    return out or None


CASE_OPS = {',,': str.lower, '@L': str.lower, '^^': str.upper, '@U': str.upper, '~~': str.swapcase,
            ',': lambda v: v[:1].lower() + v[1:], '^': lambda v: v[:1].upper() + v[1:], '@u': lambda v: v[:1].upper() + v[1:],
            '~': lambda v: v[:1].swapcase() + v[1:]}


def _transform(value, rest):
    if rest in CASE_OPS:
        return CASE_OPS[rest](value)
    if rest in ('@P', '@E'):
        return None if set(value) & {chr(92), '$', BT} else value
    return None
