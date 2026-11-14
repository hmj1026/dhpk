"""Credential path and invocation policy, without reading target contents."""

import fnmatch
import functools
import hashlib
import os
import posixpath
from pathlib import Path
import re
import stat
import sys

from credential_shell import lex
from credential_options import ADAPTERS, READERS, ReadPlan, exclusion_syntax
from credential_git import GIT_ADAPTER, RELOCATING_VARIABLES
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
    if plan.listing is not None:
        found = listing_verdict(plan, patterns, None if wrapped else cwd)
        if found is not None:
            return found
    if not plan.recursive:
        return verdict.allow()
    syntax = exclusion_syntax(plan.reader)
    # rg only escapes recursive scope for explicit, known regular local files.
    if plan.reader == 'rg' and plan.targets and cwd is not None and not wrapped and not any(t.dynamic for t in plan.targets):
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
    if any(name.endswith('credential-extract.py') for name in names):
        return verdict.protected()
    # Known readers in wrappers are still inspected; a wrapper never grants an exception.
    index = next((i for i, name in enumerate(names) if name in READERS or name == 'ssh'), None)
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
        return remote_wrapper_verdict(words[index + 1:], patterns)
    adapter = ADAPTERS[names[index]]
    plan = adapter.plan(words[index + 1:])
    if not isinstance(plan, ReadPlan):
        return verdict.unsupported(adapter.exclusion_syntax, plan.detail)
    return judge(plan, patterns, cwd, index != 0)


def remote_wrapper_verdict(args, patterns):
    """`ssh` is a Remote Wrapper: its command is judged with no local knowledge."""
    i = 0
    takes_value = set('BbcDEeFIiJLlmOopQRSWw')
    while i < len(args):
        arg = args[i].value
        if arg == '--':
            i += 1
            break
        if not arg.startswith('-') or arg == '-':
            break
        if len(arg) == 2 and arg[1] in takes_value:
            i += 1
        i += 1
    i += 1  # host
    if i >= len(args):
        return verdict.allow()
    unknown = next((t for t in args[i:] if t.dynamic or t.glob), None)
    if unknown is not None:
        return verdict.ambiguous('remote operand %s' % ascii(unknown.value),
                                 'name each remote operand as an explicit literal path or value without wildcards or shell expansions.')
    return analyze(' '.join(t.value for t in args[i:]), patterns, None, True)


def analyze(command, patterns, cwd, remote=False, nested=False, executed=False):
    """Return the Credential Verdict for one agent command."""
    try:
        # 一次詞法分析取得字詞、命令替換與 heredoc 展開，三者共用同一個引號狀態機。
        lexed = lex(command, executed)
    except ValueError as error:
        # scanner 以固定字串拒絕有歧義的 shell 語法；這是語法不支援，不是檢查失敗。
        return verdict.unsupported(None, 'shell syntax: %s' % error)
    tokens, bodies = lexed.tokens, lexed.bodies
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
        found = analyze(body, patterns, cwd, remote, True, lexed.executed)
        if not found.allowed:
            return found
    for body in lexed.executed_bodies:
        found = analyze(body, patterns, cwd, remote, True, True)
        if not found.allowed:
            return found
    if not nested and safe_extraction(tokens, remote):
        return verdict.allow()
    # 任何一段（例如先前的 `export GIT_DIR=…`）設定了搬移 repository 的 GIT_* 變數，
    # 後面的 git 讀取就無法用本機列舉證明，比照 cd 的不確定規則。
    git_relocated = any(not t.operator and (RELOCATING_VARIABLES.match(t.value) or RELOCATING_VARIABLES.match(t.value + '='))
                        for t in tokens)
    segment = []
    uncertain_cwd = cwd
    for token in tokens + [type('End', (), {'operator': True, 'value': ';'})()]:
        if token.operator and token.value in SEPARATORS:
            found = segment_verdict(segment, patterns, uncertain_cwd, git_relocated)
            if not found.allowed:
                return found
            if any(not t.operator and posixpath.basename(t.value) == 'cd' for t in segment):
                uncertain_cwd = None
            segment = []
        else:
            segment.append(token)
    return verdict.allow()
