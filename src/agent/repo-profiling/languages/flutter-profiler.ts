/**
 * Flutter / Dart profiler.
 */

import fs from 'fs';
import path from 'path';
import type { LanguageProfiler } from './language-profiler.js';
import type { ProfilingContext } from '../types.js';
import type { FsHelpers } from '../fs-helpers.js';

export const flutterProfiler: LanguageProfiler = {
  id: 'flutter',

  detect(ctx: ProfilingContext, fsh: FsHelpers): boolean {
    const pubspecPath = path.join(ctx.cwd, 'pubspec.yaml');
    if (!fsh.exists(pubspecPath)) return false;

    ctx.languages.push('Dart');
    ctx.configMtime = ctx.configMtime || fsh.mtime(pubspecPath);

    // Determine if Flutter or pure Dart
    let pubContent = '';
    try {
      pubContent = fs.readFileSync(pubspecPath, 'utf-8');
    } catch { /* ignore */ }

    const isFlutter = pubContent.includes('flutter:') || fsh.exists(path.join(ctx.cwd, 'android')) || fsh.exists(path.join(ctx.cwd, 'ios'));

    if (isFlutter) {
      ctx.packageManager = ctx.packageManager || 'flutter';
      ctx.commands.test = ctx.commands.test || 'flutter test';
      ctx.commands.build = ctx.commands.build || 'flutter build';
      ctx.commands.lint = ctx.commands.lint || 'dart analyze';
      ctx.commands.format = ctx.commands.format || 'dart format .';
    } else {
      ctx.packageManager = ctx.packageManager || 'dart';
      ctx.commands.test = ctx.commands.test || 'dart test';
      ctx.commands.build = ctx.commands.build || 'dart compile exe';
      ctx.commands.lint = ctx.commands.lint || 'dart analyze';
      ctx.commands.format = ctx.commands.format || 'dart format .';
    }

    return true;
  },

  profile(ctx: ProfilingContext, fsh: FsHelpers): void {
    const pubspecPath = path.join(ctx.cwd, 'pubspec.yaml');
    if (!fsh.exists(pubspecPath)) return;

    let pubContent = '';
    try {
      pubContent = fs.readFileSync(pubspecPath, 'utf-8');
    } catch { return; }

    // Name + description (simple YAML parsing)
    if (!ctx.projectName) {
      const nameMatch = pubContent.match(/^name:\s*(\S+)/m);
      if (nameMatch) ctx.projectName = nameMatch[1];
    }
    if (!ctx.projectDescription) {
      const descMatch = pubContent.match(/^description:\s*['"]?(.+?)['"]?\s*$/m);
      if (descMatch) ctx.projectDescription = descMatch[1];
    }

    // SDK version
    const sdkMatch = pubContent.match(/sdk:\s*['"]?>=?\s*([0-9.]+)/);
    if (sdkMatch) ctx.nodeVersion = ctx.nodeVersion || `Dart >= ${sdkMatch[1]}`;

    // Platform detection from directory structure
    const isFlutter = ctx.packageManager === 'flutter';
    if (isFlutter) {
      const platforms: string[] = [];
      if (fsh.exists(path.join(ctx.cwd, 'android'))) platforms.push('Android');
      if (fsh.exists(path.join(ctx.cwd, 'ios'))) platforms.push('iOS');
      if (fsh.exists(path.join(ctx.cwd, 'web'))) platforms.push('Web');
      if (fsh.exists(path.join(ctx.cwd, 'macos'))) platforms.push('macOS');
      if (fsh.exists(path.join(ctx.cwd, 'linux'))) platforms.push('Linux');
      if (fsh.exists(path.join(ctx.cwd, 'windows'))) platforms.push('Windows');

      if (!ctx.framework) {
        ctx.framework = platforms.length > 0
          ? `Flutter (${platforms.join(', ')})`
          : 'Flutter';
      }
    }

    // Dependencies parsing (simple YAML: lines under dependencies:)
    const depsSection = pubContent.match(/^dependencies:\s*\n((?:[ \t]+\S.*\n?)*)/m);
    const devDepsSection = pubContent.match(/^dev_dependencies:\s*\n((?:[ \t]+\S.*\n?)*)/m);
    const allDeps = new Set<string>();

    for (const section of [depsSection?.[1], devDepsSection?.[1]]) {
      if (!section) continue;
      for (const line of section.split('\n')) {
        const m = line.match(/^\s+([a-zA-Z_][a-zA-Z0-9_]*):/);
        const dep = m?.[1];
        if (dep) allDeps.add(dep);
      }
    }

    // Key dependencies
    const flutterNotable = new Set([
      'flutter_bloc', 'bloc', 'flutter_riverpod', 'riverpod', 'provider',
      'get_it', 'injectable', 'dio', 'http', 'chopper', 'retrofit',
      'sqflite', 'hive', 'isar', 'drift', 'objectbox', 'floor',
      'firebase_core', 'firebase_auth', 'cloud_firestore', 'firebase_messaging',
      'go_router', 'auto_route', 'beamer',
      'freezed', 'json_serializable', 'built_value',
      'flutter_hooks', 'get', 'mobx', 'redux',
      'flame', 'rive', 'lottie',
      'flutter_test', 'integration_test', 'mockito', 'bloc_test',
      'very_good_analysis', 'flutter_lints', 'lint',
      'supabase_flutter', 'appwrite',
    ]);
    for (const dep of allDeps) {
      if (flutterNotable.has(dep) && !ctx.keyDependencies.includes(dep)) {
        ctx.keyDependencies.push(dep);
      }
    }

    // Framework refinement
    if (!ctx.framework || ctx.framework.startsWith('Flutter')) {
      if (allDeps.has('flame')) ctx.framework = (ctx.framework || 'Flutter') + ' + Flame (game)';
    }

    // State management as build tool hint
    if (!ctx.buildTool) {
      if (allDeps.has('flutter_bloc') || allDeps.has('bloc')) ctx.buildTool = 'BLoC';
      else if (allDeps.has('flutter_riverpod') || allDeps.has('riverpod')) ctx.buildTool = 'Riverpod';
      else if (allDeps.has('provider')) ctx.buildTool = 'Provider';
      else if (allDeps.has('get')) ctx.buildTool = 'GetX';
    }

    // Test framework
    if (!ctx.testFramework) {
      if (allDeps.has('flutter_test') || isFlutter) ctx.testFramework = 'flutter_test';
      else ctx.testFramework = 'dart test';
    }

    // Database detection
    const dartDbMap: Record<string, string> = {
      'sqflite': 'SQLite', 'drift': 'SQLite (Drift)', 'floor': 'SQLite (Floor)',
      'hive': 'Hive', 'isar': 'Isar', 'objectbox': 'ObjectBox',
      'cloud_firestore': 'Firestore', 'firebase_database': 'Firebase RTDB',
      'supabase_flutter': 'Supabase (PostgreSQL)',
    };
    const dbSeen = new Set(ctx.databases);
    for (const [dep, label] of Object.entries(dartDbMap)) {
      if (allDeps.has(dep) && !dbSeen.has(label)) { ctx.databases.push(label); dbSeen.add(label); }
    }

    // Conventions
    if (!ctx.conventions.naming) ctx.conventions.naming = 'snake_case (Dart)';
    if (!ctx.linter) {
      if (allDeps.has('very_good_analysis')) ctx.linter = 'very_good_analysis';
      else if (allDeps.has('flutter_lints')) ctx.linter = 'flutter_lints';
      else ctx.linter = 'dart analyze';
    }
    if (!ctx.formatter) ctx.formatter = 'dart format';

    // Entry points
    if (ctx.entryPoints.length === 0) {
      for (const f of ['lib/main.dart', 'bin/main.dart', 'lib/app.dart']) {
        if (fsh.exists(path.join(ctx.cwd, f))) { ctx.entryPoints.push(f); break; }
      }
    }
  },
};
