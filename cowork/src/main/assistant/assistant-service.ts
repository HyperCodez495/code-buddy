/**
 * Bridges the Cowork « Assistant » panel to the core voice assistant
 * configuration module (`companion/assistant-config.js`). The core owns all
 * env-file parsing, persistence, voice discovery, preview synthesis, and daemon
 * restarts; Cowork only adapts it to IPC.
 */
import { loadCoreModule } from '../utils/core-loader.js';

export type AssistantSettingGroup = 'voice' | 'speech' | 'behavior' | 'companion';
export type AssistantSettingType = 'toggle' | 'enum' | 'text' | 'voice' | 'volume';
export type AssistantEnvFile = 'vision' | 'lisa' | 'both';

export interface AssistantSetting {
  key: string;
  label: string;
  group: AssistantSettingGroup;
  type: AssistantSettingType;
  options?: string[];
  default: string;
  envFile: AssistantEnvFile;
  help: string;
}

export interface AssistantRestartServiceResult {
  service: string;
  ok: boolean;
  error?: string;
}

export interface AssistantErrorResponse {
  ok: false;
  error: string;
}

export interface AssistantConfigSuccessResponse {
  settings: AssistantSetting[];
  values: Record<string, string>;
  voices: string[];
}

export interface AssistantConfigErrorResponse extends AssistantErrorResponse {
  settings: AssistantSetting[];
  values: Record<string, string>;
  voices: string[];
}

export type AssistantConfigResponse = AssistantConfigSuccessResponse | AssistantConfigErrorResponse;

export interface AssistantSaveSuccessResponse {
  vision: string[];
  lisa: string[];
}

export type AssistantSaveResponse = AssistantSaveSuccessResponse | AssistantErrorResponse;

export type AssistantVoicesResponse = string[] | (AssistantErrorResponse & { voices: string[] });

export type AssistantPreviewResponse = string | null | AssistantErrorResponse;

export type AssistantPlayPreviewResponse =
  | { ok: true; path: string }
  | AssistantErrorResponse;

export type AssistantRestartResponse = AssistantRestartServiceResult[] | AssistantErrorResponse;

export interface VoiceboxStudioProfile {
  id: string;
  name: string;
  description?: string | null;
  language?: string;
  voice_type?: string;
  default_engine?: string | null;
  sample_count?: number;
  generation_count?: number;
}

export interface VoiceboxStudioResponse {
  available: boolean;
  baseUrl: string;
  configuredProfile?: string;
  resolvedProfile?: VoiceboxStudioProfile;
  profiles: VoiceboxStudioProfile[];
  models: Array<{
    model_name: string;
    display_name: string;
    downloaded: boolean;
    downloading?: boolean;
    loaded?: boolean;
    size_mb?: number | null;
  }>;
  health?: {
    status: string;
    model_loaded: boolean;
    gpu_available: boolean;
    gpu_type?: string | null;
    vram_used_mb?: number | null;
    backend_type?: string | null;
    backend_variant?: string | null;
  };
  languages: readonly string[];
  engine: string;
  error?: string;
  hint?: string;
}

export interface VoiceboxCloneRequest {
  name: string;
  description?: string;
  language: string;
  referenceText: string;
  filename: string;
  audio: Uint8Array | ArrayBuffer;
  consent: boolean;
}

export type VoiceboxStudioResult = VoiceboxStudioResponse | AssistantErrorResponse;
export type VoiceboxCloneResult =
  | { ok: true; profile: VoiceboxStudioProfile; sampleId: string }
  | AssistantErrorResponse;
export type VoiceboxDeleteResult = { ok: true } | AssistantErrorResponse;

interface CoreAssistantConfigModule {
  ASSISTANT_SETTINGS?: AssistantSetting[];
  readAssistantConfig?: () => Record<string, string>;
  writeAssistantConfig?: (updates: Record<string, string>) => AssistantSaveSuccessResponse;
  listPocketVoices?: () => string[];
  previewVoice?: (name: string, text?: string) => Promise<string | null>;
  playVoicePreview?: (
    name: string,
    text?: string
  ) => Promise<{ path: string; played: boolean } | null>;
  restartAssistantServices?: (
    services: Array<'buddy-vision-brain' | 'lisa-telegram'>
  ) => Promise<AssistantRestartServiceResult[]>;
  getSystemVolume?: () => Promise<number | null>;
  setSystemVolume?: (percent: number) => Promise<boolean>;
  readAssistantVoiceDiagnostics?: () => AssistantVoiceDiagnostics | null;
  probeVoiceboxStudio?: (env: NodeJS.ProcessEnv) => Promise<VoiceboxStudioResponse>;
  createVoiceboxClone?: (
    input: {
      name: string;
      description?: string;
      language: string;
      referenceText: string;
      filename: string;
      audio: Uint8Array;
      consent: boolean;
    },
    env: NodeJS.ProcessEnv
  ) => Promise<{ profile: VoiceboxStudioProfile; sample: { id: string } }>;
  deleteVoiceboxProfile?: (
    profileId: string,
    confirmed: boolean,
    env: NodeJS.ProcessEnv
  ) => Promise<void>;
}

