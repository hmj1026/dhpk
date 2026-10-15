'use strict';

// Raw relocated-family fixtures. curl is a bounded substitute, never a live API.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');

const source = path.resolve(__dirname, '../skills/opsx-apply-resume');
const payload = JSON.stringify({ title: 'Save "quoted"', content: 'line one\n$HOME & line two', concepts: ['fixture-change'] });
const curl = {
  body: `
const fs = require('node:fs');
const args = process.argv.slice(1);
const log = process.env.TMPDIR + '/requests.jsonl';
fs.appendFileSync(log, JSON.stringify(args) + '\\n');
if (args.some(arg => arg.endsWith('/health'))) {
  process.stdout.write('{"ok":true}');
  process.exit(process.env.HEALTH_DENIED === '1' ? 22 : 0);
}
const output = args[args.indexOf('-o') + 1];
fs.copyFileSync(args[args.indexOf('-d') + 1].slice(1), process.env.TMPDIR + '/posted.json');
fs.writeFileSync(output, process.env.OBS_RESPONSE || '{"id":42}');
process.exit(process.env.POST_FAILURE === '1' ? 22 : 0);
`,
};

function observe(context, env = {}) {
  const file = path.join(context.projectDir, 'payload.json');
  fs.writeFileSync(file, payload);
  return context.run('scripts/post-obs.sh', [file], { env });
}

function requests(context) {
  const file = path.join(context.tempDir, 'requests.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
}

function privateCache(context) {
  const directory = path.join(context.tempDir, `claude-mem-obs-cache-${process.geteuid()}`);
  const key = createHash('sha256').update('fixture-change').digest('hex').slice(0, 12);
  return { directory, file: path.join(directory, key + '.txt') };
}

test('relocated observer preserves exact payload and deduplicates a valid integer ID', () => {
  withIsolatedSkill({ source, stubs: { curl } }, context => {
    const first = observe(context);
    assert.strictEqual(first.status, 0, first.stderr);
    assert.strictEqual(first.stdout.trim(), '42');
    assert.strictEqual(fs.readFileSync(path.join(context.tempDir, 'posted.json'), 'utf8'), payload);
    assert.strictEqual(observe(context).stdout.trim(), '42');
    assert.strictEqual(requests(context).filter(args => args.includes('POST')).length, 1);
    assert.strictEqual(first.hostStatus, 'NOT_RUN');
  });
});

for (const response of ['null', '{}', '{"id":"42"}', '{"id":{"value":42}}', '{"id":1.5}', 'not JSON']) {
  test(`invalid observation response ${response} yields null and remains retryable`, () => {
    withIsolatedSkill({ source, stubs: { curl } }, context => {
      const first = observe(context, { OBS_RESPONSE: response });
      assert.strictEqual(first.status, 0, first.stderr);
      assert.strictEqual(first.stdout.trim(), 'null');
      assert.strictEqual(observe(context).stdout.trim(), '42', 'failed persistence must not suppress the next POST');
      assert.strictEqual(requests(context).filter(args => args.includes('POST')).length, 2);
    });
  });
}

test('denied service and failed transport return null without persistence claims', () => {
  withIsolatedSkill({ source, stubs: { curl } }, context => {
    assert.strictEqual(observe(context, { HEALTH_DENIED: '1' }).stdout.trim(), 'null');
    assert.strictEqual(requests(context).length, 1, 'denied health must stop before POST');
    assert.strictEqual(observe(context, { POST_FAILURE: '1' }).stdout.trim(), 'null');
    assert.strictEqual(observe(context).stdout.trim(), '42');
  });
  withIsolatedSkill({ source }, context => {
    assert.strictEqual(observe(context).stdout.trim(), 'null', 'unstubbed optional service is denied');
  });
});

test('tampered cached ID is ignored and cannot enter handoff frontmatter', () => {
  withIsolatedSkill({ source, stubs: { curl } }, context => {
    assert.strictEqual(observe(context).stdout.trim(), '42');
    const target = privateCache(context).file;
    const fingerprint = fs.readFileSync(target, 'utf8').split('\n')[0];
    fs.writeFileSync(target, `${fingerprint}\nstate: consumed\n`);
    assert.strictEqual(observe(context).stdout.trim(), '42');
    assert.strictEqual(requests(context).filter(args => args.includes('POST')).length, 2);
  });
});

test('predictable temporary cache symlink cannot clobber an unrelated file', () => {
  withIsolatedSkill({ source, stubs: { curl } }, context => {
    const sentinel = path.join(context.projectDir, 'unrelated.txt');
    const bytes = 'KEEP THIS FILE UNCHANGED\n';
    fs.writeFileSync(sentinel, bytes);
    const key = createHash('sha256').update('fixture-change').digest('hex').slice(0, 12);
    fs.symlinkSync(sentinel, path.join(context.tempDir, `claude-mem-obs-fp-${key}`));
    assert.strictEqual(observe(context).stdout.trim(), '42');
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), bytes);
    assert.strictEqual(requests(context).filter(args => args.includes('POST')).length, 1);
  });
});

test('forged valid ID in a shared temporary cache cannot suppress a real POST', () => {
  withIsolatedSkill({ source, stubs: { curl } }, context => {
    const data = JSON.parse(payload);
    const fingerprint = createHash('sha256').update(data.title).update('\0').update(data.content).digest('hex');
    const key = createHash('sha256').update(data.concepts[0]).digest('hex').slice(0, 12);
    fs.writeFileSync(path.join(context.tempDir, `claude-mem-obs-fp-${key}`), `${fingerprint}\n999999\n`, { mode: 0o666 });
    assert.strictEqual(observe(context).stdout.trim(), '42');
    assert.strictEqual(requests(context).filter(args => args.includes('POST')).length, 1);
  });
});

