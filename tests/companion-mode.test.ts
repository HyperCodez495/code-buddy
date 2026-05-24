import {
  formatCompanionStatus,
  getCompanionStatus,
  recordCompanionSelfState,
  setupCompanionMode,
} from '../src/companion/companion-mode.js';
import { mkdtemp, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const identity = {
    load: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  };
  const voiceInput = {
    getConfig: vi.fn(),
    setConfig: vi.fn(),
    isAvailable: vi.fn(),
  };
  const tts = {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    isAvailable: vi.fn(),
  };
  const hasCodexCredentials = vi.fn();
  const settings = {
    setCurrentModel: vi.fn(),
    getCurrentModel: vi.fn(),
  };
  const checkCameraAvailability = vi.fn();
  return { identity, voiceInput, tts, hasCodexCredentials, settings, checkCameraAvailability };
});

jest.mock('../src/identity/identity-manager.js', () => ({
  getIdentityManager: jest.fn(() => mocks.identity),
}));

jest.mock('../src/input/voice-input-enhanced.js', () => ({
  getVoiceInputManager: jest.fn(() => mocks.voiceInput),
}));

jest.mock('../src/input/text-to-speech.js', () => ({
  getTTSManager: jest.fn(() => mocks.tts),
}));

jest.mock('../src/providers/codex-oauth.js', () => ({
  hasCodexCredentials: mocks.hasCodexCredentials,
  getCodexAuthFilePath: jest.fn(() => '/home/test/.codebuddy/codex-auth.json'),
}));

jest.mock('../src/utils/settings-manager.js', () => ({
  getSettingsManager: jest.fn(() => mocks.settings),
}));

jest.mock('../src/companion/camera.js', () => ({
  checkCameraAvailability: mocks.checkCameraAvailability,
}));

describe('companion-mode', () => {
  let tempDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    mocks.identity.load.mockResolvedValue([]);
    mocks.identity.get.mockReturnValue(undefined);
    mocks.identity.set.mockResolvedValue(undefined);
    mocks.voiceInput.getConfig.mockReturnValue({
      enabled: false,
      provider: 'system',
      language: 'en',
      hotkey: 'ctrl+shift+v',
      autoSend: false,
    });
    mocks.voiceInput.isAvailable.mockResolvedValue({ available: true });
    mocks.tts.getConfig.mockReturnValue({
      enabled: false,
      provider: 'edge-tts',
      voice: undefined,
      autoSpeak: false,
    });
    mocks.tts.isAvailable.mockResolvedValue({ available: true });
    mocks.hasCodexCredentials.mockReturnValue(true);
    mocks.settings.getCurrentModel.mockReturnValue('gpt-5.5');
    mocks.checkCameraAvailability.mockResolvedValue({
      available: true,
      ffmpegAvailable: true,
      platform: 'linux',
      commandPreview: 'ffmpeg ...',
    });
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'buddy-companion-mode-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('installs identity, configures voice, and sets the project model when ChatGPT OAuth exists', async () => {
    const result = await setupCompanionMode({ cwd: '/repo' });

    expect(mocks.identity.load).toHaveBeenCalledWith('/repo');
    expect(mocks.identity.set).toHaveBeenCalledWith('SOUL.md', expect.stringContaining('Buddy Companion'));
    expect(mocks.identity.set).toHaveBeenCalledWith('BOOT.md', expect.stringContaining('Buddy Companion Boot'));
    expect(mocks.voiceInput.setConfig).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      provider: 'system',
      language: 'fr',
      autoSend: true,
    }));
    expect(mocks.tts.updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      provider: 'edge-tts',
      autoSpeak: true,
    }));
    expect(mocks.settings.setCurrentModel).toHaveBeenCalledWith('gpt-5.5');
    expect(result.modelConfigured).toBe(true);
  });

  it('does not replace existing identity or set the model when disabled', async () => {
    mocks.identity.get.mockImplementation((name: string) => ({
      name,
      source: 'project',
      content: 'Existing identity',
    }));
    mocks.hasCodexCredentials.mockReturnValue(false);

    const result = await setupCompanionMode({
      cwd: '/repo',
      configureVoice: false,
      configureModel: false,
    });

    expect(mocks.identity.set).not.toHaveBeenCalled();
    expect(mocks.voiceInput.setConfig).not.toHaveBeenCalled();
    expect(mocks.tts.updateConfig).not.toHaveBeenCalled();
    expect(mocks.settings.setCurrentModel).not.toHaveBeenCalled();
    expect(result.skippedSoul).toBe(true);
    expect(result.skippedBoot).toBe(true);
    expect(result.modelConfigured).toBe(false);
  });

  it('formats readiness with actionable next steps', async () => {
    mocks.hasCodexCredentials.mockReturnValue(false);
    mocks.voiceInput.isAvailable.mockResolvedValue({
      available: false,
      reason: 'Missing sox',
    });
    mocks.tts.isAvailable.mockResolvedValue({
      available: false,
      reason: 'edge-tts not found',
    });
    mocks.checkCameraAvailability.mockResolvedValue({
      available: false,
      ffmpegAvailable: false,
      platform: 'linux',
      reason: 'ffmpeg missing',
    });

    const status = await getCompanionStatus({ cwd: '/repo' });
    const output = formatCompanionStatus(status);

    expect(output).toContain('Buddy Companion Status');
    expect(output).toContain('ChatGPT OAuth credentials missing');
    expect(output).toContain('Run `buddy login`');
    expect(output).toContain('Voice input setup: Missing sox');
    expect(output).toContain('TTS setup: edge-tts not found');
    expect(output).toContain('Camera setup: ffmpeg missing');
  });

  it('records the companion self-state as a self percept', async () => {
    const percept = await recordCompanionSelfState({ cwd: tempDir });

    expect(percept.modality).toBe('self');
    expect(percept.source).toBe('companion_status');
    expect(percept.summary).toContain('Buddy self-state recorded');
    expect(percept.payload).toMatchObject({
      model: 'gpt-5.5',
      chatGptCredentialsPresent: true,
      cameraReady: true,
    });
  });
});
