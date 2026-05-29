/**
 * Kotlin / Android / Gradle profiler.
 *
 * Detects Gradle-based projects (Android, Kotlin Multiplatform, pure Kotlin/JVM).
 */

import fs from 'fs';
import path from 'path';
import type { LanguageProfiler } from './language-profiler.js';
import type { ProfilingContext } from '../types.js';
import type { FsHelpers } from '../fs-helpers.js';

export const kotlinProfiler: LanguageProfiler = {
  id: 'kotlin',

  detect(ctx: ProfilingContext, fsh: FsHelpers): boolean {
    const buildGradleKts = path.join(ctx.cwd, 'build.gradle.kts');
    const buildGradle = path.join(ctx.cwd, 'build.gradle');
    const settingsGradleKts = path.join(ctx.cwd, 'settings.gradle.kts');
    const settingsGradle = path.join(ctx.cwd, 'settings.gradle');

    const hasGradle = fsh.exists(buildGradleKts) || fsh.exists(buildGradle)
      || fsh.exists(settingsGradleKts) || fsh.exists(settingsGradle);
    if (!hasGradle) return false;

    // Read build file to distinguish Kotlin from Java
    let buildContent = '';
    const buildPath = fsh.exists(buildGradleKts) ? buildGradleKts : buildGradle;
    try {
      buildContent = fs.readFileSync(buildPath, 'utf-8');
    } catch { /* ignore */ }

    // Also read settings for project name and module detection
    let settingsContent = '';
    const settingsPath = fsh.exists(settingsGradleKts) ? settingsGradleKts : settingsGradle;
    try {
      if (fsh.exists(settingsPath)) settingsContent = fs.readFileSync(settingsPath, 'utf-8');
    } catch { /* ignore */ }

    const isKotlin = buildContent.includes('kotlin') || buildContent.includes('.kts')
      || fsh.exists(path.join(ctx.cwd, 'src', 'main', 'kotlin'));
    const isAndroid = buildContent.includes('com.android') || buildContent.includes('android {')
      || fsh.exists(path.join(ctx.cwd, 'app', 'src', 'main', 'AndroidManifest.xml'));

    if (isKotlin) {
      ctx.languages.push('Kotlin');
    } else {
      ctx.languages.push('Java');
    }
    if (isAndroid && !ctx.languages.includes('Kotlin')) {
      ctx.languages.push('Kotlin'); // Android projects are overwhelmingly Kotlin now
    }

    ctx.packageManager = ctx.packageManager || 'gradle';

    // Use gradlew if present
    const wrapper = fsh.exists(path.join(ctx.cwd, 'gradlew')) ? './gradlew' : 'gradle';
    ctx.commands.test = ctx.commands.test || `${wrapper} test`;
    ctx.commands.build = ctx.commands.build || (isAndroid ? `${wrapper} assembleDebug` : `${wrapper} build`);
    ctx.commands.lint = ctx.commands.lint || (isAndroid ? `${wrapper} lint` : `${wrapper} detekt`);

    ctx.configMtime = ctx.configMtime || fsh.mtime(buildPath);

    return true;
  },

  profile(ctx: ProfilingContext, fsh: FsHelpers): void {
    if (!ctx.languages.includes('Kotlin') && !ctx.languages.includes('Java')) return;

    const buildGradleKts = path.join(ctx.cwd, 'build.gradle.kts');
    const buildGradle = path.join(ctx.cwd, 'build.gradle');
    const buildPath = fsh.exists(buildGradleKts) ? buildGradleKts : buildGradle;

    let buildContent = '';
    try {
      buildContent = fs.readFileSync(buildPath, 'utf-8');
    } catch { return; }

    // Also read app/build.gradle.kts for Android projects
    let appBuildContent = '';
    for (const appBuild of ['app/build.gradle.kts', 'app/build.gradle']) {
      const p = path.join(ctx.cwd, appBuild);
      if (fsh.exists(p)) {
        try { appBuildContent = fs.readFileSync(p, 'utf-8'); } catch { /* ignore */ }
        break;
      }
    }
    const allBuild = buildContent + '\n' + appBuildContent;

    // Project name from settings
    if (!ctx.projectName) {
      const settingsGradleKts = path.join(ctx.cwd, 'settings.gradle.kts');
      const settingsGradle = path.join(ctx.cwd, 'settings.gradle');
      const settingsPath = fsh.exists(settingsGradleKts) ? settingsGradleKts : settingsGradle;
      if (fsh.exists(settingsPath)) {
        try {
          const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
          const nameMatch = settingsContent.match(/rootProject\.name\s*=\s*"([^"]+)"/);
          if (nameMatch) ctx.projectName = nameMatch[1];

          // Monorepo detection from included modules
          const includes = [...settingsContent.matchAll(/include\s*\(\s*"([^"]+)"/g)];
          if (includes.length > 1) ctx.monorepo = true;
        } catch { /* ignore */ }
      }
    }

    // Android SDK / compile version
    const isAndroid = allBuild.includes('com.android') || allBuild.includes('android {');
    if (isAndroid) {
      const compileSdk = allBuild.match(/compileSdk\s*[=:]\s*(\d+)/);
      const minSdk = allBuild.match(/minSdk\s*[=:]\s*(\d+)/);
      if (compileSdk) {
        ctx.buildTool = `Android SDK ${compileSdk[1]}`;
        if (minSdk) ctx.buildTool += ` (min ${minSdk[1]})`;
      }
    }

    // Kotlin version
    const kotlinVer = allBuild.match(/kotlin.*version\s*[=:]\s*"([^"]+)"/);
    if (kotlinVer && !ctx.nodeVersion) ctx.nodeVersion = `Kotlin ${kotlinVer[1]}`;

    // Framework detection
    if (!ctx.framework) {
      const isKMP = allBuild.includes('multiplatform') || allBuild.includes('KotlinMultiplatform');
      const isCompose = allBuild.includes('compose') || allBuild.includes('Compose');

      if (isKMP && isCompose) ctx.framework = 'Compose Multiplatform';
      else if (isKMP) ctx.framework = 'Kotlin Multiplatform';
      else if (isCompose && isAndroid) ctx.framework = 'Jetpack Compose';
      else if (isAndroid) ctx.framework = 'Android';
      else if (allBuild.includes('ktor')) ctx.framework = 'Ktor';
      else if (allBuild.includes('spring') || allBuild.includes('springframework')) ctx.framework = 'Spring Boot (Kotlin)';
    }

    // KMP platform detection
    if (ctx.framework?.includes('Multiplatform') || ctx.framework?.includes('Compose Multiplatform')) {
      const platforms: string[] = [];
      if (allBuild.includes('android') || fsh.exists(path.join(ctx.cwd, 'androidApp'))) platforms.push('Android');
      if (allBuild.includes('ios') || fsh.exists(path.join(ctx.cwd, 'iosApp'))) platforms.push('iOS');
      if (allBuild.includes('desktop') || allBuild.includes('jvm')) platforms.push('Desktop');
      if (allBuild.includes('js(') || allBuild.includes('wasmJs')) platforms.push('Web');
      if (platforms.length > 0) {
        ctx.framework = `${ctx.framework} (${platforms.join(', ')})`;
      }
    }

    // Key dependencies from build files
    const gradleNotable = new Set([
      'ktor', 'exposed', 'koin', 'dagger', 'hilt',
      'retrofit', 'okhttp', 'moshi', 'gson', 'kotlinx-serialization',
      'coroutines', 'flow', 'room', 'datastore',
      'navigation', 'paging', 'lifecycle', 'viewmodel',
      'coil', 'glide', 'picasso',
      'timber', 'logback', 'slf4j',
      'detekt', 'ktlint', 'spotless',
      'junit', 'mockk', 'kotest', 'turbine', 'robolectric',
      'firebase', 'supabase',
      'sqldelight', 'realm',
    ]);
    // Match implementation("...group:artifact...") patterns
    const depMatches = [...allBuild.matchAll(/(?:implementation|api|testImplementation)\s*\(\s*"[^"]*:([^":]+)/g)];
    for (const [, artifact] of depMatches) {
      if (artifact === undefined) continue;
      const lower = artifact.toLowerCase();
      for (const notable of gradleNotable) {
        if (lower.includes(notable) && !ctx.keyDependencies.includes(artifact)) {
          ctx.keyDependencies.push(artifact);
          break;
        }
      }
    }
    // Also match plugin IDs
    const pluginMatches = [...allBuild.matchAll(/id\s*\(\s*"([^"]+)"\s*\)/g)];
    for (const [, plugin] of pluginMatches) {
      if (plugin === undefined) continue;
      if (plugin.includes('hilt') && !ctx.keyDependencies.includes('hilt')) ctx.keyDependencies.push('hilt');
      if (plugin.includes('compose') && !ctx.keyDependencies.includes('compose')) ctx.keyDependencies.push('compose');
      if (plugin.includes('sqldelight') && !ctx.keyDependencies.includes('sqldelight')) ctx.keyDependencies.push('sqldelight');
    }

    // Database detection
    const gradleDbMap: Record<string, string> = {
      'room': 'SQLite (Room)', 'sqldelight': 'SQLDelight',
      'realm': 'Realm', 'exposed': 'Exposed (SQL)',
      'firebase': 'Firebase', 'datastore': 'DataStore',
    };
    const dbSeen = new Set(ctx.databases);
    for (const [keyword, label] of Object.entries(gradleDbMap)) {
      if (allBuild.toLowerCase().includes(keyword) && !dbSeen.has(label)) {
        ctx.databases.push(label); dbSeen.add(label);
      }
    }

    // Test framework
    if (!ctx.testFramework) {
      if (allBuild.includes('kotest')) ctx.testFramework = 'Kotest';
      else if (allBuild.includes('mockk')) ctx.testFramework = 'JUnit + MockK';
      else if (allBuild.includes('robolectric')) ctx.testFramework = 'JUnit + Robolectric';
      else ctx.testFramework = 'JUnit';
    }

    // Linter
    if (!ctx.linter) {
      if (allBuild.includes('detekt') || fsh.exists(path.join(ctx.cwd, 'detekt.yml'))) ctx.linter = 'Detekt';
      else if (allBuild.includes('ktlint') || fsh.exists(path.join(ctx.cwd, '.editorconfig'))) ctx.linter = 'ktlint';
    }
    if (!ctx.formatter) {
      if (allBuild.includes('spotless')) ctx.formatter = 'Spotless';
      else if (allBuild.includes('ktlint')) ctx.formatter = 'ktlint';
    }

    // Conventions
    if (!ctx.conventions.naming) {
      ctx.conventions.naming = ctx.languages.includes('Kotlin') ? 'camelCase (Kotlin)' : 'camelCase (Java)';
    }

    // Entry points
    if (ctx.entryPoints.length === 0) {
      const candidates = isAndroid
        ? ['app/src/main/java', 'app/src/main/kotlin']
        : ['src/main/kotlin', 'src/main/java'];
      for (const dir of candidates) {
        if (fsh.exists(path.join(ctx.cwd, dir))) {
          // Find main Activity or Application class
          try {
            const walk = (d: string): string | undefined => {
              for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                if (entry.isDirectory()) {
                  const r = walk(path.join(d, entry.name));
                  if (r) return r;
                } else if (entry.name === 'MainActivity.kt' || entry.name === 'Application.kt' || entry.name === 'Main.kt') {
                  return path.relative(ctx.cwd, path.join(d, entry.name)).replace(/\\/g, '/');
                }
              }
              return undefined;
            };
            const main = walk(path.join(ctx.cwd, dir));
            if (main) { ctx.entryPoints.push(main); break; }
          } catch { /* ignore */ }
        }
      }
    }
  },
};
