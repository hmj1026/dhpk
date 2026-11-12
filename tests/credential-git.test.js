'use strict';

// #1262: content-reading git subcommands are credential Readers, and a
// names-only git listing is their Absence Proof (ADR 0034). One Python process
// builds fixture repositories and checks each Verdict kind in-process.
const { test, run, assert } = require('./_lib/tinytest');
const { ROOT } = require('./_lib/hookharness');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function python(source) {
  const result = spawnSync('python3', ['-B', '-c', PRELUDE + source], {
    env: { ...process.env, PYTHONPATH: path.join(ROOT, 'scripts/hooks/_lib') }, encoding: 'utf8', timeout: 120000,
  });
  assert.strictEqual(result.status, 0, result.stderr + result.stdout);
}

const PRELUDE = String.raw`
import atexit, os, shutil, subprocess, tempfile
import credential_policy, credential_scan
from credential_policy import analyze
import credential_verdict as v

# The production budgets (300 ms for the git listing and for the worktree scan)
# are wall-clock bounds; a stalled CI runner can exceed them and turn an
# expected verdict into a time-limit refusal (#1285). Verdict assertions use a
# generous budget; the fail-closed timeout path has its own test.
# credential_policy imports its own copy of the listing budget, while
# scan_roots reads credential_scan's, so both names are raised.
PRODUCTION_SECONDS = (credential_policy.MAX_SECONDS, credential_scan.MAX_SECONDS)
credential_policy.MAX_SECONDS = 60.0
credential_scan.MAX_SECONDS = 60.0

def mk():
    path = tempfile.mkdtemp()
    atexit.register(shutil.rmtree, path, True)  # issue #1322: leave no temp dir behind
    return path

ENV = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@e', GIT_COMMITTER_NAME='t',
           GIT_COMMITTER_EMAIL='t@e', GIT_CONFIG_NOSYSTEM='1', HOME=mk())

def git(repo, *args, stdin=None):
    return subprocess.run(['git', *args], cwd=repo, env=ENV, input=stdin, capture_output=True, text=True, check=True).stdout.strip()

def write(repo, rel, text='synthetic\n'):
    full = os.path.join(repo, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w') as handle:
        handle.write(text)

def repo(base, name, files):
    root = os.path.join(base, name)
    os.makedirs(root)
    git(root, 'init', '-q', '-b', 'main')
    for rel in files:
        write(root, rel)
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'init')
    return root

def check(cases, cwd, patterns=()):
    failures = []
    for command, kind in cases:
        os.chdir(cwd)
        result = analyze(command, list(patterns), cwd)
        if result.kind != kind:
            failures.append('%s: %s (%s) expected %s' % (command, result.kind, result.message(), kind))
    assert not failures, '\n'.join(failures)

base = os.path.realpath(mk())
`;

