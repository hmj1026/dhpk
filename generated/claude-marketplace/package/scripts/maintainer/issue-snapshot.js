#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    requireValue(['--repo', '--issue', '--out'].includes(key) && !(key in options)
      && typeof argv[i + 1] === 'string', 'INVALID_ARGUMENTS: --repo OWNER/REPO --issue N --out ABS_PATH');
    options[key] = argv[i + 1];
  }
  requireValue(typeof options['--repo'] === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(options['--repo']), 'INVALID_REPO');
  requireValue(/^[1-9][0-9]*$/.test(options['--issue'])
    && Number.isSafeInteger(Number(options['--issue'])), 'INVALID_ISSUE');
  requireValue(typeof options['--out'] === 'string' && path.isAbsolute(options['--out'])
    && !options['--out'].includes('\0'), 'INVALID_OUTPUT: absolute path required');
  return { repo: options['--repo'], number: Number(options['--issue']), out: options['--out'] };
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function timestamp(value, label) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && Number.isFinite(Date.parse(value)), `INVALID_DATA: ${label} timestamp`);
  // 日期解析器會將不存在的日期進位；比對年月日以免損壞的來源通過驗證。
  requireValue(new Date(value).toISOString().slice(0, 19) === value.slice(0, 19), `INVALID_DATA: ${label} timestamp`);
  return value;
}

function sourceUrl(value, label) {
  requireValue(typeof value === 'string' && value.startsWith('https://'), `INVALID_DATA: ${label} URL`);
  try {
    const parsed = new URL(value);
    requireValue(Boolean(parsed.hostname) && !parsed.username && !parsed.password, `INVALID_DATA: ${label} URL`);
  } catch {
    throw new Error(`INVALID_DATA: ${label} URL`);
  }
  return value;
}

function author(user, label) {
  if (user === null) return null;
  requireValue(object(user) && typeof user.login === 'string' && user.login.length > 0
    && Number.isSafeInteger(user.id) && user.id > 0, `INVALID_DATA: ${label} author`);
  return { login: user.login, id: user.id, url: sourceUrl(user.html_url, `${label} author`) };
}

function issueData(raw, number) {
  requireValue(object(raw) && raw.number === number && typeof raw.title === 'string'
    && (typeof raw.body === 'string' || raw.body === null)
    && ['open', 'closed'].includes(raw.state) && Array.isArray(raw.labels)
    && Number.isSafeInteger(raw.comments) && raw.comments >= 0, 'INVALID_DATA: issue');
  const issue = {
    number: raw.number,
    title: raw.title,
    body: raw.body,
    url: sourceUrl(raw.html_url, 'issue'),
    state: raw.state,
    labels: raw.labels.map((label) => {
      requireValue(object(label) && typeof label.name === 'string' && label.name.length > 0, 'INVALID_DATA: issue label');
      return label.name;
    }),
    updatedAt: timestamp(raw.updated_at, 'issue updatedAt'),
  };
  if ('created_at' in raw) issue.createdAt = timestamp(raw.created_at, 'issue createdAt');
  if ('user' in raw) issue.author = author(raw.user, 'issue');
  return { issue, count: raw.comments };
}

function commentData(pages) {
  requireValue(Array.isArray(pages) && pages.length > 0 && pages.every(Array.isArray), 'INVALID_DATA: comment pages');
  const seen = new Set();
  return pages.flat().map((raw) => {
    requireValue(object(raw) && Number.isSafeInteger(raw.id) && raw.id > 0
      && !seen.has(raw.id) && typeof raw.body === 'string', 'INVALID_DATA: comment or duplicate comment id');
    seen.add(raw.id);
    const comment = {
      id: raw.id,
      body: raw.body,
      url: sourceUrl(raw.html_url, 'comment'),
      createdAt: timestamp(raw.created_at, 'comment createdAt'),
      updatedAt: timestamp(raw.updated_at, 'comment updatedAt'),
    };
    if ('user' in raw) comment.author = author(raw.user, 'comment');
    return comment;
  });
}

function fetchJson(endpoint) {
  const args = ['api', '--method', 'GET', endpoint];
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  requireValue(!result.error && result.status === 0,
    `GH_API_FAILED: ${result.error ? result.error.message : (result.stderr || 'gh returned a nonzero status').trim()}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('INVALID_DATA: gh returned malformed JSON');
  }
}

function fetchComments(endpoint, expectedCount) {
  const pages = [];
  let total = 0;
  // 舊版 gh 不支援 --slurp；逐頁讀取 REST 陣列，並以已知留言數限制請求次數。
  const maxPages = Math.floor(expectedCount / 100) + 1;
  for (let page = 1; page <= maxPages; page += 1) {
    const items = fetchJson(`${endpoint}/comments?per_page=100&page=${page}`);
    requireValue(Array.isArray(items) && items.length <= 100, 'INVALID_DATA: comment page');
    total += items.length;
    requireValue(total <= expectedCount, 'COMMENTS_CHANGED: comment count increased during capture');
    pages.push(items);
    if (items.length < 100) return commentData(pages);
  }
  throw new Error('INCOMPLETE_COMMENTS: comment pagination did not terminate');
}

function checkDestination(out) {
  try {
    const stat = fs.lstatSync(out);
    requireValue(stat.isFile() && !stat.isSymbolicLink(), 'INVALID_OUTPUT: destination must be a regular file, not a symlink');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function atomicWrite(out, snapshot) {
  const temp = path.join(path.dirname(out), `.issue-snapshot-${randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // 先完成所有來源檢查再替換檔案；API 或序列化失敗時保留既有證據。
    checkDestination(out);
    fs.renameSync(temp, out);
  } finally {
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function snapshotIssue({ repo, number, out }) {
  checkDestination(out);
  const endpoint = `repos/${repo}/issues/${number}`;
  const before = issueData(fetchJson(endpoint), number);
  const comments = fetchComments(endpoint, before.count);
  // 留言編輯不一定改動 issue.updated_at，因此需獨立重讀完整分頁並比對內容。
  const confirmed = fetchComments(endpoint, before.count);
  const after = issueData(fetchJson(endpoint), number);
  requireValue(JSON.stringify(before) === JSON.stringify(after), 'ISSUE_CHANGED: issue metadata changed during capture');
  requireValue(comments.length === before.count && confirmed.length === before.count, 'INCOMPLETE_COMMENTS: comment count does not match issue');
  const canonical = (items) => JSON.stringify([...items].sort((a, b) => a.id - b.id));
  requireValue(canonical(comments) === canonical(confirmed), 'COMMENTS_CHANGED: comments changed during capture');
  const snapshot = { schema: 'dhpk.issue-snapshot.v1', repo, fetchedAt: new Date().toISOString(), issue: before.issue, comments };
  atomicWrite(out, snapshot);
  return snapshot;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    snapshotIssue(options);
    return 0;
  } catch (error) {
    process.stderr.write(`BLOCKED: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { main };
