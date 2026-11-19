"""Reader adapters: each Reader's own option grammar turns its arguments into a Read Plan.

Adapters only describe what an invocation would open; the credential policy
decides whether that is allowed. Unknown or ambiguous syntax is reported as
UnsupportedSyntax so the policy fails closed.
"""

from collections import namedtuple
from dataclasses import dataclass, replace
import posixpath

READERS = ('cat', 'less', 'head', 'tail', 'sed', 'awk', 'grep', 'rg', 'base64', 'dd', 'tar', 'cp')
# tar and cp are common words in package and help commands, so they only count as an invocation
# after an information-only head such as `which` or `apt` when they are the first word.
WEAK_READERS = frozenset(('tar', 'cp'))
INERT_HEADS = frozenset(('which', 'whereis', 'type', 'man', 'apt', 'apt-get', 'dpkg', 'brew', 'yum', 'dnf',
                         'apk', 'pacman', 'echo', 'printf', 'ls'))
# Only Readers that can recurse have exclusion syntax for an Exclusion Proof.
EXCLUSION_SYNTAX = {'rg': '--glob "!pattern"', 'grep': '--exclude="pattern"', 'tar': '--exclude="pattern"'}

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
    if name == 'base64':
        # -i 在 GNU 是忽略雜訊（無值）、在 BSD 是輸入檔；一律當作帶值的輸入檔處理，
        # 兩種解讀下被讀取的檔案都會被檢查。-o 只決定輸出，不是讀取來源。
        short.update({'d': NEUTRAL, 'D': NEUTRAL, 'h': NEUTRAL, 'w': VALUE, 'b': VALUE, 'i': FILE, 'o': VALUE})
        long.update({'--decode': NEUTRAL, '--ignore-garbage': NEUTRAL, '--help': NEUTRAL, '--version': NEUTRAL,
                     '--wrap': VALUE, '--break': VALUE, '--input': FILE, '--output': VALUE})
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
        return ReadPlan(name, tuple(positional), tuple(auxiliary), recursive, follow, tuple(exclusions), not invalid,
                        recovery=FILE_INPUT_RECOVERY if name == 'base64' else None)


# `if=` operands that dd reads as data; every other operand only shapes the copy.
DD_VALUE_OPERANDS = frozenset((
    'of', 'bs', 'ibs', 'obs', 'cbs', 'count', 'skip', 'seek', 'iseek', 'oseek', 'conv',
    'iflag', 'oflag', 'status', 'skip_bytes', 'count_bytes', 'seek_bytes'))

# 這兩個 Reader 的輸入是檔案路徑，不是搜尋目錄，所以不建議 git grep。
FILE_INPUT_RECOVERY = Recovery(
    'name each input as an explicit literal path without wildcards or shell expansions.', None)


@dataclass(frozen=True)
class DdAdapter:
    """dd names its input with the `if=` operand, not with dashes or bare filenames."""
    name: str = 'dd'
    exclusion_syntax = None

    def plan(self, args):
        if len(args) == 1 and args[0].value in ('--help', '--version'):
            return ReadPlan('dd', (), (), False, False, (), True)
        # 反引號內的字會被詞法切成多個字；含命令替換就直接交給政策判定為無法確定的來源。
        substituted = tuple(t for t in args if t.substitution)
        if substituted:
            return ReadPlan('dd', substituted, (), False, False, (), True, recovery=FILE_INPUT_RECOVERY)
        targets = []
        for token in args:
            key, sep, value = token.value.partition('=')
            # 只回報運算元名稱，不回報值，避免受保護路徑出現在訊息中。
            if token.operator or not sep:
                return UnsupportedSyntax('dd operand is not name=value')
            if key == 'if':
                targets.append(replace(token, value=value))
            elif key not in DD_VALUE_OPERANDS:
                return UnsupportedSyntax('dd operand %s' % ascii(key))
        return ReadPlan('dd', tuple(targets), (), False, False, (), True, recovery=FILE_INPUT_RECOVERY)


# Option grammar shared by tar and cp. `OPTIONAL` options take a value only through `--name=value`.
OPTIONAL = 'optional'
DIR = (True, 'dir')
EXEC = (True, 'exec')


