/**
 * .NET / C# profiler.
 */

import fs from 'fs';
import path from 'path';
import type { LanguageProfiler } from './language-profiler.js';
import type { ProfilingContext } from '../types.js';
import type { FsHelpers } from '../fs-helpers.js';

export const dotnetProfiler: LanguageProfiler = {
  id: 'dotnet',

  detect(ctx: ProfilingContext, fsh: FsHelpers): boolean {
    const csprojFiles = fsh.glob(ctx.cwd, '*.csproj');
    const slnFiles = fsh.glob(ctx.cwd, '*.sln');

    // Also check one level deep for csproj (solution with project folders)
    let deepCsproj: string[] = [];
    if (csprojFiles.length === 0 && slnFiles.length > 0) {
      try {
        for (const entry of fs.readdirSync(ctx.cwd, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            const sub = fs.readdirSync(path.join(ctx.cwd, entry.name)).filter(f => f.endsWith('.csproj'));
            deepCsproj.push(...sub.map(f => path.join(entry.name, f)));
          }
        }
      } catch { /* ignore */ }
    }
    const allCsproj = [...csprojFiles, ...deepCsproj];
    const hasDotNet = allCsproj.length > 0 || slnFiles.length > 0;
    if (!hasDotNet) return false;

    ctx.allCsproj = allCsproj;
    ctx.slnFiles = slnFiles;
    ctx.languages.push('C#');
    ctx.packageManager = 'dotnet';
    ctx.commands.test = ctx.commands.test || 'dotnet test';
    ctx.commands.build = ctx.commands.build || 'dotnet build';
    ctx.commands.format = ctx.commands.format || 'dotnet format';

    // Pick the main csproj for configMtime
    const mainCsproj = csprojFiles[0] || deepCsproj[0];
    if (mainCsproj) {
      const csprojPath = path.join(ctx.cwd, mainCsproj);
      ctx.configMtime = ctx.configMtime || fsh.mtime(csprojPath);
    }

    return true;
  },

  profile(ctx: ProfilingContext, fsh: FsHelpers): void {
    const allCsproj = ctx.allCsproj || [];
    const slnFiles = ctx.slnFiles || [];
    const csprojFiles = allCsproj.filter(f => !f.includes(path.sep) && !f.includes('/'));
    const deepCsproj = allCsproj.filter(f => f.includes(path.sep) || f.includes('/'));

    if (!ctx.languages.includes('C#')) return;
    if (ctx.projectName) return; // Node already set it

    // Parse csproj XML for project metadata
    const mainCsproj = csprojFiles[0] || deepCsproj[0];
    if (mainCsproj) {
      try {
        const xml = fs.readFileSync(path.join(ctx.cwd, mainCsproj), 'utf-8');
        // Project name from csproj filename or <AssemblyName>/<RootNamespace>
        const assemblyMatch = xml.match(/<AssemblyName>([^<]+)<\/AssemblyName>/);
        const namespaceMatch = xml.match(/<RootNamespace>([^<]+)<\/RootNamespace>/);
        ctx.projectName = assemblyMatch?.[1] || namespaceMatch?.[1] || mainCsproj.replace(/\.csproj$/, '').replace(/^.*[\\/]/, '');
        // Description
        const descMatch = xml.match(/<Description>([^<]+)<\/Description>/);
        if (descMatch) ctx.projectDescription = descMatch[1];
        // Target framework
        const tfmMatch = xml.match(/<TargetFramework>([^<]+)<\/TargetFramework>/);
        const tfmsMatch = xml.match(/<TargetFrameworks>([^<]+)<\/TargetFrameworks>/);
        const tfm = tfmMatch?.[1] || tfmsMatch?.[1]?.split(';')[0];
        if (tfm) {
          if (tfm.startsWith('net8')) ctx.buildTool = '.NET 8';
          else if (tfm.startsWith('net9')) ctx.buildTool = '.NET 9';
          else if (tfm.startsWith('net7')) ctx.buildTool = '.NET 7';
          else if (tfm.startsWith('net6')) ctx.buildTool = '.NET 6';
          else if (tfm.startsWith('netstandard')) ctx.buildTool = '.NET Standard';
          else if (tfm.startsWith('net4')) ctx.buildTool = '.NET Framework';
          else ctx.buildTool = tfm;
        }
        // ASP.NET / framework detection from SDK or PackageReferences
        const sdkMatch = xml.match(/<Project\s+Sdk="([^"]+)"/);
        const sdk = sdkMatch?.[1] || '';
        if (xml.includes('Avalonia') || xml.includes('avalonia')) {
          // Detect Avalonia target platforms from all csproj files
          const platforms: string[] = [];
          for (const cp of allCsproj) {
            try {
              const cpXml = fs.readFileSync(path.join(ctx.cwd, cp), 'utf-8');
              const cpName = cp.toLowerCase();
              if (cpXml.includes('Avalonia.Desktop') || cpName.includes('desktop')) platforms.push('Desktop');
              if (cpXml.includes('Avalonia.Browser') || cpName.includes('browser') || cpName.includes('wasm')) platforms.push('Browser');
              if (cpXml.includes('Avalonia.iOS') || cpName.includes('ios')) platforms.push('iOS');
              if (cpXml.includes('Avalonia.Android') || cpName.includes('android') || cpName.includes('droid')) platforms.push('Android');
            } catch { /* ignore */ }
          }
          const uniquePlatforms = [...new Set(platforms)];
          ctx.framework = uniquePlatforms.length > 0
            ? `Avalonia UI (${uniquePlatforms.join(', ')})`
            : 'Avalonia UI';
        }
        else if (sdk.includes('Web') || xml.includes('Microsoft.AspNetCore')) ctx.framework = 'ASP.NET Core';
        else if (xml.includes('Microsoft.Maui') || sdk.includes('Maui')) ctx.framework = '.NET MAUI';
        else if (xml.includes('Microsoft.NET.Sdk.BlazorWebAssembly') || xml.includes('Blazor')) ctx.framework = 'Blazor';
        else if (xml.includes('Microsoft.WindowsDesktop') || xml.includes('WPF')) ctx.framework = 'WPF';
        else if (xml.includes('WinForms') || xml.includes('WindowsForms')) ctx.framework = 'WinForms';
        else if (sdk === 'Microsoft.NET.Sdk.Worker') ctx.framework = '.NET Worker Service';
        // Key NuGet packages
        const pkgRefs = [...xml.matchAll(/<PackageReference\s+Include="([^"]+)"/g)];
        const dotnetNotable = new Set([
          'Microsoft.EntityFrameworkCore', 'Dapper', 'MediatR', 'AutoMapper',
          'FluentValidation', 'Serilog', 'NLog', 'Polly', 'MassTransit',
          'Swashbuckle.AspNetCore', 'Newtonsoft.Json', 'SignalR',
          'xunit', 'NUnit', 'MSTest', 'FluentAssertions', 'Moq', 'NSubstitute',
          'Hangfire', 'Quartz', 'StackExchange.Redis', 'Npgsql',
          'Microsoft.Extensions.DependencyInjection', 'Grpc.AspNetCore',
          'Avalonia', 'Avalonia.Desktop', 'Avalonia.Browser', 'Avalonia.iOS', 'Avalonia.Android',
          'ReactiveUI', 'ReactiveUI.Fody', 'CommunityToolkit.Mvvm',
          'Avalonia.ReactiveUI', 'Avalonia.Diagnostics',
          'FluentAvalonia', 'Material.Avalonia', 'Semi.Avalonia',
          'Dock.Avalonia', 'AvaloniaEdit', 'Avalonia.Svg.Skia',
        ]);
        for (const [, pkg] of pkgRefs) {
          if (pkg === undefined) continue;
          const match = [...dotnetNotable].find(n => pkg.startsWith(n));
          if (match && !ctx.keyDependencies.includes(match)) ctx.keyDependencies.push(match);
        }
        // Test framework from packages
        if (!ctx.testFramework) {
          if (pkgRefs.some(([, p]) => (p ?? '').startsWith('xunit'))) ctx.testFramework = 'xUnit';
          else if (pkgRefs.some(([, p]) => (p ?? '').startsWith('NUnit'))) ctx.testFramework = 'NUnit';
          else if (pkgRefs.some(([, p]) => (p ?? '').startsWith('MSTest') || (p ?? '').includes('Microsoft.VisualStudio.TestTools'))) ctx.testFramework = 'MSTest';
        }
        // Database detection from EF providers (stored for infra section)
        // Linter for .NET
        if (!ctx.linter) {
          if (pkgRefs.some(([, p]) => (p ?? '').includes('StyleCop'))) ctx.linter = 'StyleCop';
          else if (pkgRefs.some(([, p]) => (p ?? '').includes('Roslynator'))) ctx.linter = 'Roslynator';
          else if (fsh.exists(path.join(ctx.cwd, '.editorconfig'))) ctx.linter = '.editorconfig + analyzers';
        }
        // Formatter for .NET
        if (!ctx.formatter) ctx.formatter = 'dotnet format';
        // Conventions
        if (!ctx.conventions.naming) ctx.conventions.naming = 'PascalCase (C#)';
      } catch { /* malformed csproj */ }
    }

    // Scan ALL csproj files for test framework + additional deps
    if (!ctx.testFramework && allCsproj.length > 1) {
      for (const csproj of allCsproj) {
        try {
          const xml = fs.readFileSync(path.join(ctx.cwd, csproj), 'utf-8');
          const pkgRefs = [...xml.matchAll(/<PackageReference\s+Include="([^"]+)"/g)];
          if (pkgRefs.some(([, p]) => (p ?? '').startsWith('xunit'))) { ctx.testFramework = 'xUnit'; break; }
          else if (pkgRefs.some(([, p]) => (p ?? '').startsWith('NUnit'))) { ctx.testFramework = 'NUnit'; break; }
          else if (pkgRefs.some(([, p]) => (p ?? '').startsWith('MSTest') || (p ?? '').includes('Microsoft.VisualStudio.TestTools'))) { ctx.testFramework = 'MSTest'; break; }
        } catch { /* ignore */ }
      }
    }

    // Solution-level detection
    const firstSln = slnFiles[0];
    if (firstSln !== undefined) {
      const slnPath = path.join(ctx.cwd, firstSln);
      try {
        const slnContent = fs.readFileSync(slnPath, 'utf-8');
        const projectMatches = slnContent.match(/^Project\(/gm);
        if (projectMatches && projectMatches.length > 1) {
          ctx.monorepo = true;
        }
      } catch { /* ignore */ }
      ctx.configMtime = ctx.configMtime || fsh.mtime(slnPath);
    }

    // .NET entry points
    if (ctx.entryPoints.length === 0) {
      for (const f of ['Program.cs', 'Startup.cs', 'App.xaml.cs']) {
        if (fsh.exists(path.join(ctx.cwd, f))) { ctx.entryPoints.push(f); break; }
        for (const csproj of allCsproj) {
          const dir = path.dirname(csproj);
          if (dir !== '.' && fsh.exists(path.join(ctx.cwd, dir, f))) {
            ctx.entryPoints.push(`${dir}/${f}`); break;
          }
        }
      }
    }
  },
};
