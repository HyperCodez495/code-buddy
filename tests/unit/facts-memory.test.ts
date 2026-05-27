import { describe, it, expect, vi } from 'vitest';
import { FactsMemoryService, Fact } from '../../src/memory/facts-memory.js';
import { CodeBuddyClient } from '../../src/codebuddy/client.js';

vi.mock('../../src/codebuddy/client.js', () => {
  return {
    CodeBuddyClient: class {
      chat() {}
    }
  };
});

describe('FactsMemoryService', () => {
  describe('extractFacts', () => {
    it('should extract structured facts from context', async () => {
      const mockClient = new CodeBuddyClient('key', 'model', 'url');
      const chatSpy = vi.spyOn(mockClient, 'chat').mockResolvedValue({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify([
              { category: 'Projet', text: 'Uses TypeScript and ESM.' },
              { category: 'Preferences', text: 'Prefers 2-spaces tabs.' }
            ])
          },
          finish_reason: 'stop'
        }]
      } as any);

      const service = new FactsMemoryService(mockClient);
      const facts = await service.extractFacts('Some conversation');

      expect(chatSpy).toHaveBeenCalledTimes(1);
      expect(facts.length).toBe(2);
      expect(facts[0].category).toBe('Projet');
      expect(facts[0].text).toBe('Uses TypeScript and ESM.');
    });
  });

  describe('reconcileFacts', () => {
    it('should reconcile and execute transaction actions', async () => {
      const mockClient = new CodeBuddyClient('key', 'model', 'url');
      const chatSpy = vi.spyOn(mockClient, 'chat').mockResolvedValue({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify([
              { action: 'ADD', fact: { category: 'Projet', text: 'Uses ESM.' } },
              { action: 'UPDATE', targetIndex: 0, fact: { category: 'Preferences', text: 'Prefers 2 spaces instead of 4.' } },
              { action: 'DELETE', targetIndex: 1 }
            ])
          },
          finish_reason: 'stop'
        }]
      } as any);

      const currentFacts: Fact[] = [
        { category: 'Preferences', text: 'Prefers 4 spaces.' },
        { category: 'Profil', text: 'User is junior.' }
      ];

      const newFacts: Fact[] = [
        { category: 'Projet', text: 'Uses ESM.' }
      ];

      const service = new FactsMemoryService(mockClient);
      const result = await service.reconcileFacts(currentFacts, newFacts);

      expect(chatSpy).toHaveBeenCalledTimes(1);
      // Expected result:
      // Index 1 (Profil: junior) is DELETED first. currentFacts becomes [Preferences: 4 spaces]
      // Index 0 (Preferences: 4 spaces) is UPDATED to [Preferences: 2 spaces]
      // [Projet: Uses ESM] is ADDED.
      // Total length should be 2.
      expect(result.length).toBe(2);
      expect(result[0].text).toBe('Prefers 2 spaces instead of 4.');
      expect(result[1].text).toBe('Uses ESM.');
    });
  });
});
