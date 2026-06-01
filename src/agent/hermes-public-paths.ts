import path from 'path';

export function safeWorkspacePath(workDir: string, pathValue: string): string {
  const root = path.resolve(workDir);
  const target = path.resolve(pathValue);
  const relative = path.relative(root, target);
  if (relative === '') return '.';
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.replace(/\\/g, '/');
  }
  return `[redacted-local-path]/${path.basename(target) || 'path'}`;
}

export function safeLocalPathLabel(label: string): string {
  return `[${label.replace(/[^A-Za-z0-9_.-]+/g, '-')}]`;
}
