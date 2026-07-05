export interface SlidePreviewItem {
  title?: string;
  bullets?: string[];
  notes?: string;
}

export interface SlideDeckViewModel {
  slides: NormalizedSlide[];
  activeIndex: number;
  previousIndex: number | null;
  nextIndex: number | null;
  isEmpty: boolean;
}

export interface NormalizedSlide {
  index: number;
  title: string;
  bullets: string[];
  notes?: string;
  summary: string;
}

const UNTITLED_SLIDE = 'Slide sans titre';

export function normalizeSlide(slide: SlidePreviewItem, index: number): NormalizedSlide {
  const title = slide.title?.trim() || UNTITLED_SLIDE + ' ' + (index + 1);
  const bullets = (slide.bullets ?? []).map((bullet) => bullet.trim()).filter(Boolean);
  const notes = slide.notes?.trim() || undefined;
  const summary = bullets[0] ?? notes ?? 'Aucun contenu';

  return { index, title, bullets, notes, summary };
}

export function clampActiveIndex(activeIndex: number | undefined, slideCount: number): number {
  if (slideCount <= 0) {
    return 0;
  }

  if (activeIndex === undefined || !Number.isFinite(activeIndex)) {
    return 0;
  }

  return Math.min(Math.max(Math.trunc(activeIndex), 0), slideCount - 1);
}

export function buildSlideDeckViewModel(slides: SlidePreviewItem[], activeIndex?: number): SlideDeckViewModel {
  const normalizedSlides = slides.map(normalizeSlide);
  const safeActiveIndex = clampActiveIndex(activeIndex, normalizedSlides.length);

  return {
    slides: normalizedSlides,
    activeIndex: safeActiveIndex,
    previousIndex: safeActiveIndex > 0 ? safeActiveIndex - 1 : null,
    nextIndex: safeActiveIndex < normalizedSlides.length - 1 ? safeActiveIndex + 1 : null,
    isEmpty: normalizedSlides.length === 0,
  };
}
