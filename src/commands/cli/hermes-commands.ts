/**
 * Hermes Agent CLI diagnostics.
 *
 * Exposes the native Code Buddy profile that maps Hermes Agent ideas
 * onto Fleet toolsets, skills, memory, session search, scheduling and
 * delegation.
 */

import fs from 'fs';
import path from 'path';
import type { Command } from 'commander';

import {
  FLEET_DISPATCH_PROFILES,
  normalizeDispatchProfile,
} from '../../fleet/dispatch-profile.js';
import {
  buildHermesAgentProfile,
  buildHermesIntegrationPlan,
  buildHermesAgentSystemPrompt,
  renderHermesIntegrationPlanMarkdown,
} from '../../agent/hermes-agent-profile.js';
import { buildHermesAgentDiagnostics } from '../../agent/hermes-agent-diagnostics.js';
import {
  buildHermesHookLifecycleManifest,
  renderHermesHookLifecycleManifest,
} from '../../hooks/hermes-lifecycle-hooks.js';

interface HermesCommandOptions {
  json?: boolean;
  markdown?: boolean;
  planOutput?: string;
}

type HermesPlanOutputFormat = 'text' | 'json' | 'markdown';

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

function formatAllowList(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'all';
}

function formatOk(ok: boolean): string {
  return ok ? 'ok' : 'needs attention';
}

function inferHermesPlanOutputFormat(options: HermesCommandOptions): HermesPlanOutputFormat {
  if (options.json) return 'json';
  if (options.markdown) return 'markdown';

  const ext = options.planOutput ? path.extname(options.planOutput).toLowerCase() : '';
  if (ext === '.json') return 'json';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  return 'text';
}

function renderHermesPlanJson(profileArg: string, plan: ReturnType<typeof buildHermesIntegrationPlan>): string {
  return JSON.stringify({
    requestedProfile: profileArg,
    plan,
  }, null, 2);
}

function renderHermesPlanText(plan: ReturnType<typeof buildHermesIntegrationPlan>): string {
  const lines = [
    `Hermes integration plan (${plan.dispatchProfile}, ${plan.toolsetId}):`,
    `  ${plan.summary}`,
    `  Plan schema version: ${plan.planSchemaVersion}`,
    `  Generated: ${plan.generatedAt}`,
    `  Recommended next command: ${plan.recommendedNextCommand}`,
    `  Surfaces: ${formatList(plan.surfaceIds)}`,
  ];

  lines.push('');
  lines.push('Interaction surfaces:');
  for (const surface of plan.interactionSurfaces) {
    lines.push(`  ${surface.label}: ${surface.entrypoint}`);
    lines.push(`    Primary action: ${surface.primaryAction}`);
    lines.push(`    Consumes: ${formatList(surface.consumes)}`);
    lines.push(`    Produces: ${formatList(surface.produces)}`);
    if (surface.secondaryActions.length > 0) {
      lines.push(`    Secondary actions: ${formatList(surface.secondaryActions)}`);
    }
  }

  for (const item of plan.items) {
    lines.push('');
    lines.push(item.title);
    lines.push(`  Kind: ${item.kind}`);
    lines.push(`  Risk: ${item.risk}`);
    lines.push(`  Surface: ${item.nativeSurfaceId}`);
    lines.push(`  Command: ${item.command}`);
    if (item.expectedArtifacts.length > 0) {
      lines.push(`  Expected artifacts: ${formatList(item.expectedArtifacts)}`);
    }
    lines.push(`  Acceptance criteria: ${formatList(item.acceptanceCriteria)}`);
    lines.push(`  Purpose: ${item.purpose}`);
    lines.push(`  Done when: ${item.doneWhen}`);
  }

  return lines.join('\n');
}

function renderHermesPlanOutput(
  profileArg: string,
  plan: ReturnType<typeof buildHermesIntegrationPlan>,
  format: HermesPlanOutputFormat,
): string {
  if (format === 'json') return renderHermesPlanJson(profileArg, plan);
  if (format === 'markdown') return renderHermesIntegrationPlanMarkdown(plan);
  return renderHermesPlanText(plan);
}

function writeHermesPlanOutput(outputPath: string, content: string): void {
  const outputDir = path.dirname(path.resolve(outputPath));
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf-8');
}

