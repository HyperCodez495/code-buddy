/**
 * ProjectMemoryService — Claude Cowork parity
 *
 * Loads project-scoped MEMORY.md at session start and consolidates new
 * memories from the session transcript at session end. Leverages the
 * existing memory-consolidation module from Code Buddy core.
 *
 * @module main/project/project-memory
 */

import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { log, logError, logWarn } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';
import type { ProjectManager, Project } from './project-manager';

export interface MemoryEntry {
  category: 'preference' | 'pattern' | 'context' | 'decision';
  content: string;
  sourceSessionId?: string;
  timestamp: number;
}

export interface ConsolidationSummary {
  added: number;
  duplicatesSkipped: number;
  memoryDir: string;
}

export interface MemoryCandidate {
  category: MemoryEntry['category'];
  content: string;
  sourceSessionId?: string;
  sourceKind: 'user' | 'assistant';
  evidence: string;
}

// Lazy reference to the core memory-consolidation module
type MemoryConsolidationModule = {
  extractMemoriesFromMessages: (
    messages: Array<{ role: string; content: string }>,
    source?: string
  ) => Array<{
    id: string;
    source: string;
    raw: string;
    summary: string;
    category: 'preference' | 'pattern' | 'context' | 'decision';
    timestamp: string;
  }>;
  consolidateMemories: (
    memories: Array<{
      id: string;
      source: string;
      raw: string;
      summary: string;
      category: string;
      timestamp: string;
    }>,
    cwd?: string
  ) => { memoriesAdded: number; duplicatesSkipped: number; memoryDir: string };
  loadMemorySummary: (cwd?: string) => string | null;
};

let cachedModule: MemoryConsolidationModule | null = null;

async function loadModule(): Promise<MemoryConsolidationModule | null> {
  if (cachedModule) return cachedModule;
  const mod = await loadCoreModule<MemoryConsolidationModule>('memory/memory-consolidation.js');
  if (mod) cachedModule = mod;
  return mod;
}

export class ProjectMemoryService {
  private projectManager: ProjectManager;

  constructor(projectManager: ProjectManager) {
    this.projectManager = projectManager;
  }

  /** Load the memory summary + detailed memory for a project as injectable system context. */
  async loadProjectContext(projectId: string): Promise<string | null> {
    const project = this.projectManager.get(projectId);
    if (!project?.workspacePath) return null;
    if (!existsSync(project.workspacePath)) return null;

    const memoryDir = join(project.workspacePath, '.codebuddy', 'memory');
    if (!existsSync(memoryDir)) return null;

    const summaryFile = join(memoryDir, 'memory_summary.md');
    const memoryFile = join(memoryDir, 'MEMORY.md');

    const parts: string[] = [];

    if (existsSync(summaryFile)) {
      try {
        const content = readFileSync(summaryFile, 'utf-8').trim();
        if (content) parts.push(content);
      } catch (err) {
        logWarn('[ProjectMemory] Failed to read summary:', err);
      }
    }

    if (existsSync(memoryFile)) {
      try {
        const content = readFileSync(memoryFile, 'utf-8').trim();
        if (content) {
          // Cap MEMORY.md at ~8KB to keep context budget reasonable
          const capped = content.length > 8000 ? content.slice(0, 8000) + '\n...[truncated]' : content;
          parts.push(capped);
        }
      } catch (err) {
        logWarn('[ProjectMemory] Failed to read MEMORY.md:', err);
      }
    }

    if (parts.length === 0) return null;

    return `<project_memory project="${project.name}">\n${parts.join('\n\n')}\n</project_memory>`;
  }

