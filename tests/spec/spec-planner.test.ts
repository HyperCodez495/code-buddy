/**
 * Tests for the spec planner personas. The model call is injected as a fake
 * `SpecLlmCall`, so these exercise prompt routing + tolerant parsing with no network.
 */

import {
  generatePrd,
  generateArchitecture,
  shardIntoStories,
  parseStories,
  type SpecLlmCall,
} from '../../src/spec/spec-planner.js';

describe('spec-planner', () => {
  it('generatePrd returns the model text with fences stripped', async () => {
    const llm: SpecLlmCall = async () => '```markdown\n# PRD: Thing\n## Problem\nx\n```';
    const prd = await generatePrd(llm, 'build a thing');
    expect(prd.startsWith('# PRD: Thing')).toBe(true);
    expect(prd).not.toContain('```');
  });

  it('generateArchitecture forwards goal + PRD to the model', async () => {
    let seenUser = '';
    const llm: SpecLlmCall = async (_system, user) => {
      seenUser = user;
      return '# Architecture: Thing';
    };
    const arch = await generateArchitecture(llm, 'build a thing', '# PRD: Thing');
    expect(arch).toBe('# Architecture: Thing');
    expect(seenUser).toContain('build a thing');
    expect(seenUser).toContain('# PRD: Thing');
  });

  it('routes each persona to a distinct system prompt', async () => {
    const systems: string[] = [];
    const llm: SpecLlmCall = async (system) => {
      systems.push(system);
      return system.toLowerCase().includes('scrum') ? '{"stories":[]}' : '# doc';
    };
    await generatePrd(llm, 'g');
    await generateArchitecture(llm, 'g', 'prd');
    await shardIntoStories(llm, 'g', 'prd', 'arch');
    expect(systems[0]).toMatch(/product requirements/i);
    expect(systems[1]).toMatch(/architect/i);
    expect(systems[2]).toMatch(/scrum master/i);
  });

  it('shardIntoStories parses a well-formed JSON array of stories', async () => {
    const json = JSON.stringify({
      stories: [
        {
          title: 'Add radar layer',
          epicTitle: 'Map',
          narrative: 'render radars',
          acceptanceCriteria: ['shows radars', 'shows radars'],
          allowedPaths: ['src/radar'],
          verification: ['npm test'],
          riskLevel: 'low',
        },
        { title: 'Wire auth', acceptanceCriteria: [], allowedPaths: [], verification: [], riskLevel: 'HIGH' },
      ],
    });
    const llm: SpecLlmCall = async () => '```json\n' + json + '\n```';
    const stories = await shardIntoStories(llm, 'g', 'prd', 'arch');
    expect(stories).toHaveLength(2);
    expect(stories[0].epicTitle).toBe('Map');
    expect(stories[0].acceptanceCriteria).toEqual(['shows radars']); // de-duped
    expect(stories[1].riskLevel).toBe('high'); // normalized case
  });

  describe('parseStories tolerance', () => {
    it('falls back to a single coarse story on malformed JSON (never throws)', () => {
      const stories = parseStories('not json at all', 'build the goal');
      expect(stories).toHaveLength(1);
      expect(stories[0].title).toContain('build the goal');
    });

    it('falls back when the array is empty', () => {
      const stories = parseStories('{"stories":[]}', 'fallback goal');
      expect(stories).toHaveLength(1);
      expect(stories[0].title).toContain('fallback goal');
    });

    it('accepts a bare JSON array as well as a {stories:[...]} envelope', () => {
      const stories = parseStories('[{"title":"X","acceptanceCriteria":["a"]}]', 'g');
      expect(stories).toHaveLength(1);
      expect(stories[0].title).toBe('X');
      expect(stories[0].riskLevel).toBe('low'); // default when absent
    });

    it('drops entries with no title', () => {
      const stories = parseStories('{"stories":[{"narrative":"no title"},{"title":"ok"}]}', 'g');
      expect(stories.map((s) => s.title)).toEqual(['ok']);
    });
  });
});
