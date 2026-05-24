import { getIdentityManager } from '../identity/identity-manager.js';
import {
  BUDDY_COMPANION_BOOT_MD,
  BUDDY_COMPANION_SOUL_MD,
} from '../identity/companion-identity.js';
import { getVoiceInputManager } from '../input/voice-input-enhanced.js';
import type { VoiceInputConfig } from '../input/voice-input-enhanced.js';
import { getTTSManager } from '../input/text-to-speech.js';
import type { TTSConfig } from '../input/text-to-speech.js';
import { DEFAULT_WAKE_WORD_CONFIG } from '../voice/types.js';
import { hasCodexCredentials, getCodexAuthFilePath } from '../providers/codex-oauth.js';
import { getSettingsManager } from '../utils/settings-manager.js';
import { checkCameraAvailability } from './camera.js';
import {
  getCompanionPerceptStats,
  recordCompanionPercept,
  type CompanionPercept,
  type CompanionPerceptStats,
} from './percepts.js';

export const COMPANION_DEFAULT_MODEL = 'gpt-5.5';
export const COMPANION_DEFAULT_LANGUAGE = 'fr';
export const COMPANION_DEFAULT_TTS_VOICE = 'fr-FR-HenriNeural';

export interface CompanionSetupOptions {
  cwd?: string;
  forceIdentity?: boolean;
  configureVoice?: boolean;
  configureModel?: boolean;
  language?: string;
  sttProvider?: VoiceInputConfig['provider'];
  ttsProvider?: TTSConfig['provider'];
  ttsVoice?: string;
  model?: string;
}

export interface CompanionStatusOptions {
  cwd?: string;
}

export interface CompanionSetupResult {
  cwd: string;
  wroteSoul: boolean;
  wroteBoot: boolean;
  skippedSoul: boolean;
  skippedBoot: boolean;
  voiceConfigured: boolean;
  modelConfigured: boolean;
  model?: string;
  status: CompanionStatus;
}

export interface CompanionStatus {
  cwd: string;
  authPath: string;
  chatGptCredentialsPresent: boolean;
  model: string;
  identity: {
    soulLoaded: boolean;
    soulSource?: string;
    soulIsCompanion: boolean;
    bootLoaded: boolean;
    bootSource?: string;
    bootIsCompanion: boolean;
  };
  voice: {
    enabled: boolean;
    available: boolean;
    reason?: string;
    provider: VoiceInputConfig['provider'];
    language?: string;
    autoSend?: boolean;
  };
  wakeWord: {
    available: boolean;
    engine: 'porcupine' | 'text-match';
    wakeWords: string[];
    picovoiceAccessKeyPresent: boolean;
  };
  tts: {
    enabled: boolean;
    available: boolean;
    reason?: string;
    provider: TTSConfig['provider'];
    voice?: string;
    autoSpeak?: boolean;
  };
  camera: {
    available: boolean;
    ffmpegAvailable: boolean;
    platform: string;
    commandPreview?: string;
    reason?: string;
  };
  percepts: CompanionPerceptStats;
}

function isCompanionText(content: string | undefined): boolean {
  return Boolean(content?.includes('Buddy Companion'));
}

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

