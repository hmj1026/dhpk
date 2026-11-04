"""Credential path and invocation policy, without reading target contents."""

import fnmatch
import hashlib
import os
import posixpath
import re
import stat
import sys

from credential_shell import tokenize, substitutions
from credential_options import classify

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


def protected(path, patterns, cwd):
    name = posixpath.basename(normalize_path(path))
    if name not in TEMPLATES and any(match_path(path, p, cwd) for p in DEFAULTS):
        return True
    return any(match_path(path, p, cwd) for p in patterns)


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
                return True
    if any(posixpath.basename(t.value).endswith('credential-extract.py') for t in words):
        return True
    # Known readers in wrappers are still inspected; a wrapper never grants an exception.
    index = next((i for i, name in enumerate(names) if name in READERS or name == 'ssh'), None)
    if index is None:
        return False
    name = names[index]
    if name == 'ssh':
        return ssh_blocked(words[index + 1:], patterns)
    args = words[index + 1:]
    # 舊版逐字猜測叢集與縮寫會錯認參數；依各 reader 的選項與參數表解析，未知語法直接拒絕。
    classified = classify(name, args, lambda value: protected(value, patterns, cwd))
    if classified is None:
        return True
    positional, recursive, exclusions, invalid_proof = classified
    for token in positional:
        if token.glob or protected(token.value, patterns, cwd):
            return True
    if recursive:
        # rg only escapes recursive scope for explicit, known regular local files.
        if name == 'rg' and positional and cwd is not None:
            try:
                if all(stat.S_ISREG(os.lstat(os.path.join(cwd, t.value)).st_mode) for t in positional):
                    return False
            except OSError:
                pass
        effective = DEFAULTS + patterns
        # 排除帶斜線時可能只作用於單一目錄，不能證明覆蓋任意深度的自訂規則。
        return invalid_proof or not all(any('/' not in ex and (ex == '*' or ex == posixpath.basename(p)) for ex in exclusions) for p in effective)
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
        return True
    return analyze(' '.join(t.value for t in args[i:]), patterns, None, True)


def analyze(command, patterns, cwd, remote=False, nested=False):
    # 使用平衡掃描保留引號及巢狀括號，避免命令替換包住可辨識讀取時漏判。
    for body in substitutions(command):
        if analyze(body, patterns, cwd, remote, True):
            return True
    tokens = tokenize(command)
    if not nested and safe_extraction(tokens, remote):
        return False
    segment = []
    uncertain_cwd = cwd
    for token in tokens + [type('End', (), {'operator': True, 'value': ';'})()]:
        if token.operator and token.value in (';', '&&', '||', '|', '|&', '(', ')', ';;'):
            if read_blocked(segment, patterns, uncertain_cwd):
                return True
            if any(not t.operator and posixpath.basename(t.value) == 'cd' for t in segment):
                uncertain_cwd = None
            segment = []
        else:
            segment.append(token)
    return False
