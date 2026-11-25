"""Credential path and invocation policy, without reading target contents."""

import fnmatch
import dataclasses
import functools
import hashlib
import os
import posixpath
import shlex
from pathlib import Path
import re
import stat
import sys

from credential_shell import ASSIGNMENT, EXEC_SHELLS, RESERVED_WORDS, Token, lex, xargs_command
from credential_expand import expand_variants, function_names
from credential_code import RELOCATING_WRAPPERS, WRAPPERS, cluster_takes_next, code_strings, command_head, expand_aliases, option_keeps_directory
from credential_options import ADAPTERS, INERT_HEADS, READERS, WEAK_READERS, ReadPlan, exclusion_syntax
from credential_git import GIT_ADAPTER, RELOCATING_VARIABLES, exec_strings, git_pages, is_command_key
from credential_scan import MAX_SECONDS, budget_seconds
import time
from credential_scan import scan_roots
from credential_find import find_spec, selection_verdict
import credential_verdict as verdict

TEMPLATES = {'.env.example', '.env.sample', '.env.dist', '.env.template'}
DEFAULTS = ['.env', '.env.*', 'my.cnf', 'debian.cnf', '*.pem', 'id_rsa*', 'credentials*']
# Pin the dedicated extractor; a matching filename alone cannot grant access.
EXTRACTOR_SHA256 = 'd716d7ef383ee3c28e0680b077e3c203c213be026498045136a235be927339aa'
ENV_SPLIT_FLAGS = 'i0v'
ENV_LONG_VALUE_NAMES = ('unset', 'chdir', 'argv0')


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
    if result.failure == 'unknown':
        return verdict.recursive_unproven(None, result.detail, recovery and (recovery.unknown_cwd or recovery.recursive))
    if result.failure == 'limit':
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
    words, dynamic = _env_split(words)
    if dynamic is not None:
        return verdict.ambiguous('env split string %s' % ascii(dynamic.value), verdict.TRANSFORMED_COMMAND_RECOVERY)
    names = [posixpath.basename(t.value) for t in words]
    head = next((i for i, t in enumerate(words) if t.value not in RESERVED_WORDS and not ASSIGNMENT.match(t.value)), None)
    if head is not None and words[head].unresolved and _transformed(words[head]):
        return verdict.ambiguous(verdict.TRANSFORMED_COMMAND % ascii(words[head].value), verdict.TRANSFORMED_COMMAND_RECOVERY)
    found = _find_exec_verdict(words, patterns, cwd)
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


TRANSFORM_MARKS = tuple('@/#%:^,~')


def _transformed(token):
    """(#1456) A word built by a case, prompt, pattern or substring operator on a visible value."""
    return any(getattr(part, 'op', '') == 'other' and part.arg.startswith(TRANSFORM_MARKS) for part in token.parts or ())


def _consumes_selection(command):
    head = command_head(command)
    if head is None:
        return False
    name = posixpath.basename(command[head].value)
    return name in READERS or name in EXEC_SHELLS


def _relocated(words, index):
    """True when a word before the command at `index` may change the working directory or root, or is unknowable."""
    wrapper = None
    for word in words[:index]:
        name = posixpath.basename(word.value)
        if word.dynamic or name in RELOCATING_WRAPPERS:
            return True
        if name in WRAPPERS:
            wrapper = name
        elif word.value.startswith('-') and len(word.value) > 1 and not option_keeps_directory(wrapper, word.value):
            return True
    return False


def _split_string_option(value):
    """(#1468) `(text, takes_next)` when the option word is an `env` split-string option, else None.

    `text` is the string attached to the word; `takes_next` is True when the string is the next word."""
    if value.startswith('--'):
        name, equals, text = value[2:].partition('=')
        if not name or not 'split-string'.startswith(name):
            return None
        return (text, False) if equals else (None, True)
    for position, letter in enumerate(value[1:], 1):
        if letter == 'S':
            rest = value[position + 1:]
            return (rest, False) if rest else (None, True)
        if letter not in ENV_SPLIT_FLAGS:
            return None
    return None


