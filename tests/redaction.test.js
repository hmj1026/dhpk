'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { redactSensitiveText, redactedErrorText } = require('../scripts/lib/redaction');

test('redacts authorization schemes, assignments, and connection strings', () => {
  const marker = 'REDACTION_MARKER_SHOULD_NOT_LEAK_123456789';
  const output = redactSensitiveText([
    `Authorization: Bearer ${marker}`,
    `proxy-authorization: Basic ${marker}`,
    `token="${marker}"`,
    `postgres://user:${marker}@db.example.test/app`,
  ].join('\n'));
  assert.doesNotMatch(output, new RegExp(marker));
  assert.match(output, /Authorization:\s*<redacted>/i);
  assert.match(output, /<redacted>@db\.example\.test/);
});

test('redacts before truncating the retained diagnostic tail', () => {
  const marker = 'TAIL_SECRET_MARKER_SHOULD_NOT_LEAK_123456789';
  const output = redactSensitiveText(`${'x'.repeat(900)} token=${marker}`, { maxLength: 80 });
  assert.doesNotMatch(output, new RegExp(marker));
  assert.match(output, /token:\s*<redacted>/i);
  assert.ok(output.length <= 80);
});

test('redacts JSON-shaped quoted secret keys', () => {
  const marker = 'JSON_SECRET_MARKER_SHOULD_NOT_LEAK_123456789';
  const output = redactSensitiveText(`{"api_key":"${marker}","token":"${marker}","password":"${marker}"}`);
  assert.doesNotMatch(output, new RegExp(marker));
  assert.doesNotMatch(output, /JSON_SECRET_MARKER/);
});

test('redacts Cursor session token field names', () => {
  const marker = 'CURSOR_SESSION_SECRET_MARKER_SHOULD_NOT_LEAK_123456789';
  const output = redactSensitiveText(JSON.stringify({
    accessToken: marker,
    refreshToken: marker,
    oauthToken: marker,
    token: marker,
  }));
  assert.doesNotMatch(output, new RegExp(marker));
  assert.match(output, /accessToken:\s*<redacted>/i);
  assert.match(output, /refreshToken:\s*<redacted>/i);
  assert.match(output, /oauthToken:\s*<redacted>/i);
});

test('redactedErrorText redacts then truncates an Error message to 800 characters', () => {
  const marker = 'ERROR_SECRET_MARKER_SHOULD_NOT_LEAK_123456789';
  const output = redactedErrorText(new Error(`${'y'.repeat(900)} token=${marker}`));
  assert.doesNotMatch(output, new RegExp(marker));
  assert.match(output, /token:\s*<redacted>/i);
  assert.ok(output.length <= 800);
  assert.strictEqual(redactedErrorText(new Error('boom'), { maxLength: 3 }), 'oom');
});

test('redactedErrorText falls back to the fallback text or the value itself without a message', () => {
  assert.strictEqual(redactedErrorText(new Error(''), { fallback: 'unknown setup error' }), 'unknown setup error');
  assert.strictEqual(redactedErrorText(null, { fallback: 'unknown setup error' }), 'unknown setup error');
  assert.strictEqual(redactedErrorText('plain string failure'), 'plain string failure');
  assert.strictEqual(redactedErrorText({ code: 'E' }), '[object Object]');
});

run('redaction');
