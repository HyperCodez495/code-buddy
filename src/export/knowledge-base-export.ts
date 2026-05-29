/**
 * Knowledge Base Export
 *
 * Export sessions and documentation to knowledge base platforms:
 * - Notion
 * - Obsidian (local markdown vault)
 *
 * Features:
 * - Session export with metadata
 * - Code block formatting
 * - Internal linking
 * - Tag preservation
 */

import fs from 'fs-extra';
import path from 'path';
import { EventEmitter } from 'events';

export interface ExportOptions {
  /** Include timestamps */
  includeTimestamps?: boolean;
  /** Include tool outputs */
  includeToolOutputs?: boolean;
  /** Include metadata */
  includeMetadata?: boolean;
  /** Tags to add */
  tags?: string[];
  /** Custom frontmatter */
  frontmatter?: Record<string, string | number | boolean | string[]>;
}

export interface SessionData {
  id: string;
  name: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: Date;
    toolCalls?: Array<{
      name: string;
      input: string;
      output: string;
    }>;
  }>;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotionConfig {
  apiKey: string;
  parentPageId?: string;
  databaseId?: string;
}

export interface ObsidianConfig {
  vaultPath: string;
  folderPath?: string;
  templatePath?: string;
}

/**
 * Abstract base for knowledge base exporters
 */
abstract class KnowledgeBaseExporter extends EventEmitter {
  abstract export(session: SessionData, options?: ExportOptions): Promise<string>;
  abstract testConnection(): Promise<boolean>;
}

/**
 * Notion Exporter
 */
export class NotionExporter extends KnowledgeBaseExporter {
  private config: NotionConfig;
  private readonly apiUrl = 'https://api.notion.com/v1';

