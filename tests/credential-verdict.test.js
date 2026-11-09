'use strict';

// In-process seam for the #1243 decision model: Reader adapters produce Read
// Plans, and the policy returns one Credential Verdict. One Python process runs
// each table; hook-boundary behavior stays in credential-read-policy.test.js.
const { test, run, assert } = require('./_lib/tinytest');
const { ROOT } = require('./_lib/hookharness');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function python(source) {
  const result = spawnSync('python3', ['-B', '-c', source], {
    env: { ...process.env, PYTHONPATH: path.join(ROOT, 'scripts/hooks/_lib') }, encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr + result.stdout);
}

test('Reader adapters describe invocations as Read Plans without judging them', () => {
  python(String.raw`
from credential_options import ADAPTERS, READERS, ReadPlan, UnsupportedSyntax
from credential_shell import tokenize

def plan(reader, args):
    return ADAPTERS[reader].plan(tokenize(args))

def values(tokens):
    return tuple(t.value for t in tokens)

cases = [
    # reader, args, targets, auxiliary inputs, recursive, follow, exclusions, proof valid
    ('grep', '-r -f patterns.txt src', ('src',), ('patterns.txt',), True, False, (), True),
    ('grep', '-R needle .', ('.',), (), True, True, (), True),
    ('grep', '-r --exclude=.env needle .', ('.',), (), True, False, ('.env',), True),
    ('grep', '-r --include=*.js needle .', ('.',), (), True, False, (), False),
    ('rg', 'needle', (), (), True, False, (), True),
    ('rg', "--glob '!*.pem' needle .", ('.',), (), True, False, ('*.pem',), True),
    ('rg', '-g foo needle .', ('.',), (), True, False, (), False),
    ('rg', '--ignore-file list needle .', ('.',), ('list',), True, False, (), False),
    ('sed', '-f.env ordinary', ('ordinary',), ('.env',), False, False, (), True),
    ('head', '-15 ordinary', ('ordinary',), (), False, False, (), True),
    ('awk', "-F, '{print}' a b", ('a', 'b'), (), False, False, (), True),
    ('cat', '-n a -- -b', ('a', '-b'), (), False, False, (), True),
]
for reader, args, targets, aux, recursive, follow, exclusions, valid in cases:
    result = plan(reader, args)
    assert isinstance(result, ReadPlan), (reader, args, result)
    assert result.reader == reader
    assert values(result.targets) == targets, (args, result.targets)
    assert tuple(a.value for a in result.auxiliary_inputs) == aux, (args, result.auxiliary_inputs)
    assert (result.recursive, result.follow) == (recursive, follow), (args, result)
    assert result.exclusions == exclusions, (args, result.exclusions)
    assert result.exclusion_proof_valid is valid, (args, result)

for reader, args, option in [
    ('cat', '-Z ordinary', "'-Z'"), ('grep', '-Z needle ordinary', "'-Z'"),
    ('grep', '--mystery=.env needle ordinary', "'--mystery'"), ('grep', '--ex=.env needle ordinary', "'--ex'"),
    ('rg', '--pre tool needle ordinary', "'--pre'"), ('rg', '-L needle .', "'-L'"), ('sed', '-e', "'-e'"),
]:
    result = plan(reader, args)
    assert isinstance(result, UnsupportedSyntax), (reader, args, result)
    assert option in result.detail, (args, result.detail)
    assert '.env' not in result.detail, result.detail

assert set(ADAPTERS) == set(READERS) == {'cat', 'less', 'head', 'tail', 'sed', 'awk', 'grep', 'rg'}
assert ADAPTERS['rg'].exclusion_syntax == '--glob "!pattern"'
assert ADAPTERS['grep'].exclusion_syntax == '--exclude="pattern"'
assert all(ADAPTERS[r].exclusion_syntax is None for r in READERS if r not in ('rg', 'grep'))
`);
});

test('policy returns one Verdict kind per command', () => {
  python(String.raw`
import os, tempfile
from credential_policy import analyze
import credential_verdict as v

KINDS = {v.ALLOW, v.PROTECTED, v.UNSUPPORTED, v.AMBIGUOUS_TARGET, v.RECURSIVE_UNPROVEN, v.INSPECTION_FAILURE}
with tempfile.TemporaryDirectory() as base:
    base = os.path.realpath(base)
    clean, dirty = os.path.join(base, 'clean'), os.path.join(base, 'dirty')
    for root in (clean, dirty):
        os.mkdir(root)
        open(os.path.join(root, 'ordinary'), 'w').close()
    open(os.path.join(dirty, '.env'), 'w').close()
    cases = [
        ('cat ordinary', clean, v.ALLOW),
        ('cat .env', clean, v.PROTECTED),
        ('cat *.pem', clean, v.AMBIGUOUS_TARGET),
        ('cat < *.txt', clean, v.AMBIGUOUS_TARGET),
        ('cat < .env', clean, v.PROTECTED),
        ('grep -f .env needle ordinary', clean, v.PROTECTED),
        ('grep -f "$X" needle ordinary', clean, v.AMBIGUOUS_TARGET),
        ('grep -f *.txt needle ordinary', clean, v.AMBIGUOUS_TARGET),
        ('grep -f missing needle ordinary', clean, v.UNSUPPORTED),
        ('rg --ignore-file "$VAR" foo ordinary', clean, v.AMBIGUOUS_TARGET),
        ('ssh example cat "$FILE"', clean, v.AMBIGUOUS_TARGET),
        ('ssh example cat .env', clean, v.PROTECTED),
        ('ssh example "rg foo ."', clean, v.RECURSIVE_UNPROVEN),
        ('grep -Z needle ordinary', clean, v.UNSUPPORTED),
        ('cat ordinary; grep -Z x ordinary; cat .env', clean, v.UNSUPPORTED),
        ('echo "$(cat *.pem)"', clean, v.AMBIGUOUS_TARGET),
        ('rg foo .', clean, v.ALLOW),
        ('rg foo .', dirty, v.RECURSIVE_UNPROVEN),
        ('env rg foo .', clean, v.RECURSIVE_UNPROVEN),
        ("rg --glob '!*' foo .", dirty, v.ALLOW),
        ("cat <<'EOF' |\ncat .env\nEOF\nbash\n", clean, v.UNSUPPORTED),
        ('echo "$(cat .env"', clean, v.UNSUPPORTED),
        ("cat 'unterminated", clean, v.UNSUPPORTED),
    ]
    for command, cwd, kind in cases:
        os.chdir(cwd)
        result = analyze(command, [], cwd)
        assert isinstance(result, v.Verdict), (command, result)
        assert result.kind in KINDS
        assert result.kind == kind, (command, result)
        assert result.allowed is (kind == v.ALLOW), (command, result)
    os.chdir(dirty)
    scanned = analyze('rg foo .', [], dirty)
    assert "'.env'" in scanned.detail, scanned
    assert scanned.message().startswith('recursive read without credential exclusions: '), scanned.message()
    heredoc = analyze("cat <<'EOF' |\ncat .env\nEOF\nbash\n", [], clean)
    assert heredoc.detail == 'shell syntax: ambiguous heredoc pipeline', heredoc
`);
});

test('Verdict messages keep reason strings and name only the Reader\'s syntax', () => {
  python(String.raw`
import os, tempfile
from credential_policy import analyze
import credential_verdict as v

assert v.REASONS == {
    v.PROTECTED: 'protected path', v.UNSUPPORTED: 'unsupported reader syntax',
    v.AMBIGUOUS_TARGET: 'ambiguous read target',
    v.RECURSIVE_UNPROVEN: 'recursive read without credential exclusions',
    v.INSPECTION_FAILURE: 'credential inspection failure',
}
assert v.protected().message() == 'protected path; use controlled extraction or provide non-secret information.'
with tempfile.TemporaryDirectory() as root:
    open(os.path.join(root, '.env'), 'w').close()
    os.chdir(root)
    for command, present, absent in [
        ('rg needle .', '--glob', '--exclude'), ('grep -r needle .', '--exclude', '--glob'),
        ('rg -Z needle .', '--glob', '--exclude'), ('grep -Z needle .', '--exclude', '--glob'),
    ]:
        hint = analyze(command, [], root).hint
        assert present in hint and absent not in hint, (command, hint)
        assert 'custom' in hint and 'if available' in hint, (command, hint)
    hint = analyze('cat -Z ordinary', [], root).hint
    assert '--glob' not in hint and '--exclude' not in hint and 'if available' in hint, hint
assert 'None' not in v.recursive_unproven(None).hint
`);
});

test('entrypoint maps every payload and policy failure to exit 2 without a traceback', () => {
  const entry = path.join(ROOT, 'scripts/hooks/_lib/credential-read.py');
  const nested = '['.repeat(100000) + ']'.repeat(100000);
  for (const [input, env, detail] of [
    [`{"tool_input":{"command":${nested}}}`, {}, 'payload'],
    ['not json', {}, 'payload'],
    ['{"tool_input":{"command":4}}', {}, 'payload'],
    ['{"tool_input":{"command":"cat ordinary"}}', { CLAUDE_PLUGIN_OPTION_CREDENTIAL_READ_PATHS: nested }, 'policy'],
    ['{"tool_input":{"command":"cat ordinary"}}', { CLAUDE_PLUGIN_OPTION_CREDENTIAL_READ_PATHS: '[4]' }, 'policy'],
    ['{"tool_input":{"command":""}}', { DHPK_CREDENTIAL_CONFIG_ERROR: '1' }, 'policy'],
  ]) {
    const result = spawnSync('python3', ['-B', entry], { input, env: { ...process.env, ...env }, encoding: 'utf8' });
    assert.strictEqual(result.status, 2, `${detail}: ${result.stderr.slice(0, 300)}`);
    assert.strictEqual(result.stderr, `[bash-guard] blocked: credential inspection failure: ${detail}; use controlled extraction or provide non-secret information.\n`);
  }
  const allowed = spawnSync('python3', ['-B', entry], { input: '{"tool_input":{"command":"cat ordinary"}}', encoding: 'utf8' });
  assert.strictEqual(allowed.status, 0, allowed.stderr);
  assert.strictEqual(allowed.stderr, '');
});

run('credential-verdict');
