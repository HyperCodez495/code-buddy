import { describe, expect, it, vi } from 'vitest';
import {
  buildFleetInternetProofPlan,
  buildInternetProofSummaryMetadata,
  summarizeInternetProofPlan,
} from '../src/shared/internet-proof-metadata';

describe('Fleet internet proof metadata', () => {
  it('builds fallback proof metadata for web/doc dispatch goals', () => {
    const plan = buildFleetInternetProofPlan(
      'Research the latest browser automation docs and persist durable lessons.',
    );
    const summary = summarizeInternetProofPlan(plan);

    expect(summary).toMatchObject({
      assertionCount: 0,
      requiredCount: 4,
      stepCount: 6,
      tools: ['web_search', 'web_fetch', 'browser', 'remember', 'lessons_add'],
    });
    expect(buildInternetProofSummaryMetadata(summary)).toMatchObject({
      internetProofStepCount: 6,
      internetProofRequiredCount: 4,
      internetProofAssertionCount: 0,
    });
  });

  it('uses the core proof-plan builder when available and falls back after errors', () => {
    const builder = {
      buildInternetProofPlan: vi.fn(() => ({
        goal: 'Verify https://example.com status',
        query: 'Verify https://example.com status',
        steps: [
          {
            id: 'assert',
            tool: 'browser',
            action: 'assert_text',
            evidence: 'assertion',
            required: true,
          },
        ],
      })),
    };

    const built = buildFleetInternetProofPlan('Verify https://example.com status', builder);
    expect(builder.buildInternetProofPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: 'Verify https://example.com status',
        sourceUrl: 'https://example.com',
        persistWhenProven: true,
        requiresBrowser: true,
      }),
    );
    expect(summarizeInternetProofPlan(built)).toMatchObject({
      assertionCount: 1,
      requiredCount: 1,
      stepCount: 1,
    });

    const onError = vi.fn();
    const fallback = buildFleetInternetProofPlan(
      'Verify https://example.com status',
      {
        buildInternetProofPlan: vi.fn(() => {
          throw new Error('boom');
        }),
      },
      onError,
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(summarizeInternetProofPlan(fallback)).toMatchObject({
      requiredCount: 3,
      stepCount: 5,
    });
  });

  it('skips non-web dispatch goals', () => {
    expect(buildFleetInternetProofPlan('Refactor the local settings panel.')).toBeNull();
    expect(summarizeInternetProofPlan(null)).toBeNull();
    expect(buildInternetProofSummaryMetadata(null)).toEqual({});
  });
});
