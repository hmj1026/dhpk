'use strict';

// Extracts the installer's `# BEGIN tree-fingerprint` ... `# END tree-fingerprint`
// block from scripts/hooks/install-codex-skills.sh and runs it under Python, so
// a test can hold the real embedded recipe to the shared vectors.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const INSTALLER = path.resolve(__dirname, '..', '..', 'scripts', 'hooks', 'install-codex-skills.sh');
const BEGIN = '# BEGIN tree-fingerprint';
const END = '# END tree-fingerprint';

function extractTreeFingerprintBlock() {
  const lines = fs.readFileSync(INSTALLER, 'utf8').split('\n');
  const start = lines.indexOf(BEGIN);
  const end = lines.indexOf(END);
  if (start < 0 || end < start) throw new Error(`installer block not found: ${BEGIN} ... ${END}`);
  return lines.slice(start + 1, end).join('\n');
}

const DRIVER = `
import json, sys
cases = json.loads(sys.argv[1])
results = []
for case in cases:
    try:
        if case['kind'] == 'fd':
            fd = os.open(case['dir'], os.O_RDONLY | os.O_DIRECTORY)
            try:
                value = tree_fingerprint_fd_directory(fd, case['record_links'], case['skip_bytecode'])
            finally:
                os.close(fd)
        else:
            value = tree_fingerprint_path(case['dir'], case['symlinks'], case['skip_bytecode'])
        results.append({'digest': value})
    except Exception as error:
        results.append({'error': str(error)})
print(json.dumps(results))
`;

// cases: [{ kind: 'fd'|'path', dir, record_links?, symlinks?, skip_bytecode }].
// block overrides the extracted text (used for the mutation check).
function runTreeFingerprint(cases, block = extractTreeFingerprintBlock()) {
  const source = ['import hashlib', 'import os', 'import stat', block, DRIVER].join('\n\n');
  const result = spawnSync('python3', ['-I', '-c', source, JSON.stringify(cases)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`tree-fingerprint python failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

module.exports = { extractTreeFingerprintBlock, runTreeFingerprint };
