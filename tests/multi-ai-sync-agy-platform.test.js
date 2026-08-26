'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills/dhpk-cross-agent-sync/scripts/multi_ai_sync.py');

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-${prefix}-`));
}

function write(filePath, content, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, mode ? { mode } : undefined);
}

function writePythonShim(root) {
  write(path.join(root, 'bin/python3'), '#!/bin/sh\nexec /usr/bin/python3 "$@"\n', 0o755);
}

function agyPackage(root) {
  const packageRoot = path.join(root, 'plugins/dhpk-agy');
  write(path.join(packageRoot, 'plugin.json'), JSON.stringify({
    name: 'dhpk',
    version: '0.39.0',
    agents: ['./agents/'],
    rules: ['./rules/'],
    skills: ['./skills/'],
  }));
  write(path.join(packageRoot, 'agents/sample.md'), [
    '---',
    'name: sample',
    'description: Sample AGY agent',
    'tools: ["read_file", "invoke_subagent"]',
    'model: inherit',
    '---',
    '',
    '# Sample',
    '',
  ].join('\n'));
  write(path.join(packageRoot, 'agents/INDEX.md'), '# navigation only\n');
  write(path.join(packageRoot, 'agents/README.md'), '# navigation only\n');
  write(path.join(packageRoot, 'rules/sample.md'), '# rule\n');
  write(path.join(packageRoot, 'skills/dhpk-sample/SKILL.md'), '# skill\n');

  const files = {};
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filePath);
      else if (entry.isFile() && !['provenance.json', 'fingerprints.json'].includes(path.relative(packageRoot, filePath))) {
        const relative = path.relative(packageRoot, filePath).split(path.sep).join('/');
        files[relative] = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
      }
    }
  };
  walk(packageRoot);
  write(path.join(packageRoot, 'fingerprints.json'), JSON.stringify({ schema: 'dhpk.agy-plugin.v1', files }));
  write(path.join(packageRoot, 'provenance.json'), JSON.stringify({
    surface: 'agy-plugin',
    schema: 'dhpk.agy-plugin.v1',
    provenanceSchema: 'dhpk.platform-provenance.v1',
    owner: 'plugins/dhpk-agy',
    packageRoot: 'plugins/dhpk-agy',
    sourceVersion: '0.39.0',
    sourceCommit: 'c'.repeat(40),
    inventoryDigest: 'd'.repeat(64),
    generatorVersion: '1.0.0',
    transform: { id: 'agy-agent-frontmatter-v1', version: '1' },
    fingerprints: files,
    selectedIds: { agents: ['sample.md'], rules: ['rules/sample.md'], skills: ['sample'] },
  }));
}

function agySessionHome(root) {
  const home = path.join(root, 'agy-home');
  write(path.join(home, '.gemini/oauth_creds.json'), '{"accessToken":"AGY_ACCESS_MARKER"}\n', 0o600);
  write(path.join(home, '.gemini/google_accounts.json'), '{"refreshToken":"AGY_REFRESH_MARKER"}\n', 0o600);
  write(path.join(home, '.gemini/antigravity-cli/antigravity-oauth-token'), 'AGY_OAUTH_MARKER\n', 0o600);
  write(path.join(home, '.gemini/unlisted.json'), 'must-not-copy\n', 0o600);
  return home;
}

function validate(root, extra = [], env = process.env) {
  return spawnSync('python3', ['-B', SCRIPT, '--root', root, 'validate', '--targets', 'agy', '--format', 'json', ...extra], {
    encoding: 'utf8',
    timeout: 20000,
    env,
  });
}

function writeBwrapStub(root, { runtime = 'pass' } = {}) {
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'bwrap-argv.log');
  const modes = path.join(root, 'bwrap-source-modes.log');
  fs.mkdirSync(bin, { recursive: true });
  const logLiteral = JSON.stringify(log);
  const modesLiteral = JSON.stringify(modes);
  const runtimeBranch = runtime === 'auth'
    ? [
      "    printf '%s\\n' 'authentication required Authorization: Bearer AGY_SESSION_SECRET_MARKER Authorization=Bearer AGY_EQUAL_SECRET_MARKER {\"Authorization\":\"Bearer AGY_JSON_SECRET_MARKER\"}' >&2",
      '    exit 1',
    ]
    : runtime === 'dns'
      ? [
        "    printf '%s\\n' 'dns resolution failed EAI_AGY_SECRET_MARKER' >&2",
        '    exit 1',
      ]
      : runtime === 'timeout'
        ? [
          "    printf '%s\\n' 'connection timed out' >&2",
          '    exit 1',
        ]
        : runtime === 'unsafe-diagnostic'
          ? [
            "    printf '%s\\n' 'client failure /home/paul/private AGY_HOST_OVERLAY_MARKER prompt=AGY_PROMPT_MARKER tool=AGY_TOOL_MARKER' >&2",
            '    exit 1',
          ]
    : [
      "    printf '%s\\n' 'AGY_SMOKE_OK'",
      '    exit 0',
    ];
  write(path.join(bin, 'bwrap'), [
    '#!/bin/sh',
    'set -eu',
    '{',
    '  printf \'%s\\n\' "$@"',
    "  printf '\\n'",
    `} >> ${logLiteral}`,
    'has_plugins=0',
    'has_agents=0',
    'has_runtime=0',
    'for argument in "$@"; do',
    '  case "$argument" in',
    '    plugins) has_plugins=1 ;;',
    '    agents) has_agents=1 ;;',
    '    --agent) has_runtime=1 ;;',
    '  esac',
    'done',
    'previous=',
    'for argument in "$@"; do',
    '  case "$previous" in',
    '    --ro-bind|--ro-bind-try|--bind)',
    `      mode=$(/usr/bin/stat -c '%a' "$argument" 2>/dev/null || printf '%s' missing)`,
    `      printf '%s|%s\\n' "$argument" "$mode" >> ${modesLiteral}`,
    '      ;;',
    '  esac',
    '  previous="$argument"',
    'done',
    'if [ "$has_plugins" = 1 ]; then printf \'%s\\n\' \'dhpk 0.39.0\'; exit 0; fi',
    'if [ "$has_agents" = 1 ]; then printf \'%s\\n\' sample; exit 0; fi',
    'if [ "$has_runtime" = 1 ]; then',
    ...runtimeBranch,
    'fi',
    'exit 2',
    '',
  ].join('\n'), 0o755);
  write(path.join(bin, 'agy'), '#!/bin/sh\nexit 0\n', 0o755);
  return { bin, log, modes };
}

function bwrapInvocations(logPath) {
  return fs.readFileSync(logPath, 'utf8')
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map((chunk) => chunk.split(/\r?\n/));
}

function agyHostSession(root, { includeSession = true } = {}) {
  const hostHome = path.join(root, 'agy-host-home');
  if (includeSession) {
    write(path.join(hostHome, '.gemini/oauth_creds.json'), '{"refresh_token":"AGY_REFRESH_SECRET_MARKER"}\n', 0o644);
    write(path.join(hostHome, '.gemini/google_accounts.json'), '{"email":"agent@example.test"}\n', 0o644);
    write(path.join(hostHome, '.gemini/antigravity-cli/antigravity-oauth-token'), 'AGY_OAUTH_TOKEN_SECRET_MARKER\n', 0o644);
  }
  write(path.join(hostHome, '.gemini/unlisted.json'), 'UNLISTED_HOST_STATE\n', 0o644);
  write(path.join(hostHome, '.gemini/config/plugins/dhpk/host-plugin.txt'), 'HOST_PLUGIN_OVERLAY\n', 0o644);
  return hostHome;
}

function invocationContains(invocation, value) {
  return invocation.includes(value);
}

function boundSource(invocation, destination) {
  for (let index = 0; index < invocation.length - 2; index += 1) {
    if (!['--ro-bind', '--ro-bind-try', '--bind'].includes(invocation[index])) continue;
    if (invocation[index + 2] === destination) return invocation[index + 1];
  }
  return null;
}

test('explicit AGY target without a marker is BLOCKED', () => {
  const root = tempRoot('agy-blocked');
  try {
    const result = validate(root);
    const report = JSON.parse(result.stdout);
    const row = report.results.find((item) => item.platform === 'agy');
    assert.strictEqual(row.final_status, 'BLOCKED');
    assert.notStrictEqual(result.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('valid package separates structural discovery from unavailable consumer CLI', () => {
  const root = tempRoot('agy-unavailable');
  try {
    agyPackage(root);
    const env = { ...process.env, PATH: '/usr/bin:/bin' };
    const result = validate(root, [], env);
    const report = JSON.parse(result.stdout);
    const row = report.results.find((item) => item.platform === 'agy');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'agy.package.structure').status, 'PASS');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'agy.discovery.plugins').status, 'UNAVAILABLE');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'agy.runtime.subagent').status, 'NOT_RUN');
    assert.strictEqual(row.final_status, 'UNAVAILABLE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('receipt-less or traversal-shaped AGY packages cannot claim structure PASS', () => {
  const root = tempRoot('agy-invalid-structure');
  try {
    const packageRoot = path.join(root, 'plugins/dhpk-agy');
    write(path.join(packageRoot, 'plugin.json'), JSON.stringify({
      name: 'dhpk', version: '0.39.0', agents: ['../../outside/'], rules: ['./rules/'], skills: ['./skills/'],
    }));
    write(path.join(packageRoot, 'agents/sample.md'), [
      '---', 'name: sample', 'description: Sample', 'tools: ["read_file"]', 'model: inherit', '---', '',
    ].join('\n'));
    const result = validate(root, [], { ...process.env, PATH: '/usr/bin:/bin' });
    const report = JSON.parse(result.stdout);
    const row = report.results.find((item) => item.platform === 'agy');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'agy.package.structure').status, 'FAIL');
    assert.notStrictEqual(result.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('incomplete AGY provenance cannot claim structure PASS', () => {
  const root = tempRoot('agy-incomplete-receipt');
  try {
    agyPackage(root);
    const provenancePath = path.join(root, 'plugins/dhpk-agy/provenance.json');
    const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
    delete provenance.generatorVersion;
    fs.writeFileSync(provenancePath, JSON.stringify(provenance));
    const result = validate(root, [], { ...process.env, PATH: '/usr/bin:/bin' });
    const report = JSON.parse(result.stdout);
    const row = report.results.find((item) => item.platform === 'agy');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'agy.package.structure').status, 'FAIL');
    assert.notStrictEqual(result.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stubbed agy plugins/agents and bounded runtime probes remain distinct', () => {
  const root = tempRoot('agy-probe');
  const bin = path.join(root, 'bin');
  try {
    agyPackage(root);
    const hostHome = agySessionHome(root);
    const stub = writeBwrapStub(root);
    write(path.join(bin, 'agy'), [
      '#!/bin/sh',
      'if [ "$1" = "plugins" ] && [ "$2" = "list" ]; then test ! -e /home/agy/.gemini/oauth_creds.json || exit 96; echo "dhpk 0.39.0"; exit 0; fi',
      'if [ "$1" = "agents" ]; then test ! -e /home/agy/.gemini/oauth_creds.json || exit 97; echo "sample"; exit 0; fi',
      'if [ "$1" = "--agent" ] && [ "$2" = "agy-fast-worker" ] && [ "$3" = "--print" ]; then',
      '  test -f /home/agy/.gemini/oauth_creds.json || exit 93',
      '  test "$(stat -c %a /home/agy/.gemini/oauth_creds.json)" = "600" || exit 94',
      '  test ! -e /home/agy/.gemini/unlisted.json || exit 95',
      '  if [ -e /var/run/docker.sock ] || [ -e /run/user/1000/bus ]; then exit 91; fi',
      '  if touch /workspace/plugins/dhpk-agy/agents/sandbox-write 2>/dev/null; then exit 92; fi',
      '  echo "AGY_SMOKE_OK"; exit 0;',
      'fi',
      'exit 2',
      '',
    ].join('\n'), 0o755);
    const env = { ...process.env, PATH: `${stub.bin}:/usr/bin:/bin`, DHPK_AGY_HOST_HOME: hostHome };
    const discovery = JSON.parse(validate(root, [], env).stdout).results.find((item) => item.platform === 'agy');
    const discoveryPluginsStatus = discovery.capabilities.find((item) => item.id === 'agy.discovery.plugins').status;
    const discoveryAgentsStatus = discovery.capabilities.find((item) => item.id === 'agy.discovery.agents').status;
    assert.ok(['PASS', 'UNAVAILABLE'].includes(discoveryPluginsStatus), `unexpected plugin discovery status: ${discoveryPluginsStatus}`);
    assert.ok(['PASS', 'UNAVAILABLE'].includes(discoveryAgentsStatus), `unexpected agent discovery status: ${discoveryAgentsStatus}`);
    assert.strictEqual(discovery.capabilities.find((item) => item.id === 'agy.runtime.subagent').status, 'NOT_RUN');

    const runtime = JSON.parse(validate(root, ['--agy-runtime-probe'], env).stdout).results.find((item) => item.platform === 'agy');
    const runtimeStatus = runtime.capabilities.find((item) => item.id === 'agy.runtime.subagent').status;
    assert.ok(['PASS', 'UNAVAILABLE'].includes(runtimeStatus), `unexpected runtime probe status: ${runtimeStatus}`);
    assert.strictEqual(runtime.final_status, runtimeStatus === 'PASS' ? 'PASS' : 'UNAVAILABLE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isolated AGY authentication failures remain blocked instead of package failures', () => {
  const root = tempRoot('agy-auth-unavailable');
  const bin = path.join(root, 'bin');
  try {
    agyPackage(root);
    const hostHome = agySessionHome(root);
    const stub = writeBwrapStub(root, { runtime: 'auth' });
    write(path.join(bin, 'agy'), [
      '#!/bin/sh',
      'if [ "$1" = "plugins" ] && [ "$2" = "list" ]; then echo "dhpk 0.39.0"; exit 0; fi',
      'if [ "$1" = "agents" ]; then echo "sample"; exit 0; fi',
      'if [ "$1" = "--agent" ] && [ "$2" = "agy-fast-worker" ]; then echo "authentication required" >&2; exit 1; fi',
      'exit 2',
      '',
    ].join('\n'), 0o755);
    const env = { ...process.env, PATH: `${stub.bin}:/usr/bin:/bin`, DHPK_AGY_HOST_HOME: hostHome };
    const runtime = JSON.parse(validate(root, ['--agy-runtime-probe'], env).stdout).results.find((item) => item.platform === 'agy');
    const runtimeStatus = runtime.capabilities.find((item) => item.id === 'agy.runtime.subagent').status;
    assert.strictEqual(runtimeStatus, 'BLOCKED', JSON.stringify(runtime));
    assert.strictEqual(runtime.capabilities.find((item) => item.id === 'agy.runtime.subagent').reason_code, 'AUTH_REQUIRED', JSON.stringify(runtime));
    const capability = runtime.capabilities.find((item) => item.id === 'agy.runtime.subagent');
    assert.ok(capability.diagnostic, JSON.stringify(runtime));
    assert.match(capability.diagnostic, /authentication required/i);
    assert.doesNotMatch(capability.diagnostic, /AGY_SESSION_SECRET_MARKER|AGY_EQUAL_SECRET_MARKER|AGY_JSON_SECRET_MARKER/);
    assert.strictEqual(runtime.final_status, 'BLOCKED', JSON.stringify(runtime));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AGY diagnostics redact private paths and arbitrary client payloads', () => {
  const root = tempRoot('agy-runtime-unsafe-diagnostic');
  const bin = path.join(root, 'bin');
  try {
    agyPackage(root);
    const hostHome = agyHostSession(root);
    const stub = writeBwrapStub(root, { runtime: 'unsafe-diagnostic' });
    write(path.join(bin, 'agy'), [
      '#!/bin/sh',
      'if [ "$1" = "plugins" ] && [ "$2" = "list" ]; then echo "dhpk 0.39.0"; exit 0; fi',
      'if [ "$1" = "agents" ]; then echo "sample"; exit 0; fi',
      'exit 2',
      '',
    ].join('\n'), 0o755);
    const report = JSON.parse(validate(root, ['--agy-runtime-probe'], {
      ...process.env,
      PATH: `${stub.bin}:/usr/bin:/bin`,
      DHPK_AGY_HOST_HOME: hostHome,
    }).stdout);
    const runtime = report.results.find((item) => item.platform === 'agy');
    const capability = runtime.capabilities.find((item) => item.id === 'agy.runtime.subagent');
    assert.strictEqual(capability.status, 'FAIL', JSON.stringify(runtime));
    assert.doesNotMatch(JSON.stringify(capability), /\/home\/paul\/private|AGY_HOST_OVERLAY_MARKER|AGY_PROMPT_MARKER|AGY_TOOL_MARKER/);
    assert.strictEqual(capability.diagnostic, '<redacted-client-output>', JSON.stringify(capability));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('import-only agy plugins list is not native plugin discovery PASS', () => {
  const root = tempRoot('agy-import-only');
  const bin = path.join(root, 'bin');
  try {
    agyPackage(root);
    write(path.join(bin, 'agy'), [
      '#!/bin/sh',
      'if [ "$1" = "plugins" ] && [ "$2" = "list" ]; then',
      '  printf \'%s\\n\' \'{"imports":[{"name":"dhpk","source":"claude-code","importedAt":"2026-08-07T07:51:05Z","components":["skills","agents"]}]}\'',
      '  exit 0',
      'fi',
      'if [ "$1" = "agents" ]; then printf \'%s\\n\' \'unrelated-host-agent\'; exit 0; fi',
      'exit 2',
      '',
    ].join('\n'), 0o755);
    const result = validate(root, [], { ...process.env, PATH: `${bin}:/usr/bin:/bin` });
    const row = JSON.parse(result.stdout).results.find((item) => item.platform === 'agy');
    const plugins = row.capabilities.find((item) => item.id === 'agy.discovery.plugins').status;
    const agents = row.capabilities.find((item) => item.id === 'agy.discovery.agents').status;
    assert.ok(['SKIP_INCOMPATIBLE', 'UNAVAILABLE'].includes(plugins), `import-only plugins list must not PASS: ${plugins}`);
    assert.ok(['SKIP_INCOMPATIBLE', 'UNAVAILABLE'].includes(agents), `unrelated agents must not PASS: ${agents}`);
    assert.notStrictEqual(plugins, 'PASS');
    assert.notStrictEqual(row.final_status, 'FAIL', JSON.stringify(row));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AGY discovery uses an empty HOME and never shares the network', () => {
  const root = tempRoot('agy-discovery-isolation');
  try {
    agyPackage(root);
    const hostHome = agyHostSession(root);
    const stub = writeBwrapStub(root);
    const result = validate(root, [], {
      ...process.env,
      PATH: `${stub.bin}:/usr/bin:/bin`,
      DHPK_AGY_HOST_HOME: hostHome,
    });
    assert.ok(result.stdout, `${result.stdout}\n${result.stderr}`);
    const invocations = bwrapInvocations(stub.log);
    assert.strictEqual(invocations.length, 2, 'discovery should invoke plugins and agents only');
    for (const invocation of invocations) {
      assert.ok(invocationContains(invocation, '--unshare-all'));
      assert.ok(!invocationContains(invocation, '--share-net'));
      assert.ok(invocationContains(invocation, '--setenv'));
      assert.ok(invocationContains(invocation, '/home/agy'));
      assert.ok(!invocation.some((argument) => argument.includes(hostHome)));
      assert.ok(!invocation.some((argument) => /oauth_creds|google_accounts|antigravity-oauth-token/.test(argument)));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AGY sandbox projects resolver and CA bundle without reopening masked host roots', () => {
  const root = tempRoot('agy-runtime-system-roots');
  try {
    agyPackage(root);
    const stub = writeBwrapStub(root);
    const result = validate(root, [], {
      ...process.env,
      PATH: `${stub.bin}:/usr/bin:/bin`,
    });
    assert.ok(result.stdout, `${result.stdout}\n${result.stderr}`);
    const invocations = bwrapInvocations(stub.log);
    assert.strictEqual(invocations.length, 2, 'discovery should invoke plugins and agents only');
    for (const invocation of invocations) {
      assert.strictEqual(boundSource(invocation, '/etc/resolv.conf'), '/etc/resolv.conf');
      assert.strictEqual(boundSource(invocation, '/etc/ssl/certs/ca-certificates.crt'), '/etc/ssl/certs/ca-certificates.crt');
      assert.ok(invocationContains(invocation, '/etc/ssl'));
      assert.ok(invocationContains(invocation, '/etc/ssl/certs'));
      assert.ok(!invocationContains(invocation, '/etc/ssl/private'));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AGY runtime clones only allowlisted session files at 0600 and shares network after unshare', () => {
  const root = tempRoot('agy-runtime-session');
  try {
    agyPackage(root);
    const hostHome = agyHostSession(root);
    const stub = writeBwrapStub(root);
    const result = validate(root, ['--agy-runtime-probe'], {
      ...process.env,
      PATH: `${stub.bin}:/usr/bin:/bin`,
      DHPK_AGY_HOST_HOME: hostHome,
    });
    assert.ok(result.stdout, `${result.stdout}\n${result.stderr}`);
    const invocations = bwrapInvocations(stub.log);
    assert.strictEqual(invocations.length, 3, 'runtime probe should follow the two discovery probes');
    const [discoveryPlugins, discoveryAgents, runtime] = invocations;
    for (const discovery of [discoveryPlugins, discoveryAgents]) {
      assert.ok(invocationContains(discovery, '--unshare-all'));
      assert.ok(!invocationContains(discovery, '--share-net'));
    }
    const unshareIndex = runtime.indexOf('--unshare-all');
    const shareIndex = runtime.indexOf('--share-net');
    assert.ok(unshareIndex >= 0, 'runtime probe must unshare all namespaces');
    assert.ok(shareIndex > unshareIndex, 'runtime network sharing must follow --unshare-all');
    const modeIndex = runtime.indexOf('--mode');
    assert.ok(modeIndex >= 0, 'runtime probe must select AGY plan mode');
    assert.strictEqual(runtime[modeIndex + 1], 'plan', 'runtime probe must stay read-only in plan mode');
    assert.match(runtime.join(' '), /Do not call tools\./, 'runtime prompt must avoid permission-gated tool calls');
    for (const relative of [
      '.gemini/oauth_creds.json',
      '.gemini/google_accounts.json',
      '.gemini/antigravity-cli/antigravity-oauth-token',
    ]) {
      const destination = `/home/agy/${relative}`;
      const source = boundSource(runtime, destination);
      assert.ok(source, `missing runtime bind for ${relative}`);
      assert.notStrictEqual(source, path.join(hostHome, relative), 'runtime must clone, not bind the host session file');
      const sourceModes = fs.readFileSync(stub.modes, 'utf8');
      assert.match(sourceModes, new RegExp(`${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|600(?:\\n|$)`));
    }
    assert.ok(!runtime.some((argument) => argument.includes(path.join(hostHome, '.gemini/unlisted.json'))));
    assert.ok(!runtime.some((argument) => argument.includes(path.join(hostHome, '.gemini/config/plugins'))));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AGY missing login is BLOCKED with redacted diagnostics', () => {
  const root = tempRoot('agy-runtime-auth-blocked');
  try {
    agyPackage(root);
    const hostHome = agyHostSession(root, { includeSession: false });
    const stub = writeBwrapStub(root, { runtime: 'auth' });
    const result = validate(root, ['--agy-runtime-probe'], {
      ...process.env,
      PATH: `${stub.bin}:/usr/bin:/bin`,
      DHPK_AGY_HOST_HOME: hostHome,
    });
    assert.ok(result.stdout, 'BLOCKED is a classified result, not a CLI crash');
    const report = JSON.parse(result.stdout);
    const row = report.results.find((item) => item.platform === 'agy');
    const runtime = row.capabilities.find((item) => item.id === 'agy.runtime.subagent');
    assert.strictEqual(runtime.status, 'BLOCKED', JSON.stringify(row));
    assert.strictEqual(runtime.reason_code, 'SESSION_UNAVAILABLE', JSON.stringify(runtime));
    assert.strictEqual(row.final_status, 'BLOCKED', JSON.stringify(row));
    assert.doesNotMatch(JSON.stringify(report), /AGY_SESSION_SECRET_MARKER|AGY_EQUAL_SECRET_MARKER|AGY_JSON_SECRET_MARKER|AGY_REFRESH_SECRET_MARKER/);
    assert.doesNotMatch(JSON.stringify(report), new RegExp(hostHome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AGY runtime connectivity reason codes distinguish DNS and timeout', () => {
  for (const [runtime, expectedReason] of [['dns', 'DNS_UNAVAILABLE'], ['timeout', 'TIMEOUT']]) {
    const root = tempRoot(`agy-runtime-${runtime}`);
    try {
      agyPackage(root);
      const hostHome = agyHostSession(root);
      const stub = writeBwrapStub(root, { runtime });
      write(path.join(stub.bin, 'agy'), [
        '#!/bin/sh',
        'if [ "$1" = "plugins" ] && [ "$2" = "list" ]; then echo "dhpk 0.39.0"; exit 0; fi',
        'if [ "$1" = "agents" ]; then echo "sample"; exit 0; fi',
        'exit 2',
        '',
      ].join('\n'), 0o755);
      const env = { ...process.env, PATH: `${stub.bin}:/usr/bin:/bin`, DHPK_AGY_HOST_HOME: hostHome };
      const runtimeResult = JSON.parse(validate(root, ['--agy-runtime-probe'], env).stdout).results.find((item) => item.platform === 'agy');
      const capability = runtimeResult.capabilities.find((item) => item.id === 'agy.runtime.subagent');
      assert.strictEqual(capability.status, 'UNAVAILABLE', JSON.stringify(runtimeResult));
      assert.strictEqual(capability.reason_code, expectedReason, JSON.stringify(capability));
      assert.ok(capability.diagnostic, JSON.stringify(capability));
      assert.match(capability.diagnostic, /resolution failed|timed out/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('AGY missing CLI and sandbox remain UNAVAILABLE', () => {
  const missingCliRoot = tempRoot('agy-no-cli');
  const missingSandboxRoot = tempRoot('agy-no-bwrap');
  try {
    agyPackage(missingCliRoot);
    const cliStub = writeBwrapStub(missingCliRoot);
    fs.rmSync(path.join(cliStub.bin, 'agy'));
    const noCli = validate(missingCliRoot, ['--agy-runtime-probe'], {
      ...process.env,
      PATH: `${cliStub.bin}:/usr/bin:/bin`,
    });
    const cliRow = JSON.parse(noCli.stdout).results.find((item) => item.platform === 'agy');
    assert.strictEqual(cliRow.capabilities.find((item) => item.id === 'agy.discovery.plugins').status, 'UNAVAILABLE');
    assert.strictEqual(cliRow.capabilities.find((item) => item.id === 'agy.runtime.subagent').status, 'UNAVAILABLE');
    assert.strictEqual(cliRow.final_status, 'UNAVAILABLE');

    agyPackage(missingSandboxRoot);
    write(path.join(missingSandboxRoot, 'bin/agy'), '#!/bin/sh\nexit 0\n', 0o755);
    writePythonShim(missingSandboxRoot);
    const noSandbox = validate(missingSandboxRoot, ['--agy-runtime-probe'], {
      ...process.env,
      PATH: path.join(missingSandboxRoot, 'bin'),
    });
    const sandboxRow = JSON.parse(noSandbox.stdout).results.find((item) => item.platform === 'agy');
    assert.strictEqual(sandboxRow.capabilities.find((item) => item.id === 'agy.discovery.plugins').status, 'UNAVAILABLE');
    assert.strictEqual(sandboxRow.capabilities.find((item) => item.id === 'agy.runtime.subagent').status, 'UNAVAILABLE');
    assert.strictEqual(sandboxRow.final_status, 'UNAVAILABLE');
  } finally {
    fs.rmSync(missingCliRoot, { recursive: true, force: true });
    fs.rmSync(missingSandboxRoot, { recursive: true, force: true });
  }
});

test('AGY rejects a symlinked bwrap sandbox before executing the stub', () => {
  const root = tempRoot('agy-symlinked-bwrap');
  try {
    agyPackage(root);
    const hostHome = agyHostSession(root);
    const bin = path.join(root, 'bin');
    const sentinel = path.join(root, 'bwrap-must-not-run');
    const target = path.join(bin, 'bwrap-target');
    write(target, `#!/bin/sh\nprintf '%s' executed > ${sentinel}\nexit 0\n`, 0o755);
    fs.symlinkSync(target, path.join(bin, 'bwrap'));
    write(path.join(bin, 'agy'), '#!/bin/sh\nexit 0\n', 0o755);

    const result = validate(root, ['--agy-runtime-probe'], {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin`,
      DHPK_AGY_HOST_HOME: hostHome,
    });
    assert.ok(result.stdout, `${result.stdout}\n${result.stderr}`);
    assert.ok(!fs.existsSync(sentinel), 'the symlinked bwrap target must never execute');
    const row = JSON.parse(result.stdout).results.find((item) => item.platform === 'agy');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'agy.discovery.plugins').status, 'UNAVAILABLE', JSON.stringify(row));
    assert.strictEqual(row.capabilities.find((item) => item.id === 'agy.discovery.agents').status, 'UNAVAILABLE', JSON.stringify(row));
    assert.strictEqual(row.capabilities.find((item) => item.id === 'agy.runtime.subagent').status, 'UNAVAILABLE', JSON.stringify(row));
    assert.ok(['UNAVAILABLE', 'BLOCKED'].includes(row.final_status), JSON.stringify(row));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AGY package structure accepts skills with references/ supporting files', () => {
  const root = tempRoot('agy-skill-references');
  try {
    agyPackage(root);
    write(path.join(root, 'plugins/dhpk-agy/skills/dhpk-sample/references/guide.md'), '# Reference guide\n');
    const files = {};
    const pkg = path.join(root, 'plugins/dhpk-agy');
    for (const relative of ['plugin.json', 'agents/sample.md', 'agents/INDEX.md', 'agents/README.md', 'rules/sample.md', 'skills/dhpk-sample/SKILL.md', 'skills/dhpk-sample/references/guide.md']) {
      files[relative] = crypto.createHash('sha256').update(fs.readFileSync(path.join(pkg, relative))).digest('hex');
    }
    write(path.join(pkg, 'fingerprints.json'), JSON.stringify({ schema: 'dhpk.agy-plugin.v1', files }));
    const prov = JSON.parse(fs.readFileSync(path.join(pkg, 'provenance.json'), 'utf8'));
    prov.fingerprints = files;
    write(path.join(pkg, 'provenance.json'), JSON.stringify(prov));

    const result = validate(root, []);
    const row = JSON.parse(result.stdout).results.find((item) => item.platform === 'agy');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'agy.package.structure').status, 'PASS', JSON.stringify(row));
    assert.ok(!row.notes.some((note) => note.includes('AGY skill path must be')), `unexpected skill path notes: ${row.notes.join('; ')}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AGY sandbox binds the native package at the consumer plugin path', () => {
  const source = fs.readFileSync(path.join(ROOT, 'skills/dhpk-cross-agent-sync/scripts/multi_ai_sync_lib/validation.py'), 'utf8');
  assert.match(
    source,
    /"--ro-bind", os\.path\.realpath\(package_root\), "\/home\/agy\/\.gemini\/config\/plugins\/dhpk"/,
  );
  assert.doesNotMatch(source, /--ro-bind.*\/workspace\/plugins\/dhpk-agy/);
});

run('multi-ai-sync-agy-platform');
