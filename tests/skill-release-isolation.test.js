'use strict';

// All Git/GitHub effects are trusted fixture stubs; no commit, network, PR,
// tag, or publication occurs. The test author explicitly selects each phase.
const fs = require('node:fs');
const path = require('node:path');
const { test, run } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const { registerReleaseFixtures } = require('./_lib/skill-release-fixtures');
const fixtures = registerReleaseFixtures();

for (const id of ['release-unmerged-blocked', 'release-unrelated-change-blocked', 'release-prepare-explicit-files']) {
  test(id, () => {
    const fixture = fixtures[id];
    const logger = "const fs=require('fs'); const args=process.argv.slice(1); fs.appendFileSync('tool-log.jsonl',JSON.stringify({tool,args})+'\\n');";
    withIsolatedSkill({
      source: path.join(__dirname, '../skills/release-creator'),
      stubs: {
        git: { body: "const tool='git';" + logger
          + "if(args[0]==='status')process.stdout.write("
          + JSON.stringify(id === 'release-unrelated-change-blocked' ? ' M unrelated.txt\n' : ' M package.json\n')
          + "); if(args[0]==='diff'&&args.includes('--name-only'))process.stdout.write('package.json\\n');" },
        gh: { body: "const tool='gh';" + logger
          + "if(args[0]==='pr'&&args[1]==='create')process.stdout.write('https://example.invalid/release/1\\n');" },
      },
    }, (context) => {
      fs.writeFileSync(path.join(context.projectDir, 'package.json'), '{"version":"1.2.3"}\n');
      fixture.assert(context.run(fixture.entry, fixture.args), context);
    });
  });
}

run('skill-release-isolation');