test('clean repository: git reads pass, non-reads untouched, objects typed', () => {
  python(String.raw`
clean = repo(base, 'clean', ['src/a.js', 'README.md'])
write(clean, 'src/a.js', 'changed\n'); git(clean, 'commit', '-qam', 'second')
write(clean, 'src/a.js', 'worktree\n'); write(clean, 'README.md', 'staged\n'); git(clean, 'add', 'README.md')
blob = git(clean, 'rev-parse', 'HEAD:src/a.js'); tree = git(clean, 'rev-parse', 'HEAD:src')
check([
    ('git diff', v.ALLOW), ('git diff --cached', v.ALLOW), ('git show HEAD', v.ALLOW),
    ('git show', v.ALLOW), ('git log -p -3', v.ALLOW), ('git log -p', v.ALLOW), ('git grep -n x', v.ALLOW),
    ('git grep -n x HEAD', v.ALLOW), ('git grep --cached -n x', v.ALLOW), ('git diff HEAD~1 HEAD -- src', v.ALLOW),
    ('git diff --stat', v.ALLOW), ('git diff --name-only HEAD~1', v.ALLOW), ('git log --name-only', v.ALLOW),
    ('git log --oneline -5', v.ALLOW), ('git log -S password --oneline', v.ALLOW), ('git show --stat HEAD', v.ALLOW),
    ('git show -s HEAD', v.ALLOW), ('git status', v.ALLOW), ('git add .', v.ALLOW), ('git commit -m x', v.ALLOW),
    ('git stash show --stat', v.ALLOW), ('git stash show', v.INSPECTION_FAILURE),
    ('GIT_PAGER=cat git log --oneline', v.ALLOW),
    # git can run a later command; a reader after a non-read git subcommand is still judged.
    ('git bisect run cat .env', v.PROTECTED), ('git submodule foreach cat .env', v.PROTECTED),
    ('git rebase --exec cat .env', v.PROTECTED), ('git -C . bisect run grep -n x .env', v.PROTECTED), ('git --no-pager diff', v.ALLOW),
    ('git -C src grep -n x', v.ALLOW), ('git show HEAD:src', v.ALLOW), ('git show HEAD:src/a.js', v.ALLOW),
    ('git show HEAD:./src/a.js', v.ALLOW), ('git show :README.md', v.ALLOW),
    ('git cat-file -p ' + tree, v.ALLOW), ('git cat-file -p HEAD', v.ALLOW), ('git cat-file -t ' + blob, v.ALLOW),
    ('git cat-file -p ' + blob, v.AMBIGUOUS_TARGET), ('git show ' + blob, v.AMBIGUOUS_TARGET),
    ('git cat-file blob ' + blob, v.AMBIGUOUS_TARGET), ('git cat-file -p HEAD:src/a.js', v.ALLOW),
    ('git blame src/a.js', v.ALLOW), ('git blame -L 1,1 HEAD -- src/a.js', v.ALLOW),
    ('git log -L 1,1:src/a.js', v.ALLOW), ('git diff --no-index src/a.js README.md', v.ALLOW),
    ('git grep --no-index -n x src', v.ALLOW), ('git grep --untracked -n x', v.ALLOW),
    # #1262 repro rows: blocked even in a clean repository.
    ('git show HEAD:.env', v.PROTECTED), ('git cat-file -p HEAD:.env', v.PROTECTED),
    ('git log -p -- .env', v.PROTECTED), ('git diff HEAD~1 -- .env', v.PROTECTED),
    ('git grep -n x -- .env', v.PROTECTED), ('git blame .env', v.PROTECTED), ('git log -L1,2:.env', v.PROTECTED),
    ('git diff --no-index .env README.md', v.PROTECTED), ('git show HEAD:./.env', v.PROTECTED),
    ('git grep -n x -- "*.env"', v.AMBIGUOUS_TARGET), ("git grep -n x -- ':(glob)*.env'", v.AMBIGUOUS_TARGET),
    ('git grep -n x -- "$X"', v.AMBIGUOUS_TARGET), ('git show "$REV":src/a.js', v.AMBIGUOUS_TARGET),
    ("git grep -n x -- ':!src'", v.ALLOW),
    # Relocation, unknown options, and git failures fail closed.
    ('git --git-dir=/elsewhere/.git show HEAD', v.UNSUPPORTED), ('GIT_DIR=/elsewhere git diff', v.UNSUPPORTED),
    ('git -c diff.external=x diff', v.UNSUPPORTED), ('git --work-tree=/x diff', v.UNSUPPORTED),
    ('git -c alias.s=show s HEAD:.env', v.UNSUPPORTED), ('git -c Alias.x=show x', v.UNSUPPORTED),
    ('git -c user.name=x commit -m y', v.ALLOW),
    ('GIT_INDEX_FILE=/tmp/i git diff', v.UNSUPPORTED), ('git diff --frobnicate', v.UNSUPPORTED),
    ('git grep --recurse-submodules -n x', v.UNSUPPORTED), ('git show nosuchrev', v.INSPECTION_FAILURE),
    ('git -C nowhere diff', v.INSPECTION_FAILURE),
    # Unknown working directory: literal judgment only, no listing.
    ('cd src && git show HEAD:src/a.js', v.ALLOW), ('cd src && git show HEAD:.env', v.PROTECTED),
    ('cd src && git diff', v.RECURSIVE_UNPROVEN), ('git -C "$D" diff', v.RECURSIVE_UNPROVEN),
    ('echo git show HEAD:.env', v.PROTECTED), ('ssh host git diff', v.RECURSIVE_UNPROVEN),
], clean)
outside = os.path.join(base, 'not-a-repo'); os.makedirs(outside)
write(outside, 'a'); write(outside, 'b'); write(outside, '.env')
check([('git diff', v.INSPECTION_FAILURE), ('git status', v.ALLOW), ('git diff --no-index a b', v.ALLOW),
       ('git diff --no-index missing b', v.RECURSIVE_UNPROVEN), ('git diff --no-index . b', v.RECURSIVE_UNPROVEN),
       ('git grep --no-index -n x', v.RECURSIVE_UNPROVEN)], outside)
`);
});

