'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'maintainer', 'issue-snapshot.js');

function makeIssue(overrides = {}) {
  return {
    number: 42,
    title: 'Retro delivery guardrails',
    body: 'Keep the complete source record: café, 日本語, and 🧭.',
    html_url: 'https://github.com/acme/widget/issues/42',
    state: 'closed',
    labels: [
      { id: 101, name: 'bug', color: 'd73a4a' },
      { id: 202, name: 'ready-for-agent', color: '0e8a16' },
    ],
    updated_at: '2026-10-29T02:03:04Z',
    comments: 2,
    ...overrides,
  };
}

function comment(id, body, createdAt, updatedAt) {
  return {
    id,
    body,
    html_url: `https://github.com/acme/widget/issues/42#issuecomment-${id}`,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function fixture({ before = makeIssue(), after = before, firstPage, secondPage, ghFailure = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-issue-snapshot-'));
  const bin = path.join(tmp, 'bin');
  const data = path.join(tmp, 'data');
  fs.mkdirSync(bin);
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'issue-before.json'), JSON.stringify(before));
  fs.writeFileSync(path.join(data, 'issue-after.json'), JSON.stringify(after));
  fs.writeFileSync(path.join(data, 'comments-page-1.json'), JSON.stringify(firstPage || [
    comment(7001, 'The issue body is unchanged; this comment carries the delivery requirement.', '2026-10-28T09:00:00Z', '2026-10-28T09:15:00Z'),
  ]));
  fs.writeFileSync(path.join(data, 'comments-page-2.json'), JSON.stringify(secondPage || [
    comment(7002, 'Second page comment with preserved source URL.', '2026-10-28T10:00:00Z', '2026-10-28T10:00:00Z'),
  ]));
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const data = process.env.GH_FIXTURE_DIR;
const callFile = process.env.GH_CALL_FILE;
fs.appendFileSync(callFile, JSON.stringify(args) + '\\n');
if (process.env.GH_FAIL === '1') {
  process.stderr.write('fixture gh API failure\\n');
  process.exit(1);
}
if (args.includes('--slurp') && process.env.GH_REJECT_SLURP === '1') {
  process.stderr.write('unknown flag: --slurp');
  process.exit(1);
}
const endpoint = args.find((arg) => arg.startsWith('repos/')) || '';
if (endpoint.includes('/comments?per_page=100')) {
  const countFile = path.join(data, 'comment-read-count');
  const count = Number(fs.existsSync(countFile) ? fs.readFileSync(countFile, 'utf8') : '0');
  const page = Number(new URL(endpoint, 'https://api.github.com/').searchParams.get('page') || 1);
  if (page === 1) fs.writeFileSync(countFile, String(count + 1));
  const first = JSON.parse(fs.readFileSync(path.join(data, 'comments-page-1.json'), 'utf8'));
  const second = JSON.parse(fs.readFileSync(path.join(data, 'comments-page-2.json'), 'utf8'));
  if (count > 0 && process.env.GH_EDIT_COMMENT === '1') first[0].body = 'Edited during capture';
  if (endpoint.includes('&page=')) {
    const all = Array.isArray(first) && Array.isArray(second) ? first.concat(second) : {};
    const result = Array.isArray(all) ? all.slice((page - 1) * 100, page * 100) : all;
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  }
  if (args.includes('--paginate') && args.includes('--slurp')) {
    process.stdout.write(JSON.stringify([first, second]) + '\\n');
  } else {
    process.stdout.write(JSON.stringify(first) + '\\n');
  }
  process.exit(0);
}
if (endpoint === 'repos/acme/widget/issues/42') {
  const readCount = Number(fs.existsSync(process.env.GH_READ_COUNT) ? fs.readFileSync(process.env.GH_READ_COUNT, 'utf8') : '0');
  fs.writeFileSync(process.env.GH_READ_COUNT, String(readCount + 1));
  const filename = readCount === 0 ? 'issue-before.json' : 'issue-after.json';
  process.stdout.write(fs.readFileSync(path.join(data, filename), 'utf8') + '\\n');
  process.exit(0);
}
process.stderr.write('unexpected gh api endpoint: ' + endpoint + '\\n');
process.exit(2);
`, { mode: 0o755 });
  return {
    tmp,
    bin,
    data,
    callFile: path.join(tmp, 'gh-calls.jsonl'),
    readCountFile: path.join(tmp, 'issue-read-count'),
  };
}

function runCli(f, outPath, extra = [], env = {}) {
  return spawnSync(process.execPath, [SCRIPT, '--repo', 'acme/widget', '--issue', '42', '--out', outPath, ...extra], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH}`,
      GH_FIXTURE_DIR: f.data,
      GH_CALL_FILE: f.callFile,
      GH_READ_COUNT: f.readCountFile,
      ...env,
    },
  });
}

