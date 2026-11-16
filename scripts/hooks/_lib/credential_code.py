"""Code strings a shell command runs, found in command text (#1450).

`eval`, a here-string fed to a shell, `bash -c`, a `trap` action, an alias that
rebinds a command, an arithmetic expression that evaluates a visible command
substitution, and a startup-file process substitution all run text the command
states. ADR 0037 keeps those inside the Text Guard Scope (interpreter code
strings such as `python3 -c` stay outside). This module only finds the strings;
`credential_policy` judges each one with the same `analyze`, so there is one
policy owner. Nothing here reads the environment or a file.
"""

import posixpath
import re
import shlex

from credential_expand import HEAD_KEEPERS, UNKNOWN_ARGUMENT, visible_values
from credential_find import find_spec
from credential_shell import ASSIGNMENT, tokenize, xargs_command

SHELLS = frozenset(('sh', 'bash', 'dash', 'zsh', 'ksh', 'ash', 'mksh', 'rbash', 'yash', 'posh'))
# Tokens that end a command segment; parentheses group, so they split too.
SPLIT = frozenset((';', '&&', '||', '|', '|&', '(', ')', ';;', '&', '&!'))
# Wrapper heads and the short options of each that take a value.
WRAPPERS = {
    'command': '', 'builtin': '', 'exec': '', 'nohup': '', 'time': '', 'setsid': '',
    'env': 'uCS', 'sudo': 'ugpChDRTrtU', 'doas': 'uC', 'nice': 'n', 'timeout': 'sk',
    'stdbuf': 'ioe', 'ionice': 'cnp', 'busybox': '', 'chroot': '',
}
SCRIPT_RUNNERS = SHELLS | {'source', '.'}
SHELL_VALUE_OPTIONS = frozenset(('--rcfile', '--init-file'))
STARTUP_WORDS = frozenset(('BASH_ENV=', 'ENV=', '--rcfile', '--init-file'))
ARITHMETIC_TESTS = frozenset(('-eq', '-ne', '-lt', '-le', '-gt', '-ge'))
INTEGER_DECLARERS = frozenset(('declare', 'typeset', 'local', 'integer'))
DATA_PRODUCERS = frozenset(('echo', 'printf'))
IDENTIFIER = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
REFERENCE = re.compile(r'\$\{?([A-Za-z_][A-Za-z0-9_]*)')
SUBSCRIPT = re.compile(r'\$\{[#!]?[A-Za-z_][A-Za-z0-9_]*\[([^\]]*)\]')
ASSIGNED_SUBSCRIPT = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*\[([^\]]*)\]\+?=')
BACKTICKS = re.compile(r'`([^`]*)`')
MAX_NAME_DEPTH = 4
MAX_ALIAS_STEPS = 4


def _segments(tokens):
    """Token lists between separators, each keeping its redirect operators."""
    segments, current = [], []
    for token in tokens:
        if token.operator and token.value in SPLIT:
            segments.append(current)
            current = []
        else:
            current.append(token)
    return segments + [current]


def _operands(tokens):
    """Words of a segment that are not a redirect target."""
    return [t for i, t in enumerate(tokens) if not t.operator and not (i and tokens[i - 1].operator)]


CHROOT_VALUE_OPTIONS = frozenset(('--userspec', '--groups'))


def command_head(words):
    """Index of the command a wrapper chain runs, or None."""
    i = 0
    while i < len(words):
        while i < len(words) and (ASSIGNMENT.match(words[i].value) or words[i].value in HEAD_KEEPERS):
            i += 1
        if i >= len(words):
            return None
        name = posixpath.basename(words[i].value)
        if name not in WRAPPERS:
            return i
        i += 1
        while i < len(words) and words[i].value.startswith('-') and len(words[i].value) > 1:
            option = words[i].value
            i += 1
            if option == '--':
                break
            if name == 'chroot' and option in CHROOT_VALUE_OPTIONS:
                i += 1
            if len(option) == 2 and option[1] in WRAPPERS[name]:
                i += 1
        if name in ('timeout', 'chroot'):
            i += 1
    return None


def _shell_code(operands):
    """The -c command string of a shell invocation and the words after it, or (None, [])."""
    runs_string = False
    i = 0
    while i < len(operands):
        word = operands[i].value
        i += 1
        if word == '--':
            break
        if word in SHELL_VALUE_OPTIONS:
            i += 1
        elif len(word) > 1 and word[0] in '-+' and not word.startswith('--'):
            runs_string = runs_string or 'c' in word
            if 'o' in word[1:] or 'O' in word[1:]:
                i += 1
        elif word.startswith('--'):
            continue
        else:
            return (word, operands[i:]) if runs_string else (None, [])
    return (operands[i].value, operands[i + 1:]) if runs_string and i < len(operands) else (None, [])


