'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { registerFixture, getFixtures } = require('./skill-directory-fixtures');
let registered = false;

function registerReleaseFixtures() {
  if (registered) return getFixtures();
  for (const definition of [
    { id: 'release-unmerged-blocked', phase: 'publish', status: 1, output: 'is not merged' },
    { id: 'release-unrelated-change-blocked', phase: 'prepare', status: 1, output: 'unexpected worktree changes' },
    { id: 'release-prepare-explicit-files', phase: 'prepare', status: 0, output: 'https://example.invalid/release/1' },
  ]) {
    registerFixture({
      id: definition.id,
      entry: 'scripts/release-runner.sh',
      args: [definition.phase, '1.2.3', 'develop', 'main', 'v', 'release.yml',
        ...(definition.phase === 'prepare' ? ['package.json'] : [])],
      expected: { status: definition.status, output: definition.output },
      assert(result, context) {
        assert.strictEqual(result.status, definition.status, result.stderr || result.stdout);
        assert.ok((result.stdout + result.stderr).includes(definition.output));
        const log = fs.readFileSync(path.join(context.projectDir, 'tool-log.jsonl'), 'utf8')
          .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
        if (definition.status !== 0) {
          assert.ok(!log.some(({ tool, args }) =>
            (tool === 'git' && ['add', 'commit', 'push', 'tag'].includes(args[0]))
            || (tool === 'gh' && args[0] === 'pr' && args[1] === 'create')));
        } else {
          assert.deepStrictEqual(log.filter(({ tool, args }) => tool === 'git' && args[0] === 'add')
            .map(({ args }) => args), [['add', '--', 'package.json']]);
          assert.ok(log.some(({ tool, args }) => tool === 'git' && args[0] === 'commit'));
          assert.ok(log.some(({ tool, args }) => tool === 'gh' && args[0] === 'pr' && args[1] === 'create'));
          assert.ok(!log.some(({ tool, args }) => tool === 'git' && args[0] === 'tag'));
        }
        assert.strictEqual(fs.readFileSync(path.join(context.projectDir, 'package.json'), 'utf8'), '{"version":"1.2.3"}\n');
        assert.strictEqual(context.hostStatus, 'NOT_RUN');
      },
    });
  }
  registered = true;
  return getFixtures();
}

module.exports = { registerReleaseFixtures };