test('tracked custom protected file: listings name it, narrowed reads pass', () => {
  python(String.raw`
prot = repo(base, 'prot', ['src/a.js', 'protected/config/db.php', '.env'])
env_blob = git(prot, 'rev-parse', 'HEAD:.env')
git(prot, 'tag', 'blobtag', env_blob)
# Review regressions: each of these printed a Protected Path's content while allowed.
check([
    ('sudo -u git cat .env', v.PROTECTED), ('echo git cat .env', v.PROTECTED),
    ('git --attr-source HEAD show HEAD:.env', v.PROTECTED), ('git --frobnicate show HEAD', v.UNSUPPORTED),
    ('git show --stat ' + env_blob, v.AMBIGUOUS_TARGET), ('git show -s ' + env_blob, v.AMBIGUOUS_TARGET),
    ('git show blobtag', v.AMBIGUOUS_TARGET), ('git show --stat blobtag', v.AMBIGUOUS_TARGET),
    ('git grep password HEAD:protected/config', v.AMBIGUOUS_TARGET), ('git diff -C HEAD~1', v.UNSUPPORTED),
    ('git log -p --find-copies-harder', v.UNSUPPORTED), ('git stash show', v.INSPECTION_FAILURE),
    ('git show --stat HEAD', v.ALLOW), ('git show -s', v.ALLOW),
], prot, ['config/db.php'])
git(prot, 'tag', '-d', 'blobtag'); git(prot, 'rm', '-q', '.env'); git(prot, 'commit', '-qm', 'drop env')
write(prot, 'protected/config/db.php', 'changed\n'); git(prot, 'commit', '-qam', 'touch db')
touching = git(prot, 'rev-parse', 'HEAD')
write(prot, 'src/a.js', 'changed\n'); git(prot, 'commit', '-qam', 'touch src')
policy = ['config/db.php']
check([
    ('git grep -n password', v.RECURSIVE_UNPROVEN), ('git grep -n x HEAD', v.RECURSIVE_UNPROVEN),
    ('git grep -n x -- src', v.ALLOW), ('git grep -n x HEAD -- src', v.ALLOW),
    ('git show ' + touching, v.RECURSIVE_UNPROVEN), ('git show HEAD', v.ALLOW),
    ('git log -p', v.RECURSIVE_UNPROVEN), ('git log -p -- src', v.ALLOW), ('git log -p -1', v.ALLOW),
    ('git diff', v.ALLOW), ('git show HEAD:protected/config/db.php', v.PROTECTED),
    ('git -C protected show HEAD:./config/db.php', v.PROTECTED), ('git show HEAD:protected', v.ALLOW),
], prot, policy)
write(prot, 'protected/config/db.php', 'worktree\n')
check([('git diff', v.RECURSIVE_UNPROVEN), ('git diff -- src', v.ALLOW), ('git diff --stat', v.ALLOW)], prot, policy)
os.chdir(prot)
result = analyze('git grep -n password', policy, prot)
assert 'config/db.php' in result.detail, result.detail
for unwanted in ('--glob', '--exclude'):
    assert unwanted not in result.hint, result.hint
assert 'pathspec' in result.hint and '-n' in result.hint, result.hint
blob = git(prot, 'rev-parse', 'HEAD:src/a.js')
assert '<rev>:<path>' in analyze('git cat-file -p ' + blob, policy, prot).hint
`);
});

test('listings run no configured external program and stop at the entry cap', () => {
  python(String.raw`
drv = repo(base, 'drv', ['a.txt'])
marker = os.path.join(base, 'marker')
script = os.path.join(base, 'driver.sh')
with open(script, 'w') as handle:
    handle.write('#!/bin/sh\ntouch %s\ncat "$1"\n' % marker)
os.chmod(script, 0o755)
write(drv, '.gitattributes', '*.txt diff=mark\n')
git(drv, 'config', 'diff.mark.textconv', script)
git(drv, 'config', 'diff.external', script)
git(drv, 'config', 'core.fsmonitor', script)
git(drv, 'config', 'core.pager', script)
git(drv, 'add', '-A'); git(drv, 'commit', '-qm', 'attrs')
write(drv, 'a.txt', 'changed\n')
if os.path.exists(marker):
    os.unlink(marker)
check([('git diff', v.ALLOW), ('git show HEAD', v.ALLOW), ('git log -p -2', v.ALLOW), ('git grep -n x', v.ALLOW)], drv)
assert not os.path.exists(marker), 'guard ran a configured external program'

big = os.path.join(base, 'big'); os.makedirs(big); git(big, 'init', '-q', '-b', 'main')
oid = git(big, 'hash-object', '-w', '--stdin', stdin='x\n')
git(big, 'update-index', '--index-info', stdin=''.join('100644 %s\tf/%05d\n' % (oid, i) for i in range(20001)))
git(big, 'commit', '-q', '-m', 'many')
os.chdir(big)
result = analyze('git log -p', [], big)
assert result.kind == v.RECURSIVE_UNPROVEN, result
assert '-n' in result.hint, result.hint
assert analyze('git log -p -- f/00001', [], big).kind == v.ALLOW
`);
});