  constructor(config: NotionConfig) {
    super();
    this.config = config;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: object
  ): Promise<T> {
    const response = await fetch(`${this.apiUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Notion API error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Export a session to Notion
   */
  async export(session: SessionData, options: ExportOptions = {}): Promise<string> {
    const blocks = this.sessionToNotionBlocks(session, options);

    // Create the page
    const pageData: NotionPageCreate = {
      parent: this.config.databaseId
        ? { database_id: this.config.databaseId }
        : { page_id: this.config.parentPageId! },
      properties: this.buildProperties(session, options),
      children: blocks,
    };

    const result = await this.request<{ id: string; url: string }>('POST', '/pages', pageData);

    this.emit('exported', { platform: 'notion', pageId: result.id, url: result.url });
    return result.url;
  }

  private buildProperties(session: SessionData, options: ExportOptions): Record<string, NotionProperty> {
    const properties: Record<string, NotionProperty> = {
      title: {
        title: [{ text: { content: session.name || `Session ${session.id}` } }],
      },
    };

    // Add tags if database has multi_select property
    if (options.tags && options.tags.length > 0) {
      properties.Tags = {
        multi_select: options.tags.map((tag) => ({ name: tag })),
      };
    }

    // Add date property
    if (options.includeTimestamps) {
      properties.Date = {
        date: { start: session.createdAt.toISOString() },
      };
    }

    return properties;
  }

  private sessionToNotionBlocks(session: SessionData, options: ExportOptions): NotionBlock[] {
    const blocks: NotionBlock[] = [];

    // Add metadata section
    if (options.includeMetadata) {
      blocks.push({
        type: 'callout',
        callout: {
          icon: { emoji: '📋' },
          rich_text: [
            {
              type: 'text',
              text: { content: `Session ID: ${session.id}\nCreated: ${session.createdAt.toLocaleString()}` },
            },
          ],
        },
      });
      blocks.push({ type: 'divider', divider: {} });
    }

    // Add messages
    for (const message of session.messages) {
      if (message.role === 'system') continue;

      // Role header
      blocks.push({
        type: 'heading_3',
        heading_3: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: message.role === 'user' ? '👤 User' : '🤖 Assistant',
              },
            },
          ],
        },
      });

      // Timestamp if enabled
      if (options.includeTimestamps && message.timestamp) {
        blocks.push({
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: message.timestamp.toLocaleString() },
                annotations: { color: 'gray' },
              },
            ],
          },
        });
      }

      // Message content - split by code blocks
      const parts = this.parseContent(message.content);
      for (const part of parts) {
        if (part.type === 'code') {
          blocks.push({
            type: 'code',
            code: {
              rich_text: [{ type: 'text', text: { content: part.content } }],
              language: part.language || 'plain text',
            },
          });
        } else {
          // Split long text into paragraphs
          const paragraphs = part.content.split('\n\n').filter((p) => p.trim());
          for (const para of paragraphs) {
            blocks.push({
              type: 'paragraph',
              paragraph: {
                rich_text: [{ type: 'text', text: { content: para } }],
              },
            });
          }
        }
      }

      // Tool calls if enabled
      if (options.includeToolOutputs && message.toolCalls) {
        for (const tool of message.toolCalls) {
          blocks.push({
            type: 'toggle',
            toggle: {
              rich_text: [
                {
                  type: 'text',
                  text: { content: `🔧 Tool: ${tool.name}` },
                },
              ],
              children: [
                {
                  type: 'code',
                  code: {
                    rich_text: [{ type: 'text', text: { content: tool.output } }],
                    language: 'plain text',
                  },
                },
              ],
            },
          });
        }
      }

      blocks.push({ type: 'divider', divider: {} });
    }

    return blocks;
  }

  private parseContent(content: string): Array<{ type: 'text' | 'code'; content: string; language?: string }> {
    const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;

    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Add text before code block
      if (match.index > lastIndex) {
        const text = content.slice(lastIndex, match.index).trim();
        if (text) {
          parts.push({ type: 'text', content: text });
        }
      }

      // Add code block
      parts.push({
        type: 'code',
        content: (match[2] ?? '').trim(),
        language: match[1] || 'plain text',
      });

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      const text = content.slice(lastIndex).trim();
      if (text) {
        parts.push({ type: 'text', content: text });
      }
    }

    return parts;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.request('GET', '/users/me');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Obsidian Exporter (Local Markdown Vault)
 */
export class ObsidianExporter extends KnowledgeBaseExporter {
  private config: ObsidianConfig;

  constructor(config: ObsidianConfig) {
    super();
    this.config = config;
  }

  /**
   * Export a session to Obsidian vault
   */
  async export(session: SessionData, options: ExportOptions = {}): Promise<string> {
    const markdown = this.sessionToMarkdown(session, options);

    // Determine output path
    const folderPath = this.config.folderPath
      ? path.join(this.config.vaultPath, this.config.folderPath)
      : this.config.vaultPath;

    await fs.ensureDir(folderPath);

    const filename = this.sanitizeFilename(session.name || `Session ${session.id}`);
    const filePath = path.join(folderPath, `${filename}.md`);

    // Check for duplicates
    let finalPath = filePath;
    let counter = 1;
    while (await fs.pathExists(finalPath)) {
      finalPath = path.join(folderPath, `${filename} (${counter}).md`);
      counter++;
    }

    await fs.writeFile(finalPath, markdown, 'utf-8');

    this.emit('exported', { platform: 'obsidian', filePath: finalPath });
    return finalPath;
  }

  private sessionToMarkdown(session: SessionData, options: ExportOptions): string {
    const lines: string[] = [];

    // Frontmatter
    const frontmatter: Record<string, unknown> = {
      id: session.id,
      created: session.createdAt.toISOString(),
      updated: session.updatedAt.toISOString(),
      ...options.frontmatter,
    };

    if (options.tags && options.tags.length > 0) {
      frontmatter.tags = options.tags;
    }

    lines.push('---');
    for (const [key, value] of Object.entries(frontmatter)) {
      if (Array.isArray(value)) {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${item}`);
        }
      } else {
        lines.push(`${key}: ${JSON.stringify(value)}`);
      }
    }
    lines.push('---');
    lines.push('');

    // Title
    lines.push(`# ${session.name || `Session ${session.id}`}`);
    lines.push('');

    // Metadata callout
    if (options.includeMetadata) {
      lines.push('> [!info] Session Info');
      lines.push(`> - **ID**: ${session.id}`);
      lines.push(`> - **Created**: ${session.createdAt.toLocaleString()}`);
      lines.push(`> - **Updated**: ${session.updatedAt.toLocaleString()}`);
      if (session.metadata) {
        for (const [key, value] of Object.entries(session.metadata)) {
          lines.push(`> - **${key}**: ${JSON.stringify(value)}`);
        }
      }
      lines.push('');
    }

    // Messages
    for (const message of session.messages) {
      if (message.role === 'system') continue;

      // Role header with optional timestamp
      const roleEmoji = message.role === 'user' ? '👤' : '🤖';
      const roleName = message.role === 'user' ? 'User' : 'Assistant';
      const timestamp =
        options.includeTimestamps && message.timestamp
          ? ` - ${message.timestamp.toLocaleString()}`
          : '';

      lines.push(`## ${roleEmoji} ${roleName}${timestamp}`);
      lines.push('');

      // Message content
      lines.push(message.content);
      lines.push('');

      // Tool calls
      if (options.includeToolOutputs && message.toolCalls) {
        for (const tool of message.toolCalls) {
          lines.push(`> [!note]- 🔧 Tool: ${tool.name}`);
          lines.push('> ```');
          const outputLines = tool.output.split('\n');
          for (const line of outputLines) {
            lines.push(`> ${line}`);
          }
          lines.push('> ```');
          lines.push('');
        }
      }

      lines.push('---');
      lines.push('');
    }

    // Add links section
    lines.push('## Related');
    lines.push('');
    lines.push('- [[Code Buddy Sessions]]');
    if (options.tags) {
      for (const tag of options.tags) {
        lines.push(`- #${tag}`);
      }
    }

    return lines.join('\n');
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  async testConnection(): Promise<boolean> {
    try {
      await fs.access(this.config.vaultPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create an index file linking all exported sessions
   */
  async createIndex(title: string = 'Code Buddy Sessions'): Promise<string> {
    const folderPath = this.config.folderPath
      ? path.join(this.config.vaultPath, this.config.folderPath)
      : this.config.vaultPath;

    const files = await fs.readdir(folderPath);
    const mdFiles = files.filter((f) => f.endsWith('.md') && f !== `${title}.md`);

    const lines: string[] = [];
    lines.push('---');
    lines.push('tags: [index, code-buddy]');
    lines.push('---');
    lines.push('');
    lines.push(`# ${title}`);
    lines.push('');
    lines.push('## Sessions');
    lines.push('');

    for (const file of mdFiles.sort()) {
      const name = file.replace('.md', '');
      lines.push(`- [[${name}]]`);
    }

    const indexPath = path.join(folderPath, `${title}.md`);
    await fs.writeFile(indexPath, lines.join('\n'), 'utf-8');

    return indexPath;
  }
}

// Notion API types
interface NotionPageCreate {
  parent: { database_id: string } | { page_id: string };
  properties: Record<string, NotionProperty>;
  children: NotionBlock[];
}

interface NotionProperty {
  title?: Array<{ text: { content: string } }>;
  multi_select?: Array<{ name: string }>;
  date?: { start: string };
}

interface NotionBlock {
  type: string;
  callout?: {
    icon: { emoji: string };
    rich_text: Array<{ type: string; text: { content: string } }>;
  };
  divider?: Record<string, never>;
  heading_3?: {
    rich_text: Array<{ type: string; text: { content: string } }>;
  };
  paragraph?: {
    rich_text: Array<{
      type: string;
      text: { content: string };
      annotations?: { color?: string };
    }>;
  };
  code?: {
    rich_text: Array<{ type: string; text: { content: string } }>;
    language: string;
  };
  toggle?: {
    rich_text: Array<{ type: string; text: { content: string } }>;
    children?: NotionBlock[];
  };
}

/**
 * Knowledge Base Export Manager
 */
export class KnowledgeBaseExportManager extends EventEmitter {
  private notionExporter: NotionExporter | null = null;
  private obsidianExporter: ObsidianExporter | null = null;

  /**
   * Configure Notion export
   */
  configureNotion(config: NotionConfig): void {
    this.notionExporter = new NotionExporter(config);
    this.emit('configured', 'notion');
  }

  /**
   * Configure Obsidian export
   */
  configureObsidian(config: ObsidianConfig): void {
    this.obsidianExporter = new ObsidianExporter(config);
    this.emit('configured', 'obsidian');
  }

  /**
   * Export to Notion
   */
  async exportToNotion(session: SessionData, options?: ExportOptions): Promise<string> {
    if (!this.notionExporter) {
      throw new Error('Notion not configured. Call configureNotion() first.');
    }
    return this.notionExporter.export(session, options);
  }

  /**
   * Export to Obsidian
   */
  async exportToObsidian(session: SessionData, options?: ExportOptions): Promise<string> {
    if (!this.obsidianExporter) {
      throw new Error('Obsidian not configured. Call configureObsidian() first.');
    }
    return this.obsidianExporter.export(session, options);
  }

  /**
   * Export to all configured platforms
   */
  async exportToAll(
    session: SessionData,
    options?: ExportOptions
  ): Promise<{ notion?: string; obsidian?: string }> {
    const results: { notion?: string; obsidian?: string } = {};

    if (this.notionExporter) {
      results.notion = await this.notionExporter.export(session, options);
    }

    if (this.obsidianExporter) {
      results.obsidian = await this.obsidianExporter.export(session, options);
    }

    return results;
  }

  /**
   * Test connections to configured platforms
   */
  async testConnections(): Promise<{ notion?: boolean; obsidian?: boolean }> {
    const results: { notion?: boolean; obsidian?: boolean } = {};

    if (this.notionExporter) {
      results.notion = await this.notionExporter.testConnection();
    }

    if (this.obsidianExporter) {
      results.obsidian = await this.obsidianExporter.testConnection();
    }

    return results;
  }

  /**
   * Create Obsidian index
   */
  async createObsidianIndex(title?: string): Promise<string> {
    if (!this.obsidianExporter) {
      throw new Error('Obsidian not configured. Call configureObsidian() first.');
    }
    return this.obsidianExporter.createIndex(title);
  }
}

// Singleton instance
let exportManagerInstance: KnowledgeBaseExportManager | null = null;

/**
 * Get the knowledge base export manager
 */
export function getKnowledgeBaseExportManager(): KnowledgeBaseExportManager {
  if (!exportManagerInstance) {
    exportManagerInstance = new KnowledgeBaseExportManager();
  }
  return exportManagerInstance;
}

export default KnowledgeBaseExportManager;
