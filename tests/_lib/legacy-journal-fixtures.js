'use strict';

// Recorded states left behind by installers that no longer exist in the tree.
// The Python installer and the Publisher's hold producer were removed in
// js-projection-journal stage 5 and the recovery of what they left in flight
// in 0.75.0 (#1321). These recordings now prove the other direction: this
// release fails closed on them without changing a file and names dhpk 0.74.x
// (tests/fixtures/legacy-journals/README.md says how they were made).

const fs = require('node:fs');
const path = require('node:path');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'legacy-journals');

function loadLegacyFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

// Writes a recorded tree below `destination`, substituting each `@@NAME@@`
// placeholder with the real directory it stood for.
function restoreTree(tree, destination, placeholders) {
  const substitute = (text) => Object.entries(placeholders).reduce((value, [key, real]) => value.split(key).join(real), text);
  for (const [relative, entry] of Object.entries(tree)) {
    const target = relative ? path.join(destination, relative) : destination;
    if (entry.link !== undefined) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(substitute(entry.link), target);
    } else if (entry.dir) {
      fs.mkdirSync(target, { recursive: true });
      fs.chmodSync(target, entry.mode);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, substitute(entry.text));
      fs.chmodSync(target, entry.mode);
    }
  }
}

module.exports = { FIXTURE_DIR, loadLegacyFixture, restoreTree };
