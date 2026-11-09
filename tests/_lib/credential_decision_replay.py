"""Replay credential-guard commands against fixed fixture trees.

Reads {"cases": [{"command", "patterns", "tree"}]} on stdin and prints one
boolean per case: whether the guard blocks it. Works with both the pre-refactor
`analyze` (reason string or False) and the Verdict-returning one, so the same
replay produced the snapshot and checks the current code.
"""

import json
import os
import sys
import tempfile

from credential_policy import analyze, validate_patterns


def build(root, dirty):
    outside = os.path.join(root, 'outside')
    work = os.path.join(root, 'work')
    clean_target = os.path.join(root, 'clean-target')
    for directory in (outside, os.path.join(outside, 'child'), os.path.join(outside, 'sub'),
                      clean_target, work):
        os.makedirs(directory, exist_ok=True)
    for name in ('dir', 'safe-dir', 'one', 'two', 'src', 'secrets'):
        os.makedirs(os.path.join(work, name), exist_ok=True)
    for name in ('ordinary', 'ordinary.js', 'script.sh', 'safe', '.env.example', 'patterns.txt', 'list'):
        with open(os.path.join(work, name), 'w') as handle:
            handle.write('synthetic\n')
    with open(os.path.join(outside, 'safe'), 'w') as handle:
        handle.write('synthetic\n')
    os.symlink(clean_target, os.path.join(work, 'root-link'))
    if dirty:
        for name in ('.env', 'my.cnf', 'credentials.json', 'secret.conf', os.path.join('secrets', '.env'),
                     os.path.join('two', '.env')):
            with open(os.path.join(work, name), 'w') as handle:
                handle.write('synthetic\n')
        with open(os.path.join(outside, '.env'), 'w') as handle:
            handle.write('synthetic\n')
        os.symlink(os.path.join(outside, 'child'), os.path.join(work, 'link'))
        os.symlink(os.path.join(outside, '.env'), os.path.join(work, 'alias'))
    return work


def blocked(command, patterns, cwd):
    try:
        policy = validate_patterns(json.loads(patterns) if patterns is not None else [])
        result = analyze(command, policy, cwd)
    except (ValueError, TypeError, OSError, RecursionError):
        return True
    kind = getattr(result, 'kind', None)
    if kind is not None:
        return kind != 'allow'
    return bool(result)


def main():
    cases = json.load(sys.stdin)['cases']
    results = []
    with tempfile.TemporaryDirectory() as base:
        base = os.path.realpath(base)
        trees = {name: build(os.path.join(base, name), name == 'dirty') for name in ('clean', 'dirty')}
        for case in cases:
            cwd = trees[case['tree']]
            os.chdir(cwd)
            results.append(blocked(case['command'], case['patterns'], cwd))
    json.dump(results, sys.stdout)


if __name__ == '__main__':
    main()
