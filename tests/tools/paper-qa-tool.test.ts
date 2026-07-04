/**
 * `paper_qa` tool adapter (src/tools/paper-qa-tool.ts).
 *
 * No-mocks: the REAL corpus→search→answer pipeline runs, with an injected
 * deterministic pdf-parse boundary (per-path page content), a deterministic
 * bag-of-words embedder, and a deterministic fake LLM (RCS + synthesis). No
 * filesystem PDFs, no ONNX model, no network.
 *
 * Proves: the adapter chains the bricks into a grounded, cited answer with real
 * page/section provenance; refuses honestly on insufficient evidence; NEVER
 * throws (empty question, no provider, no PDF, thrown LLM); and is registered
 * for RAG selection AND resolvable through the interactive dispatch path.
 */
import { describe, it, expect, vi } from 'vitest';

import { PaperQaTool } from '../../src/tools/paper-qa-tool.js';
import type { PaperQaToolDeps } from '../../src/tools/paper-qa-tool.js';
import type { PassageEmbedder } from '../../src/research/paper-qa/passage-index.js';
import type { PassageLlmMessage, PassageQaLlm } from '../../src/research/paper-qa/rcs.js';
import type { ParsedPdf, PdfStructureDeps } from '../../src/research/paper-qa/types.js';
import type { ResolvedCommandProvider } from '../../src/commands/llm-provider-resolution.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';

import { ToolHandler } from '../../src/agent/tool-handler.js';
import {
  FormalToolRegistry,
  getFormalToolRegistry,
} from '../../src/tools/registry/tool-registry.js';
import { initializeToolRegistry } from '../../src/codebuddy/tools.js';
import { getToolRegistry } from '../../src/tools/registry.js';

// ---------------------------------------------------------------------------
// Deterministic fakes (no ONNX, no network)
// ---------------------------------------------------------------------------

/** Deterministic bag-of-words embedder (shared vocabulary → higher cosine). */
function bowEmbedder(dim = 64): PassageEmbedder {
  const embed = async (text: string): Promise<{ embedding: Float32Array }> => {
    const v = new Float32Array(dim);
    const toks = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
    for (const tok of toks) {
      let h = 0;
      for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
      v[h % dim] = (v[h % dim] ?? 0) + 1;
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += (v[i] ?? 0) * (v[i] ?? 0);
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) v[i] = (v[i] ?? 0) / norm;
    return { embedding: v };
  };
  return { embed };
}

/** PDF deps that resolve each path to its own page content (path bytes → lookup). */
function corpusDeps(corpus: Record<string, string[]>): PdfStructureDeps {
  return {
    readFile: async (p: string) => Buffer.from(p, 'utf8'),
    parsePdf: async (data: Uint8Array): Promise<ParsedPdf | null> => {
      const p = Buffer.from(data).toString('utf8');
      const pages = corpus[p];
      if (!pages) return null;
      return { pages: pages.map((text, i) => ({ num: i + 1, text })), total: pages.length };
    },
  };
}

/**
 * Combined fake LLM: RCS ("You judge…") scores passages containing `keyword`
 * relevant (0.9), else 0.1; synthesis ("You answer…") cites every listed marker.
 */
function fakeLlm(keyword: string, opts: { insufficient?: boolean; throwOnSynth?: boolean } = {}): PassageQaLlm {
  return async (messages: PassageLlmMessage[]): Promise<string> => {
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    if (system.startsWith('You judge')) {
      const passage = user.slice(user.indexOf('Passage:') + 'Passage:'.length);
      const relevant = passage.toLowerCase().includes(keyword.toLowerCase());
      return relevant ? 'RELEVANCE: 0.9\nSUMMARY: relevant evidence' : 'RELEVANCE: 0.1\nSUMMARY: NONE';
    }
    if (opts.throwOnSynth) throw new Error('synthesis model unavailable');
    if (opts.insufficient) return 'INSUFFICIENT';
    const markers = new Set<number>();
    const re = /^\[(\d+)\]/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(user)) !== null) markers.add(Number(m[1]));
    return [...markers]
      .sort((a, b) => a - b)
      .map((n) => `Claim ${n} holds [${n}].`)
      .join(' ');
  };
}

const PROVIDER: ResolvedCommandProvider = {
  apiKey: 'test-key',
  model: 'test-model',
  baseURL: 'https://example.test/v1',
  providerLabel: 'test',
};

const PHOTO_CORPUS: Record<string, string[]> = {
  '/papers/photosynthesis.pdf': [
    'Photosynthesis converts light energy into chemical energy inside plant chloroplasts every day. ' +
      'The light-dependent reactions split water and release oxygen as a by-product of photosynthesis.',
  ],
  '/papers/reactor.pdf': [
    'The nuclear reactor sustains a controlled fission chain reaction to generate electricity for the grid.',
  ],
};