export async function setupCompanionMode(
  options: CompanionSetupOptions = {},
): Promise<CompanionSetupResult> {
  const cwd = resolveCwd(options.cwd);
  const configureVoice = options.configureVoice !== false;
  const configureModel = options.configureModel !== false;
  const model = options.model || COMPANION_DEFAULT_MODEL;

  const identity = getIdentityManager();
  await identity.load(cwd);

  const existingSoul = identity.get('SOUL.md');
  const existingBoot = identity.get('BOOT.md');
  const shouldWriteSoul = options.forceIdentity || !existingSoul;
  const shouldWriteBoot = options.forceIdentity || !existingBoot;

  if (shouldWriteSoul) {
    await identity.set('SOUL.md', BUDDY_COMPANION_SOUL_MD);
  }
  if (shouldWriteBoot) {
    await identity.set('BOOT.md', BUDDY_COMPANION_BOOT_MD);
  }

  if (configureVoice) {
    const language = options.language || COMPANION_DEFAULT_LANGUAGE;
    const voiceInput = getVoiceInputManager();
    const voiceConfig = voiceInput.getConfig();
    voiceInput.setConfig({
      enabled: true,
      provider: options.sttProvider || voiceConfig.provider || 'whisper-local',
      language,
      autoSend: true,
      hotkey: voiceConfig.hotkey || 'ctrl+shift+v',
    });

    const tts = getTTSManager();
    const ttsConfig = tts.getConfig();
    tts.updateConfig({
      enabled: true,
      provider: options.ttsProvider || ttsConfig.provider || 'edge-tts',
      voice: options.ttsVoice || ttsConfig.voice || COMPANION_DEFAULT_TTS_VOICE,
      autoSpeak: true,
    });
  }

  let modelConfigured = false;
  if (configureModel && hasCodexCredentials()) {
    getSettingsManager().setCurrentModel(model);
    modelConfigured = true;
  }

  return {
    cwd,
    wroteSoul: shouldWriteSoul,
    wroteBoot: shouldWriteBoot,
    skippedSoul: !shouldWriteSoul,
    skippedBoot: !shouldWriteBoot,
    voiceConfigured: configureVoice,
    modelConfigured,
    model: modelConfigured ? model : undefined,
    status: await getCompanionStatus({ cwd }),
  };
}

export async function getCompanionStatus(
  options: CompanionStatusOptions = {},
): Promise<CompanionStatus> {
  const cwd = resolveCwd(options.cwd);
  const identity = getIdentityManager();
  await identity.load(cwd);

  const soul = identity.get('SOUL.md');
  const boot = identity.get('BOOT.md');
  const voiceInput = getVoiceInputManager();
  const tts = getTTSManager();
  const [voiceAvailable, ttsAvailable, camera, percepts] = await Promise.all([
    voiceInput.isAvailable(),
    tts.isAvailable(),
    checkCameraAvailability(),
    getCompanionPerceptStats({ cwd }),
  ]);

  const voiceConfig = voiceInput.getConfig();
  const ttsConfig = tts.getConfig();

  return {
    cwd,
    authPath: getCodexAuthFilePath(),
    chatGptCredentialsPresent: hasCodexCredentials(),
    model: getSettingsManager().getCurrentModel(),
    identity: {
      soulLoaded: Boolean(soul),
      soulSource: soul?.source,
      soulIsCompanion: isCompanionText(soul?.content),
      bootLoaded: Boolean(boot),
      bootSource: boot?.source,
      bootIsCompanion: isCompanionText(boot?.content),
    },
    voice: {
      enabled: voiceConfig.enabled,
      available: voiceAvailable.available,
      reason: voiceAvailable.reason,
      provider: voiceConfig.provider,
      language: voiceConfig.language,
      autoSend: voiceConfig.autoSend,
    },
    wakeWord: {
      available: true,
      engine: process.env.PICOVOICE_ACCESS_KEY ? 'porcupine' : 'text-match',
      wakeWords: DEFAULT_WAKE_WORD_CONFIG.wakeWords,
      picovoiceAccessKeyPresent: Boolean(process.env.PICOVOICE_ACCESS_KEY),
    },
    tts: {
      enabled: ttsConfig.enabled,
      available: ttsAvailable.available,
      reason: ttsAvailable.reason,
      provider: ttsConfig.provider,
      voice: ttsConfig.voice,
      autoSpeak: ttsConfig.autoSpeak,
    },
    camera,
    percepts,
  };
}