test('security review regressions: each case printed protected content or ran repository code', () => {
  python(String.raw`
sec = repo(base, 'sec', ['src/a.js', '.env', 'keep.txt', 'sub/b.txt'])
env_oid = git(sec, 'rev-parse', 'HEAD:.env'); other_oid = git(sec, 'rev-parse', 'HEAD:keep.txt')
git(sec, 'tag', '-a', 'blobtag', env_oid, '-m', 'x')
git(sec, 'mv', '.env', 'moved.txt'); write(sec, 'moved.txt', 'synthetic\nmore\n'); git(sec, 'commit', '-qm', 'rename')
write(sec, 'keep.txt', 'stashed\n'); write(sec, '.env.local', 'x\n'); git(sec, 'add', '.env.local')
git(sec, 'stash', '-q')
other = repo(base, 'other', ['ordinary'])
write(other, '.env', 'untracked\n')
clean_dir = os.path.join(base, 'plain'); os.makedirs(clean_dir)
check([
    ('git -C %s grep --no-index SECRET' % other, v.RECURSIVE_UNPROVEN),
    ('git -C %s grep --untracked SECRET' % other, v.RECURSIVE_UNPROVEN),
], clean_dir)
check([
    ('git show --diff-filter=R HEAD', v.RECURSIVE_UNPROVEN), ('git log -p --diff-filter=R', v.RECURSIVE_UNPROVEN),
    ('git blame keep.txt HEAD', v.ALLOW), ('git blame .env HEAD~1', v.PROTECTED),
    ('git cat-file blob blobtag', v.AMBIGUOUS_TARGET), ('git cat-file -p blobtag', v.ALLOW),
    ('git diff %s %s' % (env_oid, other_oid), v.AMBIGUOUS_TARGET), ('git diff keep.txt', v.ALLOW),
    ('git diff HEAD~1 HEAD -- src', v.ALLOW), ('git log -p src/a.js', v.ALLOW),
    ('git diff --submodule=diff', v.UNSUPPORTED),
    ('export GIT_DIR=%s/.git GIT_WORK_TREE=%s; git diff' % (other, other), v.UNSUPPORTED),
    ('GIT_DIR=%s/.git; export GIT_DIR; git diff' % other, v.UNSUPPORTED),
    ('git diff-tree -p HEAD', v.RECURSIVE_UNPROVEN), ('git diff-index -p HEAD~1', v.RECURSIVE_UNPROVEN),
    ('git reflog -p', v.RECURSIVE_UNPROVEN), ('git stash list -p', v.RECURSIVE_UNPROVEN),
    ('git stash show -p', v.RECURSIVE_UNPROVEN), ('git stash show -p -- --output=/tmp/x', v.AMBIGUOUS_TARGET),
    ('git diff-tree HEAD', v.ALLOW), ('git reflog', v.ALLOW), ('git stash list', v.ALLOW),
    ('git diff-tree -p HEAD -- src', v.ALLOW), ('git diff-files', v.ALLOW),
    ('git show HEAD~1..HEAD -- src', v.ALLOW), ('git show HEAD~1..HEAD', v.RECURSIVE_UNPROVEN),
], sec)
# An annotated tag's header must not swallow the first listed name (.env sorts first).
tagged = repo(base, 'tagged', ['.env', 'ordinary.js', 'sub/a.js'])
git(tagged, 'tag', '-a', 'tc', '-m', 'x', 'HEAD')
check([('git show tc', v.RECURSIVE_UNPROVEN), ('git show HEAD', v.RECURSIVE_UNPROVEN),
       ('git show tc -- sub', v.ALLOW), ('git log -p tc', v.RECURSIVE_UNPROVEN)], tagged)
git(sec, 'config', 'diff.submodule', 'diff')
check([('git diff', v.UNSUPPORTED)], sec)
git(sec, 'config', '--unset', 'diff.submodule')
# diff.relative makes the real command print sub-relative names; the listing must not.
git(sec, 'config', 'diff.relative', 'true'); write(sec, 'sub/b.txt', 'changed\n')
check([('git diff', v.RECURSIVE_UNPROVEN), ('git diff-files -p', v.RECURSIVE_UNPROVEN)], os.path.join(sec, 'sub'), ['sub/b.txt'])
git(sec, 'config', '--unset', 'diff.relative'); git(sec, 'checkout', '-q', '--', 'sub/b.txt')
# Repository clean filters and index hooks must not run inside the guard.
marker_filter, marker_hook = os.path.join(base, 'F'), os.path.join(base, 'H')
write(sec, '.gitattributes', '* filter=m\n')
git(sec, 'config', 'filter.m.clean', 'touch %s; cat' % marker_filter)
# .git/info/attributes and core.attributesFile are not covered by --attr-source.
with open(os.path.join(sec, '.git', 'info', 'attributes'), 'w') as handle:
    handle.write('* filter=i\n')
git(sec, 'config', 'filter.i.clean', 'touch %s; cat' % marker_filter)
git(sec, 'config', 'filter.i.process', 'touch %s; cat' % marker_filter)
global_attributes = os.path.join(base, 'global-attributes')
with open(global_attributes, 'w') as handle:
    handle.write('* filter=g\n')
git(sec, 'config', 'core.attributesFile', global_attributes)
git(sec, 'config', 'filter.g.clean', 'touch %s; cat' % marker_filter)
hook = os.path.join(sec, '.git', 'hooks', 'post-index-change')
os.makedirs(os.path.dirname(hook), exist_ok=True)
with open(hook, 'w') as handle:
    handle.write('#!/bin/sh\ntouch %s\n' % marker_hook)
os.chmod(hook, 0o755)
write(sec, 'src/a.js', 'dirty\n'); os.utime(os.path.join(sec, 'keep.txt'), (1, 1))
for marker in (marker_filter, marker_hook):
    if os.path.exists(marker):
        os.unlink(marker)
# HEAD renames .env, so an unscoped git show HEAD is rightly blocked; scope it to src.
check([('git diff', v.ALLOW), ('git diff --cached', v.ALLOW), ('git show HEAD -- src', v.ALLOW),
       ('git show HEAD', v.RECURSIVE_UNPROVEN)], sec)
assert not os.path.exists(marker_filter), 'guard ran a clean filter'
assert not os.path.exists(marker_hook), 'guard ran a repository hook'

# log.showSignature runs gpg.program for a signed commit; a submodule's own clean filter runs in a child git.
signed = repo(base, 'signed', ['src/a.js'])
marker_gpg = os.path.join(base, 'G')
gpg = os.path.join(base, 'gpg.sh')
with open(gpg, 'w') as handle:
    handle.write('#!/bin/sh\ntouch %s\nexit 1\n' % marker_gpg)
os.chmod(gpg, 0o755)
body = git(signed, 'cat-file', 'commit', 'HEAD').split('\n\n', 1)
fake = body[0] + '\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n -----END PGP SIGNATURE-----\n\n' + body[1] + '\n'
oid = git(signed, 'hash-object', '-t', 'commit', '-w', '--stdin', stdin=fake)
git(signed, 'update-ref', 'HEAD', oid)
git(signed, 'config', 'gpg.program', gpg); git(signed, 'config', 'log.showSignature', 'true')
check([('git log -p -1', v.ALLOW), ('git show HEAD', v.ALLOW)], signed)
assert not os.path.exists(marker_gpg), 'guard ran gpg.program'

inner = repo(base, 'inner', ['f'])
outer = repo(base, 'outer', ['top.txt'])
git(outer, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', inner, 'vendor')
git(outer, 'commit', '-qm', 'sub')
sub_git = git(os.path.join(outer, 'vendor'), 'rev-parse', '--absolute-git-dir')
marker_sub = os.path.join(base, 'S')
git(os.path.join(outer, 'vendor'), 'config', 'filter.s.clean', 'touch %s; cat' % marker_sub)
os.makedirs(os.path.join(sub_git, 'info'), exist_ok=True)
with open(os.path.join(sub_git, 'info', 'attributes'), 'w') as handle:
    handle.write('* filter=s\n')
os.utime(os.path.join(outer, 'vendor', 'f'), (1, 1))
if os.path.exists(marker_sub):
    os.unlink(marker_sub)
check([('git diff', v.ALLOW), ('git diff --ignore-submodules=none', v.ALLOW)], outer)
assert not os.path.exists(marker_sub), 'guard ran a submodule clean filter'
`);
});

