"""The credential guard's single decision type; every Verdict is built here."""

from dataclasses import dataclass

ALLOW = 'allow'
PROTECTED = 'protected'
UNSUPPORTED = 'unsupported'
AMBIGUOUS_TARGET = 'ambiguous_target'
RECURSIVE_UNPROVEN = 'recursive_unproven'
INSPECTION_FAILURE = 'inspection_failure'

# Agents and docs already rely on the first three strings; keep them exact.
REASONS = {
    PROTECTED: 'protected path',
    UNSUPPORTED: 'unsupported reader syntax',
    AMBIGUOUS_TARGET: 'ambiguous read target',
    RECURSIVE_UNPROVEN: 'recursive read without credential exclusions',
    INSPECTION_FAILURE: 'credential inspection failure',
}

DEFAULT_HINT = 'use controlled extraction or provide non-secret information.'
# Hints name only shell forms; an agent tool such as Grep or Read may not exist in the session (#1260).
LITERAL_TARGETS = 'name each target as an explicit literal path without wildcards or shell expansions'
DIRECTORY_SEARCH = 'to search a directory in a git repository, use git grep -n PATTERN -- <directory>'
# For a Reader's read targets, where a search can replace the wildcard; input files keep LITERAL_TARGETS.
TARGET_SEARCH = '%s; %s.' % (LITERAL_TARGETS, DIRECTORY_SEARCH)


@dataclass(frozen=True)
class Verdict:
    kind: str
    detail: str = ''
    hint: str = ''

    @property
    def allowed(self):
        return self.kind == ALLOW

    def message(self):
        if self.allowed:
            return ALLOW
        reason = REASONS[self.kind]
        if self.detail:
            reason += ': ' + self.detail
        return '%s; %s' % (reason, self.hint)


def _exclusion_clause(syntax):
    clause = 'exclude every default and custom credential pattern'
    return '%s with %s' % (clause, syntax) if syntax else clause


def allow():
    return Verdict(ALLOW)


def protected(detail=''):
    return Verdict(PROTECTED, detail, DEFAULT_HINT)


def unsupported(syntax, detail=''):
    """`syntax` is the Reader's exclusion syntax, or None when it cannot recurse."""
    parts = ['rewrite with supported options and explicit non-protected files']
    if syntax:
        parts.append('for a recursive search, ' + _exclusion_clause(syntax))
    return Verdict(UNSUPPORTED, detail, '; '.join(parts) + '.')


def ambiguous(detail='', recovery=None):
    """`recovery` is Reader-specific advice that replaces the default hint."""
    return Verdict(AMBIGUOUS_TARGET, detail, recovery or LITERAL_TARGETS + '.')


def recursive_unproven(syntax, detail='', recovery=None):
    """`recovery` is Reader-specific advice that replaces the default hint."""
    return Verdict(RECURSIVE_UNPROVEN, detail, recovery or
                   '%s, or target explicit non-protected files.' % _exclusion_clause(syntax))


def inspection_failure(detail=''):
    return Verdict(INSPECTION_FAILURE, detail, DEFAULT_HINT)
