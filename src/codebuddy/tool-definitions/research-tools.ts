/**
 * Research Tool Definitions
 *
 * LLM-facing definitions for the research pipelines exposed to the agent:
 *  - `deep_research` — the multi-source, cited web-research pipeline (the
 *    agent-callable counterpart of `buddy research --deep/--iterations/
 *    --perspectives/--ckg`); adapter in src/tools/deep-research-tool.ts.
 *  - `paper_qa` — the PaperQA2-lite scientific-PDF QA pipeline (grounded, cited
 *    answers over a local PDF corpus, or an honest refusal); adapter in
 *    src/tools/paper-qa-tool.ts, CLI `buddy papers ask`.
 *
 * Both are bounded conservatively for in-chat use.
 */

import type { CodeBuddyTool } from './types.js';

// Deep Research — multi-source, cited research pipeline.
export const DEEP_RESEARCH_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'deep_research',
    description:
      'Run a bounded, multi-source, CITED research pipeline on a topic and return a structured report with a "## Références" section. ' +
      'Use this (not web_search) when a question needs SEVERAL web sources cross-checked into one report: state of the art, comparisons, ' +
      '"what does the literature say", due diligence. The report carries inline [n] citation markers and a numbered references list. ' +
      "It is bounded for in-chat use (a few sub-questions, a low source cap, one iteration by default); raise 'iterations', " +
      "'perspectives' or 'max_sources' ONLY when the user explicitly needs a broader/deeper investigation (slower).",
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'The research question or topic to investigate.',
        },
        mode: {
          type: 'string',
          enum: ['deep', 'wide'],
          description:
            "'deep' (default): deterministic cited pipeline (plan → search → scrape → dedup → synthesize). 'wide': parallel sub-agent research fan-out (broader, less citation-strict).",
        },
        iterations: {
          type: 'number',
          description:
            'Deep only: number of gap-analysis rounds (1-3, default 1). >1 re-searches to fill gaps in the draft. Higher = slower/more thorough.',
        },
        perspectives: {
          type: 'number',
          description:
            'Deep only: research the topic from N diversified perspectives (2-6) and co-write an outline-first cited article (STORM). Activates the multi-perspective pipeline.',
        },
        ckg: {
          type: 'boolean',
          description:
            'Deep only: bridge the run to the Collective Knowledge Graph — recall prior collective knowledge and ingest the deduped sources for cross-run accumulation.',
        },
        max_sources: {
          type: 'number',
          description:
            'Deep only: global cap on scraped sources (1-20, default 6). Raise only when the topic explicitly needs broader coverage (slower).',
        },
      },
      required: ['topic'],
    },
  },
};

// Paper QA — grounded, cited answers over a local corpus of scientific PDFs.
export const PAPER_QA_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'paper_qa',
    description:
      'Answer a question from a corpus of scientific PDF papers with an ANCHORED, CITED answer. ' +
      'It parses the PDF(s), retrieves the most relevant passages, filters them for relevance, and synthesizes ' +
      'an answer whose every claim cites the exact page/section it came from (a "## Références" section is appended ' +
      'from the real passage provenance). If the corpus does not support an answer, it REFUSES honestly ' +
      '("preuves insuffisantes") rather than guessing. Use this (not deep_research/web_search) when the user points ' +
      'at local PDF files or a folder of papers and wants a grounded, source-cited answer.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to answer from the PDF corpus.',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'PDF file paths and/or directories of papers to search. A directory is walked for *.pdf ' +
            '(heavy build/vcs dirs skipped). Defaults to the current directory when omitted.',
        },
        top_k: {
          type: 'number',
          description: 'Number of passages to retrieve before relevance filtering (1-50, default 8).',
        },
        max_pdfs: {
          type: 'number',
          description:
            'Cap on PDFs indexed for this call (1-200, default 25). Raise only when a broader corpus is truly needed (slower).',
        },
      },
      required: ['question'],
    },
  },
};

/**
 * All research tools as an array.
 */
export const RESEARCH_TOOLS: CodeBuddyTool[] = [DEEP_RESEARCH_TOOL, PAPER_QA_TOOL];