  /** Consolidate new memories from a session transcript into the project. */
  async consolidateSessionMemory(
    projectId: string,
    sessionId: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<ConsolidationSummary | null> {
    const project = this.projectManager.get(projectId);
    if (!project?.workspacePath) {
      log('[ProjectMemory] Skip consolidation — project has no workspace:', projectId);
      return null;
    }
    if (!project.memoryConfig?.autoConsolidate) {
      log('[ProjectMemory] Skip consolidation — autoConsolidate disabled:', projectId);
      return null;
    }

    const mod = await loadModule();
    if (!mod) {
      // Fallback: simple MEMORY.md append
      return this.fallbackConsolidation(project, sessionId, messages);
    }

    try {
      const extracted = mod.extractMemoriesFromMessages(messages, `session:${sessionId}`);
      const semanticCandidates = this.extractMemoryCandidates(messages, sessionId);
      if (extracted.length === 0) {
        log('[ProjectMemory] No memories extracted from session:', sessionId);
        if (semanticCandidates.length === 0) {
          return {
            added: 0,
            duplicatesSkipped: 0,
            memoryDir: join(project.workspacePath, '.codebuddy', 'memory'),
          };
        }
        return this.fallbackConsolidation(project, sessionId, messages, semanticCandidates);
      }

      const result = mod.consolidateMemories(extracted, project.workspacePath);
      log('[ProjectMemory] Consolidated', result.memoriesAdded, 'memories for project', project.name);
      return {
        added: result.memoriesAdded,
        duplicatesSkipped: result.duplicatesSkipped,
        memoryDir: result.memoryDir,
      };
    } catch (err) {
      logError('[ProjectMemory] Consolidation failed:', err);
      return null;
    }
  }

  /** Preview the candidate memories that would be consolidated from a session transcript. */
  previewProjectMemory(
    projectId: string,
    sessionId: string,
    messages: Array<{ role: string; content: string }>
  ): {
    projectId: string;
    candidateCount: number;
    candidates: MemoryCandidate[];
    hasWorkspace: boolean;
    projectMemoryPath?: string;
  } | null {
    const project = this.projectManager.get(projectId);
    if (!project) return null;
    const candidates = this.extractMemoryCandidates(messages, sessionId);
    const projectMemoryPath = project.workspacePath
      ? join(project.workspacePath, '.codebuddy', 'memory')
      : undefined;
    return {
      projectId,
      candidateCount: candidates.length,
      candidates,
      hasWorkspace: Boolean(project.workspacePath),
      ...(projectMemoryPath ? { projectMemoryPath } : {}),
    };
  }

  extractMemoryCandidates(
    messages: Array<{ role: string; content: string }>,
    sessionId: string
  ): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];
    const seen = new Set<string>();
    for (const message of messages) {
      const lines = message.content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      for (const line of lines) {
        const sourceKind = message.role === 'assistant' ? 'assistant' : 'user';
        const candidate = this.classifyMemoryLine(line, sourceKind, sessionId);
        if (!candidate) continue;
        const key = `${candidate.category}:${candidate.content.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(candidate);
      }
    }
    return candidates.slice(0, 12);
  }

  /** Fallback consolidation: basic keyword-based extraction + append to MEMORY.md */
  private fallbackConsolidation(
    project: Project,
    sessionId: string,
    messages: Array<{ role: string; content: string }>,
    precomputedCandidates?: MemoryCandidate[]
  ): ConsolidationSummary {
    const memoryDir = join(project.workspacePath!, '.codebuddy', 'memory');
    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true });
    }
    const memoryFile = join(memoryDir, 'MEMORY.md');

    const candidates = precomputedCandidates ?? this.extractMemoryCandidates(messages, sessionId);
    const entries = candidates.map((candidate) => {
      const sourceSession = candidate.sourceSessionId ?? sessionId;
      return `- [${candidate.category}] ${candidate.content} (from session:${sourceSession}; source:${candidate.sourceKind}; evidence:${candidate.evidence})`;
    });

    if (entries.length === 0) {
      return { added: 0, duplicatesSkipped: 0, memoryDir };
    }

    let existing = '';
    if (existsSync(memoryFile)) {
      existing = readFileSync(memoryFile, 'utf-8');
    }

    const existingLines = new Set(existing.split('\n').map((l) => l.trim()));
    const newEntries = entries.filter((e) => !existingLines.has(e));

    if (newEntries.length === 0) {
      return { added: 0, duplicatesSkipped: entries.length, memoryDir };
    }

    const appended =
      existing +
      (existing.endsWith('\n') ? '' : '\n') +
      `\n## Session ${sessionId} (${new Date().toISOString()})\n` +
      newEntries.join('\n') +
      '\n';

    writeFileSync(memoryFile, appended, 'utf-8');
    return { added: newEntries.length, duplicatesSkipped: entries.length - newEntries.length, memoryDir };
  }

  private classifyMemoryLine(
    line: string,
    role: 'user' | 'assistant',
    sessionId: string
  ): MemoryCandidate | null {
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (normalized.length < 12) return null;

    const preferenceMatch = normalized.match(
      /(?:prefer|please use|use|always|never|must|should|avoid)\b(.+)/i
    );
    if (preferenceMatch) {
      return {
        category: 'preference',
        content: preferenceMatch[1].trim().replace(/^[,:;-]\s*/, ''),
        sourceSessionId: sessionId,
        sourceKind: role,
        evidence: normalized.slice(0, 120),
      };
    }

    const decisionMatch = normalized.match(/(?:decided|decision|chosen|selected|we will|will use)\b(.+)/i);
    if (decisionMatch) {
      return {
        category: 'decision',
        content: decisionMatch[1].trim().replace(/^[,:;-]\s*/, ''),
        sourceSessionId: sessionId,
        sourceKind: role,
        evidence: normalized.slice(0, 120),
      };
    }

    const contextMatch = normalized.match(/(?:context|important|remember|note|constraint|rule)\b(.+)/i);
    if (contextMatch) {
      return {
        category: 'context',
        content: contextMatch[1].trim().replace(/^[,:;-]\s*/, ''),
        sourceSessionId: sessionId,
        sourceKind: role,
        evidence: normalized.slice(0, 120),
      };
    }

    const patternMatch = normalized.match(/(?:pattern|repeated|usually|typically|for now|from now on)\b(.+)/i);
    if (patternMatch) {
      return {
        category: 'pattern',
        content: patternMatch[1].trim().replace(/^[,:;-]\s*/, ''),
        sourceSessionId: sessionId,
        sourceKind: role,
        evidence: normalized.slice(0, 120),
      };
    }

    return null;
  }

  /** Read memories from MEMORY.md, returning a parsed list for the browser UI. */
  listMemoryEntries(projectId: string): MemoryEntry[] {
    const project = this.projectManager.get(projectId);
    if (!project?.workspacePath) return [];

    const memoryFile = join(project.workspacePath, '.codebuddy', 'memory', 'MEMORY.md');
    if (!existsSync(memoryFile)) return [];

    try {
      const content = readFileSync(memoryFile, 'utf-8');
      const entries: MemoryEntry[] = [];
      const lineRegex = /^- \[(preference|pattern|context|decision)\]\s*(.+?)(?:\s*\(from session:([^)]+)\))?$/;

      for (const line of content.split('\n')) {
        const match = line.match(lineRegex);
        if (match) {
          entries.push({
            category: match[1] as MemoryEntry['category'],
            content: match[2].trim(),
            sourceSessionId: match[3],
            timestamp: Date.now(),
          });
        }
      }

      return entries;
    } catch (err) {
      logError('[ProjectMemory] Failed to list memory entries:', err);
      return [];
    }
  }

