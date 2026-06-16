# Design — Visual grounding fallback (set-of-marks), Agent S2 #2

> 2026-05-28. Goal: when the UIA snapshot yields **no element matching the intent**
> (the Avalonia/Skia/custom-drawn case our hardening study flags as "fallback is the
> only recourse"), resolve the target with a **set-of-marks + multimodal LLM** call —
> our no-training substitute for Agent S2's trained visual grounding expert.
> See [`piloting-hardening-study-2026-05.md`](archive/internal/piloting-hardening-study-2026-05.md) and the
> Agent S2 portability brief (backlog).

## Status

- ✅ **Annotator reworked + verified (shipped this pass).** `SmartSnapshotManager.toAnnotatedScreenshot({ interactiveOnly, crop })` now badges interactive elements only and crops to the window content region. Verified on the real WPF fixture: **3440×1440 / 2.1 MB → 788×708 / 56 KB**, badges legible (`scratch/annotate-probe.ts`, `scratch/annotated-wpf-som.png`). This was the make-or-break de-risk — set-of-marks is viable.
- ⬜ **Grounding seam + multimodal provider (NOT built — this design).** The risky/cost surface; deliberately deferred pending the gating decisions below + explicit go.

## Why the annotator had to come first

Rendering `toAnnotatedScreenshot()` as-is produced a full desktop screenshot with ~84 overlapping badges over mostly-irrelevant content — unusable as a vision-model input. The crop+filter is the prerequisite; building the LLM layer on top of the old annotator would have paid for confusing input.

## The seam (mechanism — tool side, no LLM in the tool)

Mirror the established `setICMBridgeProvider` injection pattern (the tool stays LLM-free; the agent, which owns the model, injects a provider).

1. **Provider type** (module-level in `computer-control-tool.ts`):
   ```ts
   type VisionGroundingProvider = (req: {
     imageBase64: string;            // set-of-marks PNG (interactiveOnly + crop)
     intent: string;                 // the query, e.g. "Apply button"
     role?: string;                  // expected role hint
     candidates: { ref: number; role: string; name: string }[];
   }) => Promise<number | null>;      // returns a ref, or null if unsure
   let visionGroundingProvider: VisionGroundingProvider | null = null;
   export function setVisionGroundingProvider(p: VisionGroundingProvider | null): void { ... }
   ```
2. **Trigger point**: `resolveElementForIntent` no-match branch (`computer-control-tool.ts:4608`, the `No element ... found matching` return). Before returning the error, if **enabled** (see gating) and a provider is set and `!input.simulateOnly`:
   - `const ann = await this.snapshotManager.toAnnotatedScreenshot({ interactiveOnly: true, crop: true })`
   - build `candidates` from the current snapshot's interactive elements (`ref/role/name`)
   - `const ref = await visionGroundingProvider({ imageBase64: ann.image, intent: options.query, role, candidates })`
   - if `ref != null`: `const el = this.snapshotManager.getElement(ref)`; validate role ∈ options.roles; return `{ element: el, refreshed }`.
   - else fall through to the existing error (loud, not silent).

## The provider (agent side — the multimodal call)

Implemented near the LLM client and injected via `setVisionGroundingProvider(...)` in `codebuddy-agent.ts` (alongside `setICMBridgeProvider`). Builds a multimodal message: the SoM image + a prompt listing `[ref] role "name"` candidates and the intent, asking the model to return **only** the matching ref number (or `none`). Parse strictly (integer or null). Multimodal plumbing already exists (`src/input/multimodal-input.ts`, `image-input.ts`, Gemini-native provider).

## Gating / cost (decisions — REQUIRED before build)

- **Default OFF.** Opt-in via `CODEBUDDY_VISION_GROUNDING=1` (and/or a config key). The Avalonia gap staying open is a *loud* failure; a silent per-miss LLM bill is a *worse* one.
- **Last-resort only.** Fires solely in the no-match branch after all UIA refresh/refocus retries — never on the happy path.
- **Budget aware.** Skip if near `MAX_COST` / YOLO cap; respect `simulateOnly`.
- **Observable.** Log every fire: intent, candidate count, model, latency, and (if available) token/cost. A kill-switch that's invisible is not a kill-switch.
- **Bounded input.** crop + interactiveOnly already cap image to ~56 KB and candidates to ~20 — keeps the call cheap and the model un-confused.

## Testing

- Seam: unit-test `resolveElementForIntent`'s no-match branch with a **stub** `VisionGroundingProvider` returning a known ref → assert the element resolves and role is validated; and returning `null` → assert the original error still surfaces. No real LLM.
- Annotator: verified by `scratch/annotate-probe.ts` render (image pipelines aren't unit-testable; the visual render is the check).
- Provider: mock the LLM client; assert prompt shape + ref parsing (integer / `none`).

## Effort

Seam + stub-tested mechanism: ~small/medium (TS only, zero PowerShell bytes — respects the `ENAMETOOLONG` ceiling). Provider + agent wiring + gating: ~medium. End-to-end Avalonia verification: needs a real run (the fixture has UIA peers, so to truly exercise the *no-UIA-match* path we'd need a Skia/custom-drawn control that emits no peer — note for the test plan).
