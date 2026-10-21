'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('Laravel 5.4 resource filters use the options array and Input remains', () => {
  const guide = read('skills/laravel/references/5-4.md');
  assert.match(guide, /Route::resource\('photos', 'PhotoController', \['only' => \['index'\]\]\)/);
  assert.match(guide, /Route::resource\('photos', 'PhotoController', \['except' => \['destroy'\]\]\)/);
  assert.ok(!guide.includes('->only('));
  assert.ok(!guide.includes('->except('));
  assert.match(guide, /5\.4\.36/);
  assert.match(guide, /returns void/);
  assert.ok(!guide.includes('The `Input` facade was removed'));
  assert.match(guide, /6\.0/);
  assert.match(guide, /v5\.4\.36 `Illuminate\\Support\\Facades\\Input` exists/);
  assert.match(guide, /PHP was not executed/);
});

test('Laravel 8.37 anonymous migrations are not described as a 9-only feature', () => {
  const guide = read('skills/laravel/references/8.md');
  const module = read('modules/laravel-8/module.yaml');
  const nine = read('skills/laravel/references/9.md');
  const nineModule = read('modules/laravel-9/module.yaml');
  assert.ok(!guide.includes('No anonymous migrations'));
  assert.ok(!guide.includes('added in 9'));
  assert.match(guide, /8\.37\.0/);
  assert.match(module, /8\.37/);
  assert.ok(!nine.includes('pre-9.0 migrations were named classes'));
  assert.match(nine, /8\.37\.0/);
  assert.match(nineModule, /8\.37/);
});

test('Laravel 9.18 invokable rules stay distinct from Laravel 10 ValidationRule', () => {
  const nine = read('skills/laravel/references/9.md');
  const nineModule = read('modules/laravel-9/module.yaml');
  const ten = read('skills/laravel/references/10.md');
  const tenModule = read('modules/laravel-10/module.yaml');
  assert.ok(!nine.includes('No invokable validation rules'));
  assert.match(nine, /9\.18\.0/);
  assert.match(nine, /InvokableRule/);
  assert.match(nine, /__invoke/);
  assert.match(nine, /ValidationRule::validate/);
  assert.match(nineModule, /9\.18/);
  assert.ok(!ten.includes('safer argument-array form by default'));
  assert.match(ten, /fromShellCommandline/);
  assert.match(ten, /Process::run\(\['ls', '-la'\]\)/);
  assert.match(tenModule, /ValidationRule::validate/);
  assert.match(tenModule, /9\.18/);
});

run('laravel-guidance');
