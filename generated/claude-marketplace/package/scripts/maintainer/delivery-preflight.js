'use strict';

const fs = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');

async function runPreflight({ root, base, baseRef } = {}) {
  if (typeof root !== 'string' || typeof base !== 'string'
      || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(base) || baseRef !== 'develop') {
    throw new Error('Preflight requires a repository root, full commit SHA, and develop base ref');
  }

  const canonicalRoot = fs.realpathSync(root);
  const git = (args) => execFileSync('git', args, {
    cwd: canonicalRoot, encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  // 子目錄也能執行 Git；先核對真正根目錄，避免檢查器套用到錯誤的工作範圍。
  const topLevel = fs.realpathSync(git(['rev-parse', '--show-toplevel']));
  if (canonicalRoot !== topLevel) throw new Error('Preflight root must be the Git repository root');
  if (git(['rev-parse', '--verify', `${base}^{commit}`]) !== base) {
    throw new Error('Preflight base must identify an existing commit exactly');
  }

  const checkers = [
    { name: 'changelog', args: ['scripts/ci/validate-changelog-fragments.js', '--diff-base', base, '--base-ref', baseRef] },
    { name: 'metadata', args: ['tests/codex-skill-metadata.test.js'] },
    { name: 'catalog', args: ['scripts/ci/catalog.js', '--check', 'all', '--diff-base', base] },
  ];
  const stages = [];
  for (const checker of checkers) {
    const result = spawnSync(process.execPath, checker.args, {
      cwd: canonicalRoot, encoding: 'utf8', shell: false, maxBuffer: 16 * 1024 * 1024,
    });
    const exitCode = Number.isInteger(result.status) && result.status >= 0 ? result.status : 1;
    stages.push({
      name: checker.name, command: process.execPath, args: checker.args,
      exitCode, stdout: result.stdout || '',
      stderr: (result.stderr || '') + (result.error ? `${result.error.message}\n` : ''),
    });
    // 警告文字不等於失敗；沿用各檢查器的退出碼，且首次失敗後停止後續階段。
    if (exitCode !== 0) return { status: 'failed', exitCode, stages };
  }
  return { status: 'passed', exitCode: 0, stages };
}

module.exports = { runPreflight };
