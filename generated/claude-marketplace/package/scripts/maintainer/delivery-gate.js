'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function requireGate(condition, message) {
  if (!condition) throw new Error(message);
}

function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    requireGate(['--repo', '--pr', '--head', '--evidence', '--execute'].includes(key), 'unknown argument');
    requireGate(!Object.hasOwn(result, key), 'duplicate argument');
    result[key] = key === '--execute' ? true : argv[++i];
    requireGate(result[key] !== undefined, 'missing argument value');
  }
  requireGate(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(result['--repo']), 'invalid repo');
  requireGate(/^[1-9][0-9]*$/.test(result['--pr']), 'invalid PR number');
  requireGate(/^[a-f0-9]{40}$/.test(result['--head']), 'invalid head SHA');
  requireGate(typeof result['--evidence'] === 'string' && result['--evidence'].length > 0, 'missing evidence');
  return result;
}

function gh(args, allow404 = false) {
  const result = spawnSync('gh', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  if (allow404 && result.status !== 0 && /\(HTTP 404\)/.test(result.stderr || '')) return null;
  // 不印出 gh 原始回應，避免驗證失敗時將 PR 或認證資訊帶入日誌。
  requireGate(!result.error && result.status === 0, `gh command failed: ${args.slice(0, 2).join(' ')}`);
  return result.stdout;
}

function api(endpoint, { optional = false } = {}) {
  const output = gh(['api', endpoint], optional);
  if (output === null) return null;
  try { return JSON.parse(output); } catch { throw new Error('invalid gh API JSON'); }
}

// 舊版 gh 不支援 --slurp；逐頁讀取真實 REST 物件，避免靠多份 JSON 串接解析。
function allPages(endpoint, collection) {
  const rows = [];
  for (let page = 1; page <= 1000; page += 1) {
    const value = api(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const batch = collection ? value?.[collection] : value;
    requireGate(Array.isArray(batch), 'invalid required checks or rules page');
    rows.push(...batch);
    if (Number.isSafeInteger(value?.total_count)) {
      if (rows.length >= value.total_count) return rows;
      requireGate(batch.length > 0, 'incomplete required checks pagination');
    } else if (batch.length < 100) return rows;
  }
  throw new Error('required checks pagination limit exceeded');
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function evidenceFor(opts) {
  let evidence;
  try { evidence = JSON.parse(fs.readFileSync(opts['--evidence'], 'utf8')); }
  catch { throw new Error('unreadable evidence JSON'); }
  const head = opts['--head'];
  requireGate(evidence && evidence.schema === 'dhpk.delivery-evidence.v1' && evidence.headSha === head, 'invalid evidence schema or head');
  const local = evidence.local;
  const review = evidence.review;
  requireGate(local && local.headSha === head && local.status === 'PASS' && nonempty(local.command), 'invalid local evidence');
  requireGate(review && review.headSha === head && review.status === 'APPROVE' &&
    Array.isArray(review.reviewers) && review.reviewers.length > 0 && review.reviewers.every(nonempty), 'invalid review evidence');
  for (const pointer of [local.logPath, review.reportPath]) {
    requireGate(nonempty(pointer), 'missing evidence pointer');
    const resolved = path.resolve(path.dirname(path.resolve(opts['--evidence'])), pointer);
    try {
      requireGate(fs.statSync(resolved).isFile() && fs.readFileSync(resolved).toString().trim().length > 0, 'empty evidence pointer');
    } catch { throw new Error('invalid evidence pointer'); }
  }
  requireGate(evidence.metadata && nonempty(evidence.metadata.title) &&
    /^[a-f0-9]{64}$/.test(evidence.metadata.bodySha256), 'invalid metadata evidence');
  return evidence;
}

function pullFor(opts) {
  return api(`repos/${opts['--repo']}/pulls/${opts['--pr']}`);
}

function requiredChecks(repo) {
  const protection = api(`repos/${repo}/branches/develop/protection`, { optional: true });
  requireGate(protection === null || (typeof protection === 'object' && !Array.isArray(protection)), 'invalid branch protection');
  const classic = protection?.required_status_checks || null;
  const rules = allPages(`repos/${repo}/rules/branches/develop`);
  requireGate(rules.every((rule) => rule && typeof rule.type === 'string'), 'invalid effective branch rule');
  const modern = rules.filter((rule) => rule.type === 'required_status_checks');
  const checks = [];
  if (classic !== null) {
    requireGate(classic && typeof classic === 'object' && !Array.isArray(classic), 'invalid branch protection');
    requireGate(classic.checks === undefined || Array.isArray(classic.checks), 'invalid protection checks');
    requireGate(classic.contexts === undefined || Array.isArray(classic.contexts), 'invalid protection contexts');
    checks.push(...(classic.checks || []).map((check) => ({ name: check.context, app: check.app_id })));
    for (const context of classic.contexts || []) {
      if (!checks.some((check) => check.name === context)) checks.push({ name: context, app: null });
    }
  }
  for (const rule of modern) {
    requireGate(Array.isArray(rule.parameters?.required_status_checks), 'invalid required rules');
    checks.push(...rule.parameters.required_status_checks.map((check) => ({ name: check.context, app: check.integration_id })));
  }
  requireGate(classic !== null || modern.length > 0, 'missing branch protection and effective required rules');
  requireGate(checks.length > 0 && checks.every((check) => nonempty(check.name) &&
    (check.app == null || (Number.isSafeInteger(check.app) && check.app >= -1))), 'missing or invalid required checks');
  // 其他規則存在不能掩蓋專案必要的 harness CI 遺漏。
  requireGate(checks.some((check) => check.name === 'Validate harness assets'), 'required Validate harness assets rule missing');
  const reviewRequired = (review) => review &&
    (review.required_approving_review_count > 0 || review.require_code_owner_reviews === true);
  return { checks, reviewRequired: Boolean(reviewRequired(protection?.required_pull_request_reviews) ||
    rules.some((rule) => rule.type === 'pull_request' && reviewRequired(rule.parameters))) };
}

function latest(runs) {
  // GitHub 同名 rerun 的舊綠燈不能蓋過較新的 pending；無排序證據時保守驗證全部。
  if (runs.every((run) => Number.isSafeInteger(run.id))) {
    const id = Math.max(...runs.map((run) => run.id));
    return runs.filter((run) => run.id === id);
  }
  return runs;
}

function checkHosted(repo, head, required) {
  const runs = allPages(`repos/${repo}/commits/${head}/check-runs?filter=all`, 'check_runs');
  const statuses = allPages(`repos/${repo}/commits/${head}/status`, 'statuses');
  for (const check of required) {
    const namedRuns = runs.filter((run) => run.name === check.name);
    const namedStatuses = statuses.filter((status) => status.context === check.name);
    const matching = namedRuns.filter((run) => check.app == null || check.app === -1 || run.app?.id === check.app);
    requireGate(matching.length > 0 || ((check.app == null || check.app === -1) && namedStatuses.length > 0), `required check missing or wrong app: ${check.name}`);
    requireGate(latest(matching).every((run) => run.head_sha === head && run.status === 'completed' && run.conclusion === 'success'), `required check not successful at head: ${check.name}`);
    // Commit statuses 沒有 head_sha，查詢的 commit endpoint 即是其綁定；若帶 sha 仍須相符。
    requireGate(latest(namedStatuses).every((status) => status.state === 'success' && (!status.sha || status.sha === head)), `required status not successful: ${check.name}`);
  }
}

function validate(opts) {
  const evidence = evidenceFor(opts);
  const pull = pullFor(opts);
  requireGate(pull?.number === Number(opts['--pr']) && pull.state === 'open' && pull.merged === false &&
    pull.draft === false && pull.base?.ref === 'develop', 'PR must be OPEN nondraft targeting develop');
  requireGate(pull.head?.sha === opts['--head'], 'PR head SHA changed');
  requireGate(pull.mergeable === true, 'PR mergeability is unresolved or conflicting');
  requireGate(pull.title === evidence.metadata.title && typeof pull.body === 'string' &&
    crypto.createHash('sha256').update(pull.body).digest('hex') === evidence.metadata.bodySha256, 'PR title or body digest differs from metadata evidence');
  let review;
  try { review = JSON.parse(gh(['pr', 'view', opts['--pr'], '--repo', opts['--repo'], '--json', 'reviewDecision'])); }
  catch { throw new Error('reviewDecision lookup failed'); }
  const requirements = requiredChecks(opts['--repo']);
  // 未設定遠端審批規則時，自行維護 PR 的空決議仍由本機 APPROVE 證據約束。
  const decision = review?.reviewDecision;
  requireGate(decision === 'APPROVED' || (!requirements.reviewRequired && (decision === '' || decision === null)),
    'live reviewDecision does not satisfy applicable review requirements');
  checkHosted(opts['--repo'], opts['--head'], requirements.checks);
}

function main() {
  const opts = options(process.argv.slice(2));
  validate(opts);
  if (!opts['--execute']) {
    console.log(`PASS: delivery gate at ${opts['--head']} (read-only)`);
    return;
  }
  validate(opts);
  gh(['pr', 'merge', opts['--pr'], '--repo', opts['--repo'], '--merge', '--match-head-commit', opts['--head']]);
  const observed = pullFor(opts);
  requireGate(observed?.number === Number(opts['--pr']) && observed.merged === true && observed.state === 'closed' &&
    observed.head?.sha === opts['--head'] && /^[a-f0-9]{40}$/.test(observed.merge_commit_sha), 'merge readback pending or head mismatch; no confirmed merge');
  console.log(`PASS: merged head ${opts['--head']}; merge commit ${observed.merge_commit_sha}`);
}

try { main(); } catch (error) {
  console.error(`BLOCKED: ${error.message}`);
  process.exitCode = 2;
}
