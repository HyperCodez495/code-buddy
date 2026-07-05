/**
 * RecipeGallery — the Genspark-style "pick a mission" surface.
 *
 * A dependency-light, presentational gallery of one-click missions
 * (see `agent-recipes.ts`). It owns only its search box; launching a recipe is
 * delegated to the parent via `onLaunch`, so it stays decoupled from the store
 * and the IPC bridge and can be dropped anywhere (Home empty-state, a Labs
 * panel, the command palette, …).
 *
 * Wiring (one line, in the shell that owns the chat input):
 *
 *   <RecipeGallery onLaunch={(r) => setComposerText(r.prompt)} />
 *
 * or fire it straight away through the existing send path:
 *
 *   <RecipeGallery onLaunch={(r) => sendMessage(r.prompt)} />
 *
 * The recipe also carries a suggested `autonomy` posture the shell may map to a
 * permission mode before sending.
 *
 * @module renderer/components/RecipeGallery
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ArrowUpRight } from 'lucide-react';
import {
  AGENT_RECIPES,
  RECIPE_CATEGORY_LABELS,
  filterRecipes,
  groupRecipesByCategory,
  type AgentRecipe,
  type RecipeAutonomy,
} from './agent-recipes';

export interface RecipeGalleryProps {
  /** Called when the user picks a mission. Wire this to the chat composer. */
  onLaunch: (recipe: AgentRecipe) => void;
  /** Optional extra classes for the outer container. */
  className?: string;
  /** Show the search box (default true). */
  searchable?: boolean;
}

const AUTONOMY_TONE: Record<RecipeAutonomy, string> = {
  plan: 'bg-border text-text-muted',
  auto: 'bg-accent/15 text-accent',
  full: 'bg-warning/15 text-warning',
};

const AUTONOMY_LABEL: Record<RecipeAutonomy, string> = {
  plan: 'read-only',
  auto: 'auto-edit',
  full: 'full-auto',
};

export const RecipeGallery: React.FC<RecipeGalleryProps> = ({
  onLaunch,
  className,
  searchable = true,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const filtered = filterRecipes(query, AGENT_RECIPES);
    return groupRecipesByCategory(filtered);
  }, [query]);

  const total = groups.reduce((n, g) => n + g.recipes.length, 0);

  return (
    <div data-testid="recipe-gallery" className={`flex flex-col gap-4 ${className ?? ''}`}>
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text">
            {t('recipes.title', 'Start a mission')}
          </h2>
          <p className="text-xs text-text-muted">
            {t('recipes.subtitle', 'Pick a ready-made task — the agent plans and runs it end-to-end.')}
          </p>
        </div>
        {searchable && (
          <div className="relative ml-auto w-48">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              data-testid="recipe-gallery-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('recipes.search', 'Search missions…')}
              aria-label={t('recipes.search', 'Search missions…')}
              className="w-full rounded-md border border-border bg-surface/60 py-1 pl-7 pr-2 text-xs text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>
        )}
      </div>

      {total === 0 ? (
        <p data-testid="recipe-gallery-empty" className="py-6 text-center text-xs text-text-muted">
          {t('recipes.empty', { query, defaultValue: 'No missions match “{{query}}”.' })}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.category} className="flex flex-col gap-2">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
              {t(`recipes.category.${group.category}`, RECIPE_CATEGORY_LABELS[group.category])}
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.recipes.map((recipe) => (
                <button
                  key={recipe.id}
                  type="button"
                  data-testid={`recipe-card-${recipe.id}`}
                  onClick={() => onLaunch(recipe)}
                  title={recipe.prompt}
                  className="group flex flex-col gap-1 rounded-lg border border-border bg-surface/40 p-3 text-left transition-colors hover:border-accent hover:bg-surface/70 focus:border-accent focus:outline-none"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-base leading-none" aria-hidden>
                      {recipe.emoji}
                    </span>
                    <span className="flex-1 truncate text-xs font-medium text-text">
                      {recipe.title}
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                  <span className="line-clamp-2 text-[11px] text-text-muted">
                    {recipe.description}
                  </span>
                  <span
                    className={`mt-1 w-fit rounded px-1.5 py-0.5 text-[10px] ${AUTONOMY_TONE[recipe.autonomy]}`}
                    title={t('recipes.autonomyHint', 'Suggested autonomy for this mission')}
                  >
                    {t(`recipes.autonomy.${recipe.autonomy}`, AUTONOMY_LABEL[recipe.autonomy])}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
};

export default RecipeGallery;