  /**
   * Phase 2 step 17: add a memory entry by appending a new line to MEMORY.md.
   */
  addMemoryEntry(
    projectId: string,
    category: 'preference' | 'pattern' | 'context' | 'decision',
    content: string
  ): { success: boolean; error?: string } {
    const project = this.projectManager.get(projectId);
    if (!project?.workspacePath) {
      return { success: false, error: 'Project has no workspace' };
    }
    const memoryDir = join(project.workspacePath, '.codebuddy', 'memory');
    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true });
    }
    const memoryFile = join(memoryDir, 'MEMORY.md');
    const sanitized = content.replace(/[\r\n]+/g, ' ').trim();
    if (!sanitized) {
      return { success: false, error: 'Empty content' };
    }
    const line = `- [${category}] ${sanitized}`;
    try {
      const existing = existsSync(memoryFile) ? readFileSync(memoryFile, 'utf-8') : '';
      const next = existing.endsWith('\n') || existing === '' ? `${existing}${line}\n` : `${existing}\n${line}\n`;
      writeFileSync(memoryFile, next, 'utf-8');
      return { success: true };
    } catch (err) {
      logError('[ProjectMemory] addMemoryEntry failed:', err);
      return { success: false, error: (err as Error).message };
    }
  }

  /** Update the content of the Nth matching memory entry (0-indexed). */
  updateMemoryEntry(
    projectId: string,
    entryIndex: number,
    newContent: string,
    newCategory?: 'preference' | 'pattern' | 'context' | 'decision'
  ): { success: boolean; error?: string } {
    const project = this.projectManager.get(projectId);
    if (!project?.workspacePath) {
      return { success: false, error: 'Project has no workspace' };
    }
    const memoryFile = join(project.workspacePath, '.codebuddy', 'memory', 'MEMORY.md');
    if (!existsSync(memoryFile)) {
      return { success: false, error: 'MEMORY.md not found' };
    }
    try {
      const content = readFileSync(memoryFile, 'utf-8');
      const lineRegex = /^- \[(preference|pattern|context|decision)\]\s*(.+?)(?:\s*\(from session:([^)]+)\))?$/;
      const lines = content.split('\n');
      let matchIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lineRegex.test(lines[i])) {
          matchIndex++;
          if (matchIndex === entryIndex) {
            const parts = lines[i].match(lineRegex);
            if (!parts) continue;
            const category = newCategory ?? (parts[1] as MemoryEntry['category']);
            const session = parts[3] ? ` (from session:${parts[3]})` : '';
            const sanitized = newContent.replace(/[\r\n]+/g, ' ').trim();
            lines[i] = `- [${category}] ${sanitized}${session}`;
            writeFileSync(memoryFile, lines.join('\n'), 'utf-8');
            return { success: true };
          }
        }
      }
      return { success: false, error: `Entry at index ${entryIndex} not found` };
    } catch (err) {
      logError('[ProjectMemory] updateMemoryEntry failed:', err);
      return { success: false, error: (err as Error).message };
    }
  }

  /** Delete the Nth matching memory entry (0-indexed). */
  deleteMemoryEntry(
    projectId: string,
    entryIndex: number
  ): { success: boolean; error?: string } {
    const project = this.projectManager.get(projectId);
    if (!project?.workspacePath) {
      return { success: false, error: 'Project has no workspace' };
    }
    const memoryFile = join(project.workspacePath, '.codebuddy', 'memory', 'MEMORY.md');
    if (!existsSync(memoryFile)) {
      return { success: false, error: 'MEMORY.md not found' };
    }
    try {
      const content = readFileSync(memoryFile, 'utf-8');
      const lineRegex = /^- \[(preference|pattern|context|decision)\]\s*(.+?)(?:\s*\(from session:([^)]+)\))?$/;
      const lines = content.split('\n');
      let matchIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lineRegex.test(lines[i])) {
          matchIndex++;
          if (matchIndex === entryIndex) {
            lines.splice(i, 1);
            writeFileSync(memoryFile, lines.join('\n'), 'utf-8');
            return { success: true };
          }
        }
      }
      return { success: false, error: `Entry at index ${entryIndex} not found` };
    } catch (err) {
      logError('[ProjectMemory] deleteMemoryEntry failed:', err);
      return { success: false, error: (err as Error).message };
    }
  }
}
