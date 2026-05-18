/**
 * Tests for `buddy lessons` CLI command
 *
 * The LessonsTracker module is mocked so tests exercise only
 * the command wiring (argument parsing, option handling, console output)
 * without touching the filesystem.
 */

import { Command } from 'commander';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { createLessonsCommand } from '../../src/commands/lessons.js';

// ============================================================================
// Mock the lessons tracker
// ============================================================================

const mockTracker = {
  list: jest.fn(),
  add: jest.fn(),
  search: jest.fn(),
  remove: jest.fn(),
  clearByCategory: jest.fn(),
  buildContextBlock: jest.fn(),
  buildConceptGraph: jest.fn(),
  load: jest.fn(),
  save: jest.fn(),
};

jest.mock('../../src/agent/lessons-tracker.js', () => ({
  getLessonsTracker: jest.fn(function() { return mockTracker; }),
  renderLessonConceptGraphMermaid: jest.fn(function() { return 'graph TD\n  L0["PATTERN: Use contact-discovery"]\n  L0 --> C0\n  C0(("contact-discovery"))'; }),
  renderLessonConceptGraphSummary: jest.fn(function() { return 'Lesson graph: 1 lesson(s), 1 concept(s), 0 relation(s).\n\n## Backlinks\n- contact-discovery: [l1]'; }),
  renderLessonConceptGraph: jest.fn(function(_graph, format = 'summary') {
    if (format === 'json') return '{\n  "generatedAt": 123\n}';
    if (format === 'markdown') return '# Lessons Graph\n\n### [[contact-discovery|contact-discovery]]';
    if (format === 'mermaid') return 'graph TD\n  L0["PATTERN: Use contact-discovery"]\n  L0 --> C0\n  C0(("contact-discovery"))';
    return 'Lesson graph: 1 lesson(s), 1 concept(s), 0 relation(s).\n\n## Backlinks\n- contact-discovery: [l1]';
  }),
  renderLessonConceptVaultFiles: jest.fn(function() {
    return [
      { path: 'index.md', content: '# Lessons Vault\n\n- [[concepts/contact-discovery|contact-discovery]]' },
      { path: '_concepts.md', content: '# Concept Index' },
      { path: '_lessons.md', content: '# Lesson Index' },
      { path: 'concepts/contact-discovery.md', content: '# contact-discovery' },
      { path: 'lessons/l1.md', content: '# PATTERN: l1' },
      { path: 'graph.json', content: '{ "schemaVersion": 1 }' },
      { path: 'graph.mmd', content: 'graph TD' },
      { path: 'manifest.json', content: '{ "vaultSchemaVersion": 1 }' },
    ];
  }),
}));

// ============================================================================
// Helpers
// ============================================================================

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  return program;
}

function getLogOutput(spy: jest.SpyInstance): string {
  return (spy.mock.calls as unknown[][]).map(c => c.join(' ')).join('\n');
}

// ============================================================================
// Tests
// ============================================================================