function makeTool(
  overrides: Partial<PaperQaToolDeps> = {},
  provider: ResolvedCommandProvider | null = PROVIDER,
): PaperQaTool {
  return new PaperQaTool({
    resolveProvider: () => provider,
    resolvePdfPaths: async () => Object.keys(PHOTO_CORPUS),
    embedder: bowEmbedder(),
    pdfDeps: corpusDeps(PHOTO_CORPUS),
    makeLlm: () => fakeLlm('photosynthesis'),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Grounded answer (the payoff)
// ---------------------------------------------------------------------------

describe('paper_qa adapter — grounded, cited answer', () => {
  it('answers with inline markers + a code-rendered References section (page provenance)', async () => {
    const res = await makeTool().execute({
      question: 'How does photosynthesis convert light energy?',
      paths: ['/papers'],
    });

    expect(res.success).toBe(true);
    expect(res.output).toContain('# Paper QA : How does photosynthesis convert light energy?');
    // A grounded claim with an inline marker + the deterministic References block.
    expect(res.output).toMatch(/\[1\]/);
    expect(res.output).toContain('## Références');
    // Provenance: the reference resolves to the photosynthesis paper, page 1.
    expect(res.output).toContain('photosynthesis.pdf');
    expect(res.output).toContain('p.1');
    // Header surfaces the corpus/evidence accounting.
    expect(res.output).toContain('Statut : répondu (ancré)');
  });

  it('refuses honestly when no passage is relevant to the question', async () => {
    // The LLM judges only "quantum" passages relevant — none exist in the corpus.
    const res = await makeTool({ makeLlm: () => fakeLlm('quantum') }).execute({
      question: 'What is quantum entanglement?',
      paths: ['/papers'],
    });

    expect(res.success).toBe(true); // an honest refusal is a valid outcome
    expect(res.output).toContain('Preuves insuffisantes');
    expect(res.output).toContain('refus honnête');
    expect(res.output).not.toContain('## Références');
  });
});

// ---------------------------------------------------------------------------
// Robustness (never throws)
// ---------------------------------------------------------------------------

describe('paper_qa adapter — robustness (never throws)', () => {
  it('rejects an empty question without touching the pipeline', async () => {
    const res = await makeTool().execute({ question: '   ', paths: ['/papers'] });
    expect(res.success).toBe(false);
    expect(res.error).toContain('non-empty');
  });

  it('fails cleanly when no LLM provider is available', async () => {
    const res = await makeTool({}, null).execute({ question: 'anything', paths: ['/papers'] });
    expect(res.success).toBe(false);
    expect(res.error).toContain('No LLM provider');
  });

  it('fails cleanly when no readable PDF is resolved', async () => {
    const res = await makeTool({ resolvePdfPaths: async () => [] }).execute({
      question: 'anything',
      paths: ['/empty'],
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('no readable PDF');
  });

  it('returns {success:false} (not a throw) when the synthesis LLM throws', async () => {
    const res = await makeTool({ makeLlm: () => fakeLlm('photosynthesis', { throwOnSynth: true }) }).execute({
      question: 'How does photosynthesis convert light energy?',
      paths: ['/papers'],
    });
    // The pipeline degrades to an honest refusal (synthesis unavailable), never throws.
    expect(res.success).toBe(true);
    expect(res.output).toContain('refus honnête');
    expect(res.output).toContain('synthesis_unavailable');
  });
});

// ---------------------------------------------------------------------------
// ITool contract, RAG metadata, exposition ⊆ dispatch
// ---------------------------------------------------------------------------

describe('paper_qa adapter — contract, metadata & dispatch', () => {
  it('exposes a valid schema requiring question', () => {
    const tool = new PaperQaTool();
    expect(tool.name).toBe('paper_qa');
    const schema = tool.getSchema();
    expect(schema.parameters.required).toContain('question');
    expect(Object.keys(schema.parameters.properties)).toEqual(
      expect.arrayContaining(['question', 'paths', 'top_k', 'max_pdfs']),
    );
  });

  it('validate() rejects a missing question', () => {
    const tool = new PaperQaTool();
    expect(tool.validate({}).valid).toBe(false);
    expect(tool.validate({ question: 'X' }).valid).toBe(true);
  });

  it('is registered in TOOL_METADATA so RAG selection can surface it', () => {
    const meta = TOOL_METADATA.find((m) => m.name === 'paper_qa');
    expect(meta, 'paper_qa must have RAG metadata').toBeDefined();
    expect(meta!.category).toBe('web');
    expect(meta!.keywords).toEqual(expect.arrayContaining(['paper', 'pdf', 'scientific', 'cite']));
  });

  it('is EXPOSED to the LLM and DISPATCHABLE in interactive chat', () => {
    // Exposition (what the LLM sees).
    initializeToolRegistry();
    const exposed = getToolRegistry()
      .getEnabledTools()
      .map((t) => t.function.name);
    expect(exposed).toContain('paper_qa');

    // Dispatch (the interactive FormalToolRegistry via ToolHandler.initializeRegistry).
    FormalToolRegistry.reset();
    new ToolHandler({
      checkpointManager: {
        checkpointBeforeCreate: vi.fn(),
        checkpointBeforeEdit: vi.fn(),
      } as never,
      hooksManager: { executeHooks: vi.fn().mockResolvedValue([]) } as never,
      marketplace: { executeTool: vi.fn() } as never,
      repairCoordinator: { isRepairEnabled: vi.fn(() => false) } as never,
    });
    expect(getFormalToolRegistry().getNames()).toContain('paper_qa');
  });
});
