"""git Reader adapter: content-reading subcommands and their names-only listings (ADR 0034).

The adapter parses a git invocation into a Read Plan. Files named literally in
the command become targets; files that depend on repository state are named by
a bounded, read-only git listing that the policy judges as an Absence Proof.
Unknown syntax is UnsupportedSyntax, so the policy fails closed.
"""

import os
import posixpath
import re
import subprocess
import time

from credential_options import ListingResult, ReadPlan, Recovery, UnsupportedSyntax, AuxiliaryInput
from credential_scan import MAX_ENTRIES
from credential_shell import Token

RECOVERY = Recovery(
    ambiguous='name literal paths without wildcards, expansions, or pathspec magic; for a search, pass the '
              'directory itself (git grep -n PATTERN -- <directory>); read a blob as <rev>:<path>.',
    recursive='narrow the git pathspec to paths without protected files, add -n to limit history, '
              'or read an explicit non-protected <rev>:<path>.',
)

# Global options that move the repository or change pathspec meaning; the
# listing could not see the same repository, so a read with them is unsupported.
RELOCATING_GLOBALS = ('--git-dir', '--work-tree', '--namespace', '-c', '--config-env', '--bare', '--exec-path',
                      '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs',
                      '--super-prefix', '--no-replace-objects')
PLAIN_GLOBALS = ('--no-pager', '-P', '-p', '--paginate', '--no-optional-locks', '--no-advice')
VALUE_GLOBALS = ('--attr-source', '--list-cmds')
RELOCATING_VARIABLES = re.compile(
    r'^(GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE|'
    r'CONFIG[A-Z_]*|[A-Z]+_PATHSPECS|REPLACE_REF_BASE|NO_REPLACE_OBJECTS|SHALLOW_FILE|GRAFT_FILE))=')

# Option effects: content prints file content; names prints only names or
# statistics; select limits commits or paths and is kept in the listing;
# both is content and select; output is dropped from the listing.
CONTENT, NAMES, SELECT, BOTH, OUTPUT, AUX, EXPR, UNSUPPORTED = (
    'content', 'names', 'select', 'both', 'output', 'aux', 'expr', 'unsupported')

DIFF_OPTIONS = {
    # (takes a value, effect); '=' means the value is optional and only accepted attached.
    '-p': (False, CONTENT), '-u': (False, CONTENT), '--patch': (False, CONTENT), '-U': (True, CONTENT),
    '--unified': (True, CONTENT), '--patch-with-stat': (False, CONTENT), '--patch-with-raw': (False, CONTENT),
    '--word-diff': ('=', CONTENT), '--word-diff-regex': (True, CONTENT), '--color-words': ('=', CONTENT),
    '--check': (False, CONTENT), '--binary': (False, CONTENT), '-W': (False, CONTENT),
    '--function-context': (False, CONTENT), '--ext-diff': (False, CONTENT), '--cc': (False, BOTH),
    '-m': (False, SELECT), '--diff-merges': (True, SELECT), '--remerge-diff': (False, UNSUPPORTED),
    '--textconv': (False, UNSUPPORTED), '--output': (True, UNSUPPORTED),
    '--stat': ('=', NAMES), '--numstat': (False, NAMES), '--shortstat': (False, NAMES), '--dirstat': ('=', NAMES),
    '--dirstat-by-file': ('=', NAMES), '--cumulative': (False, NAMES), '--name-only': (False, NAMES),
    '--name-status': (False, NAMES), '--raw': (False, NAMES), '--summary': (False, NAMES),
    '--compact-summary': (False, NAMES), '-s': (False, NAMES), '--no-patch': (False, NAMES),
    '--quiet': (False, NAMES), '--exit-code': (False, OUTPUT), '--stat-width': (True, OUTPUT),
    '--stat-name-width': (True, OUTPUT), '--stat-graph-width': (True, OUTPUT), '--stat-count': (True, OUTPUT),
    '--diff-filter': (True, OUTPUT), '-S': (True, SELECT), '-G': (True, SELECT), '--pickaxe-all': (False, SELECT),
    '--pickaxe-regex': (False, SELECT), '--find-object': (True, SELECT), '--ignore-submodules': ('=', OUTPUT),
    '--ita-invisible-in-index': (False, SELECT), '--ita-visible-in-index': (False, SELECT),
    '-M': ('=', OUTPUT), '--find-renames': ('=', OUTPUT), '-C': ('=', UNSUPPORTED),
    '--find-copies': ('=', UNSUPPORTED), '--find-copies-harder': (False, UNSUPPORTED), '-B': ('=', OUTPUT), '--break-rewrites': ('=', OUTPUT),
    '-D': (False, OUTPUT), '--irreversible-delete': (False, OUTPUT), '-l': (True, OUTPUT),
    '--no-renames': (False, OUTPUT), '--rename-empty': (False, OUTPUT), '--no-rename-empty': (False, OUTPUT),
    '-R': (False, OUTPUT), '--relative': ('=', OUTPUT), '--no-relative': (False, OUTPUT),
    '-a': (False, OUTPUT), '--text': (False, OUTPUT), '-w': (False, OUTPUT), '-b': (False, OUTPUT),
    '--ignore-all-space': (False, OUTPUT), '--ignore-space-change': (False, OUTPUT),
    '--ignore-space-at-eol': (False, OUTPUT), '--ignore-cr-at-eol': (False, OUTPUT),
    '--ignore-blank-lines': (False, OUTPUT), '-I': (True, OUTPUT), '--ignore-matching-lines': (True, OUTPUT),
    '--minimal': (False, OUTPUT), '--patience': (False, OUTPUT), '--histogram': (False, OUTPUT),
    '--anchored': (True, OUTPUT), '--diff-algorithm': (True, OUTPUT), '--indent-heuristic': (False, OUTPUT),
    '--no-indent-heuristic': (False, OUTPUT), '--inter-hunk-context': (True, OUTPUT),
    '--color': ('=', OUTPUT), '--no-color': (False, OUTPUT), '--color-moved': ('=', OUTPUT),
    '--no-color-moved': (False, OUTPUT), '--color-moved-ws': (True, OUTPUT), '--ws-error-highlight': (True, OUTPUT),
    '--full-index': (False, OUTPUT), '--abbrev': ('=', OUTPUT), '--no-abbrev': (False, OUTPUT),
    '--src-prefix': (True, OUTPUT), '--dst-prefix': (True, OUTPUT), '--no-prefix': (False, OUTPUT),
    '--default-prefix': (False, OUTPUT), '--line-prefix': (True, OUTPUT), '-z': (False, OUTPUT),
    '-O': (True, OUTPUT), '--skip-to': (True, OUTPUT), '--rotate-to': (True, OUTPUT),
    '--submodule': ('=', UNSUPPORTED), '--no-ext-diff': (False, OUTPUT), '--no-textconv': (False, OUTPUT),
    '--no-indent': (False, OUTPUT),
}
DIFF_ONLY = {'--cached': (False, SELECT), '--staged': (False, SELECT), '--merge-base': (False, SELECT),
             '--no-index': (False, SELECT), '--base': (False, SELECT), '--ours': (False, SELECT),
             '--theirs': (False, SELECT), '-1': (False, SELECT), '-2': (False, SELECT), '-3': (False, SELECT),
             '-0': (False, SELECT)}
