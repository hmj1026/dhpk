'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validOptions(options) {
  return options && typeof options.repo === 'string'
    && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo)
    && positiveInteger(options.pr)
    && typeof options.head === 'string' && /^[a-fA-F0-9]{40}$/.test(options.head)
    && typeof options.log === 'string' && path.isAbsolute(options.log)
    && !options.log.includes('\0')
    && Number.isSafeInteger(options.waitSeconds) && options.waitSeconds >= 0
    && options.waitSeconds <= 3600
    && Number.isSafeInteger(options.intervalSeconds) && options.intervalSeconds >= 0
    && options.intervalSeconds <= 300
    && (options.intervalSeconds > 0 || options.waitSeconds === 0);
}

function api(endpoint) {
  const result = spawnSync('gh', ['api', '--method', 'GET', endpoint], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('github-api-error');
  try { return JSON.parse(result.stdout); } catch (_) { throw new Error('github-api-json-error'); }
}

function currentPr(options) {
  const pr = api(`repos/${options.repo}/pulls/${options.pr}`);
  if (!pr || pr.number !== options.pr || !pr.head || pr.head.sha !== options.head) {
    throw new Error('pr-head-mismatch');
  }
  return pr;
}

function timestamp(value) {
  return typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
}

function matchesRun(run, pr, options) {
  if (!run || !positiveInteger(run.id) || run.path !== '.github/workflows/ci.yml'
    || run.event !== 'pull_request' || run.head_sha !== options.head
    || !Array.isArray(run.pull_requests)) return false;
  if (run.pull_requests.length > 0) {
    return run.pull_requests.some((association) => association && association.number === options.pr);
  }
  // GitHub 偶爾省略 PR 關聯；僅在完整來源座標與建立時間皆相符時接受空陣列。
  const runTime = timestamp(run.created_at);
  const prTime = timestamp(pr.created_at);
  return pr.base && pr.base.ref === 'develop' && pr.base.repo
    && pr.base.repo.full_name === options.repo
    && typeof pr.head.ref === 'string' && pr.head.ref.length > 0
    && run.head_branch === pr.head.ref
    && pr.head.repo && positiveInteger(pr.head.repo.id)
    && run.head_repository && positiveInteger(run.head_repository.id)
    && run.head_repository.id === pr.head.repo.id
    && Number.isFinite(runTime) && Number.isFinite(prTime) && runTime >= prTime;
}

function newestRun(pr, options) {
  let newest = null;
  // 明確逐頁讀取，避免依賴新版 gh 的 --slurp，亦不把第一頁的舊綠燈當成最新結果。
  for (let page = 1; ; page += 1) {
    const data = api(`repos/${options.repo}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${options.head}&per_page=100&page=${page}`);
    if (!data || !Array.isArray(data.workflow_runs)) throw new Error('github-runs-json-error');
    for (const run of data.workflow_runs) {
      if (matchesRun(run, pr, options) && (!newest || run.id > newest.id)) newest = run;
    }
    if (data.workflow_runs.length < 100) return newest;
  }
}

function watchRun(run, options) {
  return new Promise((resolve, reject) => {
    let descriptor;
    try { descriptor = fs.openSync(options.log, 'a'); } catch (_) {
      reject(new Error('watch-log-error'));
      return;
    }
    // watch 的完整輸出直接附加到檔案，避免緩衝截斷及污染結構化主控台訊息。
    const child = spawn('gh', ['run', 'watch', String(run.id), '--repo', options.repo, '--exit-status'], {
      stdio: ['ignore', descriptor, descriptor],
    });
    fs.closeSync(descriptor);
    child.once('error', () => reject(new Error('watch-command-error')));
    child.once('close', (code) => resolve(code));
  });
}

/**
 * 僅觀察指定 PR 與固定 head 的 CI；每次 watch 後重讀 PR 與最新 run，
 * 防止 head 漂移或較新排程出現時誤報舊 run 成功。
 */
async function runCiWatch(input = {}) {
  const options = { waitSeconds: 180, intervalSeconds: 20, ...input };
  let previousState;
  const transition = (state) => {
    const serialized = JSON.stringify(state);
    if (serialized !== previousState) process.stdout.write(`${serialized}\n`);
    previousState = serialized;
  };
  const finish = (status, exitCode, run, reason) => {
    const result = { status, exitCode };
    if (run) {
      result.runId = run.id;
      result.runUrl = run.html_url;
      result.conclusion = run.conclusion;
    }
    if (reason) result.reason = reason;
    transition(result);
    return result;
  };
  if (!validOptions(options)) return finish('blocked', 2, null, 'invalid-options');
  let run;
  try {
    let pr = currentPr(options);
    run = newestRun(pr, options);
    const deadline = Date.now() + options.waitSeconds * 1000;
    while (!run) {
      transition({ status: 'waiting', reason: 'run-not-found' });
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(options.intervalSeconds * 1000, remaining)));
      }
      // 即使等待時間是零，也必須在截止點重新查詢，讓剛出現的 queued run 能接續觀察。
      pr = currentPr(options);
      run = newestRun(pr, options);
      if (!run && Date.now() >= deadline) return finish('blocked', 2, null, 'run-not-found');
    }
    for (;;) {
      currentPr(options);
      transition({ status: 'watching', runId: run.id });
      const code = await watchRun(run, options);
      pr = currentPr(options);
      const latest = newestRun(pr, options);
      // 舊 run 的 watch 失敗不可替同一 run 報綠；新 run 則有獨立的觀察結果。
      if (latest && latest.id > run.id) {
        run = latest;
        continue;
      }
      if (code !== 0) return finish('failed', 1, latest || run, 'watch-error');
      if (!latest) return finish('blocked', 2, run, 'run-not-found-after-watch');
      if (latest.id !== run.id) return finish('blocked', 2, latest, 'latest-run-changed');
      if (latest.status !== 'completed') return finish('blocked', 2, latest, 'run-not-completed');
      return finish(latest.conclusion === 'success' ? 'passed' : 'failed',
        latest.conclusion === 'success' ? 0 : 1, latest);
    }
  } catch (error) {
    return finish('blocked', 2, run, error.message);
  }
}

module.exports = { runCiWatch };
