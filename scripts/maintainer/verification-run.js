#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const SCHEMA = 'dhpk.verification-run.v1';
const RECORD_DIR = 'docs/evidence/verification-runs';
const directoryHandles = [];

const USAGE = `Usage:
  node scripts/maintainer/verification-run.js start --root PATH --task ID --attempt ID --key NAME [--retry] -- <argv...>
  node scripts/maintainer/verification-run.js status --record ABSFILE
  node scripts/maintainer/verification-run.js overview --ledger ABSFILE
  node scripts/maintainer/verification-run.js preflight --root PATH --base SHA --base-ref develop
  node scripts/maintainer/verification-run.js ci-watch --repo OWNER/REPO --pr N --head SHA --log ABSFILE [--wait-seconds 180] [--interval-seconds 20]
`;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const [action, ...args] = argv;
  const fields = {
    start: ['root', 'task', 'attempt', 'key'], status: ['record'], overview: ['ledger'],
    preflight: ['root', 'base', 'base-ref'], 'ci-watch': ['repo', 'pr', 'head', 'log'],
  };
  requireValue(Object.hasOwn(fields, action), 'Invalid action');
  const options = { action };
  const required = fields[action];
  const permitted = [...required, ...(action === 'ci-watch' ? ['wait-seconds', 'interval-seconds'] : [])];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--' && action === 'start') { options.command = args.slice(i + 1); break; }
    if (args[i] === '--retry' && action === 'start' && !options.retry) { options.retry = true; continue; }
    const name = args[i].slice(2);
    requireValue(args[i].startsWith('--') && permitted.includes(name) && !options[name]
      && args[i + 1] && !args[i + 1].startsWith('--'), 'Invalid arguments');
    options[name] = args[++i];
  }
  requireValue(required.every((name) => options[name]), 'Missing required arguments');
  if (action === 'start') requireValue(options.command?.length > 0, 'Missing command argv');
  if (action === 'status') requireValue(path.isAbsolute(options.record), 'Record path must be absolute');
  if (action === 'overview') requireValue(path.isAbsolute(options.ledger), 'Ledger path must be absolute');
  if (action === 'ci-watch') {
    requireValue(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo)
      && /^[1-9]\d*$/.test(options.pr) && Number.isSafeInteger(Number(options.pr))
      && /^[0-9a-f]{40}$/i.test(options.head) && path.isAbsolute(options.log), 'Invalid CI watch arguments');
    for (const name of ['wait-seconds', 'interval-seconds']) {
      if (options[name] !== undefined) requireValue(/^\d+$/.test(options[name])
        && Number.isSafeInteger(Number(options[name])) && Number(options[name]) >= (name === 'wait-seconds' ? 0 : 1),
      'Invalid CI watch timing');
    }
  }
  return options;
}

function git(root, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', root, ...args], { encoding, maxBuffer: 64 * 1024 * 1024 });
}

function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function snapshot(root) {
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], null);
  const names = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], null)
    .toString().split('\0').filter(Boolean).sort();
  const hash = crypto.createHash('sha256').update(status);
  // 狀態旗標不會反映再次修改的內容，連同檔案位元組與路徑雜湊才能避免誤用舊證據。
  for (const name of names) {
    hash.update(JSON.stringify(name));
    try {
      const file = path.join(root, name);
      const stat = fs.lstatSync(file);
      hash.update(String(stat.mode));
      if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(file));
      else if (stat.isFile()) hash.update(fs.readFileSync(file));
      else hash.update('non-file');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update('missing');
    }
  }
  return {
    branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
    head: git(root, ['rev-parse', 'HEAD']).trim(), dirtyFingerprint: hash.digest('hex'),
  };
}

// Linux 的固定目錄 fd 防止檢查後目錄被換成 symlink 而將證據寫到 root 外。
function pinDirectory(location) {
  const fd = fs.openSync(location, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  directoryHandles.push(fd);
  return process.platform === 'linux' ? `/proc/self/fd/${fd}` : location;
}

function childDirectory(parent, name) {
  const location = path.join(parent, name);
  let created = false;
  try { fs.mkdirSync(location, { mode: 0o700 }); created = true; } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const stat = fs.lstatSync(location);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'Invalid record directory: symlink or non-directory');
  if (created) {
    const parentFd = fs.openSync(parent, fs.constants.O_RDONLY);
    try { fs.fsyncSync(parentFd); } finally { fs.closeSync(parentFd); }
  }
  return { io: pinDirectory(location), created };
}

function evidenceDirectory(root) {
  const ignored = execFileSync('git', ['-C', root, 'check-ignore', '--no-index', '--', `${RECORD_DIR}/.probe`],
    { encoding: 'utf8' }).trim();
  requireValue(ignored && !git(root, ['ls-files', '--', RECORD_DIR]).trim(),
    'Record directory must be ignored and contain no tracked files');
  let io = pinDirectory(root);
  for (const segment of RECORD_DIR.split('/')) io = childDirectory(io, segment).io;
  return io;
}

