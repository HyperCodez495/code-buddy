import {
  PROVIDER_CONFIGS,
  getProviderConfig,
  getValidationConfigForGuide,
} from '../../src/wizard/provider-onboarding.js';

describe('provider-onboarding validation lib', () => {
  describe('PROVIDER_CONFIGS', () => {
    it('every config has a /models-style validation endpoint and an env key', () => {
      for (const config of PROVIDER_CONFIGS) {
        expect(config.id).toBeTruthy();
        expect(config.baseUrl).toMatch(/^https?:\/\//);
        expect(config.validateEndpoint.startsWith('/')).toBe(true);
        expect(config.envKey).toBeTruthy();
      }
    });

    it('uses the Ollama tags endpoint for the local free path', () => {
      const ollama = getProviderConfig('ollama');
      expect(ollama?.baseUrl).toBe('http://localhost:11434');
      expect(ollama?.validateEndpoint).toBe('/api/tags');
    });
  });

  describe('getValidationConfigForGuide', () => {
    it('maps wizard ids to catalog configs (claude→anthropic, gemini→google)', () => {
      expect(getValidationConfigForGuide('claude')?.id).toBe('anthropic');
      expect(getValidationConfigForGuide('gemini')?.id).toBe('google');
      expect(getValidationConfigForGuide('grok')?.id).toBe('grok');
      expect(getValidationConfigForGuide('openai')?.id).toBe('openai');
      expect(getValidationConfigForGuide('openrouter')?.id).toBe('openrouter');
      expect(getValidationConfigForGuide('ollama')?.id).toBe('ollama');
      expect(getValidationConfigForGuide('lmstudio')?.id).toBe('lmstudio');
    });

    it('returns undefined for OAuth/unknown ids that carry no API key', () => {
      expect(getValidationConfigForGuide('chatgpt')).toBeUndefined();
      expect(getValidationConfigForGuide('nonsense')).toBeUndefined();
    });
  });
});
