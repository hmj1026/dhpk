'use strict';

// Remaining raw-directory runtime fixtures.  Each definition names one
// public Skill-relative entry and one observable command contract.  Execution
// is performed by skill-remaining-entry-isolation.test.js through the trusted
// physical relocation helper; fixture tools are the only external boundary.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { registerFixture, getFixtures } = require('./skill-directory-fixtures');
const { outputText, assertExpected } = require('./fixture-assertions');
const { withIsolatedSkill } = require('./skill-directory-isolation');

const ROOT = path.join(__dirname, '..', '..');

const SOURCES = Object.freeze({
  'ios-icon-gen': 'dhpk-ios-icon-gen',
  'code-trace': 'code-trace',
  'deploy-list': 'dhpk-deploy-list',
  'feature-verify': 'dhpk-feature-verify',
  'change-verdict': 'change-verdict',
  'flow-guide': 'flow-guide',
});

function resolveTool(name) {
  for (const directory of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111)) return fs.realpathSync(candidate);
    } catch (_error) { /* try the next PATH component */ }
  }
  return '';
}

const REAL_TOOLS = Object.freeze({
  git: resolveTool('git'),
  jq: resolveTool('jq'),
  rg: resolveTool('rg'),
});

function delegateStub(realPath, options = {}) {
  if (!realPath) return undefined;
  const inputCode = options.captureInput
    ? "const input=fs.readFileSync(0);"
    : '';
  const fdCode = options.materializeFds
    ? [
      "const os=require('node:os');",
      "const temps=[];",
      "const argv=process.argv.slice(1).map((value)=>{if(!value.startsWith('/dev/fd/'))return value;const target=path.join(process.env.TMPDIR||os.tmpdir(),`jq-${process.pid}-${temps.length}`);fs.writeFileSync(target,fs.readFileSync(value));temps.push(target);return target;});",
    ].join('')
    : 'const argv=process.argv.slice(1);';
  // Without an explicit `input`, spawnSync's default 'pipe' stdio leaves stdin
  // as a dangling, data-less anonymous pipe (a FIFO). Tools like `rg` treat a
  // piped (non-tty) stdin as "read the search corpus from stdin" and silently
  // search zero bytes instead of the given directory — 'ignore' attaches
  // stdin to a closed/empty source the same way a non-interactive real
  // invocation would, so delegated tools fall back to their normal directory
  // behavior instead of an accidental stdin-mode.
  const childOptions = options.captureInput
    ? "{cwd:process.cwd(),env:process.env,encoding:'utf8',input}"
    : "{cwd:process.cwd(),env:process.env,encoding:'utf8',stdio:['ignore','pipe','pipe']}";
  return {
    body: [
      "const fs=require('node:fs');const path=require('node:path');",
      "const {spawnSync}=require('node:child_process');",
      inputCode,
      fdCode,
      `const child=spawnSync(${JSON.stringify(realPath)},argv,${childOptions});`,
      "if(child.stdout)process.stdout.write(child.stdout);",
      "if(child.stderr)process.stderr.write(child.stderr);",
      options.materializeFds ? "for(const file of temps){try{fs.rmSync(file,{force:true});}catch(_error){}}" : '',
      "process.exitCode=child.status===null?1:child.status;",
    ].join(''),
  };
}

function writeFile(filePath, content, mode = 0o644) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { mode });
  fs.chmodSync(filePath, mode);
}

function fixture(definition) {
  const expected = {
    status: definition.expected.status,
    output: [...(definition.expected.output || [])],
    ...(typeof definition.expected.stdout === 'string' ? { stdout: definition.expected.stdout } : {}),
    ...(typeof definition.expected.stderr === 'string' ? { stderr: definition.expected.stderr } : {}),
  };
  return registerFixture({
    ...definition,
    expected,
    assert(result, context, state) {
      const unavailable = definition.allowUnavailable
        && definition.entry === 'scripts/generate_icons.swift'
        && /^#!\/usr\/bin\/env\s+swift\s*$/.test(
          fs.readFileSync(path.join(context.skillDir, definition.entry), 'utf8').split(/\r?\n/, 1)[0],
        )
        && result.status === 127
        && /\bswift\b.*(?:not found|no such file or directory)/i.test(String(result.stderr || ''));
      if (unavailable) {
        assert.strictEqual(context.hostStatus, 'NOT_RUN', `${definition.id}: unavailable capability must be NOT_RUN`);
        return;
      }
      assertExpected(result, expected, definition.id);
      if (definition.verify) definition.verify(result, context, state);
    },
  });
}

