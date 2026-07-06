/**
 * doc-block-model — real tests (no mocks): parse the agent-emitted ```doc
 * block into DocPreview blocks, strip it, pick the newest, build the prompts.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDocExportPrompt,
  buildDocGenerationPrompt,
  latestDocBlock,
  parseDocBlock,
  stripDocBlocks,
} from '../src/renderer/components/deliverables/doc-block-model';

const block = (json: string) => 'Voici le document :\n```doc\n' + json + '\n```\nRésumé.';

describe('parseDocBlock', () => {
  it('parses a real doc block with mixed block types', () => {
    const doc = parseDocBlock(
      block(
        JSON.stringify({
          title: 'Note de cadrage',
          blocks: [
            { type: 'h1', text: 'Note de cadrage' },
            { type: 'p', text: 'Contexte concret.' },
            { type: 'list', items: ['point 1', 'point 2'] },
            { type: 'quote', text: 'Une citation.' },
          ],
        }),
      ),
    )!;
    expect(doc.title).toBe('Note de cadrage');
    expect(doc.blocks).toHaveLength(4);
    expect(doc.blocks[2]).toEqual({ type: 'list', items: ['point 1', 'point 2'] });
  });

  it('falls back to the h1 as title, drops unknown/empty blocks, rejects malformed', () => {
    const doc = parseDocBlock(
      block('{"blocks":[{"type":"h1","text":"Mon titre"},{"type":"weird","text":"x"},{"type":"p"}]}'),
    )!;
    expect(doc.title).toBe('Mon titre');
    expect(doc.blocks).toHaveLength(1);

    expect(parseDocBlock(block('{oops'))).toBeNull();
    expect(parseDocBlock(block('{"blocks":[]}'))).toBeNull();
    expect(parseDocBlock('pas de bloc')).toBeNull();
  });
});

describe('stripDocBlocks', () => {
  it('hides the block from the visible reply', () => {
    const text = 'Avant.\n```doc\n{"blocks":[{"type":"p","text":"x"}]}\n```\nAprès.';
    expect(stripDocBlocks(text)).toBe('Avant.\n\nAprès.');
  });
});

describe('latestDocBlock', () => {
  const msg = (role: string, text: string) => ({ role, content: [{ type: 'text', text }] });
  const docText = (title: string) =>
    '```doc\n{"title":"' + title + '","blocks":[{"type":"p","text":"x"}]}\n```';

  it('prefers the streaming partial, else the newest assistant doc', () => {
    const messages = [msg('assistant', docText('Ancien')), msg('assistant', docText('Récent'))];
    expect(latestDocBlock(messages)!.title).toBe('Récent');
    expect(latestDocBlock(messages, docText('Live'))!.title).toBe('Live');
    expect(latestDocBlock([msg('user', 'salut')])).toBeNull();
  });
});

describe('prompts', () => {
  it('generation prompt carries the subject and the no-tools contract', () => {
    const p = buildDocGenerationPrompt('note de cadrage bêta');
    expect(p).toContain('note de cadrage bêta');
    expect(p).toContain('```doc');
    expect(p).toContain("N'utilise AUCUN outil");
  });

  it('export prompt embeds the parsed doc for the docx skill', () => {
    const p = buildDocExportPrompt({ title: 'Mon doc', blocks: [{ type: 'p', text: 'x' }] });
    expect(p).toContain('skill docx');
    expect(p).toContain('« Mon doc.docx »');
    expect(p).toContain('"blocks"');
  });
});