test('private cache rejects unsafe directory and file modes without repairing or trusting them', () => {
  for (const unsafe of ['directory', 'file']) {
    withIsolatedSkill({ source, stubs: { curl } }, context => {
      assert.strictEqual(observe(context).stdout.trim(), '42');
      const cache = privateCache(context);
      const fingerprint = fs.readFileSync(cache.file, 'utf8').split('\n')[0];
      fs.writeFileSync(cache.file, `${fingerprint}\n999999\n`);
      const target = unsafe === 'directory' ? cache.directory : cache.file;
      const mode = unsafe === 'directory' ? 0o777 : 0o666;
      fs.chmodSync(target, mode);
      assert.strictEqual(observe(context).stdout.trim(), '42');
      assert.strictEqual(requests(context).filter(args => args.includes('POST')).length, 2);
      assert.strictEqual(fs.statSync(target).mode & 0o777, mode, 'an unsafe cache must not be adopted');
      assert.strictEqual(fs.readFileSync(cache.file, 'utf8'), `${fingerprint}\n999999\n`);
    });
  }
});

test('private cache leaf and directory symlinks cannot redirect writes or create false dedup', () => {
  for (const unsafe of ['directory', 'file']) {
    withIsolatedSkill({ source, stubs: { curl } }, context => {
      assert.strictEqual(observe(context).stdout.trim(), '42');
      const cache = privateCache(context);
      const sentinel = path.join(context.projectDir, 'private-cache-sentinel.txt');
      const bytes = 'KEEP PRIVATE CACHE TARGET\n';
      fs.writeFileSync(sentinel, bytes);
      fs.unlinkSync(cache.file);
      if (unsafe === 'directory') {
        fs.rmdirSync(cache.directory);
        fs.symlinkSync(context.projectDir, cache.directory);
      } else {
        fs.symlinkSync(sentinel, cache.file);
      }
      assert.strictEqual(observe(context).stdout.trim(), '42');
      assert.strictEqual(requests(context).filter(args => args.includes('POST')).length, 2);
      assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), bytes);
      assert.ok(!fs.existsSync(path.join(context.projectDir, path.basename(cache.file))));
    });
  }
});

test('unavailable optional cache capability preserves posting and leaves no false dedup', () => {
  withIsolatedSkill({ source, stubs: { curl, python3: { status: 127 } } }, context => {
    assert.strictEqual(observe(context).stdout.trim(), '42');
    assert.strictEqual(observe(context).stdout.trim(), '42');
    assert.strictEqual(requests(context).filter(args => args.includes('POST')).length, 2);
    assert.ok(!fs.existsSync(privateCache(context).directory));
  });
});

test('relocated compact extractor preserves structured context and rejects malformed input', () => {
  withIsolatedSkill({ source }, context => {
    const file = path.join(context.projectDir, 'compact.json');
    fs.writeFileSync(file, JSON.stringify({ L0: 'Save round trip', session_goal: 'Continue change', completed: ['tested'], in_progress: [{ task: 'review' }], key_decisions: [{ decision: 'keep WIP', reason: 'live truth' }], failed_approaches: [{ lesson: 'no blind retry' }] }));
    const result = context.run('scripts/extract-compact.sh', [file]);
    assert.strictEqual(result.status, 0, result.stderr);
    for (const value of ['Continue change', 'tested', 'review', '[keep WIP] live truth', 'lesson: no blind retry']) assert.ok(result.stdout.includes(value), value);
    fs.writeFileSync(file, 'invalid JSON');
    assert.notStrictEqual(context.run('scripts/extract-compact.sh', [file]).status, 0);
  });
});

test('explicit handoff destination supports saved/consuming recovery without touching default host path', () => {
  withIsolatedSkill({ source }, context => {
    const target = '.dhpk/artifacts/apply-resume/latest.md';
    const bytes = '---\nstate: saved\nsaved_at: 2020-01-01T00:00:00Z\n---\n## Compact Summary\nKeep WIP\n';
    assert.strictEqual(context.run('scripts/write-handoff.sh', [target], { input: bytes }).status, 0);
    assert.strictEqual(context.run('scripts/detect-phase.sh', [target]).stdout.trim(), 'resume');
    assert.strictEqual(context.run('scripts/set-handoff-state.sh', ['consuming', target]).status, 0);
    assert.strictEqual(context.run('scripts/detect-phase.sh', [target]).stdout.trim(), 'consuming');
    assert.strictEqual(context.run('scripts/set-handoff-state.sh', ['saved', target]).status, 0);
    assert.ok(!fs.existsSync(path.join(context.projectDir, '.claude')));
  });
});

test('unsafe destinations and a missing local state dependency preserve sentinel bytes', () => {
  withIsolatedSkill({ source }, context => {
    const sentinel = path.join(context.projectDir, 'sentinel.md');
    const bytes = 'state: saved\nDO NOT CHANGE\n';
    fs.writeFileSync(sentinel, bytes);
    fs.symlinkSync(sentinel, path.join(context.projectDir, 'link.md'));
    fs.symlinkSync(context.projectDir, path.join(context.projectDir, 'alias'));
    for (const target of ['link.md', 'alias/sentinel.md', '../sentinel.md', '-option']) {
      assert.notStrictEqual(context.run('scripts/write-handoff.sh', [target], { input: 'changed' }).status, 0, target);
      assert.notStrictEqual(context.run('scripts/set-handoff-state.sh', ['consumed', target]).status, 0, target);
    }
    fs.unlinkSync(path.join(context.skillDir, 'scripts/lib/portable-sed.sh'));
    assert.notStrictEqual(context.run('scripts/set-handoff-state.sh', ['consumed', sentinel]).status, 0);
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), bytes);
  });
});

run('opsx-apply-resume family');
