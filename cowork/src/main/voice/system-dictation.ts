/**
 * Safe desktop paste for Cowork's global dictation shortcut.
 *
 * The transcript travels through Electron's clipboard API, never through a
 * shell command or process argument. The previous clipboard text is restored
 * only if the user has not copied something else in the meantime.
 */
import { execFile as nodeExecFile } from 'node:child_process';
import type { Clipboard } from 'electron';

export type DictationPasteMechanism = 'osascript' | 'powershell' | 'wtype' | 'xdotool' | 'clipboard';

export interface DictationPasteResult {
  ok: boolean;
  copied: boolean;
  pasted: boolean;
  mechanism: DictationPasteMechanism;
  error?: string;
}
type ExecFile = (
  file: string,
  args: readonly string[],
  callback: (error: Error | null) => void
) => void;

export interface SystemDictationDependencies {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  clipboard: Pick<Clipboard, 'readText' | 'writeText'>;
  execFile?: ExecFile;
  commandExists?: (command: string) => Promise<boolean>;
  schedule?: (callback: () => void, delayMs: number) => unknown;
}

const MAX_DICTATION_CHARACTERS = 100_000;

function runFile(execFile: ExecFile, file: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error) => error ? reject(error) : resolve());
  });
}

function defaultExecFile(file: string, args: readonly string[], callback: (error: Error | null) => void): void {
  nodeExecFile(file, [...args], { windowsHide: true, timeout: 5_000 }, (error) => callback(error));
}

async function defaultCommandExists(command: string): Promise<boolean> {
  try {
    await runFile(defaultExecFile, process.platform === 'win32' ? 'where.exe' : 'which', [command]);
    return true;
  } catch {
    return false;
  }
}

export class SystemDictationService {
  private readonly execFile: ExecFile;
  private readonly commandExists: (command: string) => Promise<boolean>;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;

  constructor(private readonly deps: SystemDictationDependencies) {
    this.execFile = deps.execFile ?? defaultExecFile;
    this.commandExists = deps.commandExists ?? defaultCommandExists;
    this.schedule = deps.schedule ?? setTimeout;
  }

  async paste(transcript: string): Promise<DictationPasteResult> {
    const clean = transcript.trim().slice(0, MAX_DICTATION_CHARACTERS);
    if (!clean) {
      return { ok: false, copied: false, pasted: false, mechanism: 'clipboard', error: 'empty transcript' };
    }

    const previous = this.deps.clipboard.readText();
    this.deps.clipboard.writeText(clean);
    const restore = (): void => {
      this.schedule(() => {
        if (this.deps.clipboard.readText() === clean) this.deps.clipboard.writeText(previous);
      }, 800);
    };

    try {
      const mechanism = await this.pasteChord();
      if (!mechanism) {
        return {
          ok: true,
          copied: true,
          pasted: false,
          mechanism: 'clipboard',
          error: this.deps.platform === 'linux'
            ? 'Transcript copied. Install wtype (Wayland) or xdotool (X11) to enable automatic paste.'
            : 'Transcript copied; automatic paste is unavailable on this platform.',
        };
      }
      restore();
      return { ok: true, copied: true, pasted: true, mechanism };
    } catch (error) {
      return {
        ok: true,
        copied: true,
        pasted: false,
        mechanism: 'clipboard',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async pasteChord(): Promise<Exclude<DictationPasteMechanism, 'clipboard'> | null> {
    if (this.deps.platform === 'darwin') {
      await runFile(this.execFile, 'osascript', [
        '-e',
        'tell application "System Events" to keystroke "v" using command down',
      ]);
      return 'osascript';
    }
    if (this.deps.platform === 'win32') {
      await runFile(this.execFile, 'powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")',
      ]);
      return 'powershell';
    }
    if (this.deps.platform !== 'linux') return null;

    if (this.deps.env.WAYLAND_DISPLAY && await this.commandExists('wtype')) {
      await runFile(this.execFile, 'wtype', ['-M', 'ctrl', '-P', 'v', '-p', 'v', '-m', 'ctrl']);
      return 'wtype';
    }
    if (await this.commandExists('xdotool')) {
      await runFile(this.execFile, 'xdotool', ['key', '--clearmodifiers', 'ctrl+v']);
      return 'xdotool';
    }
    if (await this.commandExists('wtype')) {
      await runFile(this.execFile, 'wtype', ['-M', 'ctrl', '-P', 'v', '-p', 'v', '-m', 'ctrl']);
      return 'wtype';
    }
    return null;
  }
}
