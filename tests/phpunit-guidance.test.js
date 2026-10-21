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

function namedBlocks(xsd, kind) {
  const blocks = new Map();
  const open = new RegExp(`<xs:${kind}\\b([^>]*)>`, 'g');
  let match;
  while ((match = open.exec(xsd))) {
    const name = /name="([^"]+)"/.exec(match[1]);
    const token = new RegExp(`</?xs:${kind}\\b[^>]*>`, 'g');
    token.lastIndex = open.lastIndex;
    let depth = 1;
    let end = -1;
    let close;
    while ((close = token.exec(xsd))) {
      depth += close[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        end = close.index;
        break;
      }
    }
    if (name && end >= 0) blocks.set(name[1], xsd.slice(open.lastIndex, end));
    if (end >= 0) open.lastIndex = end;
  }
  return blocks;
}

function attributeNames(block) {
  return [...String(block || '').matchAll(/<xs:attribute name="([^"]+)"/g)].map((match) => match[1]);
}

function attributeGroupRefs(block) {
  return [...String(block || '').matchAll(/<xs:attributeGroup ref="([^"]+)"/g)].map((match) => match[1]);
}

function attributesForType(complexTypes, attributeGroups, typeName, seen = new Set()) {
  if (seen.has(typeName)) return new Set();
  seen.add(typeName);
  const block = complexTypes.get(typeName);
  if (!block) throw new Error(`PHPUnit schema is missing complexType ${typeName}`);
  const names = new Set(attributeNames(block));
  const visitGroup = (groupName, groupSeen) => {
    if (groupSeen.has(groupName)) return;
    groupSeen.add(groupName);
    const group = attributeGroups.get(groupName);
    if (!group) throw new Error(`PHPUnit schema is missing attributeGroup ${groupName}`);
    for (const name of attributeNames(group)) names.add(name);
    for (const nested of attributeGroupRefs(group)) visitGroup(nested, groupSeen);
  };
  for (const groupName of attributeGroupRefs(block)) visitGroup(groupName, new Set());
  return names;
}

function elementTypes(xsd) {
  const types = new Map();
  for (const match of xsd.matchAll(/<xs:element name="([^"]+)" type="([^"]+)"/g)) {
    types.set(match[1], match[2]);
  }
  return types;
}

function xmlElements(xml) {
  const elements = [];
  for (const match of xml.matchAll(/<([A-Za-z_][\w:.-]*)([^>]*)\/?>/g)) {
    const attributes = [...match[2].matchAll(/([A-Za-z_][\w:.-]*)="[^"]*"/g)].map((attr) => attr[1]);
    elements.push({ name: match[1], attributes });
  }
  return elements;
}

// CI images do not ship xmllint. The committed 11.5 phpunit.xsd is still the
// authority: declared attributes come from its complexTypes and attributeGroups.
// When xmllint exists, the same documents are also checked with that validator.
function schemaAttributeErrors(xsd, xml) {
  assert.ok(!xsd.includes('cacheResultFile'), 'PHPUnit 11.5 schema must not declare cacheResultFile');
  const complexTypes = namedBlocks(xsd, 'complexType');
  const attributeGroups = namedBlocks(xsd, 'attributeGroup');
  const types = elementTypes(xsd);
  const errors = [];
  for (const element of xmlElements(xml)) {
    const typeName = types.get(element.name);
    if (!typeName) {
      errors.push(`element '${element.name}' is not declared`);
      continue;
    }
    const allowed = attributesForType(complexTypes, attributeGroups, typeName);
    for (const attribute of element.attributes) {
      if (!allowed.has(attribute)) {
        errors.push(`Element '${element.name}', attribute '${attribute}': The attribute '${attribute}' is not allowed.`);
      }
    }
  }
  return errors;
}

function xmllintErrors(xml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-phpunit-xsd-'));
  const file = path.join(dir, 'phpunit.xml');
  try {
    fs.writeFileSync(file, xml);
    execFileSync('xmllint', ['--noout', '--schema', SCHEMA, file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return [];
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    return [String(error.stderr || error.message)];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('PHPUnit 11.5 schema accepts root cacheDirectory and rejects source cacheResultFile', () => {
  const xsd = fs.readFileSync(SCHEMA, 'utf8');
  assert.deepStrictEqual(schemaAttributeErrors(xsd, VALID_CACHE_XML), []);
  const rejected = schemaAttributeErrors(xsd, INVALID_CACHE_XML);
  assert.ok(rejected.some((error) => /attribute 'cacheResultFile' is not allowed/.test(error)), rejected.join('\n'));
  const validLint = xmllintErrors(VALID_CACHE_XML);
  const invalidLint = xmllintErrors(INVALID_CACHE_XML);
  if (validLint !== null) {
    assert.deepStrictEqual(validLint, []);
    assert.ok(invalidLint.some((error) => /attribute 'cacheResultFile' is not allowed/.test(error)), invalidLint.join('\n'));
  }
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