test('verdicts do not depend on runner speed: a stalled git listing still allows a clean read', () => {
  // #1285: a loaded CI runner once stalled the names-only listing past the
  // production budget, turning an expected ALLOW into recursive_unproven.
  python(String.raw`
import credential_git, time
real_git = credential_git._git
def stalled(*args, **kwargs):
    time.sleep(0.35)
    return real_git(*args, **kwargs)
credential_git._git = stalled
# --untracked and --no-index also walk the worktree through scan_roots, which
# has its own budget; stall that walk too.
real_scan = credential_policy.scan_roots
def stalled_scan(*args, **kwargs):
    def slow_scandir(path):
        time.sleep(0.35)
        return os.scandir(path)
    return real_scan(*args, scandir=slow_scandir, **kwargs)
credential_policy.scan_roots = stalled_scan
slow = repo(base, 'slow', ['src/a.js', 'README.md'])
check([('git grep --untracked -n x', v.ALLOW), ('git grep --no-index -n x src', v.ALLOW), ('git diff', v.ALLOW)], slow)
`);
});

test('the production listing budget still fails closed when a listing exceeds it', () => {
  python(String.raw`
assert PRODUCTION_SECONDS == (0.300, 0.300), 'the production budgets must stay 300 ms: %r' % (PRODUCTION_SECONDS,)
tight = repo(base, 'tight', ['src/a.js'])
os.chdir(tight)
# Listing budget exhausted: git grep (tracked) is judged by the listing alone.
credential_policy.MAX_SECONDS = 0.0005
result = analyze('git grep -n x', [], tight)
assert result.kind == v.RECURSIVE_UNPROVEN and 'time limit' in result.message(), (result.kind, result.message())
# Scan budget exhausted: --no-index walks the worktree after a passing listing.
credential_policy.MAX_SECONDS = 60.0
credential_scan.MAX_SECONDS = 0.0
result = analyze('git grep --no-index -n x src', [], tight)
assert result.kind == v.RECURSIVE_UNPROVEN and 'time limit' in result.message(), (result.kind, result.message())
`);
});

