export interface ApplicationProfile {
  id: string;
  aliases: string[];
  name: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  defaultPolicy: 'allow' | 'confirm';
  processNames: string[];
  titleHints: string[];
  launchCommand: string;
  executableCandidates: string[];
  capabilities: string[];
  notes: string;
}

export const APPLICATION_PROFILES: ApplicationProfile[] = [
  {
    id: 'excel',
    aliases: ['xls', 'xlsx', 'microsoft excel', 'spreadsheet', 'tableur'],
    name: 'Microsoft Excel',
    riskLevel: 'high',
    defaultPolicy: 'confirm',
    processNames: ['EXCEL'],
    titleHints: ['Excel'],
    launchCommand: 'excel.exe',
    executableCandidates: ['excel.exe'],
    capabilities: [
      'open workbook',
      'focus workbook window',
      'write/read cells via COM',
      'select cells/ranges',
      'save workbook',
      'fallback UI typing/clicking',
    ],
    notes: 'Uses Windows COM automation when Excel is installed, then falls back to desktop control. Cell writes and saves require explicit confirmation for live runs.',
  },
  {
    id: 'notepad',
    aliases: ['bloc-notes', 'notepad.exe', 'text editor'],
    name: 'Notepad',
    riskLevel: 'medium',
    defaultPolicy: 'allow',
    processNames: ['notepad'],
    titleHints: ['Notepad', 'Bloc-notes'],
    launchCommand: 'notepad.exe',
    executableCandidates: ['notepad.exe'],
    capabilities: ['open', 'focus', 'type text', 'read text via UIAutomation', 'save text document without global hotkeys'],
    notes: 'Best for deterministic text-entry smoke tests. Saves use a targeted UIAutomation read plus explicit file write instead of blind Ctrl+S.',
  },
  {
    id: 'calculator',
    aliases: ['calc', 'calculatrice', 'calculator.exe'],
    name: 'Calculator',
    riskLevel: 'low',
    defaultPolicy: 'allow',
    processNames: ['CalculatorApp', 'ApplicationFrameHost'],
    titleHints: ['Calculator', 'Calculatrice'],
    launchCommand: 'calc.exe',
    executableCandidates: ['calc.exe'],
    capabilities: ['open', 'focus', 'click buttons', 'keyboard input'],
    notes: 'Windows Store calculator often runs behind ApplicationFrameHost.',
  },
  {
    id: 'file_explorer',
    aliases: ['explorer', 'windows explorer', 'explorateur', 'files'],
    name: 'File Explorer',
    riskLevel: 'high',
    defaultPolicy: 'confirm',
    processNames: ['explorer'],
    titleHints: ['File Explorer', 'Explorateur de fichiers'],
    launchCommand: 'explorer.exe',
    executableCandidates: ['explorer.exe'],
    capabilities: ['open folder', 'focus', 'navigate files with keyboard and UIA'],
    notes: 'Use filePath to open a specific folder. Destructive file workflows must be routed through explicit confirmation.',
  },
  {
    id: 'browser',
    aliases: ['chrome', 'edge', 'web', 'navigateur'],
    name: 'Web Browser',
    riskLevel: 'medium',
    defaultPolicy: 'allow',
    processNames: ['chrome', 'msedge', 'firefox'],
    titleHints: ['Google Chrome', 'Microsoft Edge', 'Mozilla Firefox'],
    launchCommand: 'msedge.exe',
    executableCandidates: ['msedge.exe', 'chrome.exe', 'firefox.exe'],
    capabilities: ['open', 'focus', 'desktop control', 'prefer browser tool for DOM-level work'],
    notes: 'For web pages, Browser Use remains more precise than desktop control.',
  },
  {
    id: 'vscode',
    aliases: ['code', 'visual studio code', 'vs code'],
    name: 'Visual Studio Code',
    riskLevel: 'high',
    defaultPolicy: 'confirm',
    processNames: ['Code'],
    titleHints: ['Visual Studio Code'],
    launchCommand: 'code.cmd',
    executableCandidates: ['code.cmd', 'code.exe'],
    capabilities: ['open workspace', 'focus', 'keyboard workflows', 'terminal interactions'],
    notes: 'Computer Use can operate VS Code, but repo edits should still use file tools.',
  },
  {
    id: 'terminal',
    aliases: ['powershell', 'cmd', 'windows terminal', 'terminal'],
    name: 'Terminal',
    riskLevel: 'critical',
    defaultPolicy: 'confirm',
    processNames: ['WindowsTerminal', 'powershell', 'pwsh', 'cmd'],
    titleHints: ['Windows PowerShell', 'PowerShell', 'Command Prompt', 'Invite de commandes'],
    launchCommand: 'powershell.exe',
    executableCandidates: ['wt.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe'],
    capabilities: ['open', 'focus', 'type commands', 'keyboard workflows'],
    notes: 'For command execution, shell tools are safer; live terminal UI control requires explicit confirmation.',
  },
];

export function listApplicationProfiles(): ApplicationProfile[] {
  return APPLICATION_PROFILES;
}

export function resolveApplicationProfile(appName: string): ApplicationProfile | undefined {
  const normalized = normalizeAppName(appName);
  return APPLICATION_PROFILES.find((profile) => {
    if (profile.id === normalized) return true;
    if (normalizeAppName(profile.name) === normalized) return true;
    return profile.aliases.some((alias) => normalizeAppName(alias) === normalized);
  });
}

export function normalizeAppName(value: string): string {
  return value.trim().replace(/\s+/g, '_').toLowerCase();
}