def _events(name, args, short, long, old_style=False):
    """Split options from operands in order; the order matters to `tar -C`.

    Returns ('opt', flag, effect, value, token) and ('operand', token) events,
    or UnsupportedSyntax naming the offending option (never its value).
    """
    events = []
    options = True
    i = 0
    while i < len(args):
        token = args[i]
        arg = token.value
        i += 1
        if options and arg == '--':
            options = False
        elif options and arg.startswith('--'):
            key, sep, value = arg.partition('=')
            choices = [key] if key in long else [k for k in long if k.startswith(key)]
            if len(choices) != 1:
                return UnsupportedSyntax('%s option %s' % (name, ascii(key)))
            key = choices[0]
            arity, effect = long[key]
            value_token = token
            if arity is True and not sep:
                if i >= len(args):
                    return UnsupportedSyntax('%s option %s needs a value' % (name, ascii(key)))
                value_token = args[i]
                value = value_token.value
                i += 1
            elif not arity and sep:
                return UnsupportedSyntax('%s option %s takes no value' % (name, ascii(key)))
            events.append(('opt', key, effect, value, value_token))
        elif options and arg != '-' and (arg.startswith('-') or (old_style and i == 1)):
            # An old-style first word (`tar cf out`) has no dash and takes its values from the next words.
            dashed = arg.startswith('-')
            cluster = arg[1:] if dashed else arg
            waiting = []
            k = 0
            while k < len(cluster):
                letter = cluster[k]
                flag = '-' + letter
                if letter not in short:
                    return UnsupportedSyntax('%s option %s' % (name, ascii(flag)))
                arity, effect = short[letter]
                k += 1
                if not arity:
                    events.append(('opt', flag, effect, '', token))
                    continue
                rest = cluster[k:] if dashed else ''
                if rest:
                    events.append(('opt', flag, effect, rest, token))
                else:
                    waiting.append((flag, effect))
                if dashed:
                    break
            for flag, effect in waiting:
                if i >= len(args):
                    return UnsupportedSyntax('%s option %s needs a value' % (name, ascii(flag)))
                events.append(('opt', flag, effect, args[i].value, args[i]))
                i += 1
        else:
            events.append(('operand', token))
    return events


def _info_only(args):
    return len(args) == 1 and args[0].value in ('--help', '--version')


def _plan(reader, targets, auxiliary, recursive, follow, exclusions, proof_valid, location_unknown=False):
    return ReadPlan(reader, tuple(targets), tuple(auxiliary), recursive, follow, tuple(exclusions), proof_valid,
                    location_unknown=location_unknown, recovery=FILE_INPUT_RECOVERY)


TAR_MODES = {'-c': 'create', '--create': 'create', '-r': 'append', '--append': 'append', '-u': 'append',
             '--update': 'append', '-A': 'catenate', '--catenate': 'catenate', '--concatenate': 'catenate',
             '-x': 'extract', '--extract': 'extract', '--get': 'extract', '-t': 'extract', '--list': 'extract',
             '-d': 'diff', '--diff': 'diff', '--compare': 'diff', '--delete': 'extract'}
# Modes whose operands name files on disk; extract, list and delete operands are archive member names.
TAR_SOURCE_MODES = frozenset(('create', 'append', 'diff'))
# Modes that open the -f archive for reading; create only writes it.
TAR_READ_ARCHIVE_MODES = frozenset(('append', 'catenate', 'extract', 'diff'))


