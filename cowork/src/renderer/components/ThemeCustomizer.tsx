/**
 * ThemeCustomizer — P4.4
 *
 * Lets the user tweak accent colour, density (compact/comfortable/spacious)
 * and font size. Persists into `cowork-theme` config key and applies via
 * CSS custom properties on document.documentElement.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette } from 'lucide-react';

type Density = 'compact' | 'comfortable' | 'spacious';
type FontSize = 'sm' | 'md' | 'lg';

interface ThemeConfig {
  accent: string;
  density: Density;
  fontSize: FontSize;
}

const DEFAULTS: ThemeConfig = {
  accent: '#d97757',
  density: 'comfortable',
  fontSize: 'md',
};

const DENSITY_PX: Record<Density, string> = {
  compact: '0.75',
  comfortable: '1',
  spacious: '1.25',
};

const FONT_SIZE_PX: Record<FontSize, string> = {
  sm: '13px',
  md: '15px',
  lg: '17px',
};

const PRESET_THEMES: { id: string; label: string; accent: string }[] = [
  { id: 'claude', label: 'Claude (warm)', accent: '#d97757' },
  { id: 'tokyo', label: 'Tokyo Night', accent: '#7aa2f7' },
  { id: 'solarized', label: 'Solarized', accent: '#268bd2' },
  { id: 'github', label: 'GitHub', accent: '#1f883d' },
  { id: 'sunset', label: 'Sunset', accent: '#e76f51' },
];

function applyTheme(cfg: ThemeConfig) {
  const root = document.documentElement;
  root.style.setProperty('--accent-override', cfg.accent);
  root.style.setProperty('--density-scale', DENSITY_PX[cfg.density]);
  root.style.setProperty('--font-size-base', FONT_SIZE_PX[cfg.fontSize]);
}

export function ThemeCustomizer() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<ThemeConfig>(DEFAULTS);

  useEffect(() => {
    const api = window.electronAPI?.config?.get;
    if (!api) return;
    let cancelled = false;
    api().then((full) => {
      if (cancelled) return;
      const persisted = (full as { coworkTheme?: ThemeConfig }).coworkTheme;
      if (persisted) {
        setCfg({ ...DEFAULTS, ...persisted });
        applyTheme({ ...DEFAULTS, ...persisted });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (next: ThemeConfig) => {
    setCfg(next);
    applyTheme(next);
    try {
      await window.electronAPI?.config?.save?.({ coworkTheme: next } as Record<string, unknown>);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="p-4 space-y-4 max-w-2xl border border-border-subtle rounded-lg" data-testid="theme-customizer">
      <div className="flex items-center gap-2">
        <Palette size={16} className="text-text-muted" />
        <h3 className="text-sm font-semibold">{t('theme.title', 'Theme customizer')}</h3>
      </div>

      <div>
        <label className="block text-xs text-text-secondary mb-1">{t('theme.accentLabel', 'Accent colour')}</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={cfg.accent}
            onChange={(e) => persist({ ...cfg, accent: e.target.value })}
            className="w-10 h-8 rounded border border-border-subtle cursor-pointer"
            data-testid="theme-accent"
          />
          <input
            type="text"
            value={cfg.accent}
            onChange={(e) => persist({ ...cfg, accent: e.target.value })}
            className="w-28 px-2 py-1 text-xs font-mono rounded bg-surface border border-border-subtle"
          />
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          {PRESET_THEMES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => persist({ ...cfg, accent: p.accent })}
              title={p.label}
              className="w-6 h-6 rounded-full border border-border-subtle hover:scale-110 transition-transform"
              style={{ background: p.accent }}
              data-testid={`theme-preset-${p.id}`}
            />
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-text-secondary mb-1">{t('theme.densityLabel', 'Density')}</label>
        <div className="flex items-center gap-1.5">
          {(['compact', 'comfortable', 'spacious'] as Density[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => persist({ ...cfg, density: d })}
              className={`px-3 py-1.5 text-xs rounded-md border ${
                cfg.density === d
                  ? 'border-accent bg-accent/10'
                  : 'border-border-subtle hover:bg-surface-hover'
              }`}
              data-testid={`theme-density-${d}`}
            >
              {t(`theme.density.${d}`, d)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-text-secondary mb-1">{t('theme.fontSizeLabel', 'Font size')}</label>
        <div className="flex items-center gap-1.5">
          {(['sm', 'md', 'lg'] as FontSize[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => persist({ ...cfg, fontSize: s })}
              className={`px-3 py-1.5 text-xs rounded-md border ${
                cfg.fontSize === s
                  ? 'border-accent bg-accent/10'
                  : 'border-border-subtle hover:bg-surface-hover'
              }`}
              data-testid={`theme-fontsize-${s}`}
            >
              {t(`theme.fontSize.${s}`, s.toUpperCase())}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-text-muted italic">
        {t('theme.hint', 'Changes apply immediately. Restart Cowork if you don\'t see all elements re-render.')}
      </p>
    </div>
  );
}