export async function recordCompanionSelfState(
  options: CompanionStatusOptions = {},
): Promise<CompanionPercept> {
  const status = await getCompanionStatus(options);
  return recordCompanionPercept({
    modality: 'self',
    source: 'companion_status',
    summary: `Buddy self-state recorded: model ${status.model}, voice ${
      status.voice.enabled && status.voice.available ? 'ready' : 'not ready'
    }, camera ${status.camera.available ? 'ready' : 'not ready'}`,
    confidence: 1,
    payload: {
      model: status.model,
      chatGptCredentialsPresent: status.chatGptCredentialsPresent,
      identityReady: status.identity.soulIsCompanion && status.identity.bootIsCompanion,
      voiceReady: status.voice.enabled && status.voice.available,
      ttsReady: status.tts.enabled && status.tts.available,
      cameraReady: status.camera.available,
      wakeWordEngine: status.wakeWord.engine,
      perceptTotal: status.percepts.total,
    },
    tags: ['self', 'proprioception', 'companion'],
  }, { cwd: status.cwd });
}

function mark(ok: boolean): string {
  return ok ? '[ok]' : '[todo]';
}

export function formatCompanionStatus(status: CompanionStatus): string {
  const lines = [
    'Buddy Companion Status',
    '='.repeat(50),
    '',
    `Workspace: ${status.cwd}`,
    `Brain: ${mark(status.chatGptCredentialsPresent)} ChatGPT OAuth credentials ${
      status.chatGptCredentialsPresent ? 'present' : 'missing'
    }`,
    `Auth file: ${status.authPath}`,
    `Model: ${status.model}`,
    '',
    `Identity: ${mark(status.identity.soulIsCompanion)} SOUL.md ${
      status.identity.soulLoaded ? `loaded from ${status.identity.soulSource}` : 'not loaded'
    }`,
    `Boot: ${mark(status.identity.bootIsCompanion)} BOOT.md ${
      status.identity.bootLoaded ? `loaded from ${status.identity.bootSource}` : 'not loaded'
    }`,
    '',
    `Voice input: ${mark(status.voice.enabled && status.voice.available)} ${
      status.voice.enabled ? 'enabled' : 'disabled'
    } / ${status.voice.provider} / ${status.voice.language || 'auto'} / auto-send ${
      status.voice.autoSend ? 'on' : 'off'
    }`,
    `Wake word: ${mark(status.wakeWord.available)} ${status.wakeWord.engine} / ${
      status.wakeWord.wakeWords.join(', ')
    }`,
    `TTS: ${mark(status.tts.enabled && status.tts.available)} ${
      status.tts.enabled ? 'enabled' : 'disabled'
    } / ${status.tts.provider} / ${status.tts.voice || 'auto'} / auto-speak ${
      status.tts.autoSpeak ? 'on' : 'off'
    }`,
    `Camera: ${mark(status.camera.available)} ${
      status.camera.ffmpegAvailable ? 'ffmpeg available' : 'ffmpeg missing'
    } / ${status.camera.platform}`,
    `Percepts: ${mark(status.percepts.exists)} ${status.percepts.total} recorded / ${status.percepts.storePath}`,
  ];

  const next: string[] = [];
  if (!status.chatGptCredentialsPresent) {
    next.push('Run `buddy login` to connect the ChatGPT subscription brain.');
  }
  if (!status.identity.soulIsCompanion || !status.identity.bootIsCompanion) {
    next.push('Run `buddy companion setup` to install companion identity files.');
  }
  if (!status.voice.available && status.voice.reason) {
    next.push(`Voice input setup: ${status.voice.reason}`);
  }
  if (!status.tts.available && status.tts.reason) {
    next.push(`TTS setup: ${status.tts.reason}`);
  }
  if (!status.camera.available && status.camera.reason) {
    next.push(`Camera setup: ${status.camera.reason}`);
  }

  if (next.length > 0) {
    lines.push('', 'Next steps:', ...next.map(item => `- ${item}`));
  }

  return lines.join('\n');
}
