/**
 * Deterministic prompt enhancer (bolt.new offers to enrich a terse prompt before
 * building). No LLM: detect what a description is missing (stack, styling,
 * concrete features) and propose short additions + an enriched prompt.
 */
export interface PromptEnhancement {
  suggestions: string[];
  enriched: string;
}

const STACK_RE = /\b(react|vue|next|svelte|angular|vite|html)\b/i;
const STYLE_RE = /\b(sombre|dark|thème|theme|couleur|color|responsive|design|moderne|épuré|epure|glass|néon|neon)\b/i;
const FEATURE_RE =
  /\b(todo|tâche|tache|liste|dashboard|graph|chart|form|formulaire|table|tableau|auth|login|calendrier|calendar|chat|carte|map|panier|cart|galerie|gallery|timer|blog)\b/i;

/** A description is vague when it's short or names no concrete feature. */
export function isVague(prompt: string): boolean {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  if (words.length < 6) return true;
  return !FEATURE_RE.test(prompt);
}

export function enhancePrompt(prompt: string): PromptEnhancement {
  const base = prompt.trim();
  const suggestions: string[] = [];
  const additions: string[] = [];

  if (!base) {
    return {
      suggestions: [
        'Décris une app concrète (ex. « une todo app »)',
        'Précise le style (ex. thème sombre, responsive)',
        'Nomme les fonctionnalités clés',
      ],
      enriched: '',
    };
  }

  if (!STACK_RE.test(base)) {
    suggestions.push('Préciser la stack (React + Vite)');
    additions.push('en React + Vite');
  }
  if (!STYLE_RE.test(base)) {
    suggestions.push('Ajouter un style (thème sombre soigné, responsive)');
    additions.push('avec un thème sombre soigné et une mise en page responsive');
  }
  if (!FEATURE_RE.test(base)) {
    suggestions.push('Détailler les fonctionnalités principales');
    additions.push('avec les fonctionnalités principales clairement séparées en composants');
  }
  if (suggestions.length === 0) {
    suggestions.push('Le prompt est déjà précis — tu peux générer.');
  }

  const enriched = additions.length > 0 ? `${base}, ${additions.join(', ')}.` : base;
  return { suggestions, enriched };
}
