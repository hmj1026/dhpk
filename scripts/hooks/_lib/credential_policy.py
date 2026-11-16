"""Credential path and invocation policy, without reading target contents."""

import fnmatch
import dataclasses
import functools
import hashlib
import os
import posixpath
from pathlib import Path
import re
import stat
import sys

from credential_shell import ASSIGNMENT, EXEC_SHELLS, RESERVED_WORDS, Token, lex, xargs_command
from credential_expand import expand_variants
from credential_code import code_strings, expand_aliases
from credential_options import ADAPTERS, INERT_HEADS, READERS, WEAK_READERS, ReadPlan, exclusion_syntax
from credential_git import GIT_ADAPTER, RELOCATING_VARIABLES, exec_strings, git_pages
from credential_scan import MAX_SECONDS, budget_seconds
import time
from credential_scan import scan_roots
import credential_verdict as verdict

TEMPLATES = {'.env.example', '.env.sample', '.env.dist', '.env.template'}
DEFAULTS = ['.env', '.env.*', 'my.cnf', 'debian.cnf', '*.pem', 'id_rsa*', 'credentials*']
# Pin the dedicated extractor; a matching filename alone cannot grant access.
EXTRACTOR_SHA256 = 'd716d7ef383ee3c28e0680b077e3c203c213be026498045136a235be927339aa'


def validate_patterns(value):
    if not isinstance(value, list):
        raise ValueError('policy')
    for pattern in value:
        if not isinstance(pattern, str) or not pattern or '\x00' in pattern or '\n' in pattern or '[' in pattern or ']' in pattern or '\\' in pattern:
            raise ValueError('policy')
    return value


@functools.lru_cache(maxsize=8192)
def normalize_path(path):
    # normpath 保留雙前導斜線；政策要求重複分隔符合併後再比對本機與遠端字面路徑。
    return posixpath.normpath(re.sub('/+', '/', path))


def match_path(path, pattern, cwd=None):
    path = normalize_path(path)
    pattern = normalize_path(pattern)
    if pattern.startswith('/'):
        if not path.startswith('/'):
            if cwd is None:
                return True
            path = normalize_path(posixpath.join(cwd, path))
        candidate = path
    elif '/' not in pattern:
        candidate = posixpath.basename(path)
    else:
        path_parts = path.strip('/').split('/')
        pattern_parts = pattern.strip('/').split('/')
        if len(path_parts) < len(pattern_parts):
            return False
        candidate = '/'.join(path_parts[-len(pattern_parts):])
    return _pattern_expression(pattern).fullmatch(candidate) is not None


@functools.lru_cache(maxsize=256)
def _pattern_expression(pattern):
    # git 列舉可能有上千個路徑；同一規則只編譯一次。
    return re.compile(''.join('[^/]*' if c == '*' else '[^/]' if c == '?' else re.escape(c) for c in pattern))


def matching_patterns(path, patterns, cwd):
    name = posixpath.basename(normalize_path(path))
    # 共用同一政策比對結果，避免掃描診斷與既有 template 豁免產生分歧。
    defaults = [] if name in TEMPLATES else DEFAULTS
    return {p for p in defaults + patterns if match_path(path, p, cwd)}


def protected(path, patterns, cwd):
    return bool(matching_patterns(path, patterns, cwd))


def opaque_expansion_verdict(token, patterns, cwd):
    """(#1453) Ambiguous when the text left after removing an expansion without a visible source is a Protected Path.

    The variable's value is never invented; the word is blocked instead. None when the word is unaffected.
    """
    if token.residue and protected(token.residue, patterns, cwd):
        return verdict.ambiguous('target %s with a parameter expansion that has no visible source' % ascii(token.value),
                                 verdict.OPAQUE_EXPANSION)
    return None


def auxiliary_verdict(aux, patterns, cwd):
    """Judge one auxiliary input; None when its actual target is proved safe."""
    path, token = aux.value, aux.token
    if token.dynamic or token.glob:
        return verdict.ambiguous('auxiliary input %s' % ascii(token.value))
    # 未知 cwd 時，絕對路徑規則會比對任何相對路徑；先回報無法驗證，避免誤稱受保護。
    if cwd is None:
        return verdict.unsupported(None, 'auxiliary input needs a known working directory')
    if protected(path, patterns, cwd):
        return verdict.protected()
    try:
        # 連結後的 .. 必須由檔案系統解析；正規化僅供字面政策比對。
        physical = os.path.join(cwd, path)
        logical = os.path.abspath(physical)
        resolved = str(Path(physical).resolve(strict=True))
        info = os.stat(resolved)
        if protected(logical, patterns, cwd) or protected(resolved, patterns, cwd):
            return verdict.protected()
        if not stat.S_ISREG(info.st_mode) or not info.st_mode & 0o444 or not os.access(resolved, os.R_OK):
            return verdict.unsupported(None, 'auxiliary input is not a readable regular file')
    except (OSError, RuntimeError, ValueError):
        return verdict.unsupported(None, 'auxiliary input cannot be resolved')
    return None


