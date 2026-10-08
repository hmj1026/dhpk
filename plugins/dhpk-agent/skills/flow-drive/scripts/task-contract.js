'use strict';

function cloneTaskValue(value, ancestors = new Set()) {
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value !== 'object') throw new TypeError('task contract must contain only plain data');
  if (ancestors.has(value)) throw new TypeError('task contract must not contain cycles');

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) return value.map((item) => cloneTaskValue(item, nextAncestors));

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('task contract records must be plain objects');
  const clone = prototype === null ? Object.create(null) : {};
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) throw new TypeError('task contract must not contain accessor properties');
    Object.defineProperty(clone, key, {
      value: cloneTaskValue(descriptor.value, nextAncestors),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return clone;
}

function freezeTaskValue(value, visited = new Set()) {
  if (value === null || typeof value !== 'object' || visited.has(value)) return value;
  visited.add(value);
  Object.values(value).forEach((child) => freezeTaskValue(child, visited));
  return Object.freeze(value);
}

function cloneAndFreezeTaskValue(value) {
  return freezeTaskValue(cloneTaskValue(value));
}

function createNodeTask(parentTask, node) {
  const task = cloneTaskValue(parentTask);
  task.goal = node.goal;
  task.acceptance = [...node.acceptance];
  task.constraints = {
    ...task.constraints,
    authority: node.authority,
    assigned_files: [...node.assigned_files],
  };
  return freezeTaskValue(task);
}

module.exports = Object.freeze({ cloneTaskValue, freezeTaskValue, cloneAndFreezeTaskValue, createNodeTask });
