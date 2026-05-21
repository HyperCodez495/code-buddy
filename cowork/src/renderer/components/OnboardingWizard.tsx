/**
 * OnboardingWizard — P1.6
 *
 * 5-step first-run wizard guiding the user through:
 *   1. Language + theme
 *   2. AI provider + API key (light setup; full config still lives in Settings)
 *   3. Default workspace folder
 *   4. Optional capabilities tour (skills, plugins, fleet)
 *   5. First prompt — closes the wizard and pre-fills the chat composer
 *
 * The wizard marks the user as onboarded by writing
 * `onboardingCompleted: true` into the app config. App.tsx checks this flag
 * before deciding whether to open the wizard or jump straight to the chat.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  Globe,
  Sun,
  Moon,
  Key,
  FolderOpen,
  Compass,
  Rocket,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
} from 'lucide-react';
import { useAppStore } from '../store';

type Step = 0 | 1 | 2 | 3 | 4;

interface OnboardingWizardProps {
  onClose: () => void;
  onOpenApiSettings: () => void;
}

const STEPS = [
  { id: 0, key: 'welcome' },
  { id: 1, key: 'provider' },
  { id: 2, key: 'workspace' },
  { id: 3, key: 'capabilities' },
  { id: 4, key: 'firstPrompt' },
] as const;

export function OnboardingWizard({ onClose, onOpenApiSettings }: OnboardingWizardProps) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<Step>(0);
  const setSettings = useAppStore((s) => s.setSettings);
  const settings = useAppStore((s) => s.settings);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && step < 4) setStep((step + 1) as Step);
      if (e.key === 'ArrowLeft' && step > 0) setStep((step - 1) as Step);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step, onClose]);

  const markComplete = async () => {
    try {
      await window.electronAPI?.config?.save?.({
        onboardingCompleted: true,
      } as Record<string, unknown>);
    } catch {
      /* ignore */
    }
    onClose();
  };

  const changeLanguage = (lang: string) => {
    void i18n.changeLanguage(lang);
  };

  const toggleTheme = (theme: 'light' | 'dark') => {
    setSettings({ theme });
  };

  const pickWorkspaceFolder = async () => {
    // We use the file picker as a folder picker fallback — the user picks
    // any file inside the desired folder and we save the parent directory.
    const api = window.electronAPI?.selectFiles;
    if (!api) return;
    try {
      const paths = await api();
      if (paths && paths.length > 0) {
        const first = paths[0];
        // Strip the filename to keep the parent folder
        const sep = first.includes('\\') ? '\\' : '/';
        const folder = first.substring(0, first.lastIndexOf(sep)) || first;
        await window.electronAPI?.config?.save?.({
          defaultWorkspacePath: folder,
        } as Record<string, unknown>);
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center px-4"
      data-testid="onboarding-wizard"
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden">
        {/* Header with progress */}
        <div className="px-6 pt-5 pb-3 border-b border-border-muted">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-accent" />
              <h2 className="text-base font-semibold">
                {t('onboarding.title', 'Welcome to Cowork')}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover"
              title={t('common.close', 'Close')}
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex items-center gap-1.5 mt-3">
            {STEPS.map((s) => (
              <div
                key={s.id}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  s.id <= step ? 'bg-accent' : 'bg-surface-muted'
                }`}
              />
            ))}
          </div>
          <p className="text-[11px] text-text-muted mt-2">
            {t('onboarding.stepLabel', 'Step {{current}} of {{total}}', {
              current: step + 1,
              total: STEPS.length,
            })}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 min-h-[280px]">
          {step === 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-accent shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold">
                    {t('onboarding.languageTitle', 'Choose your language')}
                  </h3>
                  <p className="text-xs text-text-muted">
                    {t('onboarding.languageDesc', 'You can change this anytime in Settings → General.')}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { code: 'en', label: 'English' },
                  { code: 'fr', label: 'Français' },
                  { code: 'zh', label: '中文' },
                ].map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => changeLanguage(lang.code)}
                    className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                      i18n.language?.startsWith(lang.code)
                        ? 'border-accent bg-accent/10'
                        : 'border-border-subtle hover:bg-surface-hover'
                    }`}
                    data-testid={`onboarding-lang-${lang.code}`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
              <div className="border-t border-border-muted pt-4">
                <h3 className="text-sm font-semibold mb-2">
                  {t('onboarding.themeTitle', 'Pick a theme')}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => toggleTheme('light')}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                      settings?.theme === 'light'
                        ? 'border-accent bg-accent/10'
                        : 'border-border-subtle hover:bg-surface-hover'
                    }`}
                  >
                    <Sun className="w-4 h-4" />
                    <span className="text-sm">{t('onboarding.themeLight', 'Light')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleTheme('dark')}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                      settings?.theme === 'dark'
                        ? 'border-accent bg-accent/10'
                        : 'border-border-subtle hover:bg-surface-hover'
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    <span className="text-sm">{t('onboarding.themeDark', 'Dark')}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Key className="w-5 h-5 text-accent shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold">
                    {t('onboarding.providerTitle', 'Connect an AI provider')}
                  </h3>
                  <p className="text-xs text-text-muted">
                    {t(
                      'onboarding.providerDesc',
                      'Cowork supports Anthropic, OpenAI, Gemini, Ollama, LM Studio, and any OpenAI-compatible endpoint.',
                    )}
                  </p>
                </div>
              </div>
              <div className="bg-surface/50 rounded-lg p-4 space-y-2 text-xs">
                <p>{t('onboarding.providerBullet1', '• You will need an API key for cloud providers.')}</p>
                <p>{t('onboarding.providerBullet2', '• For Ollama or LM Studio, just install them locally — Cowork auto-detects.')}</p>
                <p>{t('onboarding.providerBullet3', '• Costs and budgets are tracked in the Cost panel.')}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onOpenApiSettings();
                }}
                className="w-full px-4 py-2.5 rounded-lg bg-accent text-background text-sm font-medium hover:bg-accent-hover"
                data-testid="onboarding-open-api"
              >
                {t('onboarding.openApiSettings', 'Open API settings →')}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <FolderOpen className="w-5 h-5 text-accent shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold">
                    {t('onboarding.workspaceTitle', 'Pick a default workspace')}
                  </h3>
                  <p className="text-xs text-text-muted">
                    {t(
                      'onboarding.workspaceDesc',
                      'Cowork agents read and write files inside the workspace folder. You can pick a different one per session later.',
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={pickWorkspaceFolder}
                className="w-full px-4 py-2.5 rounded-lg border border-border-subtle hover:bg-surface-hover text-sm flex items-center justify-center gap-2"
                data-testid="onboarding-pick-workspace"
              >
                <FolderOpen className="w-4 h-4" />
                {t('onboarding.chooseFolder', 'Choose a folder…')}
              </button>
              <p className="text-[11px] text-text-muted italic">
                {t(
                  'onboarding.workspaceHint',
                  'Tip: pick a sandbox folder first — you can always swap to your real project later.',
                )}
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Compass className="w-5 h-5 text-accent shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold">
                    {t('onboarding.capabilitiesTitle', 'Power user toolkit')}
                  </h3>
                  <p className="text-xs text-text-muted">
                    {t('onboarding.capabilitiesDesc', 'A few things worth knowing.')}
                  </p>
                </div>
              </div>
              <ul className="text-xs space-y-2 text-text-secondary">
                <li>
                  <strong className="text-text-primary">{t('onboarding.cap1Title', 'Skills.')}</strong>{' '}
                  {t('onboarding.cap1Desc', 'Reusable expert procedures (PDF, Excel, SQL, Security…). Settings → Skills.')}
                </li>
                <li>
                  <strong className="text-text-primary">{t('onboarding.cap2Title', 'Plugins & MCP.')}</strong>{' '}
                  {t('onboarding.cap2Desc', 'Extend the agent with custom tools. Settings → MCP marketplace.')}
                </li>
                <li>
                  <strong className="text-text-primary">{t('onboarding.cap3Title', 'Fleet.')}</strong>{' '}
                  {t('onboarding.cap3Desc', 'Distribute work across multiple peers on your network.')}
                </li>
                <li>
                  <strong className="text-text-primary">{t('onboarding.cap4Title', 'Slash commands.')}</strong>{' '}
                  {t('onboarding.cap4Desc', 'Type / in the composer to discover built-in commands.')}
                </li>
                <li>
                  <strong className="text-text-primary">{t('onboarding.cap5Title', 'Cmd/Ctrl+K.')}</strong>{' '}
                  {t('onboarding.cap5Desc', 'Opens the command palette from anywhere in the app.')}
                </li>
              </ul>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4 text-center">
              <Rocket className="w-12 h-12 text-accent mx-auto" />
              <h3 className="text-base font-semibold">
                {t('onboarding.readyTitle', 'Ready to ship.')}
              </h3>
              <p className="text-xs text-text-muted max-w-sm mx-auto">
                {t(
                  'onboarding.readyDesc',
                  'Start a session and ask Cowork to help with anything — debugging, refactoring, exploring a codebase, drafting a PR.',
                )}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border-muted flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep(Math.max(0, step - 1) as Step)}
            disabled={step === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md text-text-secondary hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            {t('common.back', 'Back')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-text-muted hover:text-text-primary"
            data-testid="onboarding-skip"
          >
            {t('onboarding.skip', 'Skip onboarding')}
          </button>
          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep((step + 1) as Step)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-accent text-background hover:bg-accent-hover"
              data-testid="onboarding-next"
            >
              {t('common.next', 'Next')}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={markComplete}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-accent text-background hover:bg-accent-hover"
              data-testid="onboarding-finish"
            >
              <Check className="w-3.5 h-3.5" />
              {t('onboarding.finish', "Let's go")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
