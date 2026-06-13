import * as readline from 'readline';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface OnboardingResult {
  provider: string;
  apiKey: string;
  model: string;
  ttsEnabled: boolean;
  ttsProvider?: string;
  authMode?: OnboardingAuthMode;
  recommendedNextCommands?: string[];
}

export type OnboardingAuthMode = 'oauth' | 'api-key' | 'local';

export interface OnboardingProviderGuide {
  id: string;
  label: string;
  authMode: OnboardingAuthMode;
  envVar: string;
  defaultModel: string;
  setupCommand?: string;
  verifyCommand: string;
  help: string;
}

export interface OnboardingPhase {
  id: string;
  title: string;
  hermesPhase: string;
  codeBuddyAction: string;
  successCheck: string;
}

export const PROVIDER_ENV_MAP: Record<string, string> = {
  chatgpt: '',
  grok: 'GROK_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  ollama: '',
  lmstudio: '',
};

export const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  chatgpt: 'gpt-5.5',
  grok: 'grok-3',
  claude: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.0-flash',
  ollama: 'llama3',
  lmstudio: 'default',
};

export const PROVIDER_AUTH_MODE: Record<string, OnboardingAuthMode> = {
  chatgpt: 'oauth',
  grok: 'api-key',
  claude: 'api-key',
  gemini: 'api-key',
  ollama: 'local',
  lmstudio: 'local',
};

export const PROVIDER_GUIDES: OnboardingProviderGuide[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT subscription (OAuth)',
    authMode: 'oauth',
    envVar: '',
    defaultModel: 'gpt-5.5',
    setupCommand: 'buddy login',
    verifyCommand: 'buddy whoami',
    help: 'One browser login unlocks the ChatGPT-backed Codex route; no OPENAI_API_KEY is required.',
  },
  {
    id: 'grok',
    label: 'Grok / xAI API key',
    authMode: 'api-key',
    envVar: 'GROK_API_KEY',
    defaultModel: 'grok-3',
    verifyCommand: 'buddy doctor',
    help: 'Set GROK_API_KEY in your shell or secret manager.',
  },
  {
    id: 'claude',
    label: 'Anthropic Claude API key',
    authMode: 'api-key',
    envVar: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-20250514',
    verifyCommand: 'buddy doctor',
    help: 'Set ANTHROPIC_API_KEY in your shell or secret manager.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini API key',
    authMode: 'api-key',
    envVar: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.0-flash',
    verifyCommand: 'buddy doctor',
    help: 'Set GEMINI_API_KEY in your shell or secret manager.',
  },
  {
    id: 'ollama',
    label: 'Ollama local model',
    authMode: 'local',
    envVar: '',
    defaultModel: 'llama3',
    setupCommand: 'ollama serve',
    verifyCommand: 'curl http://localhost:11434/api/tags',
    help: 'Run Ollama locally and pull the model you selected.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio local server',
    authMode: 'local',
    envVar: '',
    defaultModel: 'default',
    verifyCommand: 'curl http://localhost:1234/v1/models',
    help: 'Start the LM Studio local server before launching Code Buddy.',
  },
];

export const ONBOARDING_PHASES: OnboardingPhase[] = [
  {
    id: 'install',
    title: 'Install and diagnose',
    hermesPhase: 'Install Hermes Agent, then run doctor when anything looks off.',
    codeBuddyAction: 'Install Code Buddy, then run buddy doctor.',
    successCheck: 'doctor reports Node.js and core dependencies as usable.',
  },
  {
    id: 'provider',
    title: 'Choose provider and authenticate',
    hermesPhase: 'Choose a provider; the fastest path is hermes setup --portal.',
    codeBuddyAction: 'Prefer buddy login for ChatGPT OAuth, or configure an API/local provider.',
    successCheck: 'buddy whoami or buddy doctor confirms the selected credential source.',
  },
  {
    id: 'first-chat',
    title: 'Run a verifiable first chat',
    hermesPhase: 'Start the CLI/TUI and ask a specific prompt with observable success.',
    codeBuddyAction: 'Run buddy with a repo summary prompt.',
    successCheck: 'the answer names files or tools from the current workspace.',
  },
  {
    id: 'session-resume',
    title: 'Verify session resume',
    hermesPhase: 'Run --continue before moving to advanced workflows.',
    codeBuddyAction: 'Run buddy --continue or buddy session list.',
    successCheck: 'the previous session is visible and resumable.',
  },
  {
    id: 'next-layer',
    title: 'Add the next layer',
    hermesPhase: 'Only after base chat works, add tools, skills, gateway, MCP, voice, or sandboxing.',
    codeBuddyAction: 'Pick one: buddy --init, buddy server, buddy skills, Cowork, Fleet, companion, or sandbox mode.',
    successCheck: 'the selected layer has a doctor/status command or a focused smoke prompt.',
  },
];

const TTS_PROVIDERS = ['edge-tts', 'espeak', 'audioreader'];

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function askChoice(rl: readline.Interface, question: string, choices: string[], defaultIdx: number): Promise<string> {
  return new Promise((resolve) => {
    console.log(`\n  ${question}`);
    choices.forEach((c, i) => console.log(`    ${i + 1}. ${c}${i === defaultIdx ? ' (default)' : ''}`));
    rl.question(`  Choice [${defaultIdx + 1}]: `, (answer) => {
      const idx = parseInt(answer) - 1;
      const selectedIdx = idx >= 0 && idx < choices.length ? idx : defaultIdx;
      resolve(choices[selectedIdx] ?? choices[0] ?? '');
    });
  });
}

