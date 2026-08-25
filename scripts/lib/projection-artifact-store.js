'use strict';

// Filesystem implementation of the ProjectionArtifactStore port.  Callers
// receive only a plan-bound session; destination paths and link targets are
// validated against that plan before any staged mutation is made.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createDistributionArtifact, projectionError, SYMLINK_POLICIES } = require('./distribution-projection-contract');
const { createTraversalBudget, readDirectoryEntries } = require('./bounded-filesystem');

function digest(file, budget = createTraversalBudget()) {
  return crypto.createHash('sha256').update(budget.readFile(file)).digest('hex');
}

function safeRelative(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\0')
    && !value.includes('\\')
    && !path.posix.isAbsolute(value)
    && !/^[A-Za-z]:[\\/]/.test(value)
    && path.posix.normalize(value) === value
    && value !== '.'
    && value !== '..'
    && !value.startsWith('../');
}

function safeLinkTarget(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\0')
    && !value.includes('\\')
    && !path.posix.isAbsolute(value)
    && !/^[A-Za-z]:[\\/]/.test(value)
    && path.posix.normalize(value) !== '.';
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function stagedManifest(stageRoot) {
  const files = new Map();
  const directories = new Set(['']);
  const budget = createTraversalBudget();

  const walk = (directory, relative = '', depth = 0) => {
    const realDirectory = budget.enterDirectory(directory, depth);
    try {
      for (const entry of readDirectoryEntries(directory, { budget, sort: true, localeSort: true })) {
        const child = path.join(directory, entry.name);
        const childRelative = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) {
          directories.add(childRelative);
          walk(child, childRelative, depth + 1);
        } else if (entry.isSymbolicLink()) {
          files.set(childRelative, { type: 'symlink', target: fs.readlinkSync(child) });
        } else if (entry.isFile()) {
          files.set(childRelative, { type: 'file', fingerprint: digest(child, budget), mode: fs.statSync(child).mode & 0o7777 });
        } else {
          files.set(childRelative, { type: 'other' });
        }
      }
    } finally {
      budget.leaveDirectory(realDirectory);
    }
  };

  walk(stageRoot, '', 0);
  return { files, directories };
}

function assertStagedManifest(plan, stageRoot, written, links, fail) {
  const planned = new Map();
  for (const entry of plan.entries) {
    if (planned.has(entry.destination)) {
      fail('DUPLICATE_PLANNED_PATH', `planned destination is duplicated: '${entry.destination}'`, {
        paths: [entry.destination],
      });
    }
    planned.set(entry.destination, entry);
  }

  const ledger = new Map();
  for (const output of written) ledger.set(output.destination, { ...output, type: 'file' });
  for (const link of links) ledger.set(link.destination, { ...link, type: 'symlink' });
  if (ledger.size !== plan.entries.length) {
    fail('STAGED_TREE_INCOMPLETE', 'staged tree mutation ledger does not cover the compiled plan', {
      stableIds: plan.entries.map((entry) => entry.stableId),
    });
  }

  const observed = stagedManifest(stageRoot);
  const allowedDirectories = new Set(['']);
  for (const destination of planned.keys()) {
    const parts = destination.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      allowedDirectories.add(parts.slice(0, index).join('/'));
    }
  }
  for (const directory of observed.directories) {
    if (!allowedDirectories.has(directory)) {
      fail('UNEXPECTED_STAGED_ENTRY', `staged directory is absent from the compiled plan: '${directory}'`, {
        paths: [directory],
      });
    }
  }

  for (const [destination, actual] of observed.files) {
    if (!planned.has(destination) || !ledger.has(destination)) {
      fail('UNEXPECTED_STAGED_ENTRY', `staged entry is absent from the compiled plan: '${destination}'`, {
        paths: [destination],
      });
    }
    const entry = planned.get(destination);
    const recorded = ledger.get(destination);
    if (actual.type !== recorded.type) {
      fail('STAGED_ENTRY_TYPE_DRIFT', `staged entry type changed for '${destination}'`, {
        stableIds: [entry.stableId],
        paths: [destination],
      });
    }
    if (actual.type === 'file') {
      if (actual.fingerprint !== recorded.fingerprint) {
        fail('STAGED_CONTENT_DRIFT', `staged content changed after store write for '${destination}'`, {
          stableIds: [entry.stableId],
          paths: [destination],
        });
      }
      if (entry.expectedFingerprint && actual.fingerprint !== entry.expectedFingerprint) {
        fail('STAGED_CONTENT_MISMATCH', `staged content does not match the compiled plan for '${destination}'`, {
          stableIds: [entry.stableId],
          paths: [destination],
        });
      }
      if (entry.mode !== null && entry.mode !== undefined && actual.mode !== entry.mode) {
        fail('STAGED_MODE_MISMATCH', `staged mode does not match the compiled plan for '${destination}'`, {
          stableIds: [entry.stableId],
          paths: [destination],
        });
      }
    } else if (actual.type === 'symlink') {
      if (actual.target !== recorded.target || (entry.symlink && entry.symlink.target && actual.target !== entry.symlink.target)) {
        fail('STAGED_LINK_DRIFT', `staged link target changed for '${destination}'`, {
          stableIds: [entry.stableId],
          paths: [destination],
        });
      }
    }
  }

  for (const destination of planned.keys()) {
    if (!observed.files.has(destination)) {
      fail('STAGED_TREE_INCOMPLETE', `compiled output is missing from the staged tree: '${destination}'`, {
        paths: [destination],
      });
    }
  }
}

