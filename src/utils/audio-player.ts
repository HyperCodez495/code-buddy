import { execFile } from 'child_process';
import * as os from 'os';
import { logger } from './logger.js';

export async function playWavFile(filePath: string): Promise<void> {
  const platform = os.platform();

  const candidates = platform === 'win32'
    ? [{
        command: 'powershell',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$ErrorActionPreference = 'Stop'; $player = New-Object System.Media.SoundPlayer -ArgumentList @($args[0]); $player.PlaySync()",
          filePath,
        ],
      }]
    : platform === 'darwin'
      ? [{ command: 'afplay', args: [filePath] }]
      : [
          { command: 'aplay', args: [filePath] },
          { command: 'paplay', args: [filePath] },
          { command: 'play', args: [filePath] },
        ];

  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      logger.debug(`[AudioPlayer] Playing audio file via command: ${candidate.command}`);
      await execFileAsync(candidate.command, candidate.args);
      return;
    } catch (error: any) {
      lastError = error;
    }
  }

  if (lastError) {
    logger.warn(`[AudioPlayer] Failed to play audio file: ${lastError.message}`);
  }
}

function execFileAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
