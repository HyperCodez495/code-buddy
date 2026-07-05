/**
 * SkillMarketplaceGallery — searchable import surface for external skills.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/SkillMarketplaceGallery
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Puzzle, Search } from 'lucide-react';
import { filterSkills, groupByCategory, type SkillCard } from '../utils/marketplace-catalog';

export interface SkillMarketplaceGalleryProps {
  skills: SkillCard[];
  onImport: (skill: SkillCard) => void;
}

export function SkillMarketplaceGallery({ skills, onImport }: SkillMarketplaceGalleryProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const categories = useMemo(() => Object.keys(groupByCategory(skills)).sort(), [skills]);
  const visible = filterSkills(skills, query, category);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="skill-marketplace-gallery">
      <div className="flex flex-col gap-3 border-b border-border pb-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Puzzle aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t('genspark.skills.title', 'Marketplace de skills')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {visible.length}/{skills.length} skills
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1" htmlFor="skill-query">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id="skill-query"
              className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
              data-testid="skill-query"
              placeholder={t('genspark.skills.search', 'Rechercher')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            aria-label={t('genspark.skills.category', 'Catégorie')}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            data-testid="skill-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">{t('genspark.skills.all', 'Toutes')}</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
          {t('genspark.skills.empty', 'Aucun skill trouvé.')}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((skill) => (
            <article
              key={skill.id}
              className="flex min-h-40 flex-col rounded-lg border border-border bg-background p-3"
              data-testid={`skill-card-${skill.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-medium text-foreground" title={skill.name}>
                    {skill.name}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">{skill.category}</p>
                </div>
                {skill.installed && (
                  <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">
                    {t('genspark.skills.installed', 'Installé')}
                  </span>
                )}
              </div>
              <p className="mt-3 line-clamp-3 flex-1 text-xs leading-5 text-muted-foreground" title={skill.description}>
                {skill.description}
              </p>
              <button
                type="button"
                aria-label={`Importer ${skill.name}`}
                className="mt-3 inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                data-testid={`skill-import-${skill.id}`}
                disabled={skill.installed}
                onClick={() => onImport(skill)}
              >
                <Download aria-hidden="true" className="h-4 w-4" />
                {t('genspark.skills.import', 'Importer')}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