REVISION_OPTIONS = {
    '-n': (True, SELECT), '--max-count': (True, SELECT), '--skip': (True, SELECT), '--since': (True, SELECT),
    '--after': (True, SELECT), '--until': (True, SELECT), '--before': (True, SELECT),
    '--since-as-filter': (True, SELECT), '--author': (True, SELECT), '--committer': (True, SELECT),
    '--grep': (True, SELECT), '--grep-reflog': (True, SELECT), '--all-match': (False, SELECT),
    '--invert-grep': (False, SELECT), '-i': (False, SELECT), '--regexp-ignore-case': (False, SELECT),
    '-E': (False, SELECT), '--extended-regexp': (False, SELECT), '-F': (False, SELECT),
    '--fixed-strings': (False, SELECT), '-P': (False, SELECT), '--perl-regexp': (False, SELECT),
    '--basic-regexp': (False, SELECT), '--merges': (False, SELECT), '--no-merges': (False, SELECT),
    '--min-parents': (True, SELECT), '--max-parents': (True, SELECT), '--no-min-parents': (False, SELECT),
    '--no-max-parents': (False, SELECT), '--first-parent': (False, SELECT), '--exclude-first-parent-only': (False, SELECT),
    '--all': (False, SELECT), '--branches': ('=', SELECT), '--tags': ('=', SELECT), '--remotes': ('=', SELECT),
    '--glob': (True, SELECT), '--exclude': (True, SELECT), '--reflog': (False, SELECT), '--not': (False, SELECT),
    '--ancestry-path': ('=', SELECT), '--simplify-by-decoration': (False, SELECT), '--full-history': (False, SELECT),
    '--dense': (False, SELECT), '--sparse': (False, SELECT), '--simplify-merges': (False, SELECT),
    '--show-pulls': (False, SELECT), '--follow': (False, SELECT), '--reverse': (False, SELECT),
    '--date-order': (False, SELECT), '--author-date-order': (False, SELECT), '--topo-order': (False, SELECT),
    '--boundary': (False, SELECT), '--left-only': (False, SELECT), '--right-only': (False, SELECT),
    '--cherry-pick': (False, SELECT), '--cherry-mark': (False, SELECT), '--cherry': (False, SELECT),
    '--no-walk': ('=', SELECT), '--do-walk': (False, SELECT), '--full-diff': (False, SELECT),
    '-c': (False, BOTH), '-t': (False, OUTPUT), '-r': (False, OUTPUT), '--root': (False, SELECT),
    '--oneline': (False, OUTPUT), '--pretty': ('=', OUTPUT), '--format': (True, OUTPUT),
    '--abbrev-commit': (False, OUTPUT), '--no-abbrev-commit': (False, OUTPUT), '--decorate': ('=', OUTPUT),
    '--no-decorate': (False, OUTPUT), '--decorate-refs': (True, OUTPUT), '--decorate-refs-exclude': (True, OUTPUT),
    '--source': (False, OUTPUT), '--graph': (False, OUTPUT), '--date': (True, OUTPUT),
    '--relative-date': (False, OUTPUT), '--parents': (False, OUTPUT), '--children': (False, OUTPUT),
    '--left-right': (False, OUTPUT), '--show-signature': (False, OUTPUT), '--notes': ('=', OUTPUT),
    '--no-notes': (False, OUTPUT), '--show-notes': ('=', OUTPUT), '--encoding': (True, OUTPUT),
    '--expand-tabs': ('=', OUTPUT), '--no-expand-tabs': (False, OUTPUT), '--mailmap': (False, OUTPUT),
    '--no-mailmap': (False, OUTPUT), '--use-mailmap': (False, OUTPUT), '--no-use-mailmap': (False, OUTPUT),
    '--log-size': (False, OUTPUT), '--show-linear-break': ('=', OUTPUT), '--clear-decorations': (False, OUTPUT),
    '--no-color': (False, OUTPUT),
}
GREP_OPTIONS = {
    '-n': (False, OUTPUT), '--line-number': (False, OUTPUT), '--column': (False, OUTPUT), '-i': (False, OUTPUT),
    '--ignore-case': (False, OUTPUT), '-w': (False, OUTPUT), '--word-regexp': (False, OUTPUT),
    '-v': (False, OUTPUT), '--invert-match': (False, OUTPUT), '-h': (False, OUTPUT), '-H': (False, OUTPUT),
    '--full-name': (False, OUTPUT), '-E': (False, OUTPUT), '--extended-regexp': (False, OUTPUT),
    '-G': (False, OUTPUT), '--basic-regexp': (False, OUTPUT), '-F': (False, OUTPUT),
    '--fixed-strings': (False, OUTPUT), '-P': (False, OUTPUT), '--perl-regexp': (False, OUTPUT),
    '-A': (True, OUTPUT), '--after-context': (True, OUTPUT), '-B': (True, OUTPUT), '--before-context': (True, OUTPUT),
    '-C': (True, OUTPUT), '--context': (True, OUTPUT), '--heading': (False, OUTPUT), '--break': (False, OUTPUT),
    '--color': ('=', OUTPUT), '--no-color': (False, OUTPUT), '-p': (False, OUTPUT), '--show-function': (False, OUTPUT),
    '-W': (False, OUTPUT), '--function-context': (False, OUTPUT), '-m': (True, OUTPUT), '--max-count': (True, OUTPUT),
    '--max-depth': (True, OUTPUT), '--threads': (True, OUTPUT), '-I': (False, OUTPUT), '-a': (False, OUTPUT),
    '--text': (False, OUTPUT), '--no-textconv': (False, OUTPUT), '-r': (False, OUTPUT), '--recursive': (False, OUTPUT),
    '--no-recursive': (False, OUTPUT), '-z': (False, OUTPUT), '--null': (False, OUTPUT), '-o': (False, OUTPUT),
    '--only-matching': (False, OUTPUT), '--and': (False, OUTPUT), '--or': (False, OUTPUT), '--not': (False, OUTPUT),
    '--all-match': (False, OUTPUT), '-q': (False, NAMES), '--quiet': (False, NAMES), '-l': (False, NAMES),
    '--files-with-matches': (False, NAMES), '--name-only': (False, NAMES), '-L': (False, NAMES),
    '--files-without-match': (False, NAMES), '-c': (False, NAMES), '--count': (False, NAMES),
    '-e': (True, EXPR), '-f': (True, AUX), '--cached': (False, SELECT), '--untracked': (False, SELECT),
    '--no-index': (False, SELECT), '--exclude-standard': (False, SELECT), '--no-exclude-standard': (False, SELECT),
    '--textconv': (False, UNSUPPORTED), '--recurse-submodules': (False, UNSUPPORTED),
    '-O': ('=', UNSUPPORTED), '--open-files-in-pager': ('=', UNSUPPORTED),
}
BLAME_OPTIONS = {
    '-L': (True, OUTPUT), '-l': (False, OUTPUT), '-t': (False, OUTPUT), '-s': (False, OUTPUT), '-e': (False, OUTPUT),
    '--show-email': (False, OUTPUT), '-w': (False, OUTPUT), '-M': ('=', OUTPUT), '-C': ('=', OUTPUT),
    '-p': (False, OUTPUT), '--porcelain': (False, OUTPUT), '--line-porcelain': (False, OUTPUT),
    '--incremental': (False, OUTPUT), '-b': (False, OUTPUT), '--root': (False, OUTPUT),
    '--show-stats': (False, OUTPUT), '-f': (False, OUTPUT), '--show-name': (False, OUTPUT), '-n': (False, OUTPUT),
    '--show-number': (False, OUTPUT), '-c': (False, OUTPUT), '--date': (True, OUTPUT), '--abbrev': ('=', OUTPUT),
    '--first-parent': (False, OUTPUT), '--reverse': (True, OUTPUT), '--ignore-rev': (True, OUTPUT),
    '--ignore-revs-file': (True, AUX), '--contents': (True, AUX), '-S': (True, AUX),
    '--color-lines': (False, OUTPUT), '--color-by-age': (False, OUTPUT), '--progress': (False, OUTPUT),
    '--no-progress': (False, OUTPUT), '--encoding': (True, OUTPUT), '--minimal': (False, OUTPUT),
    '--textconv': (False, UNSUPPORTED), '--no-textconv': (False, OUTPUT),
}
CAT_FILE_OPTIONS = {'-p': (False, CONTENT), '-t': (False, NAMES), '-s': (False, NAMES), '-e': (False, NAMES),
                    '--allow-unknown-type': (False, OUTPUT), '--textconv': (False, UNSUPPORTED),
                    '--filters': (False, UNSUPPORTED), '--path': (True, UNSUPPORTED), '--batch': ('=', UNSUPPORTED),
                    '--batch-check': ('=', UNSUPPORTED), '--batch-command': ('=', UNSUPPORTED)}
