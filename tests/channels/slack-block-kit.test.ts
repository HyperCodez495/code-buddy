/**
 * Opt-in Slack Block Kit rendering — native table blocks + mrkdwn conversion
 * (Hermes v2026.7.1 parity: b080b93ad / 7c7b48981).
 *
 * Table-block schema per docs.slack.dev/reference/block-kit/blocks/table-block
 * (verified 2026-07-03): {type:'table', rows: [[{type:'raw_text', text}]]},
 * caps 100 rows × 20 cols, ≤10 000 chars across cells.
 */
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
global.fetch = mockFetch as unknown as typeof fetch;

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SlackBlockBuilder,
  formatResponseAsBlocks,
  toSlackMrkdwn,
} from '../../src/channels/slack/block-builder.js';
import type { SlackTableBlock, SlackSectionBlock } from '../../src/channels/slack/types.js';
import { SlackChannel } from '../../src/channels/slack/index.js';

describe('toSlackMrkdwn', () => {
  it('converts standard markdown to the Slack dialect', () => {
    expect(toSlackMrkdwn('**bold** and ~~gone~~ and [doc](https://ex.tld/p)')).toBe(
      '*bold* and ~gone~ and <https://ex.tld/p|doc>'
    );
  });

  it('leaves inline code and fenced blocks untouched', () => {
    expect(toSlackMrkdwn('use `**not bold**` here')).toBe('use `**not bold**` here');
    expect(toSlackMrkdwn('```\n**raw**\n```')).toBe('```\n**raw**\n```');
  });
});

describe('SlackBlockBuilder.table', () => {
  it('emits a native table block with raw_text cells', () => {
    const blocks = new SlackBlockBuilder().table([
      ['Nom', 'Statut'],
      ['gate', 'vert'],
    ]).build();
    expect(blocks).toHaveLength(1);
    const table = blocks[0] as SlackTableBlock;
    expect(table.type).toBe('table');
    expect(table.rows).toEqual([
      [{ type: 'raw_text', text: 'Nom' }, { type: 'raw_text', text: 'Statut' }],
      [{ type: 'raw_text', text: 'gate' }, { type: 'raw_text', text: 'vert' }],
    ]);
  });

  it('falls back to a code section when Slack caps are exceeded (nothing silently lost)', () => {
    const tooManyRows = Array.from({ length: 101 }, (_, i) => [`r${i}`, 'x']);
    const blocks = new SlackBlockBuilder().table(tooManyRows).build();
    expect(blocks[0]!.type).toBe('section');
    expect((blocks[0] as SlackSectionBlock).text?.text).toContain('r100');
  });
});

describe('formatResponseAsBlocks with tables + mrkdwn', () => {
  it('renders a markdown table as a NATIVE table block between prose sections', () => {
    const md = [
      '# Résultats',
      'Voici le **résumé** :',
      '| Fichier | Tests |',
      '|---|---|',
      '| a.ts | 12 |',
      '| b.ts | 7 |',
      'Fin.',
    ].join('\n');
    const blocks = formatResponseAsBlocks(md);
    const types = blocks.map((b) => b.type);
    expect(types).toEqual(['header', 'section', 'table', 'section']);

    const table = blocks[2] as SlackTableBlock;
    expect(table.rows).toHaveLength(3); // header row + 2 body rows (separator dropped)
    expect(table.rows[0]![0]!.text).toBe('Fichier');
    expect(table.rows[2]![1]!.text).toBe('7');

    // Prose got the mrkdwn conversion.
    expect((blocks[1] as SlackSectionBlock).text?.text).toContain('*résumé*');
  });

  it('keeps code fences verbatim (no mrkdwn mangling)', () => {
    const blocks = formatResponseAsBlocks('```ts\nconst x = **not bold**;\n```');
    expect((blocks[0] as SlackSectionBlock).text?.text).toContain('**not bold**');
  });
});

describe('SlackChannel.send opt-in Block Kit', () => {
  let channel: SlackChannel;
  const envBefore = process.env.CODEBUDDY_SLACK_BLOCK_KIT;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, ts: '123.456', channel: 'C1' }),
    });
    channel = new SlackChannel({ type: 'slack', enabled: true, token: 'xoxb-test', signingSecret: 's' });
  });

  afterEach(async () => {
    if (envBefore === undefined) delete process.env.CODEBUDDY_SLACK_BLOCK_KIT;
    else process.env.CODEBUDDY_SLACK_BLOCK_KIT = envBefore;
    await channel.disconnect();
  });

  const postedBody = (): Record<string, unknown> => {
    const call = mockFetch.mock.calls.find((c) => String(c[0]).includes('chat.postMessage'));
    expect(call).toBeDefined();
    return JSON.parse((call![1] as { body: string }).body) as Record<string, unknown>;
  };

  it('renders agent markdown to blocks when CODEBUDDY_SLACK_BLOCK_KIT=true (text stays as fallback)', async () => {
    process.env.CODEBUDDY_SLACK_BLOCK_KIT = 'true';
    const content = '# Titre\n| a | b |\n|---|---|\n| 1 | 2 |';
    const result = await channel.send({ channelId: 'C1', content });
    expect(result.success).toBe(true);

    const body = postedBody();
    expect(body.text).toBe(content); // notification fallback carries full content
    const blocks = body.blocks as Array<{ type: string }>;
    expect(blocks.map((b) => b.type)).toEqual(['header', 'table']);
  });

  it('sends plain text with NO blocks when the flag is off (default unchanged)', async () => {
    delete process.env.CODEBUDDY_SLACK_BLOCK_KIT;
    await channel.send({ channelId: 'C1', content: '# Titre\nplain' });
    expect(postedBody().blocks).toBeUndefined();
  });
});
