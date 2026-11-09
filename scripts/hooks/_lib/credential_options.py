"""Reader adapters: each Reader's own option grammar turns its arguments into a Read Plan.

Adapters only describe what an invocation would open; the credential policy
decides whether that is allowed. Unknown or ambiguous syntax is reported as
UnsupportedSyntax so the policy fails closed.
"""

from collections import namedtuple
from dataclasses import dataclass

READERS = ('cat', 'less', 'head', 'tail', 'sed', 'awk', 'grep', 'rg')
# Only Readers that can recurse have exclusion syntax for an Exclusion Proof.
EXCLUSION_SYNTAX = {'rg': '--glob "!pattern"', 'grep': '--exclude="pattern"'}

AuxiliaryInput = namedtuple('AuxiliaryInput', 'value token')
UnsupportedSyntax = namedtuple('UnsupportedSyntax', 'detail')


@dataclass(frozen=True)
class ReadPlan:
    reader: str
    targets: tuple
    auxiliary_inputs: tuple
    recursive: bool
    follow: bool
    exclusions: tuple
    exclusion_proof_valid: bool
    # A Reader whose files depend on repository state names them through a
    # listing (ADR 0034); `resolve(cwd, deadline)` returns a ListingResult.
    listing: object = None
    # True when the Reader changed to a directory that cannot be known statically.
    location_unknown: bool = False
    # Reader-specific recovery text; None keeps the default hints.
    recovery: object = None


# failure: None, 'unknown', 'limit', or 'error'; detail explains a failure or ambiguity.
ListingResult = namedtuple('ListingResult', 'failure detail ambiguous targets listed')
Recovery = namedtuple('Recovery', 'ambiguous recursive')


def exclusion_syntax(reader):
    return EXCLUSION_SYNTAX.get(reader)

# Each option maps to (takes_value, effect). Required values consume the rest
# of a short cluster or the next word, just as the supported utilities do.
NEUTRAL = (False, 'neutral')
VALUE = (True, 'neutral')
EXPR = (True, 'expression')
FILE = (True, 'file')
RECURSE = (False, 'recursive')


def _grammar(name):
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




@dataclass(frozen=True)
class ReaderAdapter:
    name: str
    short: dict
    long: dict

    @property
    def exclusion_syntax(self):
        return EXCLUSION_SYNTAX.get(self.name)

    def plan(self, args):
        """Return a ReadPlan for `args`, or UnsupportedSyntax naming the offending option."""
        name = self.name
        short, long = self.short, self.long
        recursive = name == 'rg'
        follow = False
        exclusions = []
        invalid = False
        positional = []
        auxiliary = []
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
                # 只回報選項名稱，不回報值，避免受保護路徑出現在訊息中。
                if len(choices) != 1:
                    return UnsupportedSyntax('%s option %s' % (name, ascii(key)))
                arity, effect = long[choices[0]]
                if arity:
                    if not sep:
                        i += 1
                        if i >= len(args):
                            return UnsupportedSyntax('%s option %s needs a value' % (name, ascii(key)))
                        value = args[i].value
                        token = args[i]
                    effects.append((effect, value, token, key))
                elif sep:
                    return UnsupportedSyntax('%s option %s takes no value' % (name, ascii(key)))
                else:
                    effects.append((effect, '', token, key))
            elif options and name in ('head', 'tail') and arg[1:].isdigit() and arg.startswith('-'):
                # `head -15` 是 `head -n 15` 的傳統簡寫，只決定行數，不指定讀取目標。
                effects.append(('neutral', '', token, arg))
            elif options and arg.startswith('-') and arg != '-':
                j = 1
                while j < len(arg):
                    flag = '-' + arg[j]
                    if arg[j] not in short:
                        return UnsupportedSyntax('%s option %s' % (name, ascii(flag)))
                    arity, effect = short[arg[j]]
                    if arity:
                        value = arg[j + 1:]
                        if not value:
                            i += 1
                            if i >= len(args):
                                return UnsupportedSyntax('%s option %s needs a value' % (name, ascii(flag)))
                            value = args[i].value
                            token = args[i]
                        effects.append((effect, value, token, flag))
                        break
                    effects.append((effect, '', token, flag))
                    j += 1
            else:
                if not pattern_seen:
                    pattern_seen = True
                else:
                    positional.append(token)
            for effect, value, value_token, flag in effects:
                # 這些選項能讀取掃描根目錄以外的內容，即使目標是一般檔案也不能放行。
                if effect == 'unsafe':
                    return UnsupportedSyntax('%s option %s reads outside its targets' % (name, ascii(flag)))
                # 輔助檔也會被 reader 開啟；交由 policy 連同動態標記驗證。
                if effect in ('file', 'file_invalid'):
                    auxiliary.append(AuxiliaryInput(value, value_token))
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
        return ReadPlan(name, tuple(positional), tuple(auxiliary), recursive, follow, tuple(exclusions), not invalid)


ADAPTERS = {name: ReaderAdapter(name, *_grammar(name)) for name in READERS}
