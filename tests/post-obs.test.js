'use strict';

// Coverage for skills/dhpk-opsx-post-observation/scripts/post-obs.sh.
// Every HTTP call is served by a local curl stub; this suite never uses a network.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills', 'dhpk-opsx-post-observation', 'scripts', 'post-obs.sh');

function makeWorkspace(payloadText = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-obs-'));
  const bin = path.join(dir, 'bin');
  const tmpDir = path.join(dir, 'tmp');
  const payloadFile = path.join(dir, 'payload.json');
  const curlLog = path.join(dir, 'curl-requests.jsonl');
  const captureFile = path.join(dir, 'posted-payload.bin');
  const resultPathFile = path.join(dir, 'result-path.txt');
  fs.mkdirSync(bin);
  fs.mkdirSync(tmpDir);
  if (payloadText) fs.writeFileSync(payloadFile, payloadText);

  const fakeCurl = [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    'const args = process.argv.slice(2);',
    'fs.appendFileSync(process.env.CURL_LOG_FILE, JSON.stringify(args) + "\\n");',
    'const url = args.find((value) => value.startsWith("http://")) || "";',
    'if (url.endsWith("/health")) {',
    '  if (process.env.CURL_HEALTH_MODE === "up") process.stdout.write("{\\"ok\\":true}");',
    '  process.exit(process.env.CURL_HEALTH_MODE === "up" ? 0 : 7);',
    '}',
    'const dataIndex = args.indexOf("-d");',
    'const outputIndex = args.indexOf("-o");',
    'const dataArg = dataIndex >= 0 ? args[dataIndex + 1] : "";',
    'const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : "";',
    'if (!dataArg.startsWith("@") || !outputPath) process.exit(94);',
    'fs.copyFileSync(dataArg.slice(1), process.env.CURL_CAPTURE_FILE);',
    'fs.writeFileSync(process.env.CURL_RESULT_PATH_FILE, outputPath);',
    'fs.writeFileSync(outputPath, "{\\"id\\":7351}");',
  ].join('\n');
  fs.writeFileSync(path.join(bin, 'curl'), fakeCurl, { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'curl'), 0o755);

  return { dir, bin, tmpDir, payloadFile, curlLog, captureFile, resultPathFile };
}

function runScript(workspace, args, healthMode = 'up') {
  return spawnSync('/bin/bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      PATH: workspace.bin + path.delimiter + process.env.PATH,
      TMPDIR: workspace.tmpDir,
      CLAUDE_MEM_WORKER_PORT: '37777',
      CURL_HEALTH_MODE: healthMode,
      CURL_LOG_FILE: workspace.curlLog,
      CURL_CAPTURE_FILE: workspace.captureFile,
      CURL_RESULT_PATH_FILE: workspace.resultPathFile,
    },
  });
}

function readRequests(workspace) {
  if (!fs.existsSync(workspace.curlLog)) return [];
  return fs.readFileSync(workspace.curlLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

test('successful worker health check posts exact payload bytes and deduplicates the same observation', () => {
  const payloadText = '{\n  "title": "Résumé \\"quoted\\"",\n  "content": "first line\\nsecond line $HOME & {curly}",\n  "concepts": ["dedup-test", "secondary"]\n}\n';
  const workspace = makeWorkspace(payloadText);
  try {
    const first = runScript(workspace, [workspace.payloadFile]);
    assert.strictEqual(first.status, 0, first.stderr);
    assert.strictEqual(first.stdout.trim(), '7351');
    const firstRequests = readRequests(workspace);
    assert.strictEqual(firstRequests.length, 2, 'one health check and one observation POST are expected');
    assert.ok(firstRequests[0].includes('http://127.0.0.1:37777/health'));
    assert.ok(firstRequests[1].includes('-X'));
    assert.strictEqual(firstRequests[1][firstRequests[1].indexOf('-X') + 1], 'POST');
    assert.ok(firstRequests[1].includes('http://127.0.0.1:37777/api/observations'));
    const dataIndex = firstRequests[1].indexOf('-d');
    assert.ok(dataIndex >= 0, 'POST must use curl -d @file');
    assert.strictEqual(firstRequests[1][dataIndex + 1], '@' + workspace.payloadFile);
    assert.deepStrictEqual(fs.readFileSync(workspace.captureFile), Buffer.from(payloadText));

    const outputIndex = firstRequests[1].indexOf('-o');
    const resultPath = firstRequests[1][outputIndex + 1];
    assert.ok(resultPath.startsWith(workspace.tmpDir + path.sep + 'claude-mem-obs-result.'));
    assert.strictEqual(fs.readFileSync(workspace.resultPathFile, 'utf8'), resultPath);
    assert.ok(!fs.existsSync(resultPath), 'the response temp file must be removed after parsing');
    assert.strictEqual(
      fs.readdirSync(workspace.tmpDir).filter((name) => name.startsWith('claude-mem-obs-fp-')).length,
      1,
      'the dedup fingerprint must be stored under TMPDIR',
    );

    const second = runScript(workspace, [workspace.payloadFile]);
    assert.strictEqual(second.status, 0, second.stderr);
    assert.strictEqual(second.stdout.trim(), '7351');
    assert.match(second.stderr, /dedup: identical to last observation/);
    const allRequests = readRequests(workspace);
    assert.strictEqual(allRequests.length, 3, 'the duplicate must make a health check but no second POST');
    assert.ok(allRequests[2].includes('http://127.0.0.1:37777/health'));
  } finally {
    fs.rmSync(workspace.dir, { recursive: true, force: true });
  }
});

test('unavailable worker returns null without attempting an observation POST', () => {
  const workspace = makeWorkspace('{"title":"offline","content":"no post","concepts":["offline"]}\n');
  try {
    const res = runScript(workspace, [workspace.payloadFile], 'down');
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), 'null');
    const requests = readRequests(workspace);
    assert.strictEqual(requests.length, 1);
    assert.ok(requests[0].includes('http://127.0.0.1:37777/health'));
  } finally {
    fs.rmSync(workspace.dir, { recursive: true, force: true });
  }
});

test('missing payload argument and missing payload file fail before calling curl', () => {
  const workspace = makeWorkspace();
  try {
    const noArgument = runScript(workspace, []);
    assert.strictEqual(noArgument.status, 1);
    assert.ok(noArgument.stdout.includes('ERROR: payload file argument required'));

    const missingFile = runScript(workspace, [path.join(workspace.dir, 'absent.json')]);
    assert.strictEqual(missingFile.status, 1);
    assert.ok(missingFile.stdout.includes('ERROR: payload file not found'));
    assert.deepStrictEqual(readRequests(workspace), []);
  } finally {
    fs.rmSync(workspace.dir, { recursive: true, force: true });
  }
});

test('result temp-file templates retain the TMPDIR and BSD mktemp contract', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const templates = [...source.matchAll(/mktemp\s+(?:-\S+\s+)*("[^"]*"|\S+)/g)].map((match) => match[1]);
  assert.ok(templates.length > 0, 'expected at least one mktemp call');
  const tmpdirPrefix = '"' + '$' + '{TMPDIR:-/tmp}/';
  for (const template of templates) {
    assert.ok(template.startsWith(tmpdirPrefix), 'mktemp must use TMPDIR: ' + template);
    assert.match(template, /X{6,}"$/, 'mktemp template must end in X: ' + template);
  }
});

run('post-obs');
