'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const GUIDE = path.join(ROOT, 'skills', 'python', 'references', 'testing.md');
const PARSER = path.join(ROOT, 'tests', 'fixtures', 'pytest-8.3.5', 'expression.py');

function verificationSection(guide) {
  const start = guide.indexOf('## Verification');
  assert.ok(start >= 0, 'testing.md is missing the Verification section');
  return guide.slice(start);
}

test('offline pytest selection uses an exact shared live marker', () => {
  const guide = fs.readFileSync(GUIDE, 'utf8');
  const verification = verificationSection(guide);
  assert.match(verification, /pytest -m "not live"/);
  assert.ok(!verification.includes('live_*'));
  assert.ok(!verification.includes('not live_fubon'));
  assert.match(guide, /@pytest\.mark\.live` and `@pytest\.mark\.live_fubon/);
  assert.match(guide, /not a glob/);
  assert.match(guide, /marked only `live_fubon`/);

  const script = `
import importlib.util, json
spec = importlib.util.spec_from_file_location("pytest_expression", ${JSON.stringify(PARSER)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
try:
    mod.Expression.compile("not live_*")
    bad = None
except mod.ParseError as exc:
    bad = str(exc)
expr = mod.Expression.compile("not live")
cases = [
    {"name": "offline", "markers": [], "want": True},
    {"name": "fubon", "markers": ["live", "live_fubon"], "want": False},
    {"name": "external", "markers": ["live", "live_external"], "want": False},
    {"name": "specific-only", "markers": ["live_fubon"], "want": True},
]
for case in cases:
    got = expr.evaluate(lambda name, markers=set(case["markers"]): name in markers)
    case["got"] = got
print(json.dumps({"bad": bad, "cases": cases}))
`;
  const raw = execFileSync('python3', ['-c', script], { encoding: 'utf8' });
  const result = JSON.parse(raw);
  assert.match(result.bad, /unexpected character "\*"/);
  const selected = result.cases.filter((item) => item.got);
  assert.ok(selected.some((item) => item.name === 'offline'));
  for (const item of result.cases) {
    assert.strictEqual(item.got, item.want, `${item.name}: got ${item.got}`);
  }
  assert.ok(result.cases.filter((item) => item.markers.includes('live')).every((item) => item.got === false));
});

run('pytest-marker-guidance');