describe('createLessonsCommand', () => {
  let program: Command;
  let consoleSpy: jest.SpyInstance;
  let consoleErrSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock return values
    mockTracker.list.mockReturnValue([]);
    mockTracker.add.mockReturnValue({
      id: 'test123',
      category: 'RULE',
      content: 'test content',
      createdAt: Date.now(),
      source: 'manual',
    });
    mockTracker.search.mockReturnValue([]);
    mockTracker.clearByCategory.mockReturnValue(0);
    mockTracker.buildContextBlock.mockReturnValue(null);
    mockTracker.buildConceptGraph.mockReturnValue({
      generatedAt: Date.now(),
      lessons: [],
      concepts: [],
      lessonConcepts: {},
      backlinks: {},
      relatedLessons: [],
    });

    consoleSpy = jest.spyOn(console, 'log').mockImplementation(function() {});
    consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(function() {});
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(
      (() => {}) as unknown as (code?: number | string | null) => never
    );

    program = createProgram();
    program.addCommand(createLessonsCommand());
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  // --------------------------------------------------------------------------
  // Command structure
  // --------------------------------------------------------------------------

  it('should create a command named "lessons" with a description', () => {
    const cmd = createLessonsCommand();
    expect(cmd.name()).toBe('lessons');
    expect(cmd.description().length).toBeGreaterThan(0);
  });

  it('should have subcommands: list, add, search, graph, clear, context', () => {
    const cmd = createLessonsCommand();
    const names = cmd.commands.map(c => c.name());
    expect(names).toContain('list');
    expect(names).toContain('add');
    expect(names).toContain('search');
    expect(names).toContain('graph');
    expect(names).toContain('clear');
    expect(names).toContain('context');
  });

  // --------------------------------------------------------------------------
  // list subcommand
  // --------------------------------------------------------------------------

  describe('list', () => {
    it('should call tracker.list() and print "No lessons recorded" when empty', async () => {
      mockTracker.list.mockReturnValue([]);
      await program.parseAsync(['node', 'buddy', 'lessons', 'list']);
      expect(mockTracker.list).toHaveBeenCalled();
      expect(getLogOutput(consoleSpy)).toContain('No lessons recorded');
    });

    it('should group and display lessons when items exist', async () => {
      mockTracker.list.mockReturnValue([
        { id: 'a1', category: 'RULE', content: 'run tests', createdAt: 0, source: 'manual' },
      ]);
      await program.parseAsync(['node', 'buddy', 'lessons', 'list']);
      expect(getLogOutput(consoleSpy)).toContain('RULE');
      expect(getLogOutput(consoleSpy)).toContain('run tests');
    });
  });

  // --------------------------------------------------------------------------
  // add subcommand
  // --------------------------------------------------------------------------

  describe('add', () => {
    it('should call tracker.add() with parsed category and content', async () => {
      await program.parseAsync([
        'node', 'buddy', 'lessons', 'add', 'always run tsc', '--category', 'RULE',
      ]);
      expect(mockTracker.add).toHaveBeenCalledWith('RULE', 'always run tsc', 'manual', undefined);
    });

    it('should default category to INSIGHT when not specified', async () => {
      await program.parseAsync(['node', 'buddy', 'lessons', 'add', 'some insight']);
      expect(mockTracker.add).toHaveBeenCalledWith('INSIGHT', 'some insight', 'manual', undefined);
    });

    it('should pass context when --context is provided', async () => {
      await program.parseAsync([
        'node', 'buddy', 'lessons', 'add', 'use ESM', '--context', 'Node.js',
      ]);
      expect(mockTracker.add).toHaveBeenCalledWith('INSIGHT', 'use ESM', 'manual', 'Node.js');
    });

    it('should print the added lesson id and category', async () => {
      await program.parseAsync(['node', 'buddy', 'lessons', 'add', 'test content']);
      expect(getLogOutput(consoleSpy)).toContain('test123');
    });
  });

  // --------------------------------------------------------------------------
  // search subcommand
  // --------------------------------------------------------------------------

  describe('search', () => {
    it('should call tracker.search() with the query and print count', async () => {
      mockTracker.search.mockReturnValue([]);
      await program.parseAsync(['node', 'buddy', 'lessons', 'search', 'tsc']);
      expect(mockTracker.search).toHaveBeenCalledWith('tsc', undefined);
      expect(getLogOutput(consoleSpy)).toContain('No lessons found');
    });

    it('should display matching lessons when results exist', async () => {
      mockTracker.search.mockReturnValue([
        { id: 'b1', category: 'PATTERN', content: 'run tsc first', createdAt: 0, source: 'manual' },
      ]);
      await program.parseAsync(['node', 'buddy', 'lessons', 'search', 'tsc']);
      expect(getLogOutput(consoleSpy)).toContain('Found 1');
    });
  });

  // --------------------------------------------------------------------------
  // graph subcommand
  // --------------------------------------------------------------------------

  describe('graph', () => {
    it('should call tracker.buildConceptGraph() and print a graph summary', async () => {
      mockTracker.buildConceptGraph.mockReturnValue({
        generatedAt: Date.now(),
        lessons: [{ id: 'l1', category: 'PATTERN', content: 'x', createdAt: 0, source: 'manual' }],
        concepts: [{ id: 'contact-discovery', label: 'contact-discovery', lessonIds: ['l1'], sources: ['wiki_link'], weight: 1 }],
        lessonConcepts: {},
        backlinks: { 'contact-discovery': ['l1'] },
        relatedLessons: [],
      });

      await program.parseAsync(['node', 'buddy', 'lessons', 'graph', '--query', 'contact']);

      expect(mockTracker.buildConceptGraph).toHaveBeenCalledWith({
        query: 'contact',
        concept: undefined,
        category: undefined,
        includeKeywords: true,
        limit: 50,
      });
      expect(getLogOutput(consoleSpy)).toContain('Lesson graph: 1 lesson(s)');
      expect(getLogOutput(consoleSpy)).toContain('contact-discovery');
      expect(getLogOutput(consoleSpy)).toContain('Backlinks');
    });

    it('should pass --concept to tracker.buildConceptGraph()', async () => {
      await program.parseAsync(['node', 'buddy', 'lessons', 'graph', '--concept', 'contact-discovery']);

      expect(mockTracker.buildConceptGraph).toHaveBeenCalledWith({
        query: undefined,
        concept: 'contact-discovery',
        category: undefined,
        includeKeywords: true,
        limit: 50,
      });
    });

    it('should pass --no-keywords to tracker.buildConceptGraph()', async () => {
      await program.parseAsync(['node', 'buddy', 'lessons', 'graph', '--no-keywords']);

      expect(mockTracker.buildConceptGraph).toHaveBeenCalledWith({
        query: undefined,
        concept: undefined,
        category: undefined,
        includeKeywords: false,
        limit: 50,
      });
    });

    it('should print JSON when --json is provided', async () => {
      mockTracker.buildConceptGraph.mockReturnValue({
        generatedAt: 123,
        lessons: [],
        concepts: [],
        lessonConcepts: {},
        backlinks: {},
        relatedLessons: [],
      });

      await program.parseAsync(['node', 'buddy', 'lessons', 'graph', '--json']);

      expect(getLogOutput(consoleSpy)).toContain('"generatedAt": 123');
    });

    it('should print Mermaid output when --mermaid is provided', async () => {
      mockTracker.buildConceptGraph.mockReturnValue({
        generatedAt: 123,
        lessons: [{ id: 'l1', category: 'PATTERN', content: 'Use [[contact-discovery]]', createdAt: 0, source: 'manual' }],
        concepts: [{ id: 'contact-discovery', label: 'contact-discovery', lessonIds: ['l1'], sources: ['wiki_link'], weight: 1 }],
        lessonConcepts: { l1: [{ slug: 'contact-discovery', label: 'contact-discovery', sources: ['wiki_link'] }] },
        backlinks: { 'contact-discovery': ['l1'] },
        relatedLessons: [],
      });

      await program.parseAsync(['node', 'buddy', 'lessons', 'graph', '--mermaid']);

      expect(getLogOutput(consoleSpy)).toContain('graph TD');
      expect(getLogOutput(consoleSpy)).toContain('contact-discovery');
    });

    it('should print Markdown index output when --markdown is provided', async () => {
      await program.parseAsync(['node', 'buddy', 'lessons', 'graph', '--markdown']);

      expect(getLogOutput(consoleSpy)).toContain('# Lessons Graph');
      expect(getLogOutput(consoleSpy)).toContain('[[contact-discovery|contact-discovery]]');
    });

    it('should write graph output when --graph-output is provided', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lessons-command-graph-'));
      const outputPath = path.join(tmpDir, '.codebuddy', 'lessons.graph.json');

      try {
        await program.parseAsync(['node', 'buddy', 'lessons', 'graph', '--json', '--graph-output', outputPath]);

        expect(await fs.readFile(outputPath, 'utf-8')).toContain('"generatedAt": 123');
        expect(getLogOutput(consoleSpy)).toContain('Graph exported to');
      } finally {
        await fs.remove(tmpDir);
      }
    });

    it('should infer graph output format from the file extension', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lessons-command-graph-'));
      const outputPath = path.join(tmpDir, '.codebuddy', 'lessons.index.md');

      try {
        await program.parseAsync(['node', 'buddy', 'lessons', 'graph', '--graph-output', outputPath]);

        expect(await fs.readFile(outputPath, 'utf-8')).toContain('# Lessons Graph');
      } finally {
        await fs.remove(tmpDir);
      }
    });

    it('should write an Obsidian-style vault when --vault is provided', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lessons-command-vault-'));
      const vaultPath = path.join(tmpDir, '.codebuddy', 'lessons-vault');

      try {
        await program.parseAsync(['node', 'buddy', 'lessons', 'graph', '--vault', vaultPath]);

        expect(await fs.readFile(path.join(vaultPath, 'index.md'), 'utf-8')).toContain('# Lessons Vault');
        expect(await fs.pathExists(path.join(vaultPath, '_concepts.md'))).toBe(true);
        expect(await fs.pathExists(path.join(vaultPath, '_lessons.md'))).toBe(true);
        expect(await fs.pathExists(path.join(vaultPath, 'concepts', 'contact-discovery.md'))).toBe(true);
        expect(await fs.pathExists(path.join(vaultPath, 'lessons', 'l1.md'))).toBe(true);
        expect(await fs.pathExists(path.join(vaultPath, 'graph.json'))).toBe(true);
        expect(await fs.pathExists(path.join(vaultPath, 'graph.mmd'))).toBe(true);
        expect(await fs.pathExists(path.join(vaultPath, 'manifest.json'))).toBe(true);
        expect(getLogOutput(consoleSpy)).toContain('Lessons vault exported');
      } finally {
        await fs.remove(tmpDir);
      }
    });
  });

  // --------------------------------------------------------------------------
  // clear subcommand
  // --------------------------------------------------------------------------

  describe('clear', () => {
    it('should NOT call clearByCategory without --yes flag', async () => {
      await program.parseAsync(['node', 'buddy', 'lessons', 'clear']);
      expect(mockTracker.clearByCategory).not.toHaveBeenCalled();
      expect(getLogOutput(consoleSpy)).toContain('--yes');
    });

    it('should call clearByCategory() when --yes flag is provided', async () => {
      mockTracker.clearByCategory.mockReturnValue(3);
      await program.parseAsync(['node', 'buddy', 'lessons', 'clear', '--yes']);
      expect(mockTracker.clearByCategory).toHaveBeenCalledWith(undefined);
    });

    it('should print the count cleared', async () => {
      mockTracker.clearByCategory.mockReturnValue(5);
      await program.parseAsync(['node', 'buddy', 'lessons', 'clear', '--yes']);
      expect(getLogOutput(consoleSpy)).toContain('5');
    });
  });

  // --------------------------------------------------------------------------
  // context subcommand
  // --------------------------------------------------------------------------

  describe('context', () => {
    it('should call tracker.buildContextBlock()', async () => {
      await program.parseAsync(['node', 'buddy', 'lessons', 'context']);
      expect(mockTracker.buildContextBlock).toHaveBeenCalled();
    });

    it('should print "No lessons" when buildContextBlock returns null', async () => {
      mockTracker.buildContextBlock.mockReturnValue(null);
      await program.parseAsync(['node', 'buddy', 'lessons', 'context']);
      expect(getLogOutput(consoleSpy)).toContain('No lessons');
    });

    it('should print the block when buildContextBlock returns a string', async () => {
      mockTracker.buildContextBlock.mockReturnValue('<lessons_context>block</lessons_context>');
      await program.parseAsync(['node', 'buddy', 'lessons', 'context']);
      expect(getLogOutput(consoleSpy)).toContain('<lessons_context>');
    });
  });
});
