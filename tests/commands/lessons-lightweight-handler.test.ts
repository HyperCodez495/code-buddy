/**
 * Tests for the lightweight /lessons slash command handler.
 */

const mockTracker = {
  buildConceptGraph: jest.fn(),
  buildContextBlock: jest.fn(),
  getStats: jest.fn(),
  add: jest.fn(),
  search: jest.fn(),
};

jest.mock('../../src/agent/lessons-tracker.js', () => ({
  getLessonsTracker: jest.fn(function() { return mockTracker; }),
  renderLessonConceptGraph: jest.fn(function(_graph, format = 'summary') {
    return `rendered:${format}`;
  }),
}));

import { handleLessonsCommand } from '../../src/commands/handlers/lightweight.js';

describe('handleLessonsCommand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTracker.buildConceptGraph.mockReturnValue({
      generatedAt: 123,
      lessons: [],
      concepts: [],
      lessonConcepts: {},
      backlinks: {},
      relatedLessons: [],
    });
    mockTracker.buildContextBlock.mockReturnValue(null);
    mockTracker.getStats.mockReturnValue({
      total: 0,
      byCategory: { PATTERN: 0, RULE: 0, CONTEXT: 0, INSIGHT: 0 },
    });
    mockTracker.search.mockReturnValue([]);
    mockTracker.add.mockReturnValue({ id: 'l1' });
  });

  it('should pass a free-text graph query to the lessons graph builder', () => {
    const result = handleLessonsCommand('graph public data');

    expect(result.handled).toBe(true);
    expect(mockTracker.buildConceptGraph).toHaveBeenCalledWith({
      query: 'public data',
      concept: undefined,
      includeKeywords: true,
    });
    expect(result.entry?.content).toBe('rendered:summary');
  });

  it('should parse quoted --concept and graph format flags', () => {
    const result = handleLessonsCommand('graph --concept "contact page discovery" --mermaid');

    expect(result.handled).toBe(true);
    expect(mockTracker.buildConceptGraph).toHaveBeenCalledWith({
      query: undefined,
      concept: 'contact page discovery',
      includeKeywords: true,
    });
    expect(result.entry?.content).toBe('rendered:mermaid');
  });

  it('should parse the slash --markdown graph format', () => {
    const result = handleLessonsCommand('graph --concept=contact-discovery --markdown --no-keywords');

    expect(result.handled).toBe(true);
    expect(mockTracker.buildConceptGraph).toHaveBeenCalledWith({
      query: undefined,
      concept: 'contact-discovery',
      includeKeywords: false,
    });
    expect(result.entry?.content).toBe('rendered:markdown');
  });
});
