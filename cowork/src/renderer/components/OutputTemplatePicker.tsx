/**
 * OutputTemplatePicker — pre-launch output type selector.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/OutputTemplatePicker
 */

import { FileText, Globe2, Presentation, Radio, Table2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OutputTemplate } from '../utils/output-templates';

export interface OutputTemplatePickerProps {
  templates: OutputTemplate[];
  onPick: (template: OutputTemplate) => void;
}

function iconFor(id: OutputTemplate['id']) {
  if (id === 'deck') return <Presentation aria-hidden="true" className="h-5 w-5" />;
  if (id === 'table') return <Table2 aria-hidden="true" className="h-5 w-5" />;
  if (id === 'page') return <Globe2 aria-hidden="true" className="h-5 w-5" />;
  if (id === 'podcast') return <Radio aria-hidden="true" className="h-5 w-5" />;
  return <FileText aria-hidden="true" className="h-5 w-5" />;
}

export function OutputTemplatePicker({ templates, onPick }: OutputTemplatePickerProps) {
  const { t } = useTranslation();

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="output-template-picker">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t('genspark.templates.title', 'Type de sortie')}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t('genspark.templates.subtitle', 'Choisis le livrable avant de lancer la mission.')}
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            aria-label={`Choisir ${template.label}`}
            className="rounded-lg border border-border bg-background p-3 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            data-testid={`output-template-${template.id}`}
            onClick={() => onPick(template)}
          >
            <span className="mb-3 inline-flex rounded-lg bg-muted p-2 text-foreground">{iconFor(template.id)}</span>
            <span className="block text-sm font-medium text-foreground">{template.label}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">{template.mappedTool}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
