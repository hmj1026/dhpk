'use strict';

const COMMAND_NAMESPACE = 'dhpk';

function qualifyCommand(command) {
  if (!command || !command.startsWith('/')) return command;
  const prefix = `/${COMMAND_NAMESPACE}:`;
  if (command.startsWith(prefix)) return command;
  return `${prefix}${command.slice(1)}`;
}

module.exports = { COMMAND_NAMESPACE, qualifyCommand };