def _tar_grammar():
    short = {c: NEUTRAL for c in 'vzjJapPhkmoOSwWlUM'}
    short.update({c: (False, 'mode') for c in 'crAxtud'})
    short.update({c: VALUE for c in 'bLHVNK'})
    short.update({'f': (True, 'archive'), 'C': DIR, 'T': (True, 'files_from'), 'X': (True, 'exclude_from'),
                  'g': FILE, 'I': EXEC, 'F': EXEC})
    long = {key: (False, 'mode') for key in TAR_MODES if key.startswith('--')}
    long.update({'--' + key: NEUTRAL for key in (
        'gzip', 'gunzip', 'ungzip', 'bzip2', 'xz', 'lzma', 'lzop', 'zstd', 'compress', 'uncompress', 'auto-compress',
        'verbose', 'preserve-permissions', 'same-permissions', 'preserve-order', 'same-order', 'preserve',
        'absolute-names', 'dereference', 'keep-old-files', 'skip-old-files', 'keep-newer-files', 'overwrite',
        'overwrite-dir', 'no-overwrite-dir', 'one-file-system', 'numeric-owner', 'same-owner', 'no-same-owner',
        'no-same-permissions', 'sparse', 'null', 'no-null', 'verbatim-files-from', 'ignore-failed-read', 'to-stdout',
        'touch', 'acls', 'xattrs', 'selinux', 'no-acls', 'no-xattrs', 'no-selinux', 'wildcards', 'ignore-case',
        'no-ignore-case', 'wildcards-match-slash', 'no-wildcards-match-slash', 'exclude-vcs', 'exclude-backups',
        'remove-files', 'delay-directory-restore', 'no-delay-directory-restore', 'hard-dereference', 'verify',
        'show-omitted-dirs', 'block-number', 'interactive', 'confirmation', 'help', 'version', 'seek', 'multi-volume',
        'incremental', 'check-device', 'no-check-device', 'ignore-zeros', 'read-full-records', 'recursive-unlink',
        'unlink-first', 'exclude-caches', 'exclude-caches-all', 'exclude-caches-under', 'clamp-mtime')})
    long.update({'--' + key: (OPTIONAL, 'neutral') for key in ('totals', 'checkpoint', 'atime-preserve', 'occurrence', 'one-top-level')})
    long.update({'--' + key: VALUE for key in (
        'strip-components', 'transform', 'xform', 'owner', 'group', 'mode', 'mtime', 'format', 'blocking-factor',
        'label', 'tape-length', 'newer', 'newer-mtime', 'after-date', 'suffix', 'warning', 'level', 'quoting-style',
        'index-file', 'exclude-tag', 'exclude-tag-all', 'exclude-tag-under', 'owner-map', 'group-map', 'volno-file',
        'starting-file', 'sort', 'hole-detection', 'format-version', 'pax-option', 'add-file', 'sparse-version')})
    long.update({'--file': (True, 'archive'), '--directory': DIR, '--files-from': (True, 'files_from'),
                 '--exclude-from': (True, 'exclude_from'), '--exclude': (True, 'exclude'),
                 '--listed-incremental': FILE, '--no-recursion': (False, 'no_recursion'),
                 '--recursion': (False, 'recursion'), '--anchored': (False, 'invalid'),
                 '--no-wildcards': (False, 'invalid'), '--no-anchored': NEUTRAL, '--use-compress-program': EXEC,
                 '--to-command': EXEC, '--checkpoint-action': EXEC, '--info-script': EXEC,
                 '--new-volume-script': EXEC, '--rsh-command': EXEC})
    return short, long


def _under(token, base):
    """An operand of `tar -C base` names a file below `base` unless it is absolute."""
    if not base or token.value.startswith('/'):
        return token
    return replace(token, value=posixpath.join(base, token.value))


