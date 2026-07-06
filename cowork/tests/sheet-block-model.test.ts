/**
 * sheet-block-model — real tests (no mocks): parse the agent-emitted ```sheet
 * block into SheetPreview data, strip it, pick the newest, build the prompts.
 */
import { describe, expect, it } from 'vitest';
import {
  buildSheetExportPrompt,
  buildSheetGenerationPrompt,
  latestSheetBlock,
  parseSheetBlock,
  stripSheetBlocks,
} from '../src/renderer/components/deliverables/sheet-block-model';

const block = (json: string) => 'Voici la feuille :\n```sheet\n' + json + '\n```\nRésumé.';

describe('parseSheetBlock', () => {
  it('parses a real sheet block, preserving number types', () => {
    const sheet = parseSheetBlock(
      block(
        JSON.stringify({
          title: 'Providers LLM',
          columns: ['Provider', 'Modèles', 'Coût $/M'],
          rows: [
            ['Ollama', 12, 0],
            ['Grok', 4, 2.5],
          ],
        }),
      ),
    )!;
    expect(sheet.title).toBe('Providers LLM');
    expect(sheet.columns).toEqual(['Provider', 'Modèles', 'Coût $/M']);
    expect(sheet.rows).toEqual([
      ['Ollama', 12, 0],
      ['Grok', 4, 2.5],
    ]);
  });

  it('normalizes odd cells, truncates to columns, rejects malformed blocks', () => {
    const sheet = parseSheetBlock(block('{"columns":["A","B"],"rows":[["x",null,"extra"],[true]]}'))!;
    expect(sheet.title).toBe('Feuille');
    expect(sheet.rows).toEqual([
      ['x', ''],
      ['true'],
    ]);

    expect(parseSheetBlock(block('{oops'))).toBeNull();
    expect(parseSheetBlock(block('{"columns":[],"rows":[["x"]]}'))).toBeNull();
    expect(parseSheetBlock(block('{"columns":["A"],"rows":[]}'))).toBeNull();
    expect(parseSheetBlock('pas de bloc')).toBeNull();
  });
});

describe('stripSheetBlocks', () => {
  it('hides the block from the visible reply', () => {
    const text = 'Avant.\n```sheet\n{"columns":["A"],"rows":[["x"]]}\n```\nAprès.';
    expect(stripSheetBlocks(text)).toBe('Avant.\n\nAprès.');
  });
});

describe('latestSheetBlock', () => {
  const msg = (role: string, text: string) => ({ role, content: [{ type: 'text', text }] });
  const sheetText = (title: string) =>
    '```sheet\n{"title":"' + title + '","columns":["A"],"rows":[["x"]]}\n```';

  it('prefers the streaming partial, else the newest assistant sheet', () => {
    const messages = [msg('assistant', sheetText('Ancienne')), msg('assistant', sheetText('Récente'))];
    expect(latestSheetBlock(messages)!.title).toBe('Récente');
    expect(latestSheetBlock(messages, sheetText('Live'))!.title).toBe('Live');
    expect(latestSheetBlock([msg('user', 'salut')])).toBeNull();
  });
});

describe('prompts', () => {
  it('generation prompt carries the subject and the no-tools contract', () => {
    const p = buildSheetGenerationPrompt('comparatif providers');
    expect(p).toContain('comparatif providers');
    expect(p).toContain('```sheet');
    expect(p).toContain("N'utilise AUCUN outil");
  });

  it('export prompt embeds the parsed sheet for the xlsx skill', () => {
    const p = buildSheetExportPrompt({ title: 'Ma feuille', columns: ['A'], rows: [['x']] });
    expect(p).toContain('skill xlsx');
    expect(p).toContain('« Ma feuille.xlsx »');
    expect(p).toContain('"columns"');
  });
});
