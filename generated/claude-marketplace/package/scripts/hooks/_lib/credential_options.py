"""Bounded reader options: unsupported or ambiguous syntax fails closed."""

from collections import namedtuple

Classification = namedtuple('Classification', 'positional recursive exclusions exclusion_invalid follow')

# Each option maps to (takes_value, effect). Required values consume the rest
# of a short cluster or the next word, just as the supported utilities do.
NEUTRAL = (False, 'neutral')
VALUE = (True, 'neutral')
EXPR = (True, 'expression')
FILE = (True, 'file')
RECURSE = (False, 'recursive')


def schemas(name):
    short = {}
    long = {}
    if name in ('cat', 'less'):
        short.update({c: NEUTRAL for c in 'AbBenstuvETNXRSFiM'})
    if name in ('head', 'tail'):
        short.update({'n': VALUE, 'c': VALUE, 'q': NEUTRAL, 'v': NEUTRAL})
        long.update({'--lines': VALUE, '--bytes': VALUE, '--quiet': NEUTRAL, '--verbose': NEUTRAL})
    if name in ('sed', 'awk', 'grep', 'rg'):
        short.update({'e': EXPR, 'f': FILE})
        long.update({'--file': FILE})
    if name == 'sed':
        short.update({'n': NEUTRAL, 'E': NEUTRAL, 'r': NEUTRAL, 's': NEUTRAL, 'z': NEUTRAL, 'i': NEUTRAL})
        long.update({'--expression': EXPR, '--quiet': NEUTRAL, '--silent': NEUTRAL, '--regexp-extended': NEUTRAL})
    if name == 'awk':
        short.update({'F': VALUE, 'v': VALUE})
        long.update({'--source': EXPR, '--field-separator': VALUE, '--assign': VALUE})
    if name in ('grep', 'rg'):
        short.update({c: NEUTRAL for c in 'inHvclLqsvwxoU'})
        short.update({c: VALUE for c in 'mABC'})
        long.update({'--regexp': EXPR, '--max-count': VALUE, '--context': VALUE,
                     '--ignore-case': NEUTRAL, '--invert-match': NEUTRAL,
                     '--fixed-strings': NEUTRAL, '--line-number': NEUTRAL,
                     '--count': NEUTRAL, '--files-with-matches': NEUTRAL,
                     '--exclude': (True, 'exclude'), '--exclude-from': (True, 'file_invalid'),
                     '--include': (True, 'invalid'), '--exclude-dir': (True, 'invalid')})
    if name == 'grep':
        # 只限 grep：rg 的 -E 是帶值的 --encoding、-h 是 --help，語意不同，誤設 neutral 會讓參數錯位。
        short.update({c: NEUTRAL for c in 'hEFP'})
        # -R 會跟隨目錄連結，不能沿用 -r 的掃描假設。
        short.update({'r': RECURSE, 'R': (False, 'follow'), 'd': (True, 'directories')})
        long.update({'--recursive': RECURSE, '--dereference-recursive': (False, 'follow'),
                     '--directories': (True, 'directories')})
    if name == 'rg':
        # rg 的 -L 代表跟隨連結，與 grep 的同名選項不同，仍須拒絕。
        del short['L']
        # 舊表遺漏 rg 的固定字串短選項，導致合法檔案查詢被誤擋；它不改變遞迴政策。
        short['F'] = NEUTRAL
        short.update({'g': (True, 'glob'), 't': (True, 'invalid'), 'T': (True, 'invalid'), '.': (False, 'invalid')})
        long.update({'--glob': (True, 'glob'), '--iglob': (True, 'invalid'),
                     '--ignore-file': (True, 'file_invalid'), '--files-from': (True, 'unsafe'),
                     '--hidden': (False, 'invalid'), '--no-ignore': (False, 'invalid'),
                     '--no-ignore-vcs': (False, 'invalid'), '--pre': (True, 'unsafe'),
                     '--pre-glob': (True, 'invalid'), '--type': (True, 'invalid'),
                     '--encoding': VALUE, '--sort': VALUE, '--sortr': VALUE})
        # ignore 變體會改變篩選但不會擴大掃描根目錄；完整 exclusion 證明仍維持失效。
        long.update({key: (False, 'invalid') for key in (
            '--no-ignore-dot', '--no-ignore-exclude', '--no-ignore-files',
            '--no-ignore-global', '--no-ignore-parent', '--no-ignore-messages',
            '--no-ignore-file-case-insensitive')})
    return short, long


def classify(name, args, is_protected):
    short, long = schemas(name)
    recursive = name == 'rg'
    follow = False
    exclusions = []
    invalid = False
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
        effects = []
        if options and arg.startswith('--'):
            key, sep, value = arg.partition('=')
            choices = [key] if key in long else [k for k in long if k.startswith(key)]
            if len(choices) != 1:
                return None
            arity, effect = long[choices[0]]
            if arity:
                if not sep:
                    i += 1
                    if i >= len(args):
                        return None
                    value = args[i].value
                    token = args[i]
                effects.append((effect, value, token))
            elif sep:
                return None
            else:
                effects.append((effect, '', token))
        elif options and name in ('head', 'tail') and arg[1:].isdigit() and arg.startswith('-'):
            # `head -15` 是 `head -n 15` 的傳統簡寫，只決定行數，不指定讀取目標。
            effects.append(('neutral', '', token))
        elif options and arg.startswith('-') and arg != '-':
            j = 1
            while j < len(arg):
                if arg[j] not in short:
                    return None
                arity, effect = short[arg[j]]
                if arity:
                    value = arg[j + 1:]
                    if not value:
                        i += 1
                        if i >= len(args):
                            return None
                        value = args[i].value
                        token = args[i]
                    effects.append((effect, value, token))
                    break
                effects.append((effect, '', token))
                j += 1
        else:
            if not pattern_seen:
                pattern_seen = True
            else:
                positional.append(token)
        for effect, value, value_token in effects:
            # 這些選項能讀取掃描根目錄以外的內容，即使目標是一般檔案也不能放行。
            if effect == 'unsafe':
                return None
            # 輔助檔也會被 reader 開啟；需要連同動態標記驗證，不能只看字面名稱。
            if effect in ('file', 'file_invalid') and (value_token.glob or is_protected(value, value_token)):
                return None
            if effect in ('expression', 'file'):
                pattern_seen = True
            if effect == 'recursive' or (effect == 'directories' and value.startswith('recurs')):
                recursive = True
            if effect == 'follow':
                recursive = True
                follow = True
            if effect in ('invalid', 'file_invalid'):
                invalid = True
            if effect == 'exclude':
                exclusions.append(value)
            if effect == 'glob':
                if value.startswith('!'):
                    exclusions.append(value[1:])
                else:
                    invalid = True
        i += 1
    return Classification(tuple(positional), recursive, tuple(exclusions), invalid, follow)
