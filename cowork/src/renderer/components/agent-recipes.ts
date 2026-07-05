/**
 * agent-recipes — a catalog of one-click "missions" for the Super-Agent shell.
 *
 * Genspark-style: instead of asking the user to phrase a prompt, we offer a
 * gallery of ready-to-run missions. Each recipe is just a prompt template plus
 * a suggested autonomy posture; launching one drops the prompt into the chat
 * input (see `RecipeGallery`, prop `onLaunch`). Every recipe maps to real
 * Code Buddy capabilities (deep_research, paper_qa, understand_video, the
 * pptx/xlsx/docx skills, the browser/computer tools, council, git) — nothing
 * here invents a tool that doesn't exist.
 *
 * Pure data + types: no React, no store, no side effects. Safe to import from
 * anywhere (renderer or a test).
 *
 * @module renderer/components/agent-recipes
 */

/** Suggested autonomy posture when a recipe is launched. */
export type RecipeAutonomy = 'plan' | 'auto' | 'full';

/** Coarse grouping used to lay the gallery out by theme. */
export type RecipeCategory =
  | 'build'
  | 'research'
  | 'create'
  | 'analyze'
  | 'automate'
  | 'communicate';

export interface AgentRecipe {
  /** Stable id (also used as a React key). */
  id: string;
  /** Short, action-first label. */
  title: string;
  /** One-line description of what the mission does. */
  description: string;
  /** Theme bucket. */
  category: RecipeCategory;
  /** Emoji shown on the card (dependency-free icon). */
  emoji: string;
  /**
   * Prompt template dropped into the chat input. `<…>` placeholders mark the
   * bits the user should fill in before sending.
   */
  prompt: string;
  /** Suggested posture; the shell may pre-select a matching permission mode. */
  autonomy: RecipeAutonomy;
  /** Free-form tags for search/filter. */
  tags?: string[];
}

/** Human-readable label for each category (fallbacks; i18n at the view layer). */
export const RECIPE_CATEGORY_LABELS: Record<RecipeCategory, string> = {
  build: 'Build',
  research: 'Research',
  create: 'Create',
  analyze: 'Analyze',
  automate: 'Automate',
  communicate: 'Communicate',
};

/**
 * The built-in recipe catalog. Ordered roughly by how often each is reached
 * for; the gallery regroups them by category.
 */