def _env_takes_value(option):
    """(#1468) True when an `env` option that is not a split string takes the next word as its value."""
    if option.startswith('--'):
        name, equals, _ = option[2:].partition('=')
        return not equals and bool(name) and any(known.startswith(name) for known in ENV_LONG_VALUE_NAMES)
    return cluster_takes_next(option, 'uCa')


def _env_split(words):
    """(#1468) `(expanded, dynamic)`: words with the first `env` split string (`-S`, `-iS`, `-Scat`,
    `--split-string[=]` and its unique prefixes) replaced by the words it holds, and the word that
    supplies the string when it cannot be read (else None). At most one split per `env`."""
    head = next((i for i, word in enumerate(words) if posixpath.basename(word.value) == 'env'), None)
    if head is None:
        return list(words), None
    i = head + 1
    while i < len(words):
        value = words[i].value
        is_option = value.startswith('-') and len(value) > 1 and value != '--'
        if not is_option and not ASSIGNMENT.match(value):
            break
        split = _split_string_option(value) if is_option else None
        if split is not None:
            return _apply_split(words, i, *split)
        i += 2 if is_option and _env_takes_value(value) else 1
    return list(words), None


def _apply_split(words, index, text, takes_next):
    """(#1468) Replace the split-string option at `index` (and its value word) by the words of its string."""
    if takes_next and index + 1 >= len(words):
        return list(words), None
    source = words[index + 1] if takes_next else words[index]
    if source.dynamic or source.unresolved or source.substitution:
        return list(words), source
    text = source.value if takes_next else text
    tokens = [t for t in lex(text.replace('\\_', ' ')).tokens if not t.operator]
    return list(words[:index]) + tokens + list(words[index + (2 if takes_next else 1):]), None


def _split_string_words(words):
    """(#1462) Words with `env -S STRING` / `--split-string[=STRING]` replaced by the words STRING holds.

    GNU env runs the string as the command, so find and xargs inside it must stay visible.
    """
    return _env_split(words)[0]


def _find_selection(words):
    """`(spec, index, words)` of a find, or (None, None, words); only wrappers may precede it.

    `index` points into the returned words, in which an `env -S` string is already split."""
    words = _split_string_words(words)
    index = _wrapped_index(words, 'find')
    return (None, None, words) if index is None else (find_spec(words, index), index, words)


def _find_exec_verdict(words, patterns, cwd):
    """(#1456) find -exec READER ... {} reads every path find selects."""
    spec, index, words = _find_selection(words)
    if spec is None:
        return None
    for clause in spec.clauses:
        if any('{}' in t.value for t in clause) and _consumes_selection(clause):
            found = selection_verdict(spec, patterns, cwd, _relocated(words, index), matching_patterns, protected, DEFAULTS + patterns)
            if not found.allowed:
                return found
    return None


SSH_COMMAND_VARIABLE = 'GIT_SSH_COMMAND='
# (#1454) GIT_SSH names a program; GIT_PAGER and PAGER name a command line run only when git pages.
PROGRAM_VARIABLE = re.compile(r'^GIT_SSH=(.*)$', re.S)
PAGER_VARIABLE = re.compile(r'^(?:GIT_PAGER|PAGER)=(.*)$', re.S)
# (#1455) Variables whose value git or ssh runs as a command; analyzed whenever git or ssh is in the segment.
COMMAND_VARIABLE = re.compile(r'^(?:GIT_EDITOR|VISUAL|EDITOR|GIT_SEQUENCE_EDITOR|GIT_EXTERNAL_DIFF|GIT_ASKPASS|'
                              r'SSH_ASKPASS|GIT_PROXY_COMMAND)=(.*)$', re.S)
CONFIG_KEY_VARIABLE = re.compile(r'^GIT_CONFIG_KEY_(\d+)=(.*)$', re.S)
CONFIG_VALUE_VARIABLE = re.compile(r'^GIT_CONFIG_VALUE_(\d+)=(.*)$', re.S)
CONFIG_PARAMETERS = 'GIT_CONFIG_PARAMETERS='
CONFIG_RECOVERY = ('set the command with an explicit `git -c key=value` option next to a literal value, '
                   'or write the command directly instead of passing it through git configuration.')


