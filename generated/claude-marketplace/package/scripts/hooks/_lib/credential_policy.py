"""Credential path and invocation policy, without reading target contents."""

import fnmatch
import hashlib
import os
import posixpath
from pathlib import Path
import re
import stat
import sys

from credential_shell import tokenize, substitutions, heredocs
from credential_options import classify
from credential_scan import scan_roots

TEMPLATES = {'.env.example', '.env.sample', '.env.dist', '.env.template'}
DEFAULTS = ['.env', '.env.*', 'my.cnf', 'debian.cnf', '*.pem', 'id_rsa*', 'credentials*']
READERS = {'cat', 'less', 'head', 'tail', 'sed', 'awk', 'grep', 'rg'}
# Pin the dedicated extractor; a matching filename alone cannot grant access.
EXTRACTOR_SHA256 = 'd716d7ef383ee3c28e0680b077e3c203c213be026498045136a235be927339aa'


def validate_patterns(value):
    if not isinstance(value, list):
        raise ValueError('policy')
    for pattern in value:
        if not isinstance(pattern, str) or not pattern or '\x00' in pattern or '\n' in pattern or '[' in pattern or ']' in pattern or '\\' in pattern:
            raise ValueError('policy')
    return value


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
    expression = ''.join('[^/]*' if c == '*' else '[^/]' if c == '?' else re.escape(c) for c in pattern)
    return re.fullmatch(expression, candidate) is not None


def matching_patterns(path, patterns, cwd):
    name = posixpath.basename(normalize_path(path))
    # 共用同一政策比對結果，避免掃描診斷與既有 template 豁免產生分歧。
    defaults = [] if name in TEMPLATES else DEFAULTS
    return {p for p in defaults + patterns if match_path(path, p, cwd)}


def protected(path, patterns, cwd):
    return bool(matching_patterns(path, patterns, cwd))


def unsafe_auxiliary(path, token, patterns, cwd):
    """Reject auxiliary inputs whose actual target cannot be proved safe."""
    if token.dynamic or token.glob or cwd is None or protected(path, patterns, cwd):
        return True
    try:
        # 連結後的 .. 必須由檔案系統解析；正規化僅供字面政策比對。
        physical = os.path.join(cwd, path)
        logical = os.path.abspath(physical)
        resolved = str(Path(physical).resolve(strict=True))
        info = os.stat(resolved)
        return (protected(logical, patterns, cwd) or protected(resolved, patterns, cwd)
                or not stat.S_ISREG(info.st_mode) or not info.st_mode & 0o444
                or not os.access(resolved, os.R_OK))
    except (OSError, RuntimeError, ValueError):
        return True


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


# 回傳非空的阻擋原因（truthy）或 False，讓 hook 能告訴 agent 該怎麼改寫指令。
PROTECTED = 'protected path'
UNSUPPORTED = 'unsupported reader syntax'
RECURSIVE = 'recursive read without credential exclusions'


def read_blocked(tokens, patterns, cwd):
    if not tokens:
        return False
    words = [t for t in tokens if not t.operator]
    if not words:
        return False
    names = [posixpath.basename(t.value) for t in words]
    # Redirects open the target before any command runs, including metadata commands.
    for i, token in enumerate(tokens[:-1]):
        if token.operator and token.value in ('<', '<>'):
            target = tokens[i + 1]
            if target.glob or protected(target.value, patterns, cwd):
                return PROTECTED
    if any(posixpath.basename(t.value).endswith('credential-extract.py') for t in words):
        return PROTECTED
    # Known readers in wrappers are still inspected; a wrapper never grants an exception.
    index = next((i for i, name in enumerate(names) if name in READERS or name == 'ssh'), None)
    if index is None:
        return False
    name = names[index]
    if name == 'ssh':
        return ssh_blocked(words[index + 1:], patterns)
    args = words[index + 1:]
    # 舊版逐字猜測叢集與縮寫會錯認參數；依各 reader 的選項與參數表解析，未知語法直接拒絕。
    classified = classify(name, args, lambda value, token: unsafe_auxiliary(value, token, patterns, cwd))
    if classified is None:
        return UNSUPPORTED
    positional, recursive, exclusions, invalid_proof, follow = classified
    for token in positional:
        if token.glob or protected(token.value, patterns, cwd):
            return PROTECTED
    if recursive:
        # rg only escapes recursive scope for explicit, known regular local files.
        if name == 'rg' and positional and cwd is not None and index == 0 and not any(t.dynamic for t in positional):
            try:
                if all(stat.S_ISREG(os.lstat(os.path.join(cwd, t.value)).st_mode) for t in positional):
                    return False
            except OSError:
                pass
        effective = DEFAULTS + patterns
        # 排除帶斜線時可能只作用於單一目錄，不能證明覆蓋任意深度的自訂規則。
        covered = {p for p in effective if any('/' not in ex and (ex == '*' or ex == posixpath.basename(p)) for ex in exclusions)}
        if invalid_proof or len(covered) != len(set(effective)):
            # 包裝器、動態根路徑或未知 cwd 可能指向其他檔案系統，不能用本機掃描推論。
            if cwd is None or index != 0 or any(t.dynamic for t in positional):
                return RECURSIVE
            unresolved = set(effective) if invalid_proof else set(effective) - covered
            roots = [os.path.join(cwd, t.value) for t in positional] if positional else [cwd]
            failure, hits, paths = scan_roots(roots, lambda path: matching_patterns(path, patterns, cwd), unresolved, follow)
            if failure or hits:
                details = [failure] if failure else []
                if hits:
                    details.append('patterns ' + ', '.join(ascii(p) for p in sorted(hits)))
                if paths:
                    details.append('paths ' + ', '.join(ascii(p) for p in paths))
                return RECURSIVE + ': ' + '; '.join(details)
    return False


def ssh_blocked(args, patterns):
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
        return False
    if any(t.dynamic or t.glob for t in args[i:]):
        return UNSUPPORTED
    return analyze(' '.join(t.value for t in args[i:]), patterns, None, True)


def analyze(command, patterns, cwd, remote=False, nested=False):
    # 原本把 heredoc 資料誤當指令；只遮罩完整辨識的內文並保留可執行替換。
    command, expansions = heredocs(command)
    tokens = tokenize(command)
    # 原始字串會漏掉引號或跳脫後的 cd，也會誤判 heredoc 資料；先以正規化 token 判斷範圍。
    command_head = True
    for token in tokens:
        if token.operator:
            if token.value in (';', '&&', '||', '|', '|&', '(', ')', ';;'):
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
    for body in expansions:
        reason = analyze(body, patterns, cwd, remote, True)
        if reason:
            return reason
    # 使用平衡掃描保留引號及巢狀括號，避免命令替換包住可辨識讀取時漏判。
    for body in substitutions(command):
        reason = analyze(body, patterns, cwd, remote, True)
        if reason:
            return reason
    if not nested and safe_extraction(tokens, remote):
        return False
    segment = []
    uncertain_cwd = cwd
    for token in tokens + [type('End', (), {'operator': True, 'value': ';'})()]:
        if token.operator and token.value in (';', '&&', '||', '|', '|&', '(', ')', ';;'):
            reason = read_blocked(segment, patterns, uncertain_cwd)
            if reason:
                return reason
            if any(not t.operator and posixpath.basename(t.value) == 'cd' for t in segment):
                uncertain_cwd = None
            segment = []
        else:
            segment.append(token)
    return False