export const AGENT_RECIPES: readonly AgentRecipe[] = [
  {
    id: 'build-app',
    title: 'Build a web app',
    description: 'Scaffold, run and browser-test a small web app end-to-end.',
    category: 'build',
    emoji: '🚀',
    prompt:
      'Build a small web app: <describe what it should do>. Scaffold it, start the dev server, then use the browser to verify the page renders and the core flow works — fixing issues until it does.',
    autonomy: 'auto',
    tags: ['app', 'frontend', 'scaffold', 'web_test'],
  },
  {
    id: 'fix-bug',
    title: 'Find & fix a bug',
    description: 'Locate the root cause, apply a fix, and verify with a test.',
    category: 'build',
    emoji: '🐛',
    prompt:
      'Investigate this bug: <describe the symptom>. Find the root cause, propose the smallest correct fix, apply it, and verify with a test that fails before and passes after.',
    autonomy: 'auto',
    tags: ['debug', 'fix', 'test'],
  },
  {
    id: 'review-diff',
    title: 'Review my changes',
    description: 'Review the current git diff for bugs and cleanups.',
    category: 'build',
    emoji: '🔬',
    prompt:
      'Review the current git diff for correctness bugs and reuse/simplification cleanups. Group findings by severity and point to exact lines.',
    autonomy: 'plan',
    tags: ['review', 'git', 'quality'],
  },
  {
    id: 'open-pr',
    title: 'Open a pull request',
    description: 'Turn the current changes into a well-described draft PR.',
    category: 'build',
    emoji: '🔀',
    prompt:
      'Turn my current changes into a pull request: write a clear conventional-commit title and a description covering what/why/how-tested, then open it as a draft.',
    autonomy: 'auto',
    tags: ['pr', 'git', 'github'],
  },
  {
    id: 'deep-research',
    title: 'Deep research report',
    description: 'A cited, multi-source report on a topic.',
    category: 'research',
    emoji: '🔎',
    prompt:
      'Run deep research on: <topic>. Fan out across sources, verify the key claims, and produce a report with sections, inline [n] citations, and a references list.',
    autonomy: 'plan',
    tags: ['research', 'deep_research', 'cited'],
  },
  {
    id: 'sparkpage',
    title: 'Living research page',
    description: 'Synthesize the web into a sectioned page you can chat with.',
    category: 'research',
    emoji: '📄',
    prompt:
      'Research <topic> across the web and build a structured page — sections, comparison tables, and citations — saved as an artifact I can ask follow-up questions about.',
    autonomy: 'plan',
    tags: ['sparkpage', 'artifact', 'research'],
  },
  {
    id: 'ask-council',
    title: 'Ask the council',
    description: 'Several models answer, critique, and synthesize one answer.',
    category: 'research',
    emoji: '🧠',
    prompt:
      'Convene the council on: <question>. Assign complementary roles (architect, implementer, skeptic, verifier), let them debate, then synthesize one answer and show which model contributed what.',
    autonomy: 'plan',
    tags: ['council', 'ensemble', 'mixture-of-agents'],
  },
  {
    id: 'make-slides',
    title: 'Make a slide deck',
    description: 'Outline, then a .pptx with sections and speaker notes.',
    category: 'create',
    emoji: '🖼️',
    prompt:
      'Create a presentation about <topic>. First draft an outline, then generate a .pptx with a title slide, one slide per key section, and speaker notes.',
    autonomy: 'auto',
    tags: ['slides', 'pptx', 'deck'],
  },
  {
    id: 'make-sheet',
    title: 'Research → live table',
    description: 'Pull structured web data into a spreadsheet.',
    category: 'create',
    emoji: '📊',
    prompt:
      'Build a spreadsheet of <e.g. "the top 20 …"> with columns <list the columns>, filling each row from real web data, and save it as .xlsx.',
    autonomy: 'auto',
    tags: ['sheet', 'xlsx', 'data'],
  },
  {
    id: 'write-doc',
    title: 'Draft a document',
    description: 'A structured .docx with headings and citations.',
    category: 'create',
    emoji: '📝',
    prompt:
      'Write a well-structured document about <topic> with headings, a short summary, and citations, then export it as .docx.',
    autonomy: 'auto',
    tags: ['doc', 'docx', 'write'],
  },
  {
    id: 'summarize-doc',
    title: 'Summarize a document',
    description: 'Ingest a PDF/Word/Excel and distill the key points.',
    category: 'analyze',
    emoji: '📚',
    prompt:
      'Read the attached document and give me a concise, structured summary: the key points, any decisions, and action items. Ask a grounded question with page/section citations if I follow up.',
    autonomy: 'plan',
    tags: ['summarize', 'pdf', 'paper_qa', 'doc-ingest'],
  },
  {
    id: 'understand-video',
    title: 'Summarize a video',
    description: 'Transcript-first summary of a video URL.',
    category: 'analyze',
    emoji: '🎬',
    prompt:
      'Summarize this video: <url>. Give me the key points with timestamps, and the main takeaway.',
    autonomy: 'plan',
    tags: ['video', 'understand_video', 'youtube'],
  },
  {
    id: 'web-task',
    title: 'Do a web task',
    description: 'Autonomously drive the browser to get something done.',
    category: 'automate',
    emoji: '🌐',
    prompt:
      'Use the browser to <task — e.g. gather these facts / compare these options / fill this form>. Report what you did with screenshots or extracted data as evidence.',
    autonomy: 'auto',
    tags: ['browser', 'autopilot', 'automation'],
  },
  {
    id: 'daily-brief',
    title: 'Morning brief',
    description: 'What changed, what is open, what needs you today.',
    category: 'communicate',
    emoji: '☕',
    prompt:
      'Give me a short morning brief for this project: what changed recently, the open TODOs, and anything that needs my attention today.',
    autonomy: 'plan',
    tags: ['brief', 'standup', 'summary'],
  },
] as const;

/** Group the catalog by category, preserving declaration order within each. */
export function groupRecipesByCategory(
  recipes: readonly AgentRecipe[] = AGENT_RECIPES,
): Array<{ category: RecipeCategory; recipes: AgentRecipe[] }> {
  const order: RecipeCategory[] = [
    'build',
    'research',
    'create',
    'analyze',
    'automate',
    'communicate',
  ];
  const buckets = new Map<RecipeCategory, AgentRecipe[]>();
  for (const r of recipes) {
    const list = buckets.get(r.category) ?? [];
    list.push(r);
    buckets.set(r.category, list);
  }
  return order
    .filter((c) => buckets.has(c))
    .map((category) => ({ category, recipes: buckets.get(category) ?? [] }));
}

/** Case-insensitive search over title, description, tags, and category. */
export function filterRecipes(
  query: string,
  recipes: readonly AgentRecipe[] = AGENT_RECIPES,
): AgentRecipe[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...recipes];
  return recipes.filter((r) => {
    const haystack = [
      r.title,
      r.description,
      r.category,
      ...(r.tags ?? []),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}