def safe_extraction(tokens, remote):
    if remote or len(tokens) != 8 or any(t.operator or t.dynamic or t.glob for t in tokens):
        return False
    args = [t.value for t in tokens]
    helper = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'credential-extract.py'))
    if args[:5] != [os.path.realpath(sys.executable), '-I', '-S', helper, '--file'] or not os.path.isabs(args[5]) or args[6] != '--fields' or args[7] not in ('host', 'dbname', 'host,dbname'):
        return False
    try:
        info = os.lstat(helper)
        if not stat.S_ISREG(info.st_mode) or not EXTRACTOR_SHA256:
            return False
        with open(helper, 'rb') as source:
            return hashlib.sha256(source.read()).hexdigest() == EXTRACTOR_SHA256
    except OSError:
        return False


SEPARATORS = (';', '&&', '||', '|', '|&', '(', ')', ';;')


def judge(plan, patterns, cwd, wrapped):
    """Judge one Read Plan: auxiliary inputs, then targets, then recursion.

    `wrapped` is True when the Reader is not the segment's first word (for
    example `env rg`), so its root may not be the local working directory.
    """
    if plan.location_unknown:
        cwd = None
    recovery = plan.recovery
    for aux in plan.auxiliary_inputs:
        found = auxiliary_verdict(aux, patterns, cwd)
        if found is not None:
            return found
    for token in plan.targets:
        # 命令替換的輸出在執行前無法得知，可能就是受保護路徑。
        if token.substitution:
            return verdict.ambiguous('command substitution %s' % ascii(token.substitution),
                                     (recovery and recovery.ambiguous) or verdict.TARGET_SEARCH)
        if token.glob:
            return verdict.ambiguous('target %s' % ascii(token.value),
                                     (recovery and recovery.ambiguous) or verdict.TARGET_SEARCH)
        if protected(token.value, patterns, cwd):
            return verdict.protected()
        found = opaque_expansion_verdict(token, patterns, cwd)
        if found is not None:
            return found
    if plan.listing is not None:
        found = listing_verdict(plan, patterns, None if wrapped else cwd)
        if found is not None:
            return found
    if not plan.recursive:
        return verdict.allow()
    syntax = exclusion_syntax(plan.reader)
    # rg, tar and cp only escape recursive scope for explicit, known regular local files.
    if plan.reader in ('rg', 'tar', 'cp') and plan.targets and cwd is not None and not wrapped and not any(t.dynamic for t in plan.targets):
        try:
            if all(stat.S_ISREG(os.lstat(os.path.join(cwd, t.value)).st_mode) for t in plan.targets):
                return verdict.allow()
        except OSError:
            pass
    effective = DEFAULTS + patterns
    # 排除帶斜線時可能只作用於單一目錄，不能證明覆蓋任意深度的自訂規則。
    covered = {p for p in effective if any('/' not in ex and (ex == '*' or ex == posixpath.basename(p)) for ex in plan.exclusions)}
    if plan.exclusion_proof_valid and len(covered) == len(set(effective)):
        return verdict.allow()
    # 包裝器、動態根路徑或未知 cwd 可能指向其他檔案系統，不能用本機掃描推論。
    if cwd is None or wrapped or any(t.dynamic for t in plan.targets):
        return verdict.recursive_unproven(syntax, '', recovery and recovery.recursive)
    unresolved = set(effective) - covered if plan.exclusion_proof_valid else set(effective)
    roots = [os.path.join(cwd, t.value) for t in plan.targets] if plan.targets else [cwd]
    failure, hits, paths = scan_roots(roots, lambda path: matching_patterns(path, patterns, cwd), unresolved, plan.follow)
    if not failure and not hits:
        return verdict.allow()
    details = [failure] if failure else []
    if hits:
        details.append('patterns ' + ', '.join(ascii(p) for p in sorted(hits)))
    if paths:
        details.append('paths ' + ', '.join(ascii(p) for p in paths))
    return verdict.recursive_unproven(syntax, '; '.join(details), recovery and recovery.recursive)


def _hit_details(hits, paths):
    details = []
    if hits:
        details.append('patterns ' + ', '.join(ascii(p) for p in sorted(hits)))
    if paths:
        details.append('paths ' + ', '.join(ascii(p) for p in paths))
    return details


