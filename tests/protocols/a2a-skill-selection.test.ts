/**
 * A2A Skill Selection Tests (POC Niveau 3)
 * 
 * Tests for smart spoke selection based on skill matching and scoring.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { A2AAgentClient, TaskStatus } from '../../src/protocols/a2a/index.js';
import type { AgentCard } from '../../src/protocols/a2a/index.js';

describe('A2A Smart Skill Selection (POC Niveau 3)', () => {
  let client: A2AAgentClient;

  beforeEach(() => {
    client = new A2AAgentClient();

    // Register two remote spokes with different skills
    client.registerRemoteCard('ollama-darkstar', {
      url: 'http://100.73.222.64:11434',
      card: {
        name: 'Ollama DARKSTAR',
        description: 'GPU-heavy Ollama on DARKSTAR',
        url: 'http://100.73.222.64:11434',
        version: '0.2.0',
        skills: [
          { id: 'chat-qwen3.6-35b', name: 'Chat (qwen3.6)', description: 'Heavy LLM', inputModes: ['text/plain'], outputModes: ['text/plain'] },
          { id: 'image-gen', name: 'Image Gen', description: 'Image generation', inputModes: ['text/plain'], outputModes: ['image/png'] },
        ],
        capabilities: { streaming: false, pushNotifications: false },
      } as AgentCard,
      lastHeartbeat: Date.now(),
    });

    client.registerRemoteCard('ollama-ministar', {
      url: 'http://100.98.18.76:3002',
      card: {
        name: 'Ollama Ministar',
        description: 'Always-on Ollama on Ministar Linux',
        url: 'http://100.98.18.76:3002',
        version: '0.2.0',
        skills: [
          { id: 'chat-qwen3.6-35b', name: 'Chat (qwen3.6)', description: 'Heavy LLM', inputModes: ['text/plain'], outputModes: ['text/plain'] },
          { id: 'embed', name: 'Embeddings', description: 'Fast embeddings', inputModes: ['text/plain'], outputModes: ['application/json'] },
        ],
        capabilities: { streaming: false, pushNotifications: false },
      } as AgentCard,
      lastHeartbeat: Date.now(),
    });
  });

  it('should find best spoke for a skill (prefers always-on)', () => {
    // Both have chat skill, but ollama-ministar is "always-on" so should score higher
    const best = client.findBestSpokeForSkill('chat-qwen3.6-35b');
    expect(best).toBe('ollama-ministar');
  });

  it('should find best spoke for unique skill', () => {
    // Only ollama-darkstar has image-gen
    const best = client.findBestSpokeForSkill('image-gen');
    expect(best).toBe('ollama-darkstar');
  });

  it('should return null for unknown skill', () => {
    const best = client.findBestSpokeForSkill('unknown-skill');
    expect(best).toBeNull();
  });

  it('should resolve target by skill', () => {
    const resolved = client.resolveTarget({ skill: 'embed' });
    expect(resolved).toEqual({ agentKey: 'ollama-ministar' });
  });

  it('should prefer explicit agent over skill resolution', () => {
    const resolved = client.resolveTarget({ agent: 'ollama-darkstar' });
    expect(resolved).toEqual({ agentKey: 'ollama-darkstar' });
  });

  it('should error on skill + agent both provided', () => {
    const resolved = client.resolveTarget({ agent: 'ollama-darkstar', skill: 'chat-qwen3.6-35b' });
    expect(resolved).toHaveProperty('error');
    expect((resolved as any).status).toBe(400);
  });

  it('should error on unknown skill', () => {
    const resolved = client.resolveTarget({ skill: 'unknown' });
    expect(resolved).toHaveProperty('error');
    expect((resolved as any).status).toBe(404);
  });
});