def _argument_text(word):
    """A word the text spells out, or the stand-in for one that a glob, a variable or a substitution decides."""
    unspelled = word.parts or word.glob or word.dynamic or word.substitution or word.unresolved
    return shlex.quote(UNKNOWN_ARGUMENT if unspelled else word.value)


def _positional_prefix(args):
    """(#1456) Bind $0 and the positional parameters a shell -c string receives from its words after the code."""
    if not args:
        return ''
    prefix = '0=%s; ' % _argument_text(args[0])
    return prefix + ('set -- %s; ' % ' '.join(_argument_text(a) for a in args[1:]) if len(args) > 1 else '')


SU_VALUE_OPTIONS = frozenset(('--shell', '--group', '--supp-group', '--whitelist-environment'))
# Each long command option with the shortest prefix getopt_long accepts for it.
COMMAND_LONG_OPTIONS = (('--command', 3), ('--session-command', 4))


def _find_strings(operands, head):
    """(#1460) The strings of every command a find `-exec` family action runs."""
    spec = find_spec(operands, head)
    return [s for clause in spec.clauses for s in _segment_strings(clause)] if spec else []


def _xargs_strings(operands, head):
    """(#1460) The strings of the command an xargs runs; an unparsed option falls back to every operand position after it."""
    found = xargs_command(operands, head)
    if found:
        return _segment_strings(found[0])
    later = operands[head + 1:]
    return [s for k in range(len(later)) for s in _segment_strings(later[k:])]


GETOPT_VALUE_LETTERS = {'su': 'sgGw', 'runuser': 'sgGwu', 'script': 'EIOBTmo'}
# `script -t[file]` takes only the rest of its own word.
GETOPT_OPTIONAL_LETTERS = {'script': 't'}


def _is_long_command(name):
    """True when `name` is a command long option or an unambiguous getopt_long prefix of one."""
    return any(len(name) >= least and option.startswith(name) for option, least in COMMAND_LONG_OPTIONS)


def _cluster_option(word, value_letters, optional_letters):
    """(runs a command, attached value, takes the next operand) for the first value-taking letter of a short cluster."""
    for k, letter in enumerate(word[1:], 2):
        if letter == 'c':
            return True, word[k:], not word[k:]
        if letter in optional_letters:
            return False, '', False
        if letter in value_letters:
            return False, '', not word[k:]
    return False, '', False


def _getopt_code(operands, value_letters, optional_letters=''):
    """(#1460) Every command string of a su-like invocation: each `-c` or long command option, since the last one runs."""
    found, i = [], 0
    while i < len(operands):
        word = operands[i].value
        i += 1
        name, equals, attached = word.partition('=')
        if word.startswith('--') and _is_long_command(name):
            found.append(attached if equals else operands[i].value if i < len(operands) else '')
            i += 0 if equals else 1
        elif word in SU_VALUE_OPTIONS:
            i += 1
        elif len(word) > 1 and word[0] == '-' and word[1] != '-':
            is_command, attached, takes_next = _cluster_option(word, value_letters, optional_letters)
            if is_command:
                found.append(attached or (operands[i].value if i < len(operands) else ''))
            i += 1 if takes_next else 0
    return [code for code in found if code]


def _sg_code(operands):
    """(#1460) `sg [-] group [-c] command`: the operand after the group."""
    words = [w.value for w in operands if w.value != '-']
    if len(words) > 1 and words[1] == '-c':
        return words[2] if len(words) > 2 else None
    return words[1] if len(words) > 1 else None


FLOCK_VALUE_OPTIONS = frozenset(('-w', '--wait', '--timeout', '-E', '--conflict-exit-code'))


def _flock_commands(operands):
    """The -c or --command strings among flock's operands, wherever they stand."""
    found, i = [], 0
    while i < len(operands):
        word = operands[i].value
        i += 1
        if word in FLOCK_VALUE_OPTIONS:
            i += 1
        elif word.startswith('--command='):
            found.append(word[len('--command='):])
        elif word == '--command' or (len(word) > 1 and word[0] == '-' and word[1] != '-' and word.endswith('c')):
            found.append(operands[i].value if i < len(operands) else '')
            i += 1
    return [code for code in found if code]