PLUMBING_ONLY = {'-r': (False, OUTPUT), '-t': (False, OUTPUT), '--root': (False, SELECT), '--always': (False, OUTPUT),
                 '--no-commit-id': (False, OUTPUT), '-v': (False, OUTPUT), '--cached': (False, SELECT),
                 '--merge-base': (False, SELECT), '--stdin': (False, UNSUPPORTED)}
STASH_SHOW_ONLY = {'-u': (False, SELECT), '--include-untracked': (False, SELECT),
                   '--only-untracked': (False, SELECT), '--no-include-untracked': (False, SELECT)}

GRAMMARS = {
    'diff': {**DIFF_OPTIONS, **DIFF_ONLY},
    'show': {**DIFF_OPTIONS, **REVISION_OPTIONS},
    'log': {**DIFF_OPTIONS, **REVISION_OPTIONS, '-L': (True, CONTENT)},
    'whatchanged': {**DIFF_OPTIONS, **REVISION_OPTIONS, '-L': (True, CONTENT)},
    'grep': GREP_OPTIONS,
    'blame': BLAME_OPTIONS,
    'cat-file': CAT_FILE_OPTIONS,
    'stash show': {**DIFF_OPTIONS, **STASH_SHOW_ONLY},
    'stash list': {**DIFF_OPTIONS, **REVISION_OPTIONS},
    'reflog': {**DIFF_OPTIONS, **REVISION_OPTIONS},
    'diff-tree': {**DIFF_OPTIONS, **REVISION_OPTIONS, **PLUMBING_ONLY},
    'diff-index': {**DIFF_OPTIONS, **PLUMBING_ONLY, '-m': (False, SELECT)},
    'diff-files': {**DIFF_OPTIONS, **PLUMBING_ONLY, **{k: v for k, v in DIFF_ONLY.items() if k in ('-0', '-1', '-2', '-3', '--base', '--ours', '--theirs')}},
}
# log/whatchanged print content only when asked. stash show defaults to a diffstat
# unless stash.showPatch is set, so a bare `stash show` is judged as a read.
CONTENT_BY_DEFAULT = {'diff': True, 'show': True, 'log': False, 'whatchanged': False, 'stash show': True,
                      'stash list': False, 'reflog': False, 'diff-tree': False, 'diff-index': False,
                      'diff-files': False}
