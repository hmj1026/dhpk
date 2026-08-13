'use strict';

// Filesystem implementation of the ProjectionArtifactStore port.  Callers
// receive only a plan-bound session; destination paths and link targets are
// validated against that plan before any staged mutation is made.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createDistributionArtifact, projectionError, SYMLINK_POLICIES } = require('./distribution-projection-contract');

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
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

class ProjectionArtifactStore {
  constructor({ root, sourceRoot = root } = {}) {
    if (typeof root !== 'string' || root.trim() === '') throw new TypeError('ProjectionArtifactStore root is required');
    this.root = path.resolve(root);
    this.sourceRoot = path.resolve(sourceRoot);
    fs.mkdirSync(this.root, { recursive: true });
  }

  begin(plan) {
    if (!plan || !Array.isArray(plan.entries) || !plan.planFingerprint) throw new TypeError('begin requires a compiled plan');
    const stageRoot = fs.mkdtempSync(path.join(this.root, '.projection-stage-'));
    const entries = new Map(plan.entries.map((entry) => [entry.stableId, entry]));
    const written = [];
    const links = [];
    let published = false;

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
        fs.writeFileSync(target, output.content);
        written.push({ stableId: entry.stableId, destination: entry.destination, fingerprint: digest(target) });
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
      publish: () => {
        if (published) fail('ALREADY_PUBLISHED', 'artifact has already been published');
        const publishRoot = path.join(this.root, 'published');
        const backupRoot = path.join(this.root, `.projection-backup-${process.pid}-${Date.now()}`);
        try {
          if (fs.existsSync(publishRoot)) fs.renameSync(publishRoot, backupRoot);
          fs.renameSync(stageRoot, publishRoot);
          if (fs.existsSync(backupRoot)) fs.rmSync(backupRoot, { recursive: true, force: true });
          published = true;
          return { outputs: written, links, artifactFingerprint: digestManifest(written, links) };
        } catch (error) {
          if (fs.existsSync(publishRoot) && !fs.existsSync(stageRoot)) fs.renameSync(publishRoot, stageRoot);
          if (fs.existsSync(backupRoot) && !fs.existsSync(publishRoot)) fs.renameSync(backupRoot, publishRoot);
          throw error;
        }
      },
      abort: () => {
        if (!published && fs.existsSync(stageRoot)) fs.rmSync(stageRoot, { recursive: true, force: true });
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
