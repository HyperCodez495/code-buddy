/**
 * Lessons Routes
 *
 * REST management of the learned-lessons store (Hermes "journey" parity:
 * list/show/edit/delete over REST, alongside the `buddy lessons` CLI).
 * Backed by the same LessonsTracker the agent injects into every turn —
 * `.codebuddy/lessons.md` (project) + `~/.codebuddy/lessons.md` (global).
 *
 * Id semantics: the REST id is the lesson id. Scopes mirror /api/memory
 * (`memory` read / `memory:write` mutate) — lessons ARE learned memory.
 */

import { Router, Request, Response } from 'express';
import { requireScope, asyncHandler, ApiServerError, validateRequired } from '../middleware/index.js';
import type { LessonCategory, LessonItem, LessonLocation } from '../../agent/lessons-tracker.js';

const VALID_CATEGORIES: LessonCategory[] = ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'];

async function getTracker() {
  const { getLessonsTracker } = await import('../../agent/lessons-tracker.js');
  return getLessonsTracker(process.cwd());
}

function parseCategory(raw: unknown): LessonCategory | undefined {
  if (typeof raw !== 'string') return undefined;
  const upper = raw.toUpperCase() as LessonCategory;
  if (!VALID_CATEGORIES.includes(upper)) {
    throw ApiServerError.badRequest(`Invalid category: ${raw}. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }
  return upper;
}

function toRestLesson(item: LessonItem & { locations?: LessonLocation[] }): Record<string, unknown> {
  return {
    id: item.id,
    category: item.category,
    content: item.content,
    ...(item.context ? { context: item.context } : {}),
    createdAt: new Date(item.createdAt).toISOString(),
    source: item.source,
    ...(item.locations ? { locations: item.locations } : {}),
  };
}

const router = Router();

/**
 * GET /api/lessons
 * List lessons (optionally by category).
 */
router.get(
  '/',
  requireScope('memory'),
  asyncHandler(async (req: Request, res: Response) => {
    const category = parseCategory(req.query.category);
    const tracker = await getTracker();
    const items = tracker.list(category);
    res.json({ lessons: items.map(toRestLesson), total: items.length });
  })
);

/**
 * POST /api/lessons
 * Add a lesson.
 */
router.post(
  '/',
  requireScope('memory:write'),
  asyncHandler(async (req: Request, res: Response) => {
    validateRequired(req.body, ['content']);
    const { content, category, context } = req.body as Record<string, unknown>;
    const tracker = await getTracker();
    const item = tracker.add(
      parseCategory(category) ?? 'INSIGHT',
      String(content),
      'manual',
      typeof context === 'string' && context.trim() ? context.trim() : undefined
    );
    res.status(201).json(toRestLesson(tracker.get(item.id) ?? item));
  })
);

/**
 * GET /api/lessons/:id
 * Show one lesson, with the file location(s) it lives in.
 */
router.get(
  '/:id',
  requireScope('memory'),
  asyncHandler(async (req: Request, res: Response) => {
    const tracker = await getTracker();
    const item = tracker.get(req.params.id as string);
    if (!item) throw ApiServerError.notFound(`Lesson '${req.params.id}'`);
    res.json(toRestLesson(item));
  })
);

/**
 * PUT /api/lessons/:id
 * Edit a lesson (content / category / context; `context: null` clears it).
 * Format-corrupting patches are rejected with 400 by the tracker.
 */
router.put(
  '/:id',
  requireScope('memory:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const { content, category, context } = (req.body ?? {}) as Record<string, unknown>;
    if (content === undefined && category === undefined && context === undefined) {
      throw ApiServerError.badRequest('Nothing to change — pass at least one of content, category, context');
    }
    const tracker = await getTracker();
    try {
      const updated = await tracker.update(req.params.id as string, {
        ...(content !== undefined ? { content: String(content) } : {}),
        ...(category !== undefined ? { category: parseCategory(category) } : {}),
        ...(context !== undefined ? { context: context === null ? null : String(context) } : {}),
      });
      if (!updated) throw ApiServerError.notFound(`Lesson '${req.params.id}'`);
      res.json(toRestLesson(updated));
    } catch (err) {
      if (err instanceof ApiServerError) throw err;
      throw ApiServerError.badRequest(err instanceof Error ? err.message : String(err));
    }
  })
);

/**
 * DELETE /api/lessons/:id
 * Delete a lesson from every file it lives in; reports which ones.
 */
router.delete(
  '/:id',
  requireScope('memory:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const tracker = await getTracker();
    const result = await tracker.removeWithReport(req.params.id as string);
    if (!result.removed) throw ApiServerError.notFound(`Lesson '${req.params.id}'`);
    res.json({ id: req.params.id, removed: true, removedFrom: result.removedFrom });
  })
);

export default router;