# Marks where diff-family listings get --no-ext-diff --no-textconv (after the subcommand words).
DIFF_FLAGS = '\0diff-flags'
OBJECT_TYPES = ('blob', 'tree', 'commit', 'tag')
WILDCARD = re.compile(r'[*?\[]')


def _wildcard(value):
    return WILDCARD.search(value) is not None


def _pathspec_magic(value):
    """Return 'exclude', 'other', or None for a pathspec's magic signature."""
    if value.startswith((':!', ':^')):
        return 'exclude'
    if value.startswith(':('):
        names = value[2:value.find(')')].split(',') if ')' in value else ['?']
        return 'exclude' if names and all(n in ('exclude', 'top', 'literal') for n in names) and 'exclude' in names else 'other'
    if value.startswith(':/') or (value.startswith(':') and len(value) > 1 and not value[1].isalnum() and value[1] not in '._-'):
        return 'other'
    return None


def _split_revision_path(value):
    """Split `<rev>:<path>` at the first colon outside braces; None when not a revision path."""
    if value.startswith(':/'):
        return None
    depth = 0
    for i, char in enumerate(value):
        if char == '{':
            depth += 1
        elif char == '}':
            depth = max(0, depth - 1)
        elif char == ':' and depth == 0:
            rev, path = value[:i], value[i + 1:]
            if rev == '' and re.match(r'^[0-3]:', path):
                path = path[2:]
            return rev, path
    return None


def _parse_options(subcommand, args):
    """Walk options with the subcommand grammar; return (effects, operands, dashdash, error)."""
    grammar = GRAMMARS[subcommand]
    effects = []
    operands = []
    dashdash = None
    i = 0
    while i < len(args):
        token = args[i]
        arg = token.value
        if dashdash is not None:
            operands.append((token, True))
            i += 1
            continue
        if arg == '--':
            dashdash = len(operands)
            i += 1
            continue
        if token.dynamic and arg.startswith('-'):
            return None, None, None, 'git %s option with a dynamic value' % subcommand
        if arg.startswith('--') and len(arg) > 2:
            key, sep, value = arg.partition('=')
            spec = grammar.get(key)
            if spec is None:
                return None, None, None, 'git %s option %s' % (subcommand, ascii(key))
            arity, effect = spec
            if arity is True and not sep:
                i += 1
                if i >= len(args):
                    return None, None, None, 'git %s option %s needs a value' % (subcommand, ascii(key))
                value, token = args[i].value, args[i]
            elif arity is False and sep:
                return None, None, None, 'git %s option %s takes no value' % (subcommand, ascii(key))
            effects.append((effect, key, value, token, arg if arity is not True or sep else None))
        elif arg.startswith('-') and len(arg) > 1 and arg[1:].isdigit() and subcommand in ('log', 'whatchanged', 'show'):
            effects.append((SELECT, '-n', arg[1:], token, arg))
        elif arg.startswith('-') and len(arg) > 1:
            j = 1
            while j < len(arg):
                flag = '-' + arg[j]
                spec = grammar.get(flag)
                if spec is None:
                    return None, None, None, 'git %s option %s' % (subcommand, ascii(flag))
                arity, effect = spec
                rest = arg[j + 1:]
                if arity is True:
                    if rest:
                        value = rest
                    else:
                        i += 1
                        if i >= len(args):
                            return None, None, None, 'git %s option %s needs a value' % (subcommand, ascii(flag))
                        value, token = args[i].value, args[i]
                    effects.append((effect, flag, value, token, None))
                    break
                if arity == '=' and rest:
                    effects.append((effect, flag, rest, token, flag + rest))
                    break
                effects.append((effect, flag, '', token, flag))
                j += 1
        else:
            operands.append((token, False))
        i += 1
    return effects, operands, dashdash, None