def listing_verdict(plan, patterns, cwd):
    """Judge a Reader's listing (ADR 0034): literal targets, then every listed path.

    None means the listing proves no Protected Path; the caller continues.
    """
    recovery = plan.recovery
    result = plan.listing.resolve(cwd, time.monotonic() + budget_seconds(default=MAX_SECONDS))
    for path in result.targets:
        if protected(path, patterns, cwd):
            return verdict.protected()
    if result.ambiguous:
        return verdict.ambiguous(result.ambiguous, recovery and recovery.ambiguous)
    if result.failure in ('unknown', 'limit'):
        return verdict.recursive_unproven(None, result.detail, recovery and recovery.recursive)
    if result.failure == 'unsupported':
        return verdict.unsupported(None, result.detail)
    if result.failure is not None:
        return verdict.inspection_failure(result.detail)
    hits, paths = set(), []
    for path in result.listed:
        found = matching_patterns(path, patterns, cwd)
        if found:
            hits.update(found)
            if path not in paths and len(paths) < 3:
                paths.append(path)
    if hits:
        return verdict.recursive_unproven(None, '; '.join(_hit_details(hits, paths)), recovery and recovery.recursive)
    return None


def _invokes_reader(names, i):
    """A Reader word is an invocation, except a weak name such as `tar` after an information-only head."""
    if names[i] not in READERS:
        return False
    return i == 0 or names[i] not in WEAK_READERS or names[0] not in INERT_HEADS


# (#1430) Execution entrances run a file as shell code rather than reading it for display, so they are
# judged by their own rules and never planned as Readers. Startup-file variables may reuse the same
# executed_file_verdict for the file they name.
EXECUTION_ENTRANCES = ('source', '.')
ENTRANCE_PREFIXES = {'!', '{', 'time', 'if', 'then', 'elif', 'else', 'do', 'while', 'until', 'command', 'builtin'}
ASSIGNMENT = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*\+?=')


def _is_redirect(token):
    return token.operator and token.value not in SEPARATORS and token.value not in ('&', '&!')


def _entrance_index(tokens):
    """Index of a source/dot word in command position, else None; redirects and prefixes are skipped."""
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token.operator:
            i += 2 if _is_redirect(token) else 1
            continue
        nxt = tokens[i + 1] if i + 1 < len(tokens) else None
        if token.value.isdigit() and nxt is not None and _is_redirect(nxt):
            i += 1
            continue
        if token.value in EXECUTION_ENTRANCES:
            return i
        if token.value in ENTRANCE_PREFIXES or ASSIGNMENT.match(token.value):
            i += 1
            continue
        return None
    return None


def _entrance_operands(tokens):
    """Words after the entrance up to the next control operator, without redirect operands."""
    operands, i = [], 0
    while i < len(tokens):
        if tokens[i].operator:
            if not _is_redirect(tokens[i]):
                break
            i += 2
            continue
        operands.append(tokens[i])
        i += 1
    return operands


def executed_file_verdict(token, patterns, cwd):
    """Judge the file an execution entrance runs by its visible name only; its content is never read."""
    if token.substitution or token.glob:
        return verdict.ambiguous('execution entrance operand %s' % ascii(token.substitution or token.value),
                                 'name the script to run as an explicit literal path without wildcards or command substitutions; '
                                 'a Protected Path cannot be executed through source or a dot.')
    if protected(token.value, patterns, cwd):
        return verdict.protected('execution entrance operand')
    return opaque_expansion_verdict(token, patterns, cwd) or verdict.allow()


def _background_parts(tokens):
    """Split on `&`: each part starts a new command position."""
    parts, current = [], []
    for token in tokens:
        if token.operator and token.value in ('&', '&!'):
            parts.append(current)
            current = []
        else:
            current.append(token)
    return parts + [current]


def _entrance_part_verdict(tokens, patterns, cwd):
    index = _entrance_index(tokens)
    if index is None:
        return None
    operands = _entrance_operands(tokens[index + 1:])
    if operands and operands[0].value == '--':
        operands = operands[1:]
    if not operands:
        return verdict.allow()
    first = operands[0]
    if first.value.startswith('-') and first.value != '-':
        return verdict.unsupported(None, 'execution entrance option %s' % ascii(first.value))
    return executed_file_verdict(first, patterns, cwd)


def script_entrance_verdict(tokens, patterns, cwd):
    """Judge every source or dot in a segment; None when the segment has no execution entrance."""
    found = None
    for part in _background_parts(tokens):
        result = _entrance_part_verdict(part, patterns, cwd)
        if result is not None and not result.allowed:
            return result
        found = found or result
    return found


