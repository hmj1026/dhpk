"""Credential path and invocation policy, without reading target contents."""

import fnmatch
import hashlib
import os
import posixpath
import re
import stat
import sys

from credential_shell import tokenize

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


def match_path(path, pattern, cwd=None):
    path = posixpath.normpath(path)
    if pattern.startswith('/'):
        if not path.startswith('/'):
            if cwd is None:
                return True
            path = posixpath.normpath(posixpath.join(cwd, path))
        candidate = path
    elif '/' not in pattern:
        candidate = posixpath.basename(path)
    else:
        path_parts = path.strip('/').split('/')
        pattern_parts = posixpath.normpath(pattern).strip('/').split('/')
        if len(path_parts) < len(pattern_parts):
            return False
        candidate = '/'.join(path_parts[-len(pattern_parts):])
    expression = ''.join('[^/]*' if c == '*' else '[^/]' if c == '?' else re.escape(c) for c in posixpath.normpath(pattern))
    return re.fullmatch(expression, candidate) is not None


def protected(path, patterns, cwd):
    name = posixpath.basename(posixpath.normpath(path))
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
    if any(posixpath.basename(t.value) == 'credential-extract.py' for t in words):
        return True
    # Known readers in wrappers are still inspected; a wrapper never grants an exception.
    index = next((i for i, name in enumerate(names) if name in READERS or name == 'ssh'), None)
    if index is None:
        return False
    name = names[index]
    if name == 'ssh':
        return ssh_blocked(words[index + 1:], patterns)
    args = words[index + 1:]
    recursive = name == 'rg'
    exclusions = []
    invalid_proof = False
    positional = []
    pattern_seen = name not in ('grep', 'rg', 'sed', 'awk')
    options = True
    i = 0
    while i < len(args):
        token = args[i]
        arg = token.value
        if options and arg == '--':
            options = False
            i += 1
            continue
        if options and arg.startswith('-') and arg != '-':
            # rg 的 -g 可黏接重新納入規則，不得當作其他短旗標叢集。
            if name == 'rg' and arg.startswith('-g') and len(arg) > 2:
                invalid_proof = True
                i += 1
                continue
            # 短旗標叢集可帶 inline 腳本；先消耗其參數，避免將敏感目標誤認為腳本。
            if (name in ('grep', 'rg', 'sed', 'awk') and arg.startswith('-')
                    and not arg.startswith('--') and len(arg) > 2 and 'e' in arg[1:]
                    and ('f' not in arg[1:] or arg.index('e') < arg.index('f'))):
                before, suffix = arg[1:].split('e', 1)
                if name == 'grep' and any(c in before for c in 'rR'):
                    recursive = True
                if not suffix:
                    i += 1
                    if i >= len(args):
                        return True
                pattern_seen = True
                i += 1
                continue
            if name == 'grep' and (arg in ('-d', '--directories') or arg.startswith('--directories=')):
                if '=' in arg:
                    val = arg.split('=', 1)[1]
                else:
                    i += 1
                    if i >= len(args):
                        return True
                    val = args[i].value
                recursive |= val.startswith('recurs')
                i += 1
                continue
            if name == 'grep' and arg.startswith('-d') and len(arg) > 2:
                recursive |= arg[2:].startswith('recurs')
                i += 1
                continue
            # 包含與重新納入規則會推翻全域排除的證明。
            if arg.startswith('--include') or (name == 'rg' and (arg.startswith('--iglob') or (arg.startswith('-g') and len(arg) > 2))):
                invalid_proof = True
            option_name, separator, option_value = arg.partition('=')
            known_long = ('--file', '--regexp', '--expression', '--exclude', '--glob',
                          '--iglob', '--include', '--ignore-file', '--files-from',
                          '--directories', '--recursive', '--dereference-recursive',
                          '--no-ignore', '--no-ignore-vcs', '--hidden', '--pre',
                          '--pre-glob', '--max-count', '--context', '--exclude-dir',
                          '--type', '--encoding', '--sort', '--sortr', '--lines', '--bytes')
            # 無法辨識的選項可能藏有檔案參數；可辨識的敏感目標不得因此略過。
            if arg.startswith('--') and not any(option_name == option or option.startswith(option_name) for option in known_long):
                if (separator and (token.glob or protected(option_value, patterns, cwd))) or (not separator and i + 1 < len(args) and (args[i + 1].glob or protected(args[i + 1].value, patterns, cwd))):
                    return True
            if separator and ('--file'.startswith(option_name) or option_name.startswith('--file')):
                if token.glob or protected(option_value, patterns, cwd):
                    return True
                pattern_seen = True
                i += 1
                continue
            if name in ('grep', 'rg', 'sed', 'awk') and arg.startswith('--') and '--file'.startswith(arg) and arg != '--':
                i += 1
                if i >= len(args) or args[i].glob or protected(args[i].value, patterns, cwd):
                    return True
                pattern_seen = True
                i += 1
                continue
            if arg in ('--exclude-from', '--ignore-file', '--files-from'):
                invalid_proof = True
                i += 1
                if i >= len(args) or args[i].glob or protected(args[i].value, patterns, cwd):
                    return True
                i += 1
                continue
            if arg.startswith(('--exclude-from=', '--ignore-file=', '--files-from=')):
                invalid_proof = True
                if token.glob or protected(arg.split('=', 1)[1], patterns, cwd):
                    return True
                i += 1
                continue
            if (name in ('grep', 'rg', 'sed', 'awk') and arg.startswith('-')
                    and not arg.startswith('--') and len(arg) > 2 and 'f' in arg[1:]):
                if name == 'grep' and any(c in arg.split('f', 1)[0][1:] for c in 'rR'):
                    recursive = True
                suffix = arg.split('f', 1)[1]
                if suffix:
                    if token.glob or protected(suffix, patterns, cwd):
                        return True
                else:
                    i += 1
                    if i >= len(args) or args[i].glob or protected(args[i].value, patterns, cwd):
                        return True
                pattern_seen = True
                i += 1
                continue
            if arg in ('-r', '-R', '--recursive', '--dereference-recursive') or (name == 'grep' and arg.startswith('-') and not arg.startswith('--') and any(c in arg[1:] for c in 'rR')):
                recursive = True
            if arg in ('--no-ignore', '--no-ignore-vcs', '--hidden', '-.', '--pre', '--pre-glob') or arg.startswith(('--pre=', '--pre-glob=', '--ignore-file')):
                invalid_proof = True
            if arg.startswith('--exclude=') and name == 'grep':
                exclusions.append(arg.split('=', 1)[1])
            elif arg.startswith('--glob=') and name == 'rg':
                val = arg.split('=', 1)[1]
                exclusions.append(val[1:]) if val.startswith('!') else None
                invalid_proof |= not val.startswith('!')
            elif arg in ('--exclude', '--glob', '-g') and i + 1 < len(args):
                i += 1
                val = args[i].value
                if name == 'grep' and arg == '--exclude':
                    exclusions.append(val)
                elif name == 'rg' and val.startswith('!'):
                    exclusions.append(val[1:])
                else:
                    invalid_proof = True
            elif arg in ('-f', '--file', '--regexp', '-e', '--expression'):
                i += 1
                if i >= len(args):
                    return True
                if arg in ('-f', '--file') and (args[i].glob or protected(args[i].value, patterns, cwd)):
                    return True
                pattern_seen = True
            elif arg.startswith('--file='):
                if token.glob or protected(arg.split('=', 1)[1], patterns, cwd):
                    return True
                pattern_seen = True
            elif arg.startswith('-f') and len(arg) > 2:
                if protected(arg[2:], patterns, cwd):
                    return True
                pattern_seen = True
            elif arg.startswith(('-e', '--regexp=', '--expression=')):
                pattern_seen = True
            elif (name in ('head', 'tail') and arg in ('-n', '-c', '--lines', '--bytes')) or (name in ('grep', 'rg') and arg in ('-m', '--max-count', '-A', '-B', '-C', '--context', '--include', '--exclude-dir', '--type', '-t', '-T', '--encoding', '--sort', '--sortr')):
                i += 1
                if i >= len(args):
                    return True
            i += 1
            continue
        if not pattern_seen:
            pattern_seen = True
        else:
            positional.append(token)
        i += 1
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


def analyze(command, patterns, cwd, remote=False):
    # 引號內的命令替換仍會執行讀取；分析明文子命令而非展開或執行它。
    for match in re.finditer(r'\$\(([^()]*)\)|`([^`]*)`', command, re.DOTALL):
        # 單引號與跳脫字元內只是文字；只有實際可能展開的替換需要檢查。
        quote = None
        escaped = False
        for char in command[:match.start()]:
            if escaped:
                escaped = False
            elif char == '\\' and quote != "'":
                escaped = True
            elif char in ("'", '"') and (quote is None or quote == char):
                quote = None if quote else char
        if quote != "'" and not escaped and analyze(match.group(1) if match.group(1) is not None else match.group(2), patterns, cwd, remote):
            return True
    tokens = tokenize(command)
    if safe_extraction(tokens, remote):
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
