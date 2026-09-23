const fs = require('fs');
const path = require('path');
const runnerUtils = require('./runner-utils');

let _pluginName = null;
function getPluginName() {
  if (_pluginName !== null) return _pluginName;
  try {
    const pluginRoot = path.resolve(__dirname, '../..');
    const pj = JSON.parse(fs.readFileSync(
      path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
    _pluginName = pj.name || '';
  } catch { _pluginName = ''; }
  return _pluginName;
}

function qualifyCommand(cmd) {
  const name = getPluginName();
  if (!name || !cmd || !cmd.startsWith('/')) return cmd;
  if (cmd.startsWith('/' + name + ':')) return cmd;
  return '/' + name + ':' + cmd.slice(1);
}

module.exports = {
  ...runnerUtils,
  getPluginName,
  qualifyCommand,
};