# (#1451) A shell startup file is run as shell code, so the variables and options that name one are execution
# entrances too: the file they name is judged by executed_file_verdict, never read.
STARTUP_VARIABLES = re.compile(r'^(BASH_ENV|ENV)=(.*)$', re.S)
STARTUP_OPTIONS = ('--rcfile', '--init-file')
STARTUP_SHELLS = ('bash', 'sh', 'dash', 'ash', 'ksh', 'zsh', 'rbash')
ASSIGNMENT_CARRIERS = ('export', 'env', 'declare', 'typeset', 'readonly', 'local')
SHELL_VALUE_OPTIONS = ('-o', '+o', '-O', '+O')
# Commands whose operands are data: a shell named after them is text, not an invocation.
DATA_HEADS = ('echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'cat', 'ls')


def _plain_words(tokens):
    """Words of one command part without redirect operators and their targets."""
    words, i = [], 0
    while i < len(tokens):
        if tokens[i].operator:
            i += 2 if _is_redirect(tokens[i]) else 1
            continue
        words.append(tokens[i])
        i += 1
    return words


def _startup_assignment_verdict(words, patterns, cwd):
    """BASH_ENV= or ENV= in a prefix assignment, or after export, env and declaration builtins."""
    carried = False
    for word in words:
        name = posixpath.basename(word.value)
        match = STARTUP_VARIABLES.match(word.value)
        if match and match.group(2):
            found = executed_file_verdict(dataclasses.replace(word, value=match.group(2), parts=None, residue=word.residue[len(match.group(1)) + 1:]), patterns, cwd)
            if not found.allowed:
                return found
        if name in ASSIGNMENT_CARRIERS:
            carried = True
        elif not (carried or ASSIGNMENT.match(word.value) or name in ENTRANCE_PREFIXES):
            return None
    return None


def _startup_option_verdict(words, patterns, cwd):
    """--rcfile FILE and --init-file FILE among the options of a shell; the first operand ends the options."""
    head = next((w for w in words if not (ASSIGNMENT.match(w.value) or w.value in ENTRANCE_PREFIXES)), None)
    if head is None or posixpath.basename(head.value) in DATA_HEADS:
        return None
    shell = next((i for i, w in enumerate(words) if posixpath.basename(w.value) in STARTUP_SHELLS), None)
    if shell is None:
        return None
    i = shell + 1
    while i < len(words) and words[i].value.startswith(('-', '+')) and words[i].value not in ('-', '--'):
        option = words[i].value
        if option in STARTUP_OPTIONS and i + 1 < len(words):
            found = executed_file_verdict(words[i + 1], patterns, cwd)
            if not found.allowed:
                return found
            i += 2
        elif option in SHELL_VALUE_OPTIONS or option in STARTUP_OPTIONS:
            i += 2
        else:
            i += 1
    return None


def startup_file_verdict(tokens, patterns, cwd):
    """Judge startup files named in a segment; None when it names none."""
    for part in _background_parts(tokens):
        words = _plain_words(part)
        for check in (_startup_assignment_verdict, _startup_option_verdict):
            found = check(words, patterns, cwd)
            if found is not None:
                return found
    return None


def segment_verdict(tokens, patterns, cwd, git_relocated=False):
    """Judge one command segment between separators."""
    words = [t for t in tokens if not t.operator]
    if not words:
        return verdict.allow()
    names = [posixpath.basename(t.value) for t in words]
    # Redirects open the target before any command runs, including metadata commands.
    for i, token in enumerate(tokens[:-1]):
        if token.operator and token.value in ('<', '<>'):
            target = tokens[i + 1]
            if target.glob:
                return verdict.ambiguous('input redirect %s' % ascii(target.value))
            if protected(target.value, patterns, cwd):
                return verdict.protected()
            found = opaque_expansion_verdict(target, patterns, cwd)
            if found is not None:
                return found
    if any(name.endswith('credential-extract.py') for name in names):
        return verdict.protected()
    entrance = script_entrance_verdict(tokens, patterns, cwd)
    if entrance is not None and not entrance.allowed:
        return entrance
    startup = startup_file_verdict(tokens, patterns, cwd)
    if startup is not None:
        return startup
    found = exec_entrance_verdict(words, names, patterns, cwd)
    if found is not None:
        return found
    # Known readers in wrappers are still inspected; a wrapper never grants an exception.
    index = next((i for i, name in enumerate(names) if _invokes_reader(names, i) or name == 'ssh'), None)
    git_index = next((i for i, name in enumerate(names) if name == 'git'), None)
    if git_index is not None and (index is None or git_index < index):
        plan = GIT_ADAPTER.plan(words[git_index + 1:], words[:git_index], git_relocated)
        # 不是 git 讀取時仍要判定後面的 Reader：`git bisect run cat .env`、`git submodule foreach`
        # 與 `sudo -u git cat .env` 都會執行後面的指令。
        if plan is not None:
            if not isinstance(plan, ReadPlan):
                return verdict.unsupported(None, plan.detail)
            return judge(plan, patterns, cwd, git_index != 0)
    if index is None:
        return verdict.allow()
    if names[index] == 'ssh':
        return remote_wrapper_verdict(words[index + 1:], patterns, cwd)
    adapter = ADAPTERS[names[index]]
    plan = adapter.plan(words[index + 1:])
    if not isinstance(plan, ReadPlan):
        return verdict.unsupported(adapter.exclusion_syntax, plan.detail)
    return judge(plan, patterns, cwd, index != 0)


SSH_COMMAND_VARIABLE = 'GIT_SSH_COMMAND='
# (#1454) GIT_SSH names a program; GIT_PAGER and PAGER name a command line run only when git pages.
PROGRAM_VARIABLE = re.compile(r'^GIT_SSH=(.*)$', re.S)
PAGER_VARIABLE = re.compile(r'^(?:GIT_PAGER|PAGER)=(.*)$', re.S)


def _program_verdict(value, patterns, cwd):
    """(#1454) GIT_SSH=<program>: the path is judged by name, a visible command line is judged as text."""
    if not value.strip():
        return verdict.allow()
    found = executed_file_verdict(Token(value), patterns, cwd)
    if not found.allowed:
        return found
    return analyze(value, patterns, None, True)


def _pager_runs(words, names):
    """(#1454) A pager variable matters when git will page, or when the variable is only being exported."""
    git_index = next((i for i, name in enumerate(names) if name == 'git'), None)
    if git_index is not None:
        return git_pages(words[git_index + 1:])
    return all(ASSIGNMENT.match(w.value) or name in ASSIGNMENT_CARRIERS or w.value.startswith('-')
               for w, name in zip(words, names))


def _variable_commands(words, names, patterns, cwd):
    """(#1454) Verdict for GIT_SSH, GIT_PAGER and PAGER assignments in one segment; None when all are fine."""
    for word in words:
        program = PROGRAM_VARIABLE.match(word.value)
        if program:
            found = _program_verdict(program.group(1), patterns, cwd)
            if not found.allowed:
                return found
        pager = PAGER_VARIABLE.match(word.value)
        if pager and pager.group(1).strip() and _pager_runs(words, names):
            found = analyze(pager.group(1), patterns, None, True)
            if not found.allowed:
                return found
    return None


def exec_entrance_verdict(words, names, patterns, cwd=None):
    """(#1431) Judge command strings Git or its SSH variable will execute; None when the segment has none.

    The string runs in a directory this text does not know, so it is judged like a Remote Wrapper command.
    """
    found = _variable_commands(words, names, patterns, cwd)
    if found is not None:
        return found
    commands = [w.value[len(SSH_COMMAND_VARIABLE):] for w in words if w.value.startswith(SSH_COMMAND_VARIABLE)]
    git_index = next((i for i, name in enumerate(names) if name == 'git'), None)
    reader_index = next((i for i, name in enumerate(names) if _invokes_reader(names, i) or name == 'ssh'), None)
    if git_index is not None and (reader_index is None or git_index < reader_index):
        commands += exec_strings(words[git_index + 1:])
    for command in commands:
        found = analyze(command, patterns, None, True) if command.strip() else verdict.allow()
        if not found.allowed:
            return found
    return None


CODE_DEPTH_LIMIT = 6
_code_depth = [0]


def code_string_verdict(tokens, patterns, cwd, remote, checked):
    """(#1450) Judge every command string the text runs through eval, a shell, trap, an alias or arithmetic.

    Each string goes through `analyze` again, so a string follows the same policy as the same text typed directly.
    """
    for command in code_strings(tokens):
        if command in checked:
            continue
        checked.add(command)
        if _code_depth[0] >= CODE_DEPTH_LIMIT:
            return verdict.ambiguous('shell code string nesting', 'run each nested shell code string as its own command, '
                                     'or write the command directly instead of nesting it more than %d levels.' % CODE_DEPTH_LIMIT)
        _code_depth[0] += 1
        try:
            found = analyze(command, patterns, cwd, remote, True)
        finally:
            _code_depth[0] -= 1
        if not found.allowed:
            return found
    return verdict.allow()


PROXY_COMMAND = re.compile(r'^\s*proxycommand(?:\s*=\s*|\s+)(.*)$', re.I | re.S)


def _proxy_command(setting):
    """(#1454) The command an `-o ProxyCommand` setting runs, or None for another setting."""
    match = PROXY_COMMAND.match(setting)
    return match.group(1) if match else None


def proxy_command_verdict(command, patterns):
    """(#1454) A ProxyCommand runs through a shell in a directory this text does not know."""
    if not command.strip():
        return verdict.allow()
    return analyze(command, patterns, None, True)


SSH_VALUE_LETTERS = 'BbcDEeFIiJLlmOopQRSWw'


def _ssh_option_verdict(token, value, letter, patterns, cwd):
    """(#1454) `-o ProxyCommand` runs its command; `-F` and `-J` name a config or jump target, judged by name only."""
    if letter == 'o':
        command = _proxy_command(value)
        return proxy_command_verdict(command, patterns) if command is not None else verdict.allow()
    if letter in 'FJ' and value:
        return executed_file_verdict(dataclasses.replace(token, value=value, parts=None), patterns, cwd)
    return verdict.allow()


def _ssh_options(args, patterns, cwd):
    """(#1454) Walk ssh short-option clusters (`-vo`, `-4oProxyCommand=..`); (index after the options, verdict)."""
    i = 0
    while i < len(args):
        arg = args[i].value
        if arg == '--':
            return i + 1, verdict.allow()
        if not arg.startswith('-') or arg == '-':
            break
        for position, letter in enumerate(arg[1:], 1):
            if letter not in SSH_VALUE_LETTERS:
                continue
            attached = arg[position + 1:]
            if attached:
                value, token = attached, args[i]
            elif i + 1 < len(args):
                i += 1
                value, token = args[i].value, args[i]
            else:
                value, token = '', args[i]
            found = _ssh_option_verdict(token, value, letter, patterns, cwd)
            if not found.allowed:
                return i, found
            break
        i += 1
    return i, verdict.allow()


def remote_wrapper_verdict(args, patterns, cwd=None):
    """`ssh` is a Remote Wrapper: its command is judged with no local knowledge."""
    i, found = _ssh_options(args, patterns, cwd)
    if not found.allowed:
        return found
    i += 1  # host
    if i >= len(args):
        return verdict.allow()
    unknown = next((t for t in args[i:] if t.dynamic or t.glob), None)
    if unknown is not None:
        return verdict.ambiguous('remote operand %s' % ascii(unknown.value),
                                 'name each remote operand as an explicit literal path or value without wildcards or shell expansions.')
    return analyze(' '.join(t.value for t in args[i:]), patterns, None, True)


# (#1432) command a trusted `$(...)` shortcut runs; a visible function of that name voids the shortcut.
SHORTCUT_COMMANDS = {'pwd': 'pwd', 'git rev-parse --show-toplevel': 'git'}
SHORTCUT_TEXT = re.compile(r'\$\(\s*(pwd|git rev-parse --show-toplevel)\s*\)')


def shadowed_commands(tokens):
    """Names a shortcut relies on that the visible text redefines as a function."""
    defined = set()
    for index, token in enumerate(tokens[:-1]):
        if token.operator:
            continue
        following = tokens[index + 1:index + 3]
        if token.value == 'function' and not following[0].operator:
            defined.add(following[0].value)
        elif len(following) == 2 and [(t.operator, t.value) for t in following] == [(True, '('), (True, ')')]:
            defined.add(token.value)
    return defined & set(SHORTCUT_COMMANDS.values())


def distrust_shadowed(tokens, shadowed):
    """Turn a `$(pwd)` or `$(git rev-parse --show-toplevel)` word whose command is shadowed into a substitution."""
    if not shadowed:
        return tokens
    result = []
    for token in tokens:
        found = None if token.operator or token.substitution or not token.dynamic else next(
            (m for m in SHORTCUT_TEXT.finditer(token.value) if SHORTCUT_COMMANDS[m.group(1)] in shadowed), None)
        result.append(dataclasses.replace(token, substitution=found.group()) if found else token)
    return result


def analyze(command, patterns, cwd, remote=False, nested=False, executed=False, shadowed=frozenset()):
    """Return the Credential Verdict for one agent command."""
    try:
        # 一次詞法分析取得字詞、命令替換與 heredoc 展開，三者共用同一個引號狀態機。
        lexed = lex(command, executed)
    except ValueError as error:
        # scanner 以固定字串拒絕有歧義的 shell 語法；這是語法不支援，不是檢查失敗。
        return verdict.unsupported(None, 'shell syntax: %s' % error)
    # 同一段文字可見的函式若重新定義 pwd 或 git，受信任的替換捷徑就不再可信（#1432）。
    shadowed = shadowed | shadowed_commands(lexed.tokens)
    tokens, bodies = distrust_shadowed(lexed.tokens, shadowed), lexed.bodies
    # 原始字串會漏掉引號或跳脫後的 cd，也會誤判 heredoc 資料；先以正規化 token 判斷範圍。
    command_head = True
    for token in tokens:
        if token.operator:
            if token.value in SEPARATORS:
                command_head = True
            continue
        name = posixpath.basename(token.value)
        if name == 'cd' or (command_head and (token.dynamic or name in ('pushd', 'popd', 'source', 'eval', '.'))):
            cwd = None
        if command_head and (name in ('command', 'builtin') or re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', token.value)):
            continue
        command_head = False
    if remote:
        cwd = None
    for body in bodies:
        found = analyze(body, patterns, cwd, remote, True, lexed.executed, shadowed)
        if not found.allowed:
            return found
    for body in lexed.executed_bodies:
        found = analyze(body, patterns, cwd, remote, True, True, shadowed)
        if not found.allowed:
            return found
    if not nested and safe_extraction(tokens, remote):
        return verdict.allow()
    # 任何一段（例如先前的 `export GIT_DIR=…`）設定了搬移 repository 的 GIT_* 變數，
    # 後面的 git 讀取就無法用本機列舉證明，比照 cd 的不確定規則。
    git_relocated = any(not t.operator and (RELOCATING_VARIABLES.match(t.value) or RELOCATING_VARIABLES.match(t.value + '='))
                        for t in tokens)
    # 同一段文字可見的大括號、參數預設值與先前指派，先解成可能的詞再逐一判斷（#1427）。
    checked = set()
    for variant in expand_variants(tokens) or [tokens]:
        # 先套用可見的 alias 改綁，再判斷 eval 等價的程式碼字串與各段讀取（#1450）。
        variant = expand_aliases(variant)
        found = code_string_verdict(variant, patterns, cwd, remote, checked)
        if found.allowed:
            found = _judge_segments(variant, patterns, cwd, git_relocated)
        if not found.allowed:
            return found
    return verdict.allow()


PIPES = ('|', '|&')
# 由指令文字直接印出檔名的指令；其輸出經管線成為 xargs 的運算元（#1433）。
TEXT_PRODUCERS = ('echo', 'printf')
XARGS_WRAPPERS = ('env', 'command', 'builtin', 'nice', 'nohup', 'time', 'stdbuf', 'timeout', 'sudo', 'doas', 'exec')
STDIN_RECOVERY = 'name each file as an explicit literal operand of the Reader instead of piping paths into xargs.'
STDIN_SHELL_RECOVERY = ('pass explicit non-protected files to a Reader command instead of piping paths into '
                        'xargs with a shell.')


def _join_pipelines(tokens):
    """Drop the newline separators next to a pipe so a pipeline split over lines reads like one line.

    `a |` followed by a newline continues the pipeline; a newline before `|`
    is a shell syntax error, so reading it as a pipe only keeps both layouts
    on the same verdict.
    """
    def pipe(token):
        return token.operator and token.value in PIPES

    def newline(token):
        return token.operator and token.value == ';'

    count = len(tokens)
    # nearest non-newline token on each side of every position, computed in one pass each
    before, after = [None] * count, [None] * count
    last = None
    for index, token in enumerate(tokens):
        before[index] = last
        if not newline(token):
            last = token
    last = None
    for index in range(count - 1, -1, -1):
        after[index] = last
        if not newline(tokens[index]):
            last = tokens[index]
    return [token for index, token in enumerate(tokens)
            if not (newline(token) and ((before[index] is not None and pipe(before[index]))
                                        or (after[index] is not None and pipe(after[index]))))]


def _text_words(token):
    """The words xargs would read from one printed word; the flags of a glob or substitution stay on every piece."""
    pieces = [piece.strip('\'"') for piece in re.split(r'\s+|\\n', token.value) if piece and '%' not in piece]
    return [dataclasses.replace(token, value=piece) for piece in pieces if piece]


def _produced_words(segment):
    """Words a text producer (echo, printf) prints, or [] when the segment prints none visibly."""
    words = [t for t in segment if not t.operator]
    head = next((i for i, t in enumerate(words) if t.value not in RESERVED_WORDS and not ASSIGNMENT.match(t.value)), None)
    if head is None or posixpath.basename(words[head].value) not in TEXT_PRODUCERS or words[head].dynamic:
        return []
    arguments = [t for t in words[head + 1:] if not (words[head].value == 'echo' and t.value in ('-n', '-e', '-E'))]
    return [piece for token in arguments for piece in _text_words(token)]


def _xargs_consumer(segment):
    """`(words, index)` of an xargs invocation in the segment, or None; only wrappers may precede it."""
    words = [t for t in segment if not t.operator]
    for index, token in enumerate(words):
        name = posixpath.basename(token.value)
        if name == 'xargs' and not token.dynamic:
            return words, index
        if not (re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', token.value) or name in XARGS_WRAPPERS or token.value.startswith('-')):
            return None
    return None


def _stdin_ambiguous(detail, recovery=STDIN_RECOVERY):
    return verdict.ambiguous('xargs stdin %s' % detail, recovery)


def _stdin_candidates(command, replace, stdin):
    """The command lines xargs runs with the visible stdin words: one per word with a replace string, else one."""
    if replace is None:
        return [command + stdin]
    return [[dataclasses.replace(w, value=w.value.replace(replace, item.value), glob=w.glob or item.glob,
                                 substitution=w.substitution or item.substitution) if replace in w.value else w
             for w in command] for item in stdin]


def xargs_stdin_verdict(segment, producers, patterns, cwd, git_relocated):
    """Judge an `xargs` that reads the visible output of text producers earlier in the pipeline (#1433).

    The words a producer prints become operands of the command xargs runs, so
    they are judged as if written there. Input that is not visible text (a
    file, a variable, another command) is not judged, as for any other Reader.
    """
    found = _xargs_consumer(segment)
    stdin = [piece for producer in producers for piece in _produced_words(producer)]
    if found is None or not stdin:
        return verdict.allow()
    words, head = found
    parsed = xargs_command(words, head)
    named = any(t.glob or t.substitution or protected(t.value, patterns, cwd) for t in stdin)
    if parsed is None:
        return _stdin_ambiguous('option is not understood') if named else verdict.allow()
    command, replace = parsed
    if not command or command[0].dynamic:
        return verdict.allow()
    if posixpath.basename(command[0].value) in EXEC_SHELLS - set(READERS) and any(protected(t.value, patterns, cwd) for t in stdin):
        return _stdin_ambiguous('names a protected path for a shell command', STDIN_SHELL_RECOVERY)
    for line in _stdin_candidates(command, replace, stdin):
        result = segment_verdict(line, patterns, cwd, git_relocated)
        if result.kind == verdict.AMBIGUOUS_TARGET:
            return _stdin_ambiguous('target: ' + result.detail, result.hint)
        if not result.allowed:
            return result
    return verdict.allow()


class _Feeders:
    """The text producers visible upstream of the segment being judged (#1433).

    A pipe hands the segment before it, or a closed `( ... )` or `{ ...; }`
    group before it, to the next segment; any other separator ends the chain.
    """

    def __init__(self):
        self.producers = []
        self.group = None
        self.closed = []

    def after(self, segment, operator):
        """Record `segment`, which the separator `operator` just ended."""
        words = [t.value for t in segment if not t.operator]
        if words[:1] == ['{'] and self.group is None:
            self.group = []
        if operator == '(':
            self.group = [] if self.group is None else self.group
            return
        brace_close = words == ['}']
        if self.group is not None and not brace_close:
            self.group.append(segment)
        if operator == ')' or brace_close:
            self.closed, self.group = self.group or [], None
            if operator == ')':
                return
        if operator in PIPES:
            grouped = brace_close or (not segment and self.closed)
            self.producers = self.producers + (self.closed if grouped else [segment])
            self.closed = []
        else:
            self.producers, self.closed = [], []


def _judge_segments(tokens, patterns, cwd, git_relocated):
    """Judge each separator-delimited segment of one resolved token list."""
    segment = []
    uncertain_cwd = cwd
    feeders = _Feeders()
    # 命令替換的 `$(` 把本體 token 內嵌在詞列中；本體各段照常判斷，外層指令在 `)` 後接續（#1433）。
    resume, depth = None, 0
    for token in _join_pipelines(tokens) + [type('End', (), {'operator': True, 'value': ';'})()]:
        if token.operator and token.value in SEPARATORS:
            found = segment_verdict(segment, patterns, uncertain_cwd, git_relocated)
            if found.allowed:
                found = xargs_stdin_verdict(segment, feeders.producers, patterns, uncertain_cwd, git_relocated)
            if not found.allowed:
                return found
            if any(not t.operator and posixpath.basename(t.value) == 'cd' for t in segment):
                uncertain_cwd = None
            continued = None
            if depth:
                depth += (token.value == '(') - (token.value == ')')
                if not depth:
                    continued, resume = resume, None
            elif token.value == '(' and segment and segment[-1].substitution:
                resume, depth = segment, 1
            else:
                feeders.after(segment, token.value)
            segment = list(continued) if continued else []
        else:
            segment.append(token)
    return verdict.allow()
