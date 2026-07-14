'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CODE_BUDDY_PACKAGE_NAME = /^@phuetz\/code-buddy$/;
const DIST_DIGEST_SCOPE = 'dist-tree-code-without-maps-v1';
const MAX_DIST_FILES = 20_000;
const MAX_DIST_ENTRIES = 40_000;
const MAX_DIST_BYTES = 512 * 1024 * 1024;

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function collectDistFiles(directory, relative = '', state = { entries: 0, files: 0, bytes: 0 }) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const files = [];
  for (const entry of entries) {
    state.entries += 1;
    if (state.entries > MAX_DIST_ENTRIES) {
      throw new Error(`Compiled runtime exceeds the attestation entry limit (${MAX_DIST_ENTRIES})`);
    }
    const relPath = relative ? `${relative}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Compiled runtime contains an unattested symlink: dist/${relPath}`);
    }
    if (entry.isDirectory()) files.push(...collectDistFiles(absolute, relPath, state));
    else if (
      entry.isFile() &&
      !entry.name.endsWith('.js.map') &&
      relPath !== 'package.json'
    ) {
      state.files += 1;
      if (state.files > MAX_DIST_FILES) {
        throw new Error(`Compiled runtime exceeds the attestation file limit (${MAX_DIST_FILES})`);
      }
      const fileStat = fs.lstatSync(absolute);
      if (!fileStat.isFile()) {
        throw new Error(`Compiled runtime entry changed while being attested: dist/${relPath}`);
      }
      state.bytes += fileStat.size;
      if (state.bytes > MAX_DIST_BYTES) {
        throw new Error(`Compiled runtime exceeds the attestation byte limit (${MAX_DIST_BYTES})`);
      }
      files.push({ relPath, size: fileStat.size });
    }
  }
  return files;
}

function computeDistDigest(root) {
  const dist = path.join(root, 'dist');
  const canonicalRoot = fs.realpathSync(root);
  const distStat = fs.lstatSync(dist);
  if (distStat.isSymbolicLink()) {
    throw new Error(`Compiled runtime directory must not be a symlink: ${dist}`);
  }
  if (!distStat.isDirectory()) {
    throw new Error(`Compiled runtime directory is missing: ${dist}`);
  }
  const canonicalDist = fs.realpathSync(dist);
  if (!isWithinRoot(canonicalRoot, canonicalDist)) {
    throw new Error(`Compiled runtime directory escapes the project root: ${dist}`);
  }
  const files = collectDistFiles(canonicalDist);
  const hash = createHash('sha256');
  let totalBytes = 0;
  for (const { relPath, size } of files) {
    const content = fs.readFileSync(path.join(canonicalDist, ...relPath.split('/')));
    if (content.length !== size) {
      throw new Error(`Compiled runtime entry changed while being attested: dist/${relPath}`);
    }
    totalBytes += content.length;
    if (totalBytes > MAX_DIST_BYTES) {
      throw new Error(`Compiled runtime exceeds the attestation byte limit (${MAX_DIST_BYTES})`);
    }
    hash.update(relPath, 'utf8');
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return {
    algorithm: 'sha256',
    scope: DIST_DIGEST_SCOPE,
    value: hash.digest('hex'),
    fileCount: files.length,
  };
}

function validateRuntimeManifest(root, manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Code Buddy runtime manifest must be a JSON object');
  }
  if (manifest.schemaVersion !== 2) {
    throw new Error(`Unsupported Code Buddy runtime manifest schema: ${String(manifest.schemaVersion)}`);
  }
  const core = manifest.corePackage;
  for (const field of ['name', 'version', 'description']) {
    if (typeof core?.[field] !== 'string' || !core[field].trim()) {
      throw new Error(`Code Buddy runtime manifest is missing corePackage.${field}`);
    }
  }
  if (!CODE_BUDDY_PACKAGE_NAME.test(core.name)) {
    throw new Error(`Unexpected Code Buddy core package name: ${core.name}`);
  }
  const runtime = manifest.runtime;
  if (
    runtime?.kind !== 'codebuddy-core' ||
    runtime.compiled !== true ||
    runtime.moduleFormat !== 'esm' ||
    runtime.distPath !== 'dist' ||
    runtime.entrypoint !== 'dist/desktop/codebuddy-engine-adapter.js'
  ) {
    throw new Error('Code Buddy runtime manifest does not attest the compiled ESM core');
  }
  if (
    manifest.sourceRevision !== null &&
    (typeof manifest.sourceRevision !== 'string' || !/^[a-f0-9]{7,64}$/i.test(manifest.sourceRevision))
  ) {
    throw new Error('Code Buddy runtime manifest has an invalid sourceRevision');
  }
  if (
    manifest.sourceRevision !== null &&
    (typeof manifest.sourceRevisionOrigin !== 'string' || !manifest.sourceRevisionOrigin.trim())
  ) {
    throw new Error('Code Buddy runtime manifest has no sourceRevisionOrigin');
  }
  if (
    manifest.sourceDirty !== null &&
    manifest.sourceDirty !== undefined &&
    typeof manifest.sourceDirty !== 'boolean'
  ) {
    throw new Error('Code Buddy runtime manifest has an invalid sourceDirty');
  }
  const observed = computeDistDigest(root);
  const attested = manifest.distDigest;
  if (
    attested?.algorithm !== observed.algorithm ||
    attested?.scope !== observed.scope ||
    attested?.value !== observed.value ||
    attested?.fileCount !== observed.fileCount
  ) {
    throw new Error(
      'Code Buddy compiled runtime does not match its build-time distDigest; run npm run build',
    );
  }
  return observed;
}

module.exports = {
  CODE_BUDDY_PACKAGE_NAME,
  DIST_DIGEST_SCOPE,
  computeDistDigest,
  validateRuntimeManifest,
};