def _program_verdict(value, patterns, cwd):
    """(#1454) GIT_SSH=<program>: the path is judged by name, a visible command line is judged as text."""
    if not value.strip():
        return verdict.allow()
    found = executed_file_verdict(Token(value), patterns, cwd)
    if not found.allowed:
        return found
    return analyze(value, patterns, None, True)


def command_text_verdict(command, patterns, cwd):
    """(#1455) A command string a config key or variable names: the program path by name, the text recursively."""
    if not command.strip():
        return verdict.allow()
    if len(command.split()) == 1:
        found = executed_file_verdict(Token(command), patterns, cwd)
        if not found.allowed:
            return found
    return analyze(command, patterns, None, True)


def _pager_runs(words, names):
    """(#1454) A pager variable matters when git will page; behind any other head it may reach a git, so it counts."""
    git_index = next((i for i, name in enumerate(names) if name == 'git'), None)
    return git_pages(words[git_index + 1:]) if git_index is not None else True


def _variable_commands(words, names, patterns, cwd):
    """(#1454, #1455) Verdict for GIT_SSH, pager and command-valued variables in one segment; None when fine."""
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
        command = COMMAND_VARIABLE.match(word.value)
        if command:
            found = command_text_verdict(command.group(1), patterns, cwd)
            if not found.allowed:
                return found
    return None


def _assignments(words):
    """NAME -> value of every visible assignment word in the segment."""
    pairs = (w.value.split('=', 1) for w in words if ASSIGNMENT.match(w.value))
    return {name.rstrip('+'): value for name, value in pairs}


def _injected_settings(words):
    """(#1455) (key, value) pairs from GIT_CONFIG_KEY_n/VALUE_n and GIT_CONFIG_PARAMETERS; (pairs, problems).

    A value without a visible key is analyzed as a command anyway, and a command-valued key without a
    visible value is a problem: the text cannot say what git will run."""
    keys, values, pairs, problems = {}, {}, [], []
    for word in words:
        key = CONFIG_KEY_VARIABLE.match(word.value)
        value = CONFIG_VALUE_VARIABLE.match(word.value)
        if key:
            keys[key.group(1)] = key.group(2).lower()
        elif value:
            values[value.group(1)] = value.group(2)
        elif word.value.startswith(CONFIG_PARAMETERS):
            try:
                entries = shlex.split(word.value[len(CONFIG_PARAMETERS):])
            except ValueError:
                problems.append('GIT_CONFIG_PARAMETERS')
                continue
            pairs += [(k.lower(), v) for k, _, v in (entry.partition('=') for entry in entries)]
    for index in sorted(set(keys) | set(values)):
        if index in keys and index in values:
            pairs.append((keys[index], values[index]))
        elif index in values:
            pairs.append(('', values[index]))
        elif is_command_key(keys[index]):
            problems.append('GIT_CONFIG_KEY_' + index)
    return pairs, problems


def _env_split_strings(words, names):
    """(#1455 r3) Strings `env -S` / `--split-string` re-parses into a command line."""
    found = []
    for index, name in enumerate(names):
        if name != 'env':
            continue
        i = index + 1
        while i < len(words) and (words[i].value.startswith('-') or ASSIGNMENT.match(words[i].value)):
            arg = words[i].value
            option = _split_string_option(arg) if arg.startswith('-') else None
            if option is not None and option[1] and i + 1 < len(words):
                found.append(words[i + 1].value)
                i += 1
            elif option is not None and option[0] is not None:
                found.append(option[0])
            elif arg.startswith('-') and arg != '--' and _env_takes_value(arg):
                i += 1
            i += 1
    return found