class ProjectionArtifactStore {
  constructor({ root, sourceRoot = root, publishRoot = null } = {}) {
    if (typeof root !== 'string' || root.trim() === '') throw new TypeError('ProjectionArtifactStore root is required');
    this.root = path.resolve(root);
    this.sourceRoot = path.resolve(sourceRoot);
    this.publishRoot = path.resolve(publishRoot || path.join(this.root, 'published'));
    if (!inside(this.root, this.publishRoot)) {
      throw new TypeError('ProjectionArtifactStore publishRoot must be contained by root');
    }
    fs.mkdirSync(this.root, { recursive: true });
  }

  begin(plan) {
    if (!plan || !Array.isArray(plan.entries) || !plan.planFingerprint) throw new TypeError('begin requires a compiled plan');
    const stageRoot = fs.mkdtempSync(path.join(this.root, '.projection-stage-'));
    const entries = new Map(plan.entries.map((entry) => [entry.stableId, entry]));
    const written = [];
    const links = [];
    let staged = false;
    let activated = false;

    const fail = (code, message, details = {}) => {
      throw Object.assign(new Error(message), { projectionCode: code, projectionDetails: details });
    };

    const entryFor = (output) => {
      if (!output || typeof output !== 'object') fail('INVALID_OUTPUT', 'planned output must be an object');
      const entry = entries.get(output.stableId);
      if (!entry) fail('UNPLANNED_OUTPUT', `output stable id '${output.stableId}' is absent from the plan`, { stableIds: [output.stableId] });
      if (output.destination !== entry.destination) fail('UNPLANNED_PATH', `output destination '${output.destination}' does not match the plan`, { stableIds: [entry.stableId], paths: [output.destination] });
      if (!safeRelative(entry.destination)) fail('UNSAFE_PATH', `planned destination is not safe: '${entry.destination}'`, { stableIds: [entry.stableId], paths: [entry.destination] });
      return entry;
    };

    const stagedPath = (relative) => {
      const target = path.resolve(stageRoot, relative);
      if (!inside(stageRoot, target)) fail('PATH_ESCAPE', `staged path escapes the artifact root: '${relative}'`, { paths: [relative] });
      return target;
    };

    const session = {
      // The stage root is exposed only for adapter-side structural validation.
      // stage() audits the complete staged manifest before returning a
      // candidate; activate() is the only operation that replaces the active
      // root. publish() remains a compatibility convenience for callers that
      // intentionally request both phases.
      stageRoot,
      write: (output) => {
        const entry = entryFor(output);
        if (entry.symlink && entry.symlink.policy !== 'forbid' && output.linkTarget) {
          fail('LINK_REQUIRED', `entry '${entry.stableId}' requires link()`, { stableIds: [entry.stableId] });
        }
        const target = stagedPath(entry.destination);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (typeof output.content !== 'string' && !Buffer.isBuffer(output.content)) {
          fail('INVALID_CONTENT', `output '${entry.stableId}' requires string or Buffer content`, { stableIds: [entry.stableId] });
        }
        const mode = output.mode === undefined || output.mode === null ? entry.mode : output.mode;
        if (mode !== null && mode !== undefined && (!Number.isInteger(mode) || mode < 0 || mode > 0o7777)) {
          fail('INVALID_MODE', `output '${entry.stableId}' requires a valid file mode`, { stableIds: [entry.stableId] });
        }
        if (entry.mode !== null && entry.mode !== undefined && mode !== entry.mode) {
          fail('MODE_MISMATCH', `output mode does not match the compiled plan for '${entry.stableId}'`, { stableIds: [entry.stableId] });
        }
        if (mode === null || mode === undefined) fs.writeFileSync(target, output.content);
        else fs.writeFileSync(target, output.content, { mode });
        written.push({ stableId: entry.stableId, destination: entry.destination, fingerprint: digest(target), mode: fs.statSync(target).mode & 0o7777 });
      },
      link: (output) => {
        const entry = entryFor(output);
        const policy = entry.symlink && entry.symlink.policy ? entry.symlink.policy : 'forbid';
        if (policy === 'forbid') fail('SYMLINK_FORBIDDEN', `symlink is forbidden for '${entry.stableId}'`, { stableIds: [entry.stableId] });
        const targetText = output.target || (entry.symlink && entry.symlink.target);
        if (!safeLinkTarget(targetText)) fail('INVALID_LINK', `link target must be relative: '${targetText}'`, { stableIds: [entry.stableId] });
        const target = stagedPath(entry.destination);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const resolved = path.resolve(path.dirname(target), targetText);
        if (policy === 'contained-relative' && !inside(stageRoot, resolved)) {
          fail('LINK_ESCAPE', `link target escapes artifact ownership root: '${targetText}'`, { stableIds: [entry.stableId] });
        }
        if (policy === 'declared-source-relative' && !inside(this.sourceRoot, path.resolve(this.sourceRoot, targetText))) {
          fail('LINK_ESCAPE', `link target escapes declared source root: '${targetText}'`, { stableIds: [entry.stableId] });
        }
        fs.symlinkSync(targetText, target);
        links.push({ stableId: entry.stableId, destination: entry.destination, target: targetText, policy });
      },
      stage: () => {
        if (staged) fail('ALREADY_STAGED', 'artifact has already been staged');
        assertStagedManifest(plan, stageRoot, written, links, fail);
        staged = true;
        return { outputs: written, links, stageRoot, artifactFingerprint: digestManifest(written, links) };
      },
      activate: () => {
        if (!staged) fail('NOT_STAGED', 'artifact must be staged before activation');
        if (activated) fail('ALREADY_ACTIVATED', 'artifact has already been activated');
        const publishRoot = this.publishRoot;
        const backupRoot = path.join(this.root, `.projection-backup-${process.pid}-${Date.now()}`);
        try {
          if (fs.existsSync(publishRoot)) fs.renameSync(publishRoot, backupRoot);
          fs.renameSync(stageRoot, publishRoot);
          if (fs.existsSync(backupRoot)) fs.rmSync(backupRoot, { recursive: true, force: true });
          activated = true;
          return { outputs: written, links, artifactFingerprint: digestManifest(written, links) };
        } catch (error) {
          if (fs.existsSync(publishRoot) && !fs.existsSync(stageRoot)) fs.renameSync(publishRoot, stageRoot);
          if (fs.existsSync(backupRoot) && !fs.existsSync(publishRoot)) fs.renameSync(backupRoot, publishRoot);
          throw error;
        }
      },
      publish: () => {
        if (!staged) session.stage();
        return session.activate();
      },
      abort: () => {
        if (!activated && fs.existsSync(stageRoot)) fs.rmSync(stageRoot, { recursive: true, force: true });
      },
    };
    return session;
  }
}

function digestManifest(outputs, links) {
  return crypto.createHash('sha256').update(JSON.stringify({ outputs, links })).digest('hex');
}

module.exports = {
  ProjectionArtifactStore,
  safeRelative,
  safeLinkTarget,
  inside,
};
