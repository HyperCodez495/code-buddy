/**
 * Self-describe tool adapter.
 *
 * ITool exposing `self_describe` — "de quoi es-tu fait ?": the robot's live
 * manifest of the bricks that compose it (buddy-sense, buddy-vision,
 * buddy-memory) plus its registered/configured faculties (tools, providers,
 * sensors), without inferring runtime liveness. Read-only,
 * auto-approved. The result text flows back through the normal agent→voice path
 * so the companion can speak it. See src/tools/self-describe.ts.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { buildSelfDescription } from '../self-describe.js';

export class SelfDescribeTool implements ITool {
  readonly name = 'self_describe';
  readonly description =
    "Describe what THIS robot/agent is made of: its constituent bricks (buddy-sense = ears/nervous system, buddy-vision = eyes, buddy-memory = memory), verified source/build status, configured faculties, and available code self-inspection tools. Use it for technical introspection, capabilities, limits, version, and 'de quoi es-tu composé'. It reports a verifiable operational self-model, never subjective consciousness. Read-only, auto-approved.";

  async execute(_input: Record<string, unknown>): Promise<ToolResult> {
      // Resolve registered/configured faculties best-effort — a failure just omits that detail.
    let toolNames: string[] | undefined;
    try {
      const { getFormalToolRegistry } = await import('./tool-registry.js');
      toolNames = getFormalToolRegistry().getNames();
    } catch {
      toolNames = undefined;
    }

    let personaRobotName: string | undefined;
    try {
      const { getActivePersonaVoiceAsync } = await import('../../personas/persona-manager.js');
      personaRobotName = (await getActivePersonaVoiceAsync()).robotName;
    } catch {
      personaRobotName = undefined;
    }

    const description = buildSelfDescription({ toolNames, personaRobotName });
    return { success: true, output: description.text, data: description as unknown as Record<string, unknown> };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: { type: 'object', properties: {}, required: [] },
    };
  }

  validate(_input: unknown): IValidationResult {
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_read' as ToolCategoryType,
      keywords: [
        'self', 'describe', 'components', 'composants', 'briques', 'bricks', 'architecture',
        'de quoi es-tu fait', 'de quoi es-tu compose', 'qui es-tu', 'capabilities', 'capacites',
        'capteur', 'capteurs', 'sensors', 'modules', 'introspection', 'auto inspection',
        'etudie', 'examine', 'inspecte',
        'propre code', 'ton code', 'fonctionne', 'fonctionnes', 'fonctionnement',
        'limites', 'version', 'conscient', 'consciente', 'conscience', 'consciousness',
        'modele de soi',
      ],
      priority: 50,
      modifiesFiles: false,
      makesNetworkRequests: false,
      requiresConfirmation: false,
      fleetSafe: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

/** Create the self-describe tool adapters. */
export function createSelfDescribeTools(): ITool[] {
  return [new SelfDescribeTool()];
}
