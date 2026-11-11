'use strict';

// A package fixture that includes the harness-setup Skill needs the installer
// entry the packaged bundle is built from (scripts/lib/marketplace-skill-content.js).
// This writes a one-module stand-in so the fixture does not carry the real closure.

const fs = require('node:fs');
const path = require('node:path');

function writeInstallerEntry(root) {
  const entry = path.join(root, 'scripts', 'lib', 'install-adapters', 'codex-cli.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "'use strict';\nprocess.stdout.write('fixture installer entry\\n');\n");
}

module.exports = { writeInstallerEntry };