export function writeConfig(configDir: string, result: OnboardingResult): void {
  mkdirSync(configDir, { recursive: true });
  const authMode = result.authMode ?? getProviderGuide(result.provider).authMode;
  const recommendedNextCommands =
    result.recommendedNextCommands ?? buildRecommendedNextCommands(result);
  const config: Record<string, unknown> = {
    provider: result.provider,
    model: result.model,
    authMode,
    ttsEnabled: result.ttsEnabled,
    onboarding: {
      version: 1,
      phases: ONBOARDING_PHASES.map((phase) => phase.id),
      recommendedNextCommands,
    },
  };
  if (result.ttsProvider) {
    config.ttsProvider = result.ttsProvider;
  }
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');
}

export function getProviderGuide(provider: string): OnboardingProviderGuide {
  return (
    PROVIDER_GUIDES.find((guide) => guide.id === provider)
    ?? PROVIDER_GUIDES.find((guide) => guide.id === 'chatgpt')
    ?? {
      id: 'chatgpt',
      label: 'ChatGPT subscription (OAuth)',
      authMode: 'oauth',
      envVar: '',
      defaultModel: 'gpt-5.5',
      setupCommand: 'buddy login',
      verifyCommand: 'buddy whoami',
      help: 'Use ChatGPT OAuth.',
    }
  );
}

export function buildRecommendedNextCommands(result: Pick<OnboardingResult, 'provider' | 'model' | 'apiKey'>): string[] {
  const guide = getProviderGuide(result.provider);
  const commands: string[] = [];

  if (guide.authMode === 'oauth') {
    commands.push(guide.setupCommand ?? 'buddy login');
    commands.push(guide.verifyCommand);
  } else if (guide.authMode === 'api-key' && guide.envVar && !result.apiKey) {
    commands.push(`export ${guide.envVar}=<your_api_key>`);
    commands.push(guide.verifyCommand);
  } else if (guide.authMode === 'local') {
    if (guide.setupCommand) commands.push(guide.setupCommand);
    commands.push(guide.verifyCommand);
  } else {
    commands.push(guide.verifyCommand);
  }

  commands.push(`buddy --model ${result.model} -p "Summarize this repo in 5 bullets and name the main entry point."`);
  commands.push('buddy --continue');
  commands.push('buddy --init');
  return Array.from(new Set(commands));
}

export function renderOnboardingRoadmap(result?: Pick<OnboardingResult, 'provider' | 'model' | 'apiKey'>): string {
  const nextCommands = result ? buildRecommendedNextCommands(result) : [];
  const lines: string[] = [
    '  Hermes-style onboarding phases:',
    ...ONBOARDING_PHASES.map((phase, index) =>
      `    ${index + 1}. ${phase.title} — ${phase.codeBuddyAction}`
    ),
  ];
  if (nextCommands.length) {
    lines.push('', '  Recommended next commands:');
    nextCommands.forEach((command) => lines.push(`    ${command}`));
  }
  return lines.join('\n');
}

export async function runOnboarding(): Promise<OnboardingResult> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║     Welcome to Code Buddy Setup!     ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
    console.log('  This wizard will help you configure Code Buddy.');
    console.log('');
    console.log(renderOnboardingRoadmap());
    console.log('');

    // 1. Provider selection
    const provider = await askChoice(
      rl,
      'Which AI provider do you want to use?',
      PROVIDER_GUIDES.map((guide) => `${guide.id} — ${guide.label}`),
      0
    ).then((choice) => choice.split(/\s+—\s+/)[0] ?? choice);
    const guide = getProviderGuide(provider);

    // 2. API Key
    const envVar = guide.envVar;
    let apiKey = '';
    if (guide.authMode === 'oauth') {
      console.log(`\n  ${guide.help}`);
      console.log(`  After this wizard, run: ${guide.setupCommand ?? 'buddy login'}`);
      console.log(`  Verify with: ${guide.verifyCommand}`);
    } else if (envVar) {
      console.log(`\n  You will need to set ${envVar} in your environment.`);
      apiKey = await ask(rl, `Enter your API key (or press Enter to set ${envVar} later)`);
    } else {
      console.log(`\n  ${guide.help}`);
    }

    // 3. Model selection
    const defaultModel = guide.defaultModel;
    const model = await ask(rl, 'Which model do you want to use?', defaultModel);

    // 4. TTS setup
    const ttsAnswer = await ask(rl, 'Enable text-to-speech? (y/n)', 'n');
    const ttsEnabled = ttsAnswer.toLowerCase() === 'y' || ttsAnswer.toLowerCase() === 'yes';
    let ttsProvider: string | undefined;
    if (ttsEnabled) {
      ttsProvider = await askChoice(rl, 'Which TTS provider?', TTS_PROVIDERS, 0);
    }

    const result: OnboardingResult = {
      provider,
      apiKey,
      model,
      ttsEnabled,
      authMode: guide.authMode,
      recommendedNextCommands: buildRecommendedNextCommands({ provider, apiKey, model }),
      ...(ttsProvider ? { ttsProvider } : {}),
    };

    // 5. Write config
    const configDir = join(process.cwd(), '.codebuddy');
    writeConfig(configDir, result);

    // 6. Summary
    console.log('');
    console.log('  Setup complete! Configuration saved to .codebuddy/config.json');
    console.log('');
    console.log(`  Provider:  ${provider}`);
    console.log(`  Auth:      ${guide.authMode}`);
    console.log(`  Model:     ${model}`);
    if (ttsEnabled && ttsProvider) {
      console.log(`  TTS:       ${ttsProvider}`);
    }
    if (envVar && !apiKey) {
      console.log('');
      console.log(`  Remember to set ${envVar} in your environment before using Code Buddy.`);
    }
    console.log('');
    console.log(renderOnboardingRoadmap(result));
    console.log('');

    return result;
  } finally {
    rl.close();
  }
}
