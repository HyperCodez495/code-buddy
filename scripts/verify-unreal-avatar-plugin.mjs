#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = path.join(repoRoot, 'integrations', 'unreal', 'CodeBuddyAvatar');
const manifestPath = path.join(pluginRoot, 'bundle-manifest.json');
const writeManifest = process.argv.includes('--write-manifest');
const jsonOutput = process.argv.includes('--json');
const requiredFiles = [
  'CodeBuddyAvatar.uplugin',
  'Config/DefaultCodeBuddyAvatar.ini',
  'README.md',
  'Source/CodeBuddyAvatar/CodeBuddyAvatar.Build.cs',
  'Source/CodeBuddyAvatar/Private/CodeBuddyAvatarModule.cpp',
  'Source/CodeBuddyAvatar/Private/CodeBuddyAvatarSubsystem.cpp',
  'Source/CodeBuddyAvatar/Private/CodeBuddyWavParser.cpp',
  'Source/CodeBuddyAvatar/Private/Tests/CodeBuddyWavParserTest.cpp',
  'Source/CodeBuddyAvatar/Public/CodeBuddyAvatarSubsystem.h',
  'Source/CodeBuddyAvatar/Public/CodeBuddyAvatarTypes.h',
  'Source/CodeBuddyAvatar/Public/CodeBuddyWavParser.h',
];

async function walk(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const next = path.posix.join(relative.replaceAll(path.sep, '/'), entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, next));
    else if (entry.isFile() && next !== 'bundle-manifest.json') files.push(next);
  }
  return files;
}

async function sha256(file) {
  const content = await readFile(file);
  return createHash('sha256').update(content).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyContracts(files) {
  for (const required of requiredFiles) {
    assert(files.includes(required), `missing required plugin file: ${required}`);
  }

  const descriptor = JSON.parse(await readFile(path.join(pluginRoot, 'CodeBuddyAvatar.uplugin'), 'utf8'));
  assert(descriptor.FileVersion === 3, 'uplugin FileVersion must be 3');
  assert(descriptor.VersionName === '0.5.0-split-a.5', 'unexpected plugin version');
  const runtime = descriptor.Modules?.find((module) => module.Name === 'CodeBuddyAvatar');
  assert(runtime?.Type === 'Runtime', 'CodeBuddyAvatar must be a Runtime module');
  assert(runtime?.PlatformAllowList?.includes('Win64'), 'plugin must explicitly target Win64');

  const build = await readFile(
    path.join(pluginRoot, 'Source/CodeBuddyAvatar/CodeBuddyAvatar.Build.cs'),
    'utf8',
  );
  for (const dependency of ['Engine', 'AudioMixer', 'Json', 'WebSockets']) {
    assert(build.includes(`"${dependency}"`), `missing Unreal module dependency: ${dependency}`);
  }

  const subsystem = await readFile(
    path.join(pluginRoot, 'Source/CodeBuddyAvatar/Private/CodeBuddyAvatarSubsystem.cpp'),
    'utf8',
  );
  for (const invariant of [
    'SetTextMessageMemoryLimit',
    'CODEBUDDY_AVATAR_TOKEN',
    'avatar.renderer.hello',
    'avatar.renderer.status',
    'avatar.sync',
    'audioReplay',
    'ProtocolMaxChunkBytes = 48 * 1024',
    'Sequence != LastSequence + 1',
    'FBase64::Decode',
    'FCodeBuddyWavParser::ParsePcm16',
    'USoundWaveProcedural',
    'SetSampleRate(static_cast<uint32>(Prepared.Wav.SampleRate), false)',
    'bTurnCompletionReceived',
    'FinalizeCompletedTurn',
    'if (!bSpeechStartReceived && !ActiveAudioComponent)',
    'if (bSpeechStartReceived && !ActiveTurnId.IsEmpty())',
    'avatar.speech.interrupted',
  ]) {
    assert(subsystem.includes(invariant), `missing renderer contract invariant: ${invariant}`);
  }

  const config = await readFile(path.join(pluginRoot, 'Config/DefaultCodeBuddyAvatar.ini'), 'utf8');
  assert(!/(?:token|secret|api[_-]?key)\s*=/i.test(config), 'plugin config must not persist credentials');
  assert(config.includes('bAudioDrivenAnimationEnabled=False'), 'animation capability must fail closed');

  const deployment = await readFile(
    path.join(repoRoot, 'scripts', 'unreal', 'Invoke-CodeBuddyAvatarV5.ps1'),
    'utf8',
  );
  for (const invariant of [
    "[ValidateSet('Stage', 'Validate', 'Promote')]",
    "Get-Process UnrealEditor",
    "Get-FileHash",
    "Get-RelevantProcessMap",
    "Get-NetFirewallProfile",
    "Start-Process",
    "-PassThru -Wait",
    "CodeBuddy.Avatar",
  ]) {
    assert(deployment.includes(invariant), `missing deployment safety invariant: ${invariant}`);
  }
}

async function buildManifest(files) {
  const entries = [];
  for (const relative of files) {
    const absolute = path.join(pluginRoot, relative);
    const info = await stat(absolute);
    assert(info.size <= 2 * 1024 * 1024, `source bundle file exceeds 2 MiB: ${relative}`);
    entries.push({ path: relative, size: info.size, sha256: await sha256(absolute) });
  }
  return {
    schemaVersion: 1,
    bundleId: 'metahuman-split-a.5',
    protocolVersion: 1,
    pluginVersion: '0.5.0-split-a.5',
    files: entries,
  };
}

async function main() {
  const files = await walk(pluginRoot);
  await verifyContracts(files);
  const expected = await buildManifest(files);
  if (writeManifest) {
    await writeFile(manifestPath, `${JSON.stringify(expected, null, 2)}\n`, 'utf8');
  } else {
    const actual = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert(JSON.stringify(actual) === JSON.stringify(expected), 'bundle-manifest.json is stale');
  }
  const result = {
    ok: true,
    bundleId: expected.bundleId,
    files: expected.files.length,
    bytes: expected.files.reduce((sum, file) => sum + file.size, 0),
    manifest: path.relative(repoRoot, manifestPath),
  };
  if (jsonOutput) process.stdout.write(`${JSON.stringify(result)}\n`);
  else process.stdout.write(`CodeBuddyAvatar ${result.bundleId}: ${result.files} files verified (${result.bytes} bytes).\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (jsonOutput) process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  else process.stderr.write(`CodeBuddyAvatar verification failed: ${message}\n`);
  process.exitCode = 1;
});