def exec_entrance_verdict(words, names, patterns, cwd=None):
    """(#1431) Judge command strings Git or its SSH variable will execute; None when the segment has none.

    The string runs in a directory this text does not know, so it is judged like a Remote Wrapper command.
    """
    assigned = any('=' in w.value for w in words)
    found = _variable_commands(words, names, patterns, cwd) if assigned else None
    if found is not None:
        return found
    commands = [w.value[len(SSH_COMMAND_VARIABLE):] for w in words if w.value.startswith(SSH_COMMAND_VARIABLE)]
    injected, problems = _injected_settings(words) if assigned else ([], [])
    git_index = next((i for i, name in enumerate(names) if name == 'git'), None)
    reader_index = next((i for i, name in enumerate(names) if _invokes_reader(names, i) or name == 'ssh'), None)
    if git_index is not None and (reader_index is None or git_index < reader_index):
        strings, unresolved = exec_strings(words[git_index + 1:], _assignments(words), injected)
        commands += strings
        problems += unresolved
    elif injected:
        # 只匯出設定（export、declare 的每個 NAME=VALUE）：之後跑什麼不知道，每個值都當命令判定。
        commands += exec_strings([], None, injected)[0]
    for command in commands:
        found = command_text_verdict(command, patterns, cwd) if command.strip() else verdict.allow()
        if not found.allowed:
            return found
    if 'env' in names:
        for string in _env_split_strings(words, names):
            found = analyze(string, patterns, cwd, False, True) if string.strip() else verdict.allow()
            if not found.allowed:
                return found
    if problems and git_index is not None:
        return verdict.ambiguous('git configuration %s' % ascii(problems[0]), CONFIG_RECOVERY)
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


PROXY_COMMAND = re.compile(r'^\s*(?:proxycommand|localcommand|knownhostscommand)(?:\s*=\s*|\s+)(.*)$', re.I | re.S)


def _proxy_command(setting):
    """(#1454, #1455) The command an `-o ProxyCommand`, `LocalCommand` or `KnownHostsCommand` setting runs."""
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
    return function_names(tokens) & set(SHORTCUT_COMMANDS.values())


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
    """Words a text producer (echo, printf) prints, or [] when the segment prints none visibly.

    (#1468) The producer may sit behind wrappers (`nice echo`, `env echo`, `sudo -u root printf`)."""
    words = _split_string_words([t for t in segment if not t.operator])
    head = command_head(words)
    if head is None or words[head].dynamic or posixpath.basename(words[head].value) not in TEXT_PRODUCERS:
        return []
    echo = posixpath.basename(words[head].value) == 'echo'
    arguments = [t for t in words[head + 1:] if not (echo and t.value in ('-n', '-e', '-E'))]
    return [piece for token in arguments for piece in _text_words(token)]


def _wrapped_index(words, command):
    """Index of `command` in words when only assignments, wrappers and their option values precede it, else None."""
    head = command_head(words)
    if head is None or words[head].dynamic or posixpath.basename(words[head].value) != command:
        return None
    return head


def _xargs_consumer(segment):
    """`(words, index)` of an xargs invocation in the segment, or None; only wrappers may precede it."""
    words = _split_string_words([t for t in segment if not t.operator])
    index = _wrapped_index(words, 'xargs')
    return None if index is None else (words, index)


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
    if found is not None:
        parsed = xargs_command(*found)
        if parsed is None or (parsed[0] and _consumes_selection(parsed[0])):
            for producer in producers:
                words = [t for t in producer if not t.operator]
                spec, index, words = _find_selection(words)
                if spec is not None:
                    result = selection_verdict(spec, patterns, cwd, _relocated(words, index), matching_patterns, protected, DEFAULTS + patterns)
                    if not result.allowed:
                        # (#1468) An xargs option the guard cannot parse hides what the command consumes.
                        return result if parsed is not None else _stdin_ambiguous('option is not understood')
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
            # The outer words before a `$(` are resumed after its `)` and judged once,
            # when the outer command ends; judging every prefix again is quadratic.
            opens_substitution = not depth and token.value == '(' and segment and segment[-1].substitution
            if not opens_substitution:
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