export type AssistantVolumeResponse = { volume: number | null } | AssistantErrorResponse;
export type AssistantSetVolumeResponse = { ok: true; volume: number } | AssistantErrorResponse;

export interface AssistantVoiceTransition {
  sequence: number;
  at: string;
  turnId: string;
  phase: string;
  decisionReason?: string;
  suppressionReason?: string;
  scene?: string;
  sceneConfidence?: number;
  firstAudioMs?: number;
  totalMs?: number;
  aecActive?: boolean;
}

export interface AssistantVoiceDiagnostics {
  version: 1;
  updatedAt: string;
  phase: string;
  activeTurnId?: string;
  attention?: {
    engaged: boolean;
    source?: string;
    remainingMs: number;
    dialogueAgeMs: number;
    closeReason?: string;
  };
  counters: {
    captured: number;
    accepted: number;
    spoken: number;
    suppressed: number;
    interrupted: number;
    failed: number;
  };
  recent: AssistantVoiceTransition[];
}

export type AssistantDiagnosticsResponse =
  | { diagnostics: AssistantVoiceDiagnostics | null }
  | AssistantErrorResponse;

type CoreLoader = () => Promise<CoreAssistantConfigModule | null>;

const ASSISTANT_DAEMONS = ['buddy-vision-brain', 'lisa-telegram'] as const;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function unavailableConfig(
  message = 'module assistant indisponible (moteur embarqué configuré ?)'
): AssistantConfigErrorResponse {
  return { ok: false, settings: [], values: {}, voices: [], error: message };
}

function unavailable(message: string): AssistantErrorResponse {
  return { ok: false, error: message };
}

export class AssistantService {
  private modPromise?: Promise<CoreAssistantConfigModule | null>;

  constructor(
    private readonly loader: CoreLoader = () =>
      loadCoreModule<CoreAssistantConfigModule>('companion/assistant-config.js'),
    private readonly voiceboxLoader: CoreLoader = () =>
      loadCoreModule<CoreAssistantConfigModule>('voice/voicebox-tts.js')
  ) {}

  private async module(): Promise<CoreAssistantConfigModule | null> {
    this.modPromise ??= this.loader().catch(() => null);
    return this.modPromise;
  }

  private async voiceboxModule(): Promise<CoreAssistantConfigModule | null> {
    const [assistant, voicebox] = await Promise.all([
      this.module(),
      this.voiceboxLoader().catch(() => null),
    ]);
    return { ...(assistant ?? {}), ...(voicebox ?? {}) };
  }

  private voiceboxEnv(mod: CoreAssistantConfigModule): NodeJS.ProcessEnv {
    return { ...(mod.readAssistantConfig?.() ?? {}), ...process.env };
  }

  async getConfig(): Promise<AssistantConfigResponse> {
    try {
      const mod = await this.module();
      if (!mod?.ASSISTANT_SETTINGS || !mod.readAssistantConfig || !mod.listPocketVoices) {
        return unavailableConfig();
      }

      return {
        settings: mod.ASSISTANT_SETTINGS,
        values: mod.readAssistantConfig(),
        voices: mod.listPocketVoices(),
      };
    } catch (err) {
      return unavailableConfig(errorMessage(err));
    }
  }

  async save(updates: Record<string, string>): Promise<AssistantSaveResponse> {
    try {
      const mod = await this.module();
      if (!mod?.writeAssistantConfig) {
        return unavailable('module assistant indisponible (écriture impossible)');
      }

      return mod.writeAssistantConfig(updates ?? {});
    } catch (err) {
      return unavailable(errorMessage(err));
    }
  }

  async voices(): Promise<AssistantVoicesResponse> {
    try {
      const mod = await this.module();
      if (!mod?.listPocketVoices) {
        return {
          ok: false,
          voices: [],
          error: 'module assistant indisponible (voix indisponibles)',
        };
      }

      return mod.listPocketVoices();
    } catch (err) {
      return { ok: false, voices: [], error: errorMessage(err) };
    }
  }