function isolatedSystemTool(name) {
  return ['/usr/bin', '/bin'].some((directory) => {
    try {
      const stat = fs.statSync(path.join(directory, name));
      return stat.isFile() && (stat.mode & 0o111) !== 0;
    } catch (_error) {
      return false;
    }
  });
}

function unavailableCodeTraceTools() {
  return ['fd', 'yq', 'ast-grep'].filter((name) => !isolatedSystemTool(name));
}

function fixtureTools(...names) {
  const stubs = {};
  for (const name of names) {
    const stub = delegateStub(REAL_TOOLS[name], name === 'jq' ? { captureInput: true, materializeFds: true } : {});
    if (stub) stubs[name] = stub;
  }
  return stubs;
}

function gitEnvironment(context) {
  return {
    HOME: context.homeDir,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(context.homeDir, '.gitconfig'),
  };
}

function git(context, args) {
  assert.ok(REAL_TOOLS.git, 'local Git is required for the disposable Git fixture');
  const result = spawnSync(REAL_TOOLS.git, args, {
    cwd: context.projectDir,
    env: { ...process.env, ...gitEnvironment(context) },
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, `fixture git ${args.join(' ')} failed: ${result.stderr}`);
  return String(result.stdout || '').trim();
}

function initGit(context) {
  git(context, ['init', '-q']);
  git(context, ['branch', '-M', 'master']);
  git(context, ['config', 'user.email', 'fixture@example.invalid']);
  git(context, ['config', 'user.name', 'fixture']);
  git(context, ['config', 'commit.gpgsign', 'false']);
}

function prepareDeployRepository(context) {
  initGit(context);
  writeFile(path.join(context.projectDir, 'src', 'base.js'), 'export const base = true;\n');
  writeFile(path.join(context.projectDir, 'docs', 'release.md'), 'docs are filtered\n');
  git(context, ['add', '.']);
  git(context, ['commit', '-qm', 'fixture base']);
  git(context, ['checkout', '-q', '-b', 'feature']);
  writeFile(path.join(context.projectDir, 'src', 'feature.js'), 'export const feature = true;\n');
  writeFile(path.join(context.projectDir, 'README.md'), 'readme is filtered\n');
  git(context, ['add', '.']);
  git(context, ['commit', '-qm', 'fixture feature']);
  return { branch: 'feature', head: git(context, ['rev-parse', 'HEAD']) };
}

function prepareReviewRepository(context) {
  initGit(context);
  writeFile(path.join(context.projectDir, 'README.md'), '# review fixture\n');
  git(context, ['add', '.']);
  git(context, ['commit', '-qm', 'fixture base']);
  writeFile(path.join(context.projectDir, 'changed.js'), 'module.exports = 1;\n');
  return { promptLog: path.join(context.projectDir, 'codex-prompt.txt') };
}

function prepareFlowFixture(context) {
  return { query: 'How does this code flow work?' };
}

function curlStub() {
  return {
    body: [
      "const fs=require('node:fs');",
      "const a=process.argv.slice(1);",
      "const mode=process.env.CURL_FIXTURE||'';",
      "if(mode==='iconify'){const i=a.indexOf('-o');if(i>=0)fs.writeFileSync(a[i+1],'<svg xmlns=\"http://www.w3.org/2000/svg\"><path/></svg>');process.exitCode=0;}",
      "else if(mode==='api-success'){process.stdout.write('{\"ok\":true}\\n__DHPK_META__ 200 0.125');process.exitCode=0;}",
      "else if(mode==='api-failure'){process.stderr.write('curl: connection failed\\n');process.exitCode=7;}",
      "else if(mode==='health'){const f=process.env.CODES_FILE;const rows=fs.readFileSync(f,'utf8').split(/\\r?\\n/).filter(Boolean);const code=rows.shift()||'000';fs.writeFileSync(f,rows.length?rows.join('\\n')+'\\n':'');process.stdout.write(code);process.exitCode=0;}",
      "else {process.stderr.write('unknown fixture curl mode\\n');process.exitCode=2;}",
    ].join(''),
  };
}

function rasterizerStub() {
  return {
    body: [
      "const fs=require('node:fs');",
      "const a=process.argv.slice(1);",
      "const i=a.indexOf('-o');",
      "if(i<0){process.stderr.write('missing raster output\\n');process.exitCode=2;}else{fs.writeFileSync(a[i+1],Buffer.from('fixture-png'));process.exitCode=0;}",
    ].join(''),
  };
}

function ghStub() {
  return {
    body: [
      "const a=process.argv.slice(1);",
      "if(a.includes('body'))process.stdout.write(process.env.GH_BODY||'fixture body\\n');",
      "else if(a.includes('files'))process.stdout.write('src/feature.js\\ndocs/release.md\\n');",
      "else process.exitCode=0;",
    ].join(''),
  };
}

function codexStub() {
  return {
    body: [
      "const fs=require('node:fs');",
      "const input=fs.readFileSync(0,'utf8');",
      "if(process.env.CODEX_PROMPT_LOG)fs.writeFileSync(process.env.CODEX_PROMPT_LOG,input);",
      "process.stdout.write('fixture review output\\n');",
      "process.exitCode=0;",
    ].join(''),
  };
}

let registered = false;

function registerRemainingFixtures() {
  if (registered) return getFixtures();

  const definitions = [
    {
      id: 'remaining-ios-iconify-generate', skill: 'ios-icon-gen', entry: 'scripts/iconify_gen.sh',
      args: ['mdi:receipt-text-outline', 'fixture-icon', '--output', 'icons', '--color', '#ff00aa', '--size', '12'],
      stubs: { curl: curlStub(), 'rsvg-convert': rasterizerStub() },
      env: { CURL_FIXTURE: 'iconify' },
      expected: { status: 0, output: ['[ios-icon-gen] wrote'] },
      verify(result, context) {
        const set = path.join(context.projectDir, 'icons', 'fixture-icon.imageset');
        assert.ok(fs.existsSync(path.join(set, 'fixture-icon.png')));
        assert.ok(fs.existsSync(path.join(set, 'fixture-icon@2x.png')));
        assert.ok(fs.existsSync(path.join(set, 'fixture-icon@3x.png')));
        const contents = JSON.parse(fs.readFileSync(path.join(set, 'Contents.json'), 'utf8'));
        assert.strictEqual(contents.info.version, 1);
        assert.match(String(result.stdout), /fixture-icon\.imageset/);
      },
    },
    {
      id: 'remaining-ios-swift-list', skill: 'ios-icon-gen', entry: 'scripts/generate_icons.swift',
      args: ['--list'], allowUnavailable: true,
      expected: { status: 0, output: ['Browse symbols in SF Symbols.app'] },
    },
    {
      id: 'remaining-code-trace-analyze-function-calls', skill: 'code-trace', entry: 'scripts/diagnose/analyze-function-calls.sh',
      args: ['fixture.js', 'analysis.txt'], stubs: fixtureTools('rg'),
      prepare(context) {
        writeFile(path.join(context.projectDir, 'fixture.js'), 'function outer() { inner(); }\nfunction inner() { return 1; }\nouter();\n');
      },
      expected: { status: 0, output: ['分析完成'] },
      verify(_result, context) { assert.match(fs.readFileSync(path.join(context.projectDir, 'analysis.txt'), 'utf8'), /function outer/); },
    },
    {
      id: 'remaining-code-trace-check-tools-unavailable', skill: 'code-trace', entry: 'scripts/diagnose/check-tools.sh',
      stubs: { jq: { status: 0, stdout: 'jq-fixture 1.0\n' }, rg: { status: 0, stdout: 'rg-fixture 1.0\n' } },
      expected: {
        status: unavailableCodeTraceTools().length,
        output: [`缺少 ${unavailableCodeTraceTools().length} 個工具`],
      },
    },
    {
      id: 'remaining-code-trace-find-polluter-multi-file', skill: 'code-trace', entry: 'scripts/diagnose/find-polluter.sh',
      args: ['pollution.marker', 'tests/*.test.js', './fixture-test'],
      prepare(context) {
        writeFile(path.join(context.projectDir, 'tests', 'first.test.js'), 'first\n');
        writeFile(path.join(context.projectDir, 'tests', 'second.test.js'), 'second\n');
        writeFile(path.join(context.projectDir, 'fixture-test'), [
          '#!/bin/sh',
          'case "${1#./}" in tests/second.test.js) printf polluted > pollution.marker ;; esac',
          'exit 0',
        ].join('\n') + '\n', 0o755);
      },
      expected: { status: 1, output: ['FOUND POLLUTER', 'tests/second.test.js'] },
    },
    {
      id: 'remaining-code-trace-generate-flow-diagram', skill: 'code-trace', entry: 'scripts/diagnose/generate-flow-diagram.sh',
      args: ['outer', 'fixture.js', 'flow.md'], stubs: fixtureTools('rg'),
      prepare(context) { writeFile(path.join(context.projectDir, 'fixture.js'), 'function outer() { inner(); }\nfunction inner() {}\n'); },
      expected: { status: 0, output: ['流程圖已生成'] },
      verify(_result, context) { assert.match(fs.readFileSync(path.join(context.projectDir, 'flow.md'), 'utf8'), /mermaid/); },
    },
    {
      id: 'remaining-code-trace-search-database-queries', skill: 'code-trace', entry: 'scripts/diagnose/search-database-queries.sh',
      args: ['orders', 'src'], stubs: fixtureTools('rg'),
      prepare(context) { writeFile(path.join(context.projectDir, 'src', 'query.js'), 'const rows = "SELECT * FROM orders";\n'); },
      expected: { status: 0, output: ['搜尋完成', 'orders'] },
    },
    {
      id: 'remaining-code-trace-trace-data-flow', skill: 'code-trace', entry: 'scripts/diagnose/trace-data-flow.sh',
      args: ['orderStatus', 'src', 'js'], stubs: fixtureTools('rg'),
      prepare(context) { writeFile(path.join(context.projectDir, 'src', 'flow.js'), 'let orderStatus = "new";\nfunction read(orderStatus) { return orderStatus; }\n'); },
      expected: { status: 0, output: ['追蹤完成', 'orderStatus'] },
    },
    {
      id: 'remaining-deploy-list-generate', skill: 'deploy-list', entry: 'scripts/deploy-list.sh',
      argsFactory(context, state) {
        return ['--date', '2026/08/06', '--author', 'fixture', '--project', 'deploy-fixture', '--tag', '[FIXTURE]', '--description', 'deploy fixture', '--base', 'master', '--head', state.branch, '--preset', 'generic', '--lang', 'en', '--deploy-commits', state.head];
      },
      stubs: fixtureTools('git'),
      prepare: prepareDeployRepository,
      expected: { status: 0, output: ['# deploy-list schema=v1', 'src/feature.js', '# end deploy-list schema=v1'] },
      verify(result) { assert.doesNotMatch(String(result.stdout), /README\.md|docs\/release\.md/); },
    },
    {
      id: 'remaining-deploy-list-check-golden', skill: 'deploy-list', entry: 'scripts/check-golden.sh',
      args: [], timeout: 30000, stubs: { ...fixtureTools('git', 'rg') },
      expected: { status: 0, output: ['[PASS] generic:fixture-01', 'generic suite:'] },
    },
    {
      id: 'remaining-feature-verify-api-success', skill: 'feature-verify', entry: 'scripts/api-exec.sh',
      args: ['POST', 'https://fixture.invalid/query', '{"id":0}'], stubs: { curl: curlStub() }, env: { CURL_FIXTURE: 'api-success' },
      expected: { status: 0, output: ['http_code=200', 'latency_seconds=0.125', 'body={"ok":true}'] },
    },
    {
      id: 'remaining-feature-verify-api-transport-failure', skill: 'feature-verify', entry: 'scripts/api-exec.sh',
      args: ['GET', 'https://fixture.invalid/health'], stubs: { curl: curlStub() }, env: { CURL_FIXTURE: 'api-failure' },
      expected: { status: 7, output: ['curl transport failed'] },
      verify(result) { assert.strictEqual(String(result.stdout || ''), ''); },
    },
    {
      id: 'remaining-feature-verify-health-retry-success', skill: 'feature-verify', entry: 'scripts/health-probe.sh',
      args: ['https://fixture.invalid/health'], stubs: { curl: curlStub() }, env: { CURL_FIXTURE: 'health' },
      prepare(context) { writeFile(path.join(context.projectDir, 'codes'), '000\n503\n204\n'); },
      envFactory(context) { return { CODES_FILE: path.join(context.projectDir, 'codes') }; },
      expected: { status: 0, output: ['reachable=true attempt=3 http_code=204'] },
    },
    {
      id: 'remaining-feature-verify-health-retry-exhausted', skill: 'feature-verify', entry: 'scripts/health-probe.sh',
      args: ['https://fixture.invalid/health'], stubs: { curl: curlStub() }, env: { CURL_FIXTURE: 'health' },
      prepare(context) { writeFile(path.join(context.projectDir, 'codes'), '000\n500\n404\n200\n'); },
      envFactory(context) { return { CODES_FILE: path.join(context.projectDir, 'codes') }; },
      expected: { status: 1, output: ['reachable=false attempts=3 http_code=404'] },
      verify(_result, context) { assert.strictEqual(fs.readFileSync(path.join(context.projectDir, 'codes'), 'utf8').trim(), '200'); },
    },
    {
      id: 'remaining-change-verdict-unrelated-squash-warning', skill: 'change-verdict', entry: 'scripts/check-unrelated-changes.sh',
      args: ['42', '--merge-method', 'squash'], stubs: { gh: ghStub() }, env: { GH_BODY: '## Summary\nNo unrelated section here\n' },
      expected: { status: 0, output: ["MISSING '## Unrelated Changes' SECTION", 'src/feature.js'] },
    },
    {
      id: 'remaining-change-verdict-unrelated-merge-skip', skill: 'change-verdict', entry: 'scripts/check-unrelated-changes.sh',
      args: ['42', '--merge-method', 'merge'], expected: { status: 0, output: ["[skip] merge method 'merge'"] },
    },
    {
      id: 'remaining-change-verdict-review-cli-stub', skill: 'change-verdict', entry: 'scripts/review-cli.sh',
      args: ['--backend', 'cli', '--scope', 'tests', '--depth', 'fast', '--prompt', 'fixture prompt'],
      stubs: { ...fixtureTools('git'), codex: codexStub() }, prepare: prepareReviewRepository,
      envFactory(context, state) { return { CODEX_PROMPT_LOG: state.promptLog }; },
      expected: { status: 0, output: ['CODEX CLI REVIEW (Uncommitted Changes)', 'fixture review output'] },
      verify(_result, context, state) { const prompt = fs.readFileSync(state.promptLog, 'utf8'); assert.match(prompt, /Review scope: tests/); assert.match(prompt, /fixture prompt/); assert.match(prompt, /Pinned merge base:/); },
    },
    {
      id: 'remaining-flow-guide-pre-route-local-table', skill: 'flow-guide', entry: 'scripts/pre-route.sh',
      argsFactory(_context, state) { return [state.query]; }, expected: { status: 0, output: ['MATCH\tcode-trace\tcode exploration'] },
      prepare: prepareFlowFixture,
    },
  ];

  for (const definition of definitions) fixture(definition);
  registered = true;
  return getFixtures();
}

function runRemainingEntryFixture(id) {
  const fixtures = registerRemainingFixtures();
  const definition = fixtures[id];
  if (!definition) throw new Error(`unknown remaining-entry fixture: ${id}`);
  const source = path.join(ROOT, 'skills', SOURCES[definition.skill]);
  assert.ok(fs.existsSync(source), `${id}: canonical Skill source is missing`);

  const run = (ambientRoot) => withIsolatedSkill({
    source,
    env: definition.env || {},
    stubs: definition.stubs || {},
  }, (context) => {
    assert.ok(context.skillDir.includes('relocated skill'), `${id}: relocation must contain spaces`);
    assert.ok(context.projectDir.includes('fixture project'), `${id}: project must be separate`);
    const state = { ambientRoot };
    if (definition.prepare) {
      const prepared = definition.prepare(context, state);
      if (prepared && typeof prepared === 'object') Object.assign(state, prepared);
    }
    const args = definition.argsFactory ? definition.argsFactory(context, state) : definition.args || [];
    const env = definition.envFactory ? definition.envFactory(context, state) : {};
    const input = definition.inputFactory ? definition.inputFactory(context, state) : undefined;
    const result = context.run(definition.entry, args, { env, input, timeout: definition.timeout });
    definition.assert(result, context, state);
    return { result, evidenceKind: context.evidenceKind, hostStatus: context.hostStatus, fixtureId: id };
  });

  if (!definition.ambientParent) return run(undefined);
  const ambientRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk ambient package '));
  const priorTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = ambientRoot;
  try {
    return run(ambientRoot);
  } finally {
    if (priorTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = priorTmpdir;
    fs.rmSync(ambientRoot, { recursive: true, force: true });
  }
}

module.exports = {
  SOURCES,
  registerRemainingFixtures,
  runRemainingEntryFixture,
};
