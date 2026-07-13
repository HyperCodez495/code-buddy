/**
 * Cowork adapter for the core evidence-backed companion model route.
 * Only explicitly linked Lisa sessions participate; ordinary coding sessions
 * and deliberate per-session model overrides remain untouched.
 */
import type { Session } from '../../renderer/types';
import { isCompanionThreadTags } from '../../shared/companion-thread';
import { loadCoreModule } from '../utils/core-loader';
import { logWarn } from '../utils/logger';

export interface CoworkCompanionRuntimeConfig {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface CoworkCompanionModelRoute {
  profileId: string;
  lane: string;
  model: string;
  provider: string;
  apiKey: string;
  baseURL: string;
  reason: string;
}

interface CoreRoutingModule {
  resolveCompanionModelRoute?: (options: {
    surface: 'cowork';
    text: string;
    env: NodeJS.ProcessEnv;
  }) => Promise<CoworkCompanionModelRoute | null>;
}

type CoreLoader = <T>(relativePath: string) => Promise<T | null>;

export class CoworkCompanionModelRouting {
  constructor(
    private readonly coreLoader: CoreLoader = <T>(relativePath: string) =>
      loadCoreModule<T>(relativePath),
  ) {}

  async resolve(
    session: Session,
    prompt: string,
    runtime: CoworkCompanionRuntimeConfig,
  ): Promise<CoworkCompanionModelRoute | null> {
    if (!isCompanionThreadTags(session.tags)) return null;
    // Session model differs from the current config only when the user chose a
    // deliberate session-level override. Manual intent outranks the pilot.
    if (session.model && session.model !== runtime.model) return null;
    try {
      const module = await this.coreLoader<CoreRoutingModule>(
        'conversation/companion-model-routing.js',
      );
      return (
        (await module?.resolveCompanionModelRoute?.({
          surface: 'cowork',
          text: prompt,
          env: process.env,
        })) ?? null
      );
    } catch (error) {
      logWarn(
        '[CoworkCompanionRouting] pilot route unavailable:',
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }
}