def _flock_code(operands):
    """(#1460) The strings a `flock` runs: its command option strings, or those of the command after the lock file."""
    found = _flock_commands(operands)
    if found:
        return found
    i = 0
    while i < len(operands) and operands[i].value.startswith('-') and len(operands[i].value) > 1:
        i += 2 if operands[i].value in FLOCK_VALUE_OPTIONS else 1
    rest = operands[i + 1:]
    return _segment_strings(rest[1:] if rest and rest[0].value == '--' else rest)


WATCH_VALUE_OPTIONS = frozenset(('-n', '--interval', '-q', '--equexit'))


def _watch_code(operands):
    i = 0
    while i < len(operands) and operands[i].value.startswith('-'):
        word = operands[i].value
        i += 1
        if word == '--':
            break
        if word in WATCH_VALUE_OPTIONS:
            i += 1
    return ' '.join(w.value for w in operands[i:]) or None


def _here_strings(tokens):
    """Words that follow a `<<<` operator (lexed as `<<` then `<`)."""
    return [tokens[i + 2].value for i in range(len(tokens) - 2)
            if tokens[i].operator and tokens[i].value == '<<'
            and tokens[i + 1].operator and tokens[i + 1].value == '<' and not tokens[i + 2].operator]


def _trap_action(operands):
    args = [w.value for w in operands]
    while args and args[0].startswith('-') and args[0] != '-':
        if args[0] in ('-p', '-l'):
            return None
        if args.pop(0) == '--':
            break
    return args[0] if args and args[0] not in ('-', '') else None


def _segment_strings(segment):
    """Code strings one segment runs directly."""
    operands = _operands(segment)
    head = command_head(operands)
    if head is None:
        return []
    name = posixpath.basename(operands[head].value)
    rest = operands[head + 1:]
    if name == 'eval':
        return [' '.join(w.value for w in rest)] if rest else []
    if name == 'trap':
        action = _trap_action(rest)
        return [action] if action else []
    if name == 'flock':
        return _flock_code(rest)
    if name == 'find':
        return _find_strings(operands, head)
    if name == 'xargs':
        return _xargs_strings(operands, head)
    if name == 'sg' or name in GETOPT_VALUE_LETTERS:
        if name != 'sg':
            return _getopt_code(rest, GETOPT_VALUE_LETTERS[name], GETOPT_OPTIONAL_LETTERS.get(name, ''))
        code = _sg_code(rest)
        return [code] if code else []
    if name == 'watch':
        code = _watch_code(rest)
        return [code] if code else []
    shell = name in SHELLS or operands[head].dynamic
    if name in SCRIPT_RUNNERS or shell:
        found = _here_strings(segment)
        code, args = _shell_code(rest) if shell else (None, [])
        return found + ([_positional_prefix(args) + code] if code is not None else [])
    return []


def _procsub_strings(tokens):
    """Text an `echo` or `printf` feeds a startup file or script through `<( )>`."""
    found = []
    for i in range(1, len(tokens) - 1):
        opener, previous = tokens[i + 1], tokens[i - 1]
        if not (tokens[i].operator and tokens[i].value == '<' and opener.operator and opener.value == '('):
            continue
        if previous.operator or not (previous.value in STARTUP_WORDS or posixpath.basename(previous.value) in SCRIPT_RUNNERS):
            continue
        depth, end = 0, i + 1
        while end < len(tokens):
            if tokens[end].operator and tokens[end].value == '(':
                depth += 1
            elif tokens[end].operator and tokens[end].value == ')':
                depth -= 1
                if not depth:
                    break
            end += 1
        for segment in _segments(tokens[i + 2:end]):
            operands = _operands(segment)
            head = command_head(operands)
            if head is None or posixpath.basename(operands[head].value) not in DATA_PRODUCERS:
                continue
            text = ' '.join(w.value for w in operands[head + 1:] if not w.value.startswith('-'))
            found.append(text.replace('\\n', '\n'))
    return found


def _substitutions(text):
    """Command texts of `$(...)` and backtick substitutions inside `text`; `$((` is arithmetic and is descended."""
    found = [m.group(1) for m in BACKTICKS.finditer(text)]
    start = text.find('$(')
    while start >= 0:
        depth, end = 0, start + 1
        while end < len(text):
            if text[end] == '(':
                depth += 1
            elif text[end] == ')':
                depth -= 1
                if not depth:
                    break
            end += 1
        inner = text[start + 2:end]
        if inner.startswith('('):
            found += _substitutions(inner[1:])
        else:
            found.append(inner)
        start = text.find('$(', start + 2)
    return found