  async preview(name: string, text?: string): Promise<AssistantPreviewResponse> {
    try {
      const voiceName = (name ?? '').trim();
      if (!voiceName) return unavailable('voix requise');

      const mod = await this.module();
      if (!mod?.previewVoice) {
        return unavailable('module assistant indisponible (aperçu vocal impossible)');
      }

      const sample = (text ?? '').trim();
      return mod.previewVoice(voiceName, sample || undefined);
    } catch (err) {
      return unavailable(errorMessage(err));
    }
  }

  async playPreview(name: string, text?: string): Promise<AssistantPlayPreviewResponse> {
    try {
      const voiceName = (name ?? '').trim();
      if (!voiceName) return unavailable('voix requise');

      const mod = await this.module();
      if (!mod?.playVoicePreview) {
        return unavailable('module assistant indisponible (lecture de l\'aperçu impossible)');
      }

      const sample = (text ?? '').trim();
      const result = await mod.playVoicePreview(voiceName, sample || undefined);
      if (!result) return unavailable('aperçu vocal indisponible');
      if (!result.played) {
        return unavailable('aucun lecteur audio système disponible pour lire l\'aperçu');
      }

      return { ok: true, path: result.path };
    } catch (err) {
      return unavailable(errorMessage(err));
    }
  }

  async getVolume(): Promise<AssistantVolumeResponse> {
    try {
      const mod = await this.module();
      if (!mod?.getSystemVolume) return unavailable('module assistant indisponible (volume)');
      return { volume: await mod.getSystemVolume() };
    } catch (err) {
      return unavailable(errorMessage(err));
    }
  }

  async setVolume(percent: number): Promise<AssistantSetVolumeResponse> {
    try {
      const pct = Math.max(0, Math.min(150, Math.round(Number(percent) || 0)));
      const mod = await this.module();
      if (!mod?.setSystemVolume) return unavailable('module assistant indisponible (volume)');
      const ok = await mod.setSystemVolume(pct);
      return ok ? { ok: true, volume: pct } : unavailable('réglage du volume impossible');
    } catch (err) {
      return unavailable(errorMessage(err));
    }
  }

  async restart(): Promise<AssistantRestartResponse> {
    try {
      const mod = await this.module();
      if (!mod?.restartAssistantServices) {
        return unavailable('module assistant indisponible (redémarrage impossible)');
      }

      return mod.restartAssistantServices([...ASSISTANT_DAEMONS]);
    } catch (err) {
      return unavailable(errorMessage(err));
    }
  }

  async diagnostics(): Promise<AssistantDiagnosticsResponse> {
    try {
      const mod = await this.module();
      if (!mod?.readAssistantVoiceDiagnostics) {
        return unavailable('module assistant indisponible (diagnostic vocal)');
      }
      return { diagnostics: mod.readAssistantVoiceDiagnostics() };
    } catch (err) {
      return unavailable(errorMessage(err));
    }
  }

  async voiceboxStudio(): Promise<VoiceboxStudioResult> {
    try {
      const mod = await this.voiceboxModule();
      if (!mod?.probeVoiceboxStudio) return unavailable('module Voicebox indisponible');
      return await mod.probeVoiceboxStudio(this.voiceboxEnv(mod));
    } catch (err) {
      return unavailable(errorMessage(err));
    }
  }

  async createVoiceboxClone(request: VoiceboxCloneRequest): Promise<VoiceboxCloneResult> {
    try {
      const mod = await this.voiceboxModule();
      if (!mod?.createVoiceboxClone) return unavailable('module Voicebox indisponible');
      const audio = request.audio instanceof Uint8Array
        ? request.audio
        : new Uint8Array(request.audio);
      const result = await mod.createVoiceboxClone({
        name: request.name,
        ...(request.description?.trim() ? { description: request.description } : {}),
        language: request.language,
        referenceText: request.referenceText,
        filename: request.filename,
        audio,
        consent: request.consent === true,
      }, this.voiceboxEnv(mod));
      return { ok: true, profile: result.profile, sampleId: result.sample.id };
    } catch (err) {
      return unavailable(errorMessage(err));
    }
  }

  async deleteVoiceboxProfile(profileId: string, confirmed: boolean): Promise<VoiceboxDeleteResult> {
    try {
      const mod = await this.voiceboxModule();
      if (!mod?.deleteVoiceboxProfile) return unavailable('module Voicebox indisponible');
      await mod.deleteVoiceboxProfile(profileId, confirmed === true, this.voiceboxEnv(mod));
      return { ok: true };
    } catch (err) {
      return unavailable(errorMessage(err));
    }
  }
}
