export type InternetProofPlanBuilder = {
  buildInternetProofPlan: (options: {
    expectedText?: string;
    goal: string;
    persistWhenProven?: boolean;
    query?: string;
    requiresBrowser?: boolean;
    sourceUrl?: string;
  }) => Record<string, unknown>;
};

export interface InternetProofSummary {
  assertionCount: number;
  requiredCount: number;
  stepCount: number;
  steps: Array<Record<string, unknown>>;
  tools: string[];
}

export function buildFleetInternetProofPlan(
  goal: string,
  proofPlanBuilder: InternetProofPlanBuilder | null = null,
  onBuilderError?: (error: unknown) => void,
): Record<string, unknown> | null {
  if (!shouldBuildInternetProofPlan(goal)) return null;

  const sourceUrl = extractFirstUrl(goal);
  if (proofPlanBuilder) {
    try {
      return proofPlanBuilder.buildInternetProofPlan({
        goal,
        query: goal,
        ...(sourceUrl ? { sourceUrl } : {}),
        requiresBrowser: true,
        persistWhenProven: true,
      });
    } catch (err) {
      onBuilderError?.(err);
    }
  }

  return buildFallbackInternetProofPlan(goal, sourceUrl);
}

export function summarizeInternetProofPlan(value: unknown): InternetProofSummary | null {
  if (!isRecord(value) || !Array.isArray(value.steps)) return null;

  const tools = new Set<string>();
  let assertionCount = 0;
  let requiredCount = 0;
  let stepCount = 0;
  const steps: Array<Record<string, unknown>> = [];

  for (const rawStep of value.steps) {
    if (!isRecord(rawStep)) continue;
    stepCount++;
    if (rawStep.required === true) requiredCount++;
    if (typeof rawStep.tool === 'string') tools.add(rawStep.tool);
    if (typeof rawStep.tool === 'string' && steps.length < 8) {
      steps.push({
        ...(typeof rawStep.id === 'string' ? { id: rawStep.id } : {}),
        ...(typeof rawStep.title === 'string' ? { title: rawStep.title } : {}),
        tool: rawStep.tool,
        ...(typeof rawStep.action === 'string' ? { action: rawStep.action } : {}),
        ...(typeof rawStep.evidence === 'string' ? { evidence: rawStep.evidence } : {}),
        ...(typeof rawStep.required === 'boolean' ? { required: rawStep.required } : {}),
      });
    }

    const evidence = typeof rawStep.evidence === 'string' ? rawStep.evidence : '';
    const action = typeof rawStep.action === 'string' ? rawStep.action : '';
    if (`${evidence} ${action}`.toLowerCase().includes('assert')) {
      assertionCount++;
    }
  }

  if (stepCount === 0) return null;
  return {
    assertionCount,
    requiredCount,
    stepCount,
    steps,
    tools: [...tools],
  };
}

export function buildInternetProofSummaryMetadata(
  summary: InternetProofSummary | null,
): Record<string, unknown> {
  if (!summary) return {};
  return {
    internetProofStepCount: summary.stepCount,
    internetProofRequiredCount: summary.requiredCount,
    internetProofAssertionCount: summary.assertionCount,
    internetProofTools: summary.tools,
    internetProofSteps: summary.steps,
  };
}

function shouldBuildInternetProofPlan(goal: string): boolean {
  const normalized = goal.toLowerCase();
  return (
    /https?:\/\//.test(normalized) ||
    /\bwww\./.test(normalized) ||
    /\b(github|internet|web|browser|browserbase|stagehand|mem0|documentation|docs)\b/.test(normalized) ||
    /\b(site|navigateur|recherche|chercher|actualite|actualité)\b/.test(normalized)
  );
}

function extractFirstUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s)"'>]+/);
  return match?.[0];
}

function buildFallbackInternetProofPlan(
  goal: string,
  sourceUrl: string | undefined,
): Record<string, unknown> {
  const steps: Array<Record<string, unknown>> = [];
  if (!sourceUrl) {
    steps.push({
      id: 'discover',
      title: 'Discover source candidates',
      tool: 'web_search',
      required: true,
      evidence: 'discovery',
      reason: 'Find current public sources before browser automation.',
    });
  }
  steps.push(
    {
      id: 'static-read',
      title: 'Read the source cheaply',
      tool: 'web_fetch',
      required: true,
      evidence: 'static-read',
      reason: sourceUrl
        ? 'Fetch the known URL before browser automation.'
        : 'Fetch the best search result before browser automation.',
    },
    {
      id: 'observe',
      title: 'Observe page state before acting',
      tool: 'browser',
      action: 'observe',
      required: true,
      evidence: 'observation',
      reason: 'Capture actionable refs and visible page context before interaction.',
    },
    {
      id: 'extract',
      title: 'Extract structured page evidence',
      tool: 'browser',
      action: 'extract',
      required: true,
      evidence: 'extraction',
      reason: 'Capture URL, title, headings, actions, links and query-focused text evidence.',
    },
    {
      id: 'persist',
      title: 'Persist only proven durable facts',
      tool: 'remember',
      required: false,
      evidence: 'memory',
      reason: 'Save only durable facts after extraction proves them.',
    },
    {
      id: 'lesson',
      title: 'Capture reusable workflow lessons',
      tool: 'lessons_add',
      required: false,
      evidence: 'memory',
      reason: 'Store reusable web automation patterns, not raw browsing noise.',
    },
  );

  return {
    goal,
    query: goal,
    ...(sourceUrl ? { sourceUrl } : {}),
    steps,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