test('writes the complete issue snapshot, including full comment text', () => {
  const f = fixture();
  const out = path.join(f.tmp, 'snapshot.json');
  try {
    const result = runCli(f, out);
    assert.strictEqual(result.status, 0, result.stderr || result.error?.message);

    const serialized = fs.readFileSync(out, 'utf8');
    const snapshot = JSON.parse(serialized);
    assert.strictEqual(serialized.endsWith('\n'), true);
    assert.deepStrictEqual(Object.keys(snapshot), ['schema', 'repo', 'fetchedAt', 'issue', 'comments']);
    assert.strictEqual(snapshot.schema, 'dhpk.issue-snapshot.v1');
    assert.strictEqual(snapshot.repo, 'acme/widget');
    assert.ok(Number.isFinite(Date.parse(snapshot.fetchedAt)));
    assert.strictEqual(snapshot.issue.number, 42);
    assert.strictEqual(snapshot.issue.title, 'Retro delivery guardrails');
    assert.strictEqual(snapshot.issue.body, 'Keep the complete source record: café, 日本語, and 🧭.');
    assert.strictEqual(snapshot.issue.url, 'https://github.com/acme/widget/issues/42');
    assert.strictEqual(snapshot.issue.state, 'closed');
    assert.deepStrictEqual(snapshot.issue.labels, ['bug', 'ready-for-agent']);
    const calls = fs.readFileSync(f.callFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    assert.ok(calls.every((args) => args[0] === 'api' && args.includes('GET')));
    assert.deepStrictEqual(snapshot.comments, [
      {
        id: 7001,
        body: 'The issue body is unchanged; this comment carries the delivery requirement.',
        url: 'https://github.com/acme/widget/issues/42#issuecomment-7001',
        createdAt: '2026-10-28T09:00:00Z',
        updatedAt: '2026-10-28T09:15:00Z',
      },
      {
        id: 7002,
        body: 'Second page comment with preserved source URL.',
        url: 'https://github.com/acme/widget/issues/42#issuecomment-7002',
        createdAt: '2026-10-28T10:00:00Z',
        updatedAt: '2026-10-28T10:00:00Z',
      },
    ]);
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
  }
});

test('refuses an incomplete comment set without replacing the existing snapshot', () => {
  const f = fixture({ secondPage: [] });
  const out = path.join(f.tmp, 'snapshot.json');
  fs.writeFileSync(out, 'keep-existing-snapshot\n');
  try {
    const result = runCli(f, out);
    assert.notStrictEqual(result.status, 0);
    assert.ok(`${result.stdout}\n${result.stderr}`.toLowerCase().includes('comment'));
    assert.strictEqual(fs.readFileSync(out, 'utf8'), 'keep-existing-snapshot\n');
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
  }
});

test('refuses an issue that changes while comments are being fetched', () => {
  const f = fixture({ after: makeIssue({ updated_at: '2026-10-29T02:04:04Z' }) });
  const out = path.join(f.tmp, 'snapshot.json');
  fs.writeFileSync(out, 'keep-existing-snapshot\n');
  try {
    const result = runCli(f, out);
    assert.notStrictEqual(result.status, 0);
    assert.ok(`${result.stdout}\n${result.stderr}`.includes('ISSUE_CHANGED'));
    assert.strictEqual(fs.readFileSync(out, 'utf8'), 'keep-existing-snapshot\n');
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
  }
});

test('rejects invalid repo, issue, and relative output before calling gh', () => {
  for (const args of [
    ['--repo', 'acme', '--issue', '42', '--out', '/tmp/unused.json'],
    ['--repo', 'acme/widget', '--issue', '0', '--out', '/tmp/unused.json'],
    ['--repo', 'acme/widget', '--issue', '42', '--out', 'relative.json'],
  ]) {
    const f = fixture();
    try {
      const result = spawnSync(process.execPath, [SCRIPT, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${f.bin}:${process.env.PATH}`,
          GH_FIXTURE_DIR: f.data,
          GH_CALL_FILE: f.callFile,
          GH_READ_COUNT: f.readCountFile,
        },
      });
      assert.notStrictEqual(result.status, 0);
      assert.strictEqual(fs.existsSync(f.callFile), false);
    } finally {
      fs.rmSync(f.tmp, { recursive: true, force: true });
    }
  }
});

test('refuses gh API errors and preserves the destination', () => {
  const f = fixture();
  const out = path.join(f.tmp, 'snapshot.json');
  fs.writeFileSync(out, 'keep-existing-snapshot\n');
  try {
    const result = runCli(f, out, [], { GH_FAIL: '1' });
    assert.notStrictEqual(result.status, 0);
    assert.ok(`${result.stdout}\n${result.stderr}`.includes('fixture gh API failure'));
    assert.strictEqual(fs.readFileSync(out, 'utf8'), 'keep-existing-snapshot\n');
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
  }
});

test('refuses malformed issue data without creating a snapshot', () => {
  const f = fixture({ before: makeIssue({ labels: null }) });
  const out = path.join(f.tmp, 'snapshot.json');
  try {
    const result = runCli(f, out);
    assert.notStrictEqual(result.status, 0);
    assert.strictEqual(fs.existsSync(out), false);
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
  }
});

test('refuses a symlink output path without modifying its target', () => {
  const f = fixture();
  const target = path.join(f.tmp, 'existing.json');
  const out = path.join(f.tmp, 'snapshot-link.json');
  fs.writeFileSync(target, 'keep-existing-snapshot\n');
  fs.symlinkSync(target, out);
  try {
    const result = runCli(f, out);
    assert.notStrictEqual(result.status, 0);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'keep-existing-snapshot\n');
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
  }
});

test('rejects comment edits even when issue timestamp and count stay unchanged', () => {
  const f = fixture();
  const out = path.join(f.tmp, 'snapshot.json');
  fs.writeFileSync(out, 'keep-existing-snapshot\n');
  try {
    const result = runCli(f, out, [], { GH_EDIT_COMMENT: '1' });
    assert.notStrictEqual(result.status, 0);
    assert.ok(result.stderr.includes('COMMENTS_CHANGED'));
    assert.strictEqual(fs.readFileSync(out, 'utf8'), 'keep-existing-snapshot\n');
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
  }
});

test('rejects malformed pages, duplicate ids, and invalid timestamps', () => {
  for (const secondPage of [
    {},
    [comment(7001, 'Duplicate id', '2026-10-28T10:00:00Z', '2026-10-28T10:00:00Z')],
    [comment(7002, 'Bad timestamp', 'invalid', '2026-10-28T10:00:00Z')],
  ]) {
    const f = fixture({ secondPage });
    const out = path.join(f.tmp, 'snapshot.json');
    try {
      const result = runCli(f, out);
      assert.notStrictEqual(result.status, 0);
      assert.ok(result.stderr.toLowerCase().includes('comment'));
      assert.strictEqual(fs.existsSync(out), false);
    } finally {
      fs.rmSync(f.tmp, { recursive: true, force: true });
    }
  }
});

test('preserves issue and comment author identities and source timestamps', () => {
  const f = fixture({
    before: makeIssue({
      created_at: '2026-10-27T01:00:00Z',
      user: { login: 'issue-author', id: 80, html_url: 'https://github.com/issue-author', ignored: 'extra' },
    }),
    firstPage: [{
      ...comment(7001, 'Attributed comment', '2026-10-28T09:00:00Z', '2026-10-28T09:15:00Z'),
      user: { login: 'comment-author', id: 81, html_url: 'https://github.com/comment-author' },
    }],
    secondPage: [{
      ...comment(7002, 'Deleted author', '2026-10-28T10:00:00Z', '2026-10-28T10:00:00Z'),
      user: null,
    }],
  });
  const out = path.join(f.tmp, 'snapshot.json');
  try {
    const result = runCli(f, out);
    assert.strictEqual(result.status, 0, result.stderr);
    const snapshot = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.deepStrictEqual(snapshot.issue.author, { login: 'issue-author', id: 80, url: 'https://github.com/issue-author' });
    assert.strictEqual(snapshot.issue.createdAt, '2026-10-27T01:00:00Z');
    assert.strictEqual(snapshot.issue.updatedAt, '2026-10-29T02:03:04Z');
    assert.deepStrictEqual(snapshot.comments[0].author, { login: 'comment-author', id: 81, url: 'https://github.com/comment-author' });
    assert.strictEqual(snapshot.comments[1].author, null);
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
  }
});

test('supports older gh without slurp and captures 100 plus 1 comments across real API pages', () => {
  const firstPage = Array.from({ length: 100 }, (_, i) => comment(8000 + i, `Comment ${i}`, '2026-10-28T09:00:00Z', '2026-10-28T09:00:00Z'));
  const f = fixture({
    before: makeIssue({ comments: 101 }),
    firstPage,
    secondPage: [comment(9000, 'Last page requirement', '2026-10-28T10:00:00Z', '2026-10-28T10:00:00Z')],
  });
  const out = path.join(f.tmp, 'snapshot.json');
  try {
    const result = runCli(f, out, [], { GH_REJECT_SLURP: '1' });
    assert.strictEqual(result.status, 0, result.stderr);
    const snapshot = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.strictEqual(snapshot.comments.length, 101);
    assert.strictEqual(snapshot.comments[0].id, 8000);
    assert.strictEqual(snapshot.comments[99].id, 8099);
    assert.strictEqual(snapshot.comments[100].id, 9000);
    assert.strictEqual(snapshot.comments[100].body, 'Last page requirement');
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
  }
});

run('maintainer-issue-snapshot');