function atomicJson(directory, name, value) {
  const temporary = path.join(directory, `.${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, path.join(directory, name));
  const dirFd = fs.openSync(directory, fs.constants.O_RDONLY);
  try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
}

function processIdentity(pid) {
  if (process.platform !== 'linux' || !Number.isInteger(pid) || pid <= 0) return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (['Z', 'X'].includes(fields[0])) return null;
    return `${fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${fields[19]}`;
  } catch (_) { return null; }
}

function readRecord(location) {
  const fd = fs.openSync(location, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let record;
  try { record = JSON.parse(fs.readFileSync(fd, 'utf8')); } finally { fs.closeSync(fd); }
  requireValue(record && record.schema === SCHEMA && typeof record.ownerId === 'string'
    && ['running', 'passed', 'failed', 'unknown'].includes(record.status)
    && typeof record.recordPath === 'string' && typeof record.attempt === 'string', 'Invalid record');
  if (record.status === 'running'
    && (!record.processStartIdentity || processIdentity(record.pid) !== record.processStartIdentity)) {
    return { ...record, status: 'unknown' };
  }
  return record;
}

function summary(record, reused) {
  process.stdout.write(`${JSON.stringify({ ...record, reused })}\n`);
  // 包裝器的成功退出碼會讓 CI 誤認失敗指令已通過；重用證據也必須保留同一失敗結果。
  if (record.status === 'unknown') process.exitCode = 2;
  else if (record.status === 'failed') {
    process.exitCode = Number.isInteger(record.exitCode) && record.exitCode > 0 && record.exitCode <= 255
      ? record.exitCode : 1;
  }
}

async function existingRecord(io, recordPath) {
  // 同時啟動可能遇到已 claim 尚未寫入 record 的短暫空窗；只等初始化，絕不重新執行。
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try { return readRecord(path.join(io, 'record.json')); } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  // mkdir 成功後即使初始化程序死亡，也不可當作「沒有 claim」再執行一次。
  return { recordPath, status: 'unknown' };
}

async function runCommand(options, io, recordPath, snap, environment, envDigest) {
  const record = {
    schema: SCHEMA, ownerId: crypto.randomUUID(), task: options.task, attempt: options.attempt,
    key: options.key, root: options.root, snapshot: snap, command: options.command, environment, envDigest,
    pid: process.pid, processStartIdentity: processIdentity(process.pid),
    recordPath, logPath: path.join(path.dirname(recordPath), 'output.log'),
    status: 'running', exitCode: null, startedAt: new Date().toISOString(),
  };
  // 無法驗證程序起始身分時只留下 unknown，不啟動無法安全重用的子程序。
  if (!record.processStartIdentity) {
    record.status = 'unknown';
    atomicJson(io, 'record.json', record);
    summary(record, false);
    return;
  }
  const log = fs.openSync(path.join(io, 'output.log'), fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  atomicJson(io, 'record.json', record);
  try {
    const { code, signal } = await new Promise((resolve, reject) => {
      const child = spawn(options.command[0], options.command.slice(1), {
        cwd: options.root, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (data) => { fs.writeSync(log, data); process.stdout.write(data); });
      child.stderr.on('data', (data) => { fs.writeSync(log, data); process.stderr.write(data); });
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal }));
    });
    record.status = code === 0 ? 'passed' : 'failed';
    record.exitCode = code;
    record.signal = signal;
  } catch (error) {
    record.status = 'failed'; record.error = error.message;
    fs.writeSync(log, `${error.message}\n`); process.stderr.write(`${error.message}\n`);
  } finally { fs.fsyncSync(log); fs.closeSync(log); }
  if (record.status === 'passed') {
    // 指令可能讀到執行中改寫的來源，不能將通過結果歸給啟動時的舊快照。
    // 前後快照僅偵測結束時仍存在的變更，無法證明期間沒有改寫後還原。
    try {
      record.endSnapshot = snapshot(options.root);
      if (JSON.stringify(record.endSnapshot) !== JSON.stringify(snap)) {
        record.sourceChanged = true;
        record.status = 'unknown';
      }
    } catch (error) {
      record.sourceCheckError = error.message;
      record.status = 'unknown';
    }
  }
  record.finishedAt = new Date().toISOString();
  atomicJson(io, 'record.json', record);
  // 指令輸出可能沒有換行；summary 必須維持獨立 JSON 行。
  process.stdout.write('\n');
  summary(record, false);
}

async function start(options) {
  const root = fs.realpathSync(options.root);
  requireValue(fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim()) === root,
    'Root must be the repository root');
  const evidence = evidenceDirectory(root);
  const snap = snapshot(root);
  const environment = Object.fromEntries(['DHPK_TEST_JOBS', 'NODE_ENV'].map((name) => [name, process.env[name] ?? null]));
  // PATH、NODE_OPTIONS 與任意自訂變數都可能改變指令結果；完整環境只存摘要，避免洩漏憑證。
  const envDigest = digest(JSON.stringify(Object.keys(process.env).sort().map((name) => [name, process.env[name]])));
  const claimId = digest(JSON.stringify({ root, ...snap, key: options.key, command: options.command, envDigest }));
  let physical = path.join(root, RECORD_DIR, claimId);
  let claim = childDirectory(evidence, claimId);
  const attempts = new Set();
  while (!claim.created) {
    const recordPath = path.join(physical, 'record.json');
    const record = await existingRecord(claim.io, recordPath);
    attempts.add(record.attempt);
    if (fs.existsSync(path.join(claim.io, 'retry'))) {
      claim = childDirectory(claim.io, 'retry'); physical = path.join(physical, 'retry'); continue;
    }
    if (!options.retry) { summary(record, true); return; }
    requireValue(record.status === 'failed', 'Retry requires a failed record; unknown or running owner cannot be retried');
    requireValue(!attempts.has(options.attempt), 'Retry requires a new attempt ID');
    claim = childDirectory(claim.io, 'retry'); physical = path.join(physical, 'retry');
  }
  await runCommand({ ...options, root }, claim.io, path.join(physical, 'record.json'), snap, environment, envDigest);
}

async function main() {
  if (process.argv.length < 3 || process.argv[2] === '--help') { process.stdout.write(USAGE); return; }
  const options = parseArgs(process.argv.slice(2));
  if (options.action === 'status') summary(readRecord(options.record), true);
  else if (options.action === 'start') await start(options);
  else if (options.action === 'overview') overview(options.ledger);
  else {
    // helper 延後載入，避免讀取舊 record 時因其他維護工具缺少依賴而失效。
    const result = options.action === 'preflight'
      ? await require('./delivery-preflight').runPreflight({ root: options.root, base: options.base, baseRef: options['base-ref'] })
      : await require('./ci-watch').runCiWatch({
        repo: options.repo, pr: Number(options.pr), head: options.head, log: options.log,
        waitSeconds: options['wait-seconds'] === undefined ? 180 : Number(options['wait-seconds']),
        intervalSeconds: options['interval-seconds'] === undefined ? 20 : Number(options['interval-seconds']),
      });
    requireValue(result && typeof result.status === 'string' && Number.isInteger(result.exitCode)
      && result.exitCode >= 0 && result.exitCode <= 255, 'Invalid helper result');
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.exitCode;
  }
}

function overview(ledgerPath) {
  try {
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    requireValue(ledger && ledger.schema === 'dhpk.verification-ledger.v1', 'Invalid ledger schema');
    const seen = new Set();
    // 固定兩個名稱會漏掉其他頂層證據的失敗；讀取所有直接參照，並保留舊欄位的格式檢查。
    const records = Object.entries(ledger).filter(([label, entry]) =>
      ['verification', 'priorVerification'].includes(label)
      || (entry && typeof entry === 'object' && !Array.isArray(entry) && Object.hasOwn(entry, 'recordPath')))
      .map(([label, entry]) => {
      requireValue(entry && typeof entry.recordPath === 'string' && entry.recordPath.length > 0, 'Invalid ledger reference');
      const recordPath = fs.realpathSync(path.resolve(path.dirname(ledgerPath), entry.recordPath));
      requireValue(!seen.has(recordPath), 'Duplicate canonical record path');
      seen.add(recordPath);
      // ledger 的快取狀態可能過時；只沿用 record 的來源身分，不能冒稱目前 workspace 已通過。
      return { ...readRecord(recordPath), label, recordPath };
    });
    requireValue(records.length > 0, 'Missing ledger references');
    const failed = records.find((record) => record.status === 'failed');
    process.stdout.write(`${JSON.stringify({ schema: 'dhpk.verification-overview.v1', ledgerPath, records })}\n`);
    if (records.some((record) => record.status === 'unknown')) process.exitCode = 2;
    else if (failed) process.exitCode = Number.isInteger(failed.exitCode) && failed.exitCode > 0 && failed.exitCode <= 255
      ? failed.exitCode : 1;
  } catch (error) {
    throw new Error(`BLOCKED: ${error.message}`);
  }
}

// 共用 readRecord 時不可觸發 CLI，否則其他工具 import 便會意外執行使用者 argv。
if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`verification-run: ${error.message}\n`); process.exitCode = 2;
  }).finally(() => { for (const fd of directoryHandles) fs.closeSync(fd); });
}

module.exports = { readRecord };
