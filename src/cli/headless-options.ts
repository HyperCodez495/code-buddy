export interface HeadlessOutputOptions {
  output?: string;
  outputFormat?: string;
}

export function resolveHeadlessOutputFormat(options: HeadlessOutputOptions): string {
  return options.outputFormat || options.output || 'json';
}

export function resolveHeadlessResultExitCode(resultText: string): number {
  const normalized = resultText.trim().toLowerCase();
  if (normalized.startsWith('sorry, i encountered an error:')) {
    return 1;
  }
  return 0;
}