def _listing_options(effects):
    """Rebuild the selecting options for a listing; output and content options are dropped."""
    kept = []
    for effect, key, value, token, literal in effects:
        if effect not in (SELECT, BOTH) or key in ('--no-index',):
            continue
        if literal is not None:
            kept.append(literal)
        else:
            kept.extend([key, value])
    return kept


class GitListing:
    """Names the files a git read opens; runs only names-only, read-only git commands."""

    def __init__(self, directories, steps, revision_paths, objects, grep_operands=None, grep_pathspecs=(),
                 grep_cached=False, show_step=None):
        self.directories = directories        # literal -C components, in order
        self.steps = steps                    # listing argv tails, each yielding names
        self.revision_paths = revision_paths  # (rev, path, working-directory relative)
        self.objects = objects                # (object, mode) with mode 'show' or 'cat-file'
        self.grep_operands = grep_operands    # undecided git grep operands, or None
        self.grep_pathspecs = tuple(grep_pathspecs)
        self.grep_cached = grep_cached
        self.show_step = show_step            # show listing that runs only for typed commits

    def resolve(self, cwd, deadline):
        literal = []
        for rev, path, relative in self.revision_paths:
            literal.append(posixpath.normpath(posixpath.join(*self.directories, path)) if relative and self.directories else path)
        if cwd is None:
            # 不在已知目錄時不執行 git；只能字面判定路徑。
            failure = 'unknown' if (self.steps or self.objects or self.grep_operands is not None) else None
            return ListingResult(failure, 'git listing needs a known working directory', None, tuple(literal), ())
        try:
            workdir = os.path.normpath(os.path.join(cwd, *self.directories)) if self.directories else cwd
            if not os.path.isdir(workdir):
                raise _Error()
            head = _git(workdir, ['rev-parse', '--show-toplevel', '--show-object-format'], deadline)
            top, _, object_format = head.decode('utf-8', 'surrogateescape').strip('\n').rpartition('\n')
            empty_tree = EMPTY_TREES.get(object_format.strip())
            if not top or empty_tree is None:
                raise _Error()
            queries = ['%s:%s' % (rev, path) for rev, path, _ in self.revision_paths]
            plan = []
            for obj, mode in self.objects:
                if mode == 'diff':
                    # diff 的運算元可能是路徑、範圍或 blob；只有 blob 會直接印出內容。
                    if os.path.lexists(os.path.join(workdir, obj)):
                        continue
                    for part in (p for p in re.split(r'\.{2,3}', obj) if p):
                        plan.append((obj, 'diff', len(queries)))
                        queries.append(part + '^{}')
                elif mode in ('show', 'peel') and re.search(r'\.{2,3}', obj):
                    # show 的範圍會逐一顯示 commit；兩端各自判定型別。
                    for part in (p for p in re.split(r'\.{2,3}', obj) if p):
                        plan.append((obj, 'range-' + mode, len(queries)))
                        queries.append(part + '^{}')
                else:
                    # show 與 cat-file <type> 會剝開 tag；指向 blob 的 tag 也會印出內容。
                    plan.append((obj, mode, len(queries)))
                    queries.append(obj + '^{}' if mode in ('show', 'peel') else obj)
            types = _object_types(workdir, queries, deadline)
            targets = []
            for (rev, path, relative), kind in zip(self.revision_paths, types):
                if kind == 'tree':
                    continue
                base = workdir if relative else top
                targets.append(os.path.normpath(os.path.join(base, path)))
            steps = list(self.steps)
            commits = []
            for obj, mode, index in plan:
                kind = types[index]
                if kind == 'blob':
                    return ListingResult(None, None, 'blob object %s' % ascii(obj), tuple(targets), ())
                if mode in ('show', 'peel', 'cat-file', 'range-show', 'range-peel') and kind is None:
                    raise _Error()
                # 列舉傳入剝開後的 commit：tag 物件會先印出標頭與訊息，混進第一個檔名。
                if mode == 'show' and kind == 'commit':
                    commits.append(obj + '^{commit}')
                elif mode == 'range-show' and kind == 'commit' and obj not in commits:
                    commits.append(obj)
            if self.show_step is not None and commits:
                split = self.show_step.index('--')
                steps.append(self.show_step[:split] + commits + self.show_step[split:])
            if self.grep_operands is not None:
                steps = self._grep_steps(workdir, deadline)
            listed = []
            attr_source = None
            filter_overrides = []
            if any(DIFF_FLAGS in step for step in steps):
                # diff.submodule=diff 會在原指令印出 submodule 內的檔案內容，列舉看不到。
                # 讀取 repository 自己的設定；不可套用列舉用的覆寫值。
                settings = _git_optional(workdir, ['config', '-z', '--get-regexp', r'^(filter\..*|diff\.submodule)$'],
                                         deadline, overrides=False) or b''
                drivers = set()
                for entry in settings.decode('utf-8', 'surrogateescape').split('\0'):
                    key, _, value = entry.partition('\n')
                    if key == 'diff.submodule' and value.strip() == 'diff':
                        return ListingResult('unsupported', 'diff.submodule=diff prints submodule content', None,
                                             tuple(targets), ())
                    if key.startswith('filter.') and key.count('.') >= 2:
                        drivers.add(key[len('filter.'):key.rindex('.')])
                # .git/info/attributes 不受 --attr-source 影響；把每個 filter driver 覆寫成空值。
                filter_overrides = [setting for name in sorted(drivers) for setting in (
                    'filter.%s.clean=' % name, 'filter.%s.smudge=' % name, 'filter.%s.process=' % name,
                    'filter.%s.required=false' % name)]
                attr_source = empty_tree
            for step in steps:
                diff_step = DIFF_FLAGS in step
                output = _git(workdir, step, deadline, attr_source if diff_step else None,
                              config=filter_overrides if diff_step else ())
                for name in output.decode('utf-8', 'surrogateescape').split('\0'):
                    name = name.strip('\n')
                    if '\n' in name:
                        # -z 列舉的項目不會含換行；出現代表輸出夾帶了標頭，無法逐一判定。
                        raise _Error()
                    if name:
                        listed.append(os.path.normpath(os.path.join(top, name)))
                        if len(listed) > MAX_ENTRIES:
                            return ListingResult('limit', 'entry limit', None, tuple(targets), ())
            return ListingResult(None, None, None, tuple(targets), tuple(listed))
        except _Limit:
            return ListingResult('limit', 'time limit', None, tuple(literal), ())
        except _Error:
            return ListingResult('error', 'git listing failed', None, tuple(literal), ())

    def _grep_steps(self, workdir, deadline):
        revisions, pathspecs = [], list(self.grep_pathspecs)
        undecided = []
        for operand in self.grep_operands:
            if os.path.lexists(os.path.join(workdir, operand)):
                pathspecs.append(operand)
            else:
                undecided.append(operand)
        for operand, kind in zip(undecided, _object_types(workdir, undecided, deadline)):
            if kind not in ('commit', 'tree', 'tag'):
                raise _Error()
            revisions.append(operand)
        if not revisions:
            return [['ls-files', '-z', '--full-name', *(['--cached'] if self.grep_cached else []), '--', *pathspecs]]
        return [['ls-tree', '-r', '-z', '--name-only', '--full-name', rev, '--', *pathspecs] for rev in revisions]