def _commands_in(text, variables, seen=()):
    """Commands an arithmetic evaluation of `text` runs: its own substitutions and those of the names it evaluates."""
    found = _substitutions(text)
    if len(seen) >= MAX_NAME_DEPTH:
        return found
    for name in sorted(set(IDENTIFIER.findall(text)) - set(seen)):
        for value in variables.get(name, ()):
            found += _commands_in(value, variables, seen + (name,))
    return found


def _arithmetic_texts(tokens):
    """Expression texts the shell evaluates arithmetically: `(( ))`, `$(( ))`, `let`, `[[ -eq ]]`, integer variables, subscripts."""
    texts, integers = [], set()
    for i in range(len(tokens) - 1):
        if not (tokens[i].operator and tokens[i].value == '(' and tokens[i + 1].operator and tokens[i + 1].value == '('):
            continue
        depth, words = 0, []
        for token in tokens[i:]:
            if token.operator:
                depth += 1 if token.value == '(' else -1 if token.value == ')' else 0
                if not depth:
                    break
            else:
                words.append(token.value)
        texts.append(' '.join(words))
    for segment in _segments(tokens):
        operands = _operands(segment)
        head = command_head(operands)
        if head is None:
            continue
        name, rest = posixpath.basename(operands[head].value), [w.value for w in operands[head + 1:]]
        if name == 'let':
            texts.append(' '.join(rest))
        elif name == '[[' and ARITHMETIC_TESTS & set(rest):
            texts.append(' '.join(w for w in rest if w not in ARITHMETIC_TESTS and w != ']]'))
        elif name in INTEGER_DECLARERS and (name == 'integer' or any(w[:1] == '-' and 'i' in w for w in rest)):
            for word in (w for w in rest if w[:1] != '-'):
                integers.add(word.partition('=')[0])
                texts.append(word.partition('=')[2])
    for token in (t for t in tokens if not t.operator):
        texts += SUBSCRIPT.findall(token.value)
        found = ASSIGNED_SUBSCRIPT.match(token.value)
        texts += [found.group(1)] if found else []
        assigned = ASSIGNMENT.match(token.value)
        if assigned and token.value[:assigned.end() - 1].rstrip('+') in integers:
            texts.append(token.value[assigned.end():])
    return texts


def _with_assignments(code, variables):
    """`code` preceded by the visible assignments it references, so a nested analysis resolves `$name`."""
    names = [n for n in dict.fromkeys(REFERENCE.findall(code)) if n in variables]
    prefix = ''.join('%s=%s; ' % (n, shlex.quote(v)) for n in names for v in variables[n])
    return prefix + code


def code_strings(tokens):
    """Every command string `tokens` runs in this shell or a child shell, with visible assignments attached."""
    variables = visible_values(tokens)
    strings = []
    for segment in _segments(tokens):
        strings += [_with_assignments(code, variables) for code in _segment_strings(segment)]
    strings += [_with_assignments(code, variables) for code in _procsub_strings(tokens)]
    for text in _arithmetic_texts(tokens):
        strings += _commands_in(text, variables)
    return [s for s in dict.fromkeys(strings) if s.strip()]


def expand_aliases(tokens):
    """Tokens with each command-position word that an earlier `alias` rebinds replaced by its value (#1450)."""
    aliases, out, head, defining = {}, [], True, False
    for token in tokens:
        if token.operator:
            if token.value in SPLIT:
                head, defining = True, False
            out.append(token)
        elif head and token.value in aliases:
            out += _alias_tokens(token, aliases)
            head = False
        elif head and (ASSIGNMENT.match(token.value) or posixpath.basename(token.value) in ('command', 'builtin')):
            out.append(token)
        else:
            if defining and ASSIGNMENT.match(token.value):
                name, _, value = token.value.partition('=')
                aliases[name] = value
            defining = defining or (head and token.value == 'alias')
            head = False
            out.append(token)
    return out if aliases else tokens


def _alias_tokens(token, aliases):
    """Follow an alias chain up to a fixed number of steps; a name already used does not expand again."""
    replacement, seen = [token], set()
    for _ in range(MAX_ALIAS_STEPS):
        first = replacement[0]
        if first.operator or first.value not in aliases or first.value in seen:
            break
        seen.add(first.value)
        try:
            expanded = tokenize(aliases[first.value])
        except ValueError:
            break
        if not expanded:
            break
        replacement = expanded + replacement[1:]
    return replacement
