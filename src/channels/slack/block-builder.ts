/**
 * Slack Block Kit Builder
 *
 * Native Engine v2026.3.12 alignment: fluent API for building Block Kit messages.
 * Supports `channelData.slack.blocks` passthrough and markdown auto-formatting.
 */

import type {
  SlackBlock,
  SlackSectionBlock,
  SlackDividerBlock,
  SlackHeaderBlock,
  SlackContextBlock,
  SlackActionsBlock,
  SlackImageBlock,
  SlackTableBlock,
  SlackTextObject,
  SlackBlockElement,
} from './types.js';

// Native table block limits (docs.slack.dev/reference/block-kit/blocks/table-block).
const TABLE_MAX_ROWS = 100;
const TABLE_MAX_COLS = 20;
const TABLE_MAX_CHARS = 10_000;

/**
 * Fluent builder for Slack Block Kit messages
 */
export class SlackBlockBuilder {
  private blocks: SlackBlock[] = [];

  /**
   * Add a header block
   */
  header(text: string): this {
    this.blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: text.slice(0, 150), emoji: true },
    } as SlackHeaderBlock);
    return this;
  }

  /**
   * Add a section block with mrkdwn text
   */
  section(text: string, blockId?: string): this {
    const block: SlackSectionBlock = {
      type: 'section',
      text: { type: 'mrkdwn', text },
    };
    if (blockId) block.block_id = blockId;
    this.blocks.push(block);
    return this;
  }

  /**
   * Add a section block with fields (2-column layout)
   */
  sectionFields(fields: string[], blockId?: string): this {
    const block: SlackSectionBlock = {
      type: 'section',
      fields: fields.map(f => ({ type: 'mrkdwn', text: f })),
    };
    if (blockId) block.block_id = blockId;
    this.blocks.push(block);
    return this;
  }

  /**
   * Add a section with an accessory element
   */
  sectionWithAccessory(text: string, accessory: SlackBlockElement): this {
    this.blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text },
      accessory,
    } as SlackSectionBlock);
    return this;
  }

  /**
   * Add a divider block
   */
  divider(): this {
    this.blocks.push({ type: 'divider' } as SlackDividerBlock);
    return this;
  }

  /**
   * Add a context block (small text / images)
   */
  context(elements: (string | SlackTextObject)[]): this {
    this.blocks.push({
      type: 'context',
      elements: elements.map(el =>
        typeof el === 'string' ? { type: 'mrkdwn', text: el } : el
      ),
    } as SlackContextBlock);
    return this;
  }

  /**
   * Add an actions block with interactive elements
   */
  actions(elements: SlackBlockElement[], blockId?: string): this {
    const block: SlackActionsBlock = {
      type: 'actions',
      elements,
    };
    if (blockId) block.block_id = blockId;
    this.blocks.push(block);
    return this;
  }

  /**
   * Add an image block
   */
  image(imageUrl: string, altText: string, blockId?: string): this {
    const block: SlackImageBlock = {
      type: 'image',
      image_url: imageUrl,
      alt_text: altText,
    };
    if (blockId) block.block_id = blockId;
    this.blocks.push(block);
    return this;
  }

  /**
   * Add a NATIVE table block (rows of plain-text cells). Slack caps tables at
   * 100 rows × 20 columns and 10 000 chars across all cells — an oversized
   * table falls back to a monospace code section so nothing is silently lost.
   */
  table(rows: string[][]): this {
    const clipped = rows.slice(0, TABLE_MAX_ROWS).map((row) => row.slice(0, TABLE_MAX_COLS));
    const totalChars = clipped.reduce((sum, row) => sum + row.reduce((s, c) => s + c.length, 0), 0);
    if (rows.length > TABLE_MAX_ROWS || rows.some((r) => r.length > TABLE_MAX_COLS) || totalChars > TABLE_MAX_CHARS) {
      const fence = rows.map((row) => row.join(' | ')).join('\n');
      return this.section('```\n' + fence.slice(0, 2900) + '\n```');
    }
    const block: SlackTableBlock = {
      type: 'table',
      rows: clipped.map((row) => row.map((text) => ({ type: 'raw_text' as const, text }))),
    };
    this.blocks.push(block);
    return this;
  }

  /**
   * Build and return the blocks array
   */
  build(): SlackBlock[] {
    return [...this.blocks];
  }
}

/**
 * Best-effort standard-markdown → Slack mrkdwn conversion for section text.
 * Slack's dialect: *bold*, _italic_, ~strike~, <url|label>. Inline code and
 * fenced blocks pass through untouched.
 */
export function toSlackMrkdwn(text: string): string {
  const segments = text.split(/(```[\s\S]*?```|`[^`\n]*`)/);
  return segments
    .map((segment, i) => {
      if (i % 2 === 1) return segment; // code segment — untouched
      return segment
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<$2|$1>')
        .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
        .replace(/~~([^~\n]+)~~/g, '~$1~');
    })
    .join('');
}

/** Parse one markdown table (header, `|---|` separator, body) into cell rows. */
function parseMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

/**
 * Auto-format markdown content as Slack Block Kit blocks
 *
 * Converts common markdown patterns:
 * - `# heading` → header block
 * - `---` → divider block
 * - ```` ```code``` ```` → section with mrkdwn
 * - Regular text → section block
 */
export function formatResponseAsBlocks(content: string): SlackBlock[] {
  const builder = new SlackBlockBuilder();
  const lines = content.split('\n');
  let buffer = '';
  let inCodeBlock = false;

  function flushBuffer(): void {
    const text = buffer.trim();
    if (text) {
      // Code fences keep their exact content; prose is converted to mrkdwn.
      builder.section(text.startsWith('```') ? text : toSlackMrkdwn(text));
    }
    buffer = '';
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Toggle code block
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        buffer += line + '\n';
        // End of code block — flush as single section
        flushBuffer();
        inCodeBlock = false;
      } else {
        // Start of code block — flush any preceding text
        flushBuffer();
        inCodeBlock = true;
        buffer += line + '\n';
      }
      continue;
    }

    if (inCodeBlock) {
      buffer += line + '\n';
      continue;
    }

    // Markdown table (header row + |---| separator) → NATIVE table block.
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      flushBuffer();
      const rows: string[][] = [parseMarkdownTableRow(line)];
      let j = i + 2; // skip the separator line
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j]!)) {
        rows.push(parseMarkdownTableRow(lines[j]!));
        j++;
      }
      builder.table(rows);
      i = j - 1;
      continue;
    }

    // Heading → header block
    if (/^#{1,3}\s+/.test(line)) {
      flushBuffer();
      const headingText = line.replace(/^#{1,3}\s+/, '');
      builder.header(headingText);
      continue;
    }

    // Horizontal rule → divider
    if (/^---+\s*$/.test(line)) {
      flushBuffer();
      builder.divider();
      continue;
    }

    // Accumulate regular text
    buffer += line + '\n';
  }

  // Flush remaining buffer
  flushBuffer();

  return builder.build();
}