class _Limit(Exception):
    pass


class _Error(Exception):
    pass


def _environment():
    env = dict(os.environ)
    # 列舉只讀名稱：不取鎖、不觸發 partial clone 的遠端抓取、不互動。
    env.update(GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1', GIT_TERMINAL_PROMPT='0', GIT_PAGER='cat', PAGER='cat',
               GIT_ATTR_NOSYSTEM='1')
    return env


# The empty tree is a fixed object per hash format; it serves as an attribute source with no attributes.
EMPTY_TREES = {'sha1': '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
               'sha256': '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321'}


def _git(workdir, args, deadline, attr_source=None, stdin=None, overrides=True, config=()):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise _Limit()
    # 不執行 repository 設定的外部程式：pager、fsmonitor、hook、external diff、textconv；
    # 以空 tree 作為 attribute 來源，clean/smudge filter 與 diff driver 都不會被套用。
    # log.showSignature 會執行 gpg.program。
    argv = ['git', '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
            '-c', 'log.showSignature=false']
    if overrides:
        argv += ['-c', 'diff.relative=false', '-c', 'diff.submodule=short', '-c', 'core.attributesFile=/dev/null']
    for setting in config:
        argv += ['-c', setting]
    if attr_source:
        argv.append('--attr-source=' + attr_source)
    for arg in args:
        if arg == DIFF_FLAGS:
            # 不進入 submodule：子 git 會套用 submodule 自己的設定與 filter；只少列 gitlink 名稱。
            argv += ['--no-ext-diff', '--no-textconv', '--ignore-submodules=all']
        else:
            argv.append(arg)
    try:
        result = subprocess.run(argv, cwd=workdir, env=_environment(), input=stdin,
                                stdin=None if stdin is not None else subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=remaining)
    except subprocess.TimeoutExpired:
        raise _Limit()
    except OSError:
        raise _Error()
    if result.returncode != 0:
        raise _Error()
    return result.stdout


def _git_optional(workdir, args, deadline, overrides=True):
    try:
        return _git(workdir, args, deadline, overrides=overrides)
    except _Error:
        return None


def _object_types(workdir, names, deadline):
    """Type every object name in one batch; a missing or ambiguous name maps to None."""
    if not names:
        return []
    if any('\n' in name or '\0' in name for name in names):
        raise _Error()
    output = _git(workdir, ['cat-file', '--batch-check=%(objecttype)'], deadline,
                  stdin=''.join(name + '\n' for name in names).encode('utf-8', 'surrogateescape'))
    lines = output.decode('utf-8', 'replace').split('\n')
    if len(lines) < len(names):
        raise _Error()
    return [line if line in OBJECT_TYPES else None for line in lines[:len(names)]]


