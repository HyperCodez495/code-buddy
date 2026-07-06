/**
 * dev-plan — real test (no mocks): derive a development plan from an app prompt
 * (stack detection, feature steps, theme, always-present scaffold/run bookends).
 */
import { describe, expect, it } from 'vitest';
import { buildDevPlan } from '../src/renderer/components/studio/dev-plan';

describe('buildDevPlan', () => {
  it('detects React by default and brackets the plan with scaffold + run', () => {
    const plan = buildDevPlan('Une todo app avec thème sombre');
    expect(plan.stack).toBe('React + Vite');
    expect(plan.steps[0]!.id).toBe('scaffold');
    expect(plan.steps[plan.steps.length - 1]!.id).toBe('run');
    expect(plan.steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('extracts features and a dark-theme step', () => {
    const plan = buildDevPlan('Un dashboard Next.js avec des graphiques et un thème sombre');
    expect(plan.stack).toBe('Next.js');
    const titles = plan.steps.map((s) => s.title);
    expect(titles.some((t) => /Tableau de bord/.test(t))).toBe(true);
    expect(titles.some((t) => /Visualisations/.test(t))).toBe(true);
    expect(plan.steps.some((s) => s.id === 'theme-dark')).toBe(true);
  });

  it('falls back to a core UI step when no known feature is named', () => {
    const plan = buildDevPlan('quelque chose de joli');
    expect(plan.steps.some((s) => s.id === 'feat-core')).toBe(true);
  });

  it('derives a readable title and never returns empty for a blank prompt', () => {
    expect(buildDevPlan('').title).toBe('Nouvelle application');
    expect(buildDevPlan('Todo app pro. Avec du style').title).toBe('Todo app pro');
  });

  it('does not duplicate a feature mentioned twice', () => {
    const plan = buildDevPlan('un formulaire et encore un formulaire');
    const formSteps = plan.steps.filter((s) => /Formulaire/.test(s.title));
    expect(formSteps).toHaveLength(1);
  });
});