@dataclass(frozen=True)
class TarAdapter:
    """tar reads the files it archives when creating, and the archive itself when extracting or listing."""
    name: str = 'tar'
    exclusion_syntax = EXCLUSION_SYNTAX['tar']
    short: dict = None
    long: dict = None

    def plan(self, args):
        if not args or _info_only(args):
            return _plan('tar', (), (), False, False, (), True)
        events = _events('tar', args, self.short, self.long, old_style=True)
        if isinstance(events, UnsupportedSyntax):
            return events
        modes = {TAR_MODES[event[1]] for event in events if event[0] == 'opt' and event[2] == 'mode'}
        if len(modes) != 1:
            return UnsupportedSyntax('tar needs exactly one operation mode')
        mode = modes.pop()
        archives, operands, auxiliary, exclusions = [], [], [], []
        recursive, proof_valid, unknown = True, True, False
        directory = ''
        seen_dirs = []
        for event in events:
            if event[0] == 'operand':
                operands.append((event[1], directory))
                continue
            _, flag, effect, value, token = event
            if effect == 'exec':
                return UnsupportedSyntax('tar option %s runs another command' % ascii(flag))
            if effect == 'dir':
                if token.dynamic or token.glob or token.substitution:
                    unknown = True
                else:
                    directory = posixpath.join(directory, value) if directory else value
                    seen_dirs.append(directory)
            elif effect == 'archive':
                archives.append((replace(token, value=value), tuple(seen_dirs)))
            elif effect == 'files_from':
                if mode in TAR_SOURCE_MODES or mode == 'catenate':
                    return UnsupportedSyntax('tar option %s reads outside its targets' % ascii(flag))
                auxiliary.append(AuxiliaryInput(value, token))
            elif effect in ('exclude_from', 'file'):
                auxiliary.append(AuxiliaryInput(value, token))
                proof_valid = proof_valid and effect != 'exclude_from'
            elif effect == 'exclude':
                exclusions.append(value)
            elif effect == 'invalid':
                proof_valid = False
            elif effect == 'no_recursion':
                recursive = False
            elif effect == 'recursion':
                recursive = True
        targets = []
        if mode in TAR_READ_ARCHIVE_MODES:
            # 歸檔名稱相對於起始目錄；同時檢查各 -C 目錄下的對應路徑，避免因實作差異漏掉。
            for token, dirs in archives:
                targets.append(token)
                targets.extend(replace(token, value=posixpath.join(d, token.value)) for d in dirs if not token.value.startswith('/'))
        if mode == 'catenate':
            targets.extend(token for token, _ in operands)
        if mode in TAR_SOURCE_MODES:
            targets.extend(_under(token, base) for token, base in operands)
        return _plan('tar', targets, auxiliary, recursive and mode in TAR_SOURCE_MODES and bool(operands), False,
                     exclusions, proof_valid, unknown)


def _cp_grammar():
    short = {c: NEUTRAL for c in 'bdfilnPpsuvxZH'}
    short.update({'a': RECURSE, 'R': RECURSE, 'r': RECURSE, 'L': (False, 'follow'), 'S': VALUE, 't': DIR})
    short['T'] = NEUTRAL
    long = {'--' + key: NEUTRAL for key in (
        'attributes-only', 'copy-contents', 'debug', 'force', 'link', 'no-clobber', 'no-dereference',
        'no-target-directory', 'one-file-system', 'parents', 'remove-destination', 'strip-trailing-slashes',
        'symbolic-link', 'keep-directory-symlink', 'interactive', 'verbose', 'help', 'version')}
    long.update({'--' + key: (OPTIONAL, 'neutral') for key in ('backup', 'preserve', 'reflink', 'update', 'context')})
    long.update({'--archive': RECURSE, '--recursive': RECURSE, '--dereference': (False, 'follow'),
                 '--target-directory': DIR, '--suffix': VALUE, '--sparse': VALUE, '--no-preserve': VALUE})
    return short, long


def _truncated_substitution(token):
    return bool(token.substitution) and token.substitution not in token.value


@dataclass(frozen=True)
class CpAdapter:
    """cp reads every operand except the destination: the last one, or all of them when -t names it."""
    name: str = 'cp'
    exclusion_syntax = None
    short: dict = None
    long: dict = None

    def plan(self, args):
        if not args or _info_only(args):
            return _plan('cp', (), (), False, False, (), True)
        events = _events('cp', args, self.short, self.long)
        if isinstance(events, UnsupportedSyntax):
            return events
        operands = [event[1] for event in events if event[0] == 'operand']
        recursive = any(event[2] == 'recursive' for event in events if event[0] == 'opt')
        follow = recursive and any(event[2] == 'follow' for event in events if event[0] == 'opt')
        explicit_destination = any(event[2] == 'dir' for event in events if event[0] == 'opt')
        destination = None if explicit_destination or not operands else operands[-1]
        # 命令替換會把片段切到分隔符之外，被切斷的字詞不是目的地，而是可能展開成來源。
        sources = [t for t in operands if t is not destination or _truncated_substitution(t)]
        return _plan('cp', sources, (), recursive and bool(sources), follow, (), True)


ADAPTERS = {name: ReaderAdapter(name, *_grammar(name)) for name in READERS if name not in ('dd', 'tar', 'cp')}
ADAPTERS['dd'] = DdAdapter()
ADAPTERS['tar'] = TarAdapter(short=_tar_grammar()[0], long=_tar_grammar()[1])
ADAPTERS['cp'] = CpAdapter(short=_cp_grammar()[0], long=_cp_grammar()[1])