class GitAdapter:
    name = 'git'

    def plan(self, args, prefixes=(), environment_relocated=False):
        """Return a ReadPlan, UnsupportedSyntax, or None when the invocation reads no file content.

        `environment_relocated` is True when the command sets a relocating GIT_* variable
        anywhere, for example `export GIT_DIR=…; git diff` in an earlier segment.
        """
        relocated = next((ascii(w.value.split('=', 1)[0]) for w in prefixes if RELOCATING_VARIABLES.match(w.value)), None)
        if environment_relocated:
            relocated = relocated or 'a relocating GIT_* variable'
        directories = []
        location_unknown = False
        i = 0
        while i < len(args) and args[i].value.startswith('-'):
            arg = args[i].value
            key = arg.split('=', 1)[0]
            if arg == '--':
                # 全域選項到此結束，下一個字是子指令。
                i += 1
                break
            if arg == '-C':
                i += 1
                if i >= len(args):
                    return UnsupportedSyntax('git option -C needs a value')
                if args[i].dynamic or args[i].glob:
                    location_unknown = True
                else:
                    directories.append(args[i].value)
            elif key in RELOCATING_GLOBALS:
                relocated = relocated or 'git option %s' % ascii(key)
                value = arg.split('=', 1)[1] if '=' in arg else (args[i + 1].value if i + 1 < len(args) else '')
                # 當場定義的 alias 可把讀取包成未知的子指令，無法判定，不論子指令為何都拒絕。
                if key in ('-c', '--config-env') and value.lower().startswith('alias.'):
                    return UnsupportedSyntax('git option %s defines an alias' % ascii(key))
                if '=' not in arg and key in ('--git-dir', '--work-tree', '--namespace', '-c', '--config-env', '--exec-path', '--super-prefix'):
                    i += 1
            elif arg in PLAIN_GLOBALS:
                pass
            elif key in VALUE_GLOBALS:
                if '=' not in arg:
                    i += 1
            elif arg in ('--version', '--help', '-h', '--html-path', '--man-path', '--info-path'):
                return None
            else:
                # 不認得的全域選項可能帶值，無法確定子指令；一律拒絕。
                return UnsupportedSyntax('git option %s' % ascii(key))
            i += 1
        if i >= len(args):
            return None
        subcommand = args[i].value
        rest = args[i + 1:]
        if subcommand == 'stash':
            if not rest or rest[0].value not in ('show', 'list'):
                return None
            subcommand, rest = 'stash ' + rest[0].value, rest[1:]
        elif subcommand == 'reflog':
            if rest and rest[0].value == 'show':
                rest = rest[1:]
            elif rest and not rest[0].value.startswith('-') and rest[0].value in ('expire', 'delete', 'exists', 'list'):
                return None
        if subcommand not in GRAMMARS:
            return None
        effects, operands, dashdash, error = _parse_options(subcommand, rest)
        if error:
            # 非讀取用法（例如 git diff --frobnicate）仍無法確認，維持拒絕。
            return UnsupportedSyntax(error)
        kinds = {effect for effect, *_ in effects}
        if UNSUPPORTED in kinds:
            option = next(key for effect, key, *_ in effects if effect == UNSUPPORTED)
            return UnsupportedSyntax('git %s option %s' % (subcommand, ascii(option)))
        reads = self._reads(subcommand, kinds, effects, operands)
        if not reads:
            return None
        if relocated:
            return UnsupportedSyntax('%s relocates the repository' % relocated)
        return self._plan(subcommand, effects, operands, dashdash, directories, location_unknown)

    @staticmethod
    def _reads(subcommand, kinds, effects, operands):
        if subcommand in ('grep', 'blame'):
            return NAMES not in kinds or CONTENT in kinds
        if subcommand == 'cat-file':
            if CONTENT in kinds:
                return True
            return NAMES not in kinds and bool(operands) and operands[0][0].value in OBJECT_TYPES and operands[0][0].value == 'blob'
        if any(effect == CONTENT and key == '-L' for effect, key, *_ in effects):
            return True
        if subcommand == 'show' and any(not after for _, after in operands):
            # --stat、-s 等只對 commit 有效；blob（或指向 blob 的 tag）仍會印出內容。
            return True
        if CONTENT in kinds or BOTH in kinds:
            return True
        return CONTENT_BY_DEFAULT[subcommand] and NAMES not in kinds

    def _plan(self, subcommand, effects, operands, dashdash, directories, location_unknown):
        def located(value):
            return posixpath.normpath(posixpath.join(*directories, value)) if directories else value

        def literal(token, value=None):
            value = token.value if value is None else value
            return Token(located(value), glob=token.glob or _wildcard(value), dynamic=token.dynamic)

        def ambiguous_token(token):
            return Token(token.value, glob=True, dynamic=token.dynamic)

        targets, auxiliary, revision_paths, objects, steps = [], [], [], [], []
        recursive = False
        show_step = None
        for effect, key, value, token, _ in effects:
            if effect == AUX:
                auxiliary.append(AuxiliaryInput(located(value), token))
            if key == '-L' and subcommand in ('log', 'whatchanged'):
                # -L<start>,<end>:<file> 與 -L:<func>:<file>：最後一個冒號之後是檔案。
                path = value.rsplit(':', 1)[-1] if ':' in value else ''
                if not path:
                    return UnsupportedSyntax('git %s option -L without a file' % subcommand)
                targets.append(literal(token, path))

        def add_pathspec(token):
            magic = _pathspec_magic(token.value)
            if token.dynamic or token.glob or magic == 'other' or (magic is None and _wildcard(token.value)):
                targets.append(ambiguous_token(token))
                return False
            if magic is None:
                targets.append(literal(token))
            return True

        def add_object_operand(token, mode):
            if token.dynamic or token.glob:
                targets.append(ambiguous_token(token))
                return
            split = _split_revision_path(token.value)
            if split is None:
                objects.append((token.value, mode))
                return
            rev, path = split
            if _wildcard(path) or _wildcard(rev):
                targets.append(ambiguous_token(token))
                return
            relative = path.startswith('./') or path.startswith('../') or path in ('.', '..')
            revision_paths.append((rev, path, relative))

        listing_options = _listing_options(effects)
        before = [t for t, after in operands if not after]
        after = [t for t, after in operands if after]
        # 列舉沿用原指令的 `--` 位置；`--` 之前的運算元不會以 - 開頭（否則已被當成選項）。
        tail = [t.value for t in before] + (['--', *[t.value for t in after]] if dashdash is not None else [])

        def add_revisions(tokens):
            for token in tokens:
                if token.dynamic or token.glob or _wildcard(token.value):
                    targets.append(ambiguous_token(token))
                elif _split_revision_path(token.value) and not token.value.startswith(':/'):
                    add_object_operand(token, 'cat-file')
                else:
                    targets.append(literal(token))
                    objects.append((token.value, 'diff'))

        if subcommand == 'cat-file':
            positional = before + after
            typed = bool(positional) and positional[0].value in OBJECT_TYPES
            if typed:
                positional = positional[1:]
            for token in positional[:1]:
                # `cat-file <type>` 會剝開 tag；`-p` 印出的是 tag 物件本身。
                add_object_operand(token, 'peel' if typed else 'cat-file')
        elif subcommand == 'blame':
            # `git blame <file> <rev>` 與 `git blame <rev> <file>` 都合法；每個運算元都可能是檔案。
            if not before and not after:
                return UnsupportedSyntax('git blame without a file')
            for token in before + after:
                if not add_pathspec(token):
                    break
        elif subcommand == 'grep':
            has_pattern = any(effect in (EXPR, AUX) for effect, *_ in effects)
            rest = before if has_pattern else before[1:]
            flags = {key for _, key, *_ in effects}
            pathspecs = []
            for token in after:
                if add_pathspec(token):
                    pathspecs.append(token.value)
            undecided = []
            for token in rest:
                split = _split_revision_path(token.value) if not token.value.startswith(':') else None
                if token.dynamic or token.glob or _wildcard(token.value) or _pathspec_magic(token.value) == 'other':
                    targets.append(ambiguous_token(token))
                elif split is not None:
                    # <rev>:<dir> 讓 ls-tree 以子樹為基準列出名稱，多層 pattern 會比對不到。
                    targets.append(ambiguous_token(token))
                else:
                    targets.append(literal(token))
                    undecided.append(token.value)
            if '--no-index' in flags or '--untracked' in flags:
                roots = [literal(Token(p)) for p in pathspecs] + [literal(t) for t in rest if not t.glob]
                # 沒有路徑時掃描 -C 之後的目錄，而不是 hook 的工作目錄。
                roots = roots or [literal(Token('.'))]
                recursive = True
                targets.extend(roots)
            if '--no-index' in flags:
                return ReadPlan('git', tuple(targets), tuple(auxiliary), True, False, (), False,
                                None, location_unknown, RECOVERY)
            listing = GitListing(tuple(directories), [], (), (), grep_operands=undecided,
                                 grep_pathspecs=pathspecs, grep_cached='--cached' in flags)
            return ReadPlan('git', tuple(targets), tuple(auxiliary), recursive, False, (), False,
                            listing, location_unknown, RECOVERY)
        elif subcommand == 'diff':
            if any(key == '--no-index' for _, key, *_ in effects):
                for token in before + after:
                    add_pathspec(token)
                return ReadPlan('git', tuple(targets), tuple(auxiliary), True, False, (), False,
                                None, location_unknown, RECOVERY)
            add_revisions(before)
            for token in after:
                add_pathspec(token)
            steps.append(['diff', DIFF_FLAGS, '--name-only', '-z', '--no-renames', *listing_options, *tail])
        elif subcommand == 'show':
            names_only = NAMES in {e for e, *_ in effects} and CONTENT not in {e for e, *_ in effects}
            for token in before or [Token('HEAD')]:
                add_object_operand(token, 'peel' if names_only else 'show')
            for token in after:
                add_pathspec(token)
            show_step = None if names_only else ['show', DIFF_FLAGS, '--name-only', '--format=', '-z', '--no-renames',
                                                 *listing_options, '--', *[t.value for t in after]]
        elif subcommand in ('log', 'whatchanged'):
            if not any(key == '-L' for _, key, *_ in effects):
                for token in before:
                    if token.dynamic or token.glob or _wildcard(token.value):
                        targets.append(ambiguous_token(token))
                    else:
                        targets.append(literal(token))
                for token in after:
                    add_pathspec(token)
                steps.append(['log', DIFF_FLAGS, '--name-only', '--format=', '-z', '--no-renames', *listing_options,
                              *tail])
        elif subcommand in ('reflog', 'stash list'):
            for token in before + after:
                if token.dynamic or token.glob or _wildcard(token.value) or token.value.startswith('-'):
                    targets.append(ambiguous_token(token))
            head = ['log', DIFF_FLAGS, '-g'] if subcommand == 'reflog' else ['stash', 'list', DIFF_FLAGS]
            steps.append([*head, '--name-only', '--format=', '-z', '--no-renames', *listing_options, *tail])
        elif subcommand in ('diff-tree', 'diff-index', 'diff-files'):
            add_revisions(before)
            for token in after:
                add_pathspec(token)
            extra = ['-r', '--no-commit-id'] if subcommand == 'diff-tree' else []
            steps.append([subcommand, DIFF_FLAGS, *extra, '--name-only', '-z', '--no-renames', *listing_options, *tail])
        elif subcommand == 'stash show':
            for token in before + after:
                # 這些運算元會進入 hook 自己執行的列舉；以 - 開頭的值可能被當成選項。
                if token.dynamic or token.glob or token.value.startswith('-'):
                    targets.append(ambiguous_token(token))
            steps.append(['stash', 'show', DIFF_FLAGS, '--name-only', '-z', '--no-renames', *listing_options,
                          *[t.value for t in before]])

        listing = None
        if steps or revision_paths or objects:
            listing = GitListing(tuple(directories), steps, tuple(revision_paths), tuple(objects),
                                 show_step=show_step)
        return ReadPlan('git', tuple(targets), tuple(auxiliary), recursive, False, (), False,
                        listing, location_unknown, RECOVERY)


GIT_ADAPTER = GitAdapter()