export function registerHermesCommands(program: Command): void {
  const hermes = program
    .command('hermes')
    .description('Inspect the native Hermes-inspired Code Buddy agent profile');

  hermes
    .command('profile')
    .description('Show the Hermes Agent profile mapped onto Code Buddy primitives')
    .argument('[dispatchProfile]', `default Fleet profile (${FLEET_DISPATCH_PROFILES.join(', ')})`, 'balanced')
    .option('--json', 'output JSON')
    .action((profileArg: string, options: HermesCommandOptions) => {
      const dispatchProfile = normalizeDispatchProfile(profileArg);
      const profile = buildHermesAgentProfile(dispatchProfile);

      if (options.json) {
        console.log(JSON.stringify({
          requestedProfile: profileArg,
          profile,
        }, null, 2));
        return;
      }

      console.log(`\nHermes Agent profile: ${profile.name}`);
      if (profileArg !== dispatchProfile) {
        console.log(`  Requested: ${profileArg} (normalized to balanced)`);
      }
      console.log(`  ID: ${profile.id}`);
      console.log(`  Default Fleet profile: ${profile.defaultDispatchProfile}`);
      console.log(`  Description: ${profile.description}`);
      console.log('\nDispatch profile selection:');
      for (const guidance of profile.dispatchProfileGuidance) {
        console.log(`  ${guidance.profile}: ${guidance.useWhen}`);
      }
      console.log('\nNative surfaces:');
      for (const surface of profile.nativeSurfaces) {
        console.log(`  ${surface.label}: ${surface.codeBuddySurface}`);
        console.log(`    ${surface.purpose}`);
      }
      console.log('\nToolsets:');
      for (const toolset of profile.toolsets) {
        console.log(`  ${toolset.toolsetId}`);
        console.log(`    allow: ${formatList(toolset.allowedTools)}`);
        console.log(`    confirm: ${formatList(toolset.confirmTools)}`);
        console.log(`    deny: ${formatList(toolset.deniedTools)}`);
      }
      console.log('\nUse with: buddy --agent hermes');
      console.log('');
    });

  hermes
    .command('plan')
    .description('Print a short Hermes integration checklist for the selected dispatch profile')
    .argument('[dispatchProfile]', `default Fleet profile (${FLEET_DISPATCH_PROFILES.join(', ')})`, 'balanced')
    .option('--json', 'output JSON')
    .option('--markdown', 'output Markdown')
    .option('--plan-output <file>', 'write plan output to a file')
    .action((profileArg: string, options: HermesCommandOptions) => {
      const dispatchProfile = normalizeDispatchProfile(profileArg);
      const plan = buildHermesIntegrationPlan(dispatchProfile);
      const outputFormat = inferHermesPlanOutputFormat(options);
      const output = renderHermesPlanOutput(profileArg, plan, outputFormat);

      if (options.planOutput) {
        writeHermesPlanOutput(options.planOutput, output);
        console.log(`Hermes plan exported to ${options.planOutput}`);
        return;
      }

      console.log(output);
    });

  hermes
    .command('agent')
    .description('Print the built-in Hermes Agent system prompt')
    .argument('[dispatchProfile]', `default Fleet profile (${FLEET_DISPATCH_PROFILES.join(', ')})`, 'balanced')
    .option('--json', 'output JSON')
    .action((profileArg: string, options: HermesCommandOptions) => {
      const dispatchProfile = normalizeDispatchProfile(profileArg);
      const systemPrompt = buildHermesAgentSystemPrompt(dispatchProfile);

      if (options.json) {
        console.log(JSON.stringify({
          id: 'hermes',
          name: 'Hermes Agent',
          requestedProfile: profileArg,
          dispatchProfile,
          systemPrompt,
        }, null, 2));
        return;
      }

      console.log('\nHermes Agent system prompt:\n');
      console.log(systemPrompt);
      console.log('');
    });

  hermes
    .command('hooks')
    .description('Show the Hermes lifecycle hook contract and configured handlers')
    .option('--json', 'output JSON')
    .action((options: HermesCommandOptions) => {
      const manifest = buildHermesHookLifecycleManifest(process.cwd());

      if (options.json) {
        console.log(JSON.stringify(manifest, null, 2));
        return;
      }

      console.log(renderHermesHookLifecycleManifest(manifest));
    });

  hermes
    .command('doctor')
    .description('Check the built-in Hermes Agent profile and effective tool filter')
    .argument('[dispatchProfile]', `default Fleet profile (${FLEET_DISPATCH_PROFILES.join(', ')})`, 'balanced')
    .option('--json', 'output JSON')
    .action((profileArg: string, options: HermesCommandOptions) => {
      const diagnostics = buildHermesAgentDiagnostics({ dispatchProfile: profileArg });

      if (options.json) {
        console.log(JSON.stringify({
          requestedProfile: profileArg,
          diagnostics,
        }, null, 2));
        return;
      }

      console.log(`\nHermes Agent doctor: ${formatOk(diagnostics.ok)}`);
      if (profileArg !== diagnostics.dispatchProfile) {
        console.log(`  Requested: ${profileArg} (normalized to balanced)`);
      }
      console.log(`  Source: ${diagnostics.source}`);
      console.log(`  Agent path: ${diagnostics.agentPath ?? 'none'}`);
      console.log(`  Dispatch profile: ${diagnostics.dispatchProfile}`);
      console.log(`  Agent default dispatch profile: ${diagnostics.fleetDispatchProfile ?? 'none'}`);
      console.log(
        `  Requires explicit delegation profile: ${diagnostics.requireExplicitDispatchProfile ? 'yes' : 'no'}`,
      );
      console.log(`  Active toolset: ${diagnostics.activeToolset.toolsetId}`);
      console.log(`  Agent tools: ${formatAllowList(diagnostics.enabledTools)}`);
      console.log(`  Agent disabled tools: ${formatList(diagnostics.disabledTools)}`);
      console.log(
        `  Effective filter allow: ${formatAllowList(diagnostics.effectiveToolFilter.enabledPatterns)}`,
      );
      console.log(
        `  Effective filter deny: ${formatList(diagnostics.effectiveToolFilter.disabledPatterns)}`,
      );
      console.log('  Dispatch profile selection:');
      for (const guidance of diagnostics.dispatchProfileGuidance) {
        console.log(`    ${guidance.profile}: ${guidance.useWhen}`);
      }
      console.log(`  Native surfaces: ${formatList(diagnostics.nativeSurfaceIds)}`);

      if (diagnostics.issues.length > 0) {
        console.log('\nIssues:');
        for (const issue of diagnostics.issues) {
          console.log(`  - ${issue}`);
        }
      }

      if (diagnostics.recommendations.length > 0) {
        console.log('\nRecommendations:');
        for (const recommendation of diagnostics.recommendations) {
          console.log(`  - ${recommendation}`);
        }
      }

      if (diagnostics.issues.length === 0 && diagnostics.recommendations.length === 0) {
        console.log('\nNo issues or recommendations.');
      }

      console.log('');
    });
}