test('the test-only budget override cannot lower or loosen the production budget (#1290)', () => {
  python(String.raw`
budget = credential_scan.budget_seconds
KEY = 'DHPK_CREDENTIAL_TEST_MAX_SECONDS'
assert PRODUCTION_SECONDS == (0.300, 0.300)
credential_scan.MAX_SECONDS = PRODUCTION_SECONDS[1]  # the prelude raised it for verdict tests
assert budget({}) == 0.300
assert budget({KEY: '5'}) == 0.300, 'override without DHPK_TEST_MODE'
assert budget({'DHPK_TEST_MODE': '0', KEY: '5'}) == 0.300
assert budget({'DHPK_TEST_MODE': 'true', KEY: '5'}) == 0.300
assert budget({'DHPK_TEST_MODE': '1'}) == 0.300, 'mode without value'
assert budget({'DHPK_TEST_MODE': '1', KEY: '5'}) == 5.0
assert budget({'DHPK_TEST_MODE': '1', KEY: '0.01'}) == 0.300, 'never lowers below 300 ms'
assert budget({'DHPK_TEST_MODE': '1', KEY: '-3'}) == 0.300
assert budget({'DHPK_TEST_MODE': '1', KEY: '0.3'}) == 0.300
assert budget({'DHPK_TEST_MODE': '1', KEY: '999'}) == 10.0, 'clamped to 10 s'
for bad in ('nan', 'inf', '-inf', 'abc', '', ' ', '1e999x'):
    assert budget({'DHPK_TEST_MODE': '1', KEY: bad}) == 0.300, bad
# The same helper backs both consumers: the policy module's default stays 300 ms.
assert budget({'DHPK_TEST_MODE': '1', KEY: 'nan'}, default=PRODUCTION_SECONDS[0]) == 0.300
`);
});

run('credential-git');
