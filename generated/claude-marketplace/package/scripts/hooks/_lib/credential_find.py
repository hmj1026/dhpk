"""(#1456) The files a visible find invocation hands to -exec or to a piped xargs Reader."""
from dataclasses import dataclass, field
import fnmatch
import posixpath

import credential_verdict as verdict
from credential_options import Recovery
from credential_scan import scan_roots

EXEC_ACTIONS = frozenset(('-exec', '-execdir', '-ok', '-okdir'))
NAME_TESTS = {'-name': False, '-iname': True}
UNMODELLED = frozenset(('-o', '-or', '!', '-not', ',', '(', ')', '-printf', '-fprintf', '-fprint', '-fprint0', '-fls'))
VALUE_TESTS = frozenset(('-path', '-ipath', '-wholename', '-iwholename', '-regex', '-iregex', '-type', '-xtype',
                         '-maxdepth', '-mindepth', '-newer', '-anewer', '-cnewer', '-perm', '-size', '-user', '-group',
                         '-uid', '-gid', '-mtime', '-mmin', '-atime', '-amin', '-ctime', '-cmin', '-links', '-inum',
                         '-samefile', '-fstype', '-regextype', '-used', '-context', '-lname', '-ilname'))
RECOVERY = Recovery(
    ambiguous='name each file as an explicit literal operand of the Reader, or add a find -name filter that does not match a protected file.',
    recursive='add a find -name filter that does not match a protected file, or name each file as an explicit literal operand of the Reader.')


@dataclass
class FindSpec:
    roots: list
    filters: list = field(default_factory=list)
    clauses: list = field(default_factory=list)
    follow: bool = False
    unmodelled: bool = False


def find_spec(words, head):
    """Parse `find` at words[head]; None when words[head] is not find."""
    if posixpath.basename(words[head].value) != 'find' or words[head].dynamic:
        return None
    spec = FindSpec(roots=[])
    i = head + 1
    while i < len(words) and (words[i].value in ('-H', '-L', '-P', '-D') or words[i].value.startswith('-O')):
        spec.follow = spec.follow or words[i].value == '-L'
        i += 2 if words[i].value == '-D' else 1
    while i < len(words) and not words[i].value.startswith('-') and words[i].value not in ('(', '!'):
        spec.roots.append(words[i])
        i += 1
    while i < len(words):
        value = words[i].value
        if value in EXEC_ACTIONS:
            end = i + 1
            while end < len(words) and not (words[end].value == ';' or (words[end].value == '+' and words[end - 1].value == '{}')):
                end += 1
            spec.clauses.append(words[i + 1:end])
            i = end + 1
            continue
        if value in NAME_TESTS and i + 1 < len(words):
            spec.filters.append((words[i + 1], NAME_TESTS[value]))
            i += 2
            continue
        if value in UNMODELLED:
            spec.unmodelled = True
        elif value == '-follow':
            spec.follow = True
        elif value in VALUE_TESTS:
            i += 1
        i += 1
    return spec


def _selected(name, filters):
    for word, folded in filters:
        pattern, text = (word.value.lower(), name.lower()) if folded else (word.value, name)
        if not fnmatch.fnmatchcase(text, pattern):
            return False
    return True


def selection_verdict(spec, patterns, cwd, wrapped, matching, protected, effective):
    """Judge the paths find selects as Reader targets; allow when none can be a Protected Path.

    Only a find whose selection is a plain conjunction with a -name or -iname filter is judged. Without a
    name filter, or with a predicate this module does not model, the selection is unknown and keeps the
    verdict the caller had before (no new recursive scan, no new block).
    """
    filters = spec.filters
    if spec.unmodelled or not filters:
        return verdict.allow()
    for word, folded in filters:
        if word.dynamic:
            return verdict.ambiguous('find -name %s' % ascii(word.value), RECOVERY.ambiguous)
        if not any(c in word.value for c in '*?[') and protected(word.value, patterns, cwd):
            return verdict.protected()
    roots = spec.roots
    if cwd is None or wrapped or any(t.dynamic or t.glob for t in roots):
        return verdict.recursive_unproven(None, 'find selection needs a known working directory', RECOVERY.recursive)
    paths = [posixpath.join(cwd, t.value) for t in roots] or [cwd]

    def matcher(path):
        if not _selected(posixpath.basename(path), filters):
            return set()
        return matching(path, patterns, cwd)

    failure, hits, found = scan_roots(paths, matcher, set(effective), spec.follow)
    if not failure and not hits:
        return verdict.allow()
    details = [failure] if failure else []
    if hits:
        details.append('patterns ' + ', '.join(ascii(p) for p in sorted(hits)))
    if found:
        details.append('paths ' + ', '.join(ascii(p) for p in found))
    return verdict.recursive_unproven(None, '; '.join(details), RECOVERY.recursive)
