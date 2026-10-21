'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCHEMA = path.join(ROOT, 'tests', 'fixtures', 'phpunit-11.5', 'phpunit.xsd');
const VALID_CACHE_XML = '<phpunit cacheDirectory=".phpunit.cache"><source/></phpunit>';
const INVALID_CACHE_XML = '<phpunit><source cacheResultFile=".phpunit.result.cache"/></phpunit>';

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function validate(xml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-phpunit-xsd-'));
  const file = path.join(dir, 'phpunit.xml');
  try {
    fs.writeFileSync(file, xml);
    return execFileSync('xmllint', ['--noout', '--schema', SCHEMA, file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return error;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('PHPUnit 11.5 schema accepts root cacheDirectory and rejects source cacheResultFile', () => {
  assert.strictEqual(validate(VALID_CACHE_XML), '');
  const rejected = validate(INVALID_CACHE_XML);
  assert.ok(rejected instanceof Error, 'source cacheResultFile must fail the official 11.5 schema');
  assert.match(String(rejected.stderr), /attribute 'cacheResultFile' is not allowed/);
});

test('PHPUnit 10 guidance separates issues from exceptions and targets the event system', () => {
  const guide = read('skills/phpunit/references/10.md');
  const module = read('modules/phpunit-10/module.yaml');
  assert.ok(!guide.includes('always true'));
  assert.ok(!guide.includes('is the hooks API'));
  assert.ok(!guide.includes('port to the hooks API'));
  assert.match(guide, /failOnDeprecation/);
  assert.match(guide, /failOnNotice/);
  assert.match(guide, /failOnWarning/);
  assert.match(guide, /displayDetailsOnTestsThatTriggerDeprecations/);
  assert.match(guide, /displayDetailsOnTestsThatTriggerNotices/);
  assert.match(guide, /displayDetailsOnTestsThatTriggerWarnings/);
  assert.match(guide, /PHPUnit\\Runner\\Extension\\Extension/);
  assert.ok(!module.includes('hooks API'));
  assert.match(module, /event system/);
});

test('PHPUnit 11 guidance keeps the property assertion and cache boundaries on the right version', () => {
  const guide = read('skills/phpunit/references/11.md');
  const module = read('modules/phpunit-11/module.yaml');
  assert.ok(guide.includes(VALID_CACHE_XML));
  assert.ok(guide.includes(INVALID_CACHE_XML));
  assert.ok(!guide.includes('attribute moved to `<source>`'));
  assert.ok(!guide.includes('11 (only path)'));
  assert.ok(!guide.includes('worked but already misnamed'));
  assert.match(guide, /absent from the 10\.0\.0 and 10\.5/);
  assert.match(guide, /exists in PHPUnit 10\.5/);
  assert.match(guide, /not in the 10\.0\.0 tag/);
  assert.ok(!module.includes('assertObjectHasAttribute renamed to assertObjectHasProperty'));
  assert.match(module, /10\.0\.0/);
  assert.match(module, /10\.5/);
});

run('phpunit-guidance');
