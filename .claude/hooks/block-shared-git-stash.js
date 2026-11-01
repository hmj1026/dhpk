#!/usr/bin/env node
'use strict';

// dhpk-local PreToolUse(Bash) guard. Several sessions share this checkout and
// its git stash, so a bare stash or a stash pop/apply can capture or apply
// another session's work. Copy files aside with `cp` instead.

const READ_ONLY = new Set(['list', 'show']);

function blockedStash(command) {
  // Match only at a command start, so prose such as a commit message that
  // mentions the command is not blocked.
  const re = /(?:^|[\n;&|(]|\$\()\s*git\s+stash\b(?:[ \t]+([^\s;&|)]+))?([^\n;&|)]*)/g;
  for (const m of command.matchAll(re)) {
    const sub = m[1] && !m[1].startsWith('-') ? m[1] : 'push';
    if (READ_ONLY.has(sub)) continue;
    if ((sub === 'push' || sub === 'save') && /\s--\s+\S/.test(` ${m[1] || ''}${m[2] || ''}`)) continue;
    return sub;
  }
  return null;
}

function main() {
  let input = '';
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let command = '';
    try { command = JSON.parse(input).tool_input.command || ''; } catch { process.exit(0); }
    const sub = blockedStash(command);
    if (!sub) process.exit(0);
    process.stderr.write(
      `Blocked \`git stash ${sub}\`: the dhpk checkout and its stash are shared across sessions. `
      + 'Copy files aside with `cp` (or use `git stash push -- <paths>` for your own files only).\n',
    );
    process.exit(2);
  });
}

if (require.main === module) main();
module.exports = { blockedStash };
