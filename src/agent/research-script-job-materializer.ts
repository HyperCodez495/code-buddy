import fs from 'fs/promises';
import path from 'path';
import {
  renderResearchScriptJobManifest,
  renderResearchScriptJobReadme,
  type ResearchScriptJobArtifact,
  type ResearchScriptJobFiles,
} from './research-script-job-artifact.js';

export interface MaterializeResearchScriptJobOptions {
  inputData?: unknown;
  overwrite?: boolean;
  rootDir: string;
  scriptSource?: string;
  summaryNote?: string;
}

export interface MaterializedResearchScriptJob {
  absoluteFiles: ResearchScriptJobFiles;
  artifactRoot: string;
  commandPreview: string;
  executed: false;
  jobId: string;
  manifestPath: string;
}

const NOT_RUN_REASON = 'Job materialized for review; script was not executed.';

export async function materializeResearchScriptJobArtifact(
  job: ResearchScriptJobArtifact,
  options: MaterializeResearchScriptJobOptions,
): Promise<MaterializedResearchScriptJob> {
  const rootDir = path.resolve(options.rootDir);
  const absoluteFiles = resolveResearchScriptJobFiles(rootDir, job.files);
  const artifactRoot = resolveResearchScriptPathInsideRoot(rootDir, job.artifactRoot);
  const writeFlag = options.overwrite ? 'w' : 'wx';

  await fs.mkdir(artifactRoot, { recursive: true });
  await Promise.all(Object.values(absoluteFiles).map((filePath) => fs.mkdir(path.dirname(filePath), { recursive: true })));

  const scriptSource = options.scriptSource ?? renderReviewOnlyScript(job);
  const inputData = options.inputData ?? {};
  const outputPlaceholder = {
    status: 'not_run',
    reason: NOT_RUN_REASON,
    jobId: job.id,
  };

  await Promise.all([
    writeFile(absoluteFiles.manifest, renderResearchScriptJobManifest(job), writeFlag),
    writeFile(absoluteFiles.readme, renderResearchScriptJobReadme(job), writeFlag),
    writeFile(absoluteFiles.script, scriptSource, writeFlag),
    writeFile(absoluteFiles.input, JSON.stringify(inputData, null, 2), writeFlag),
    writeFile(absoluteFiles.output, JSON.stringify(outputPlaceholder, null, 2), writeFlag),
    writeFile(absoluteFiles.stdout, '', writeFlag),
    writeFile(absoluteFiles.stderr, '', writeFlag),
    writeFile(absoluteFiles.summary, renderMaterializationSummary(job, options.summaryNote), writeFlag),
  ]);

  return {
    absoluteFiles,
    artifactRoot,
    commandPreview: [job.command.executable, ...job.command.args].join(' '),
    executed: false,
    jobId: job.id,
    manifestPath: absoluteFiles.manifest,
  };
}

export function resolveResearchScriptJobFiles(rootDir: string, files: ResearchScriptJobFiles): ResearchScriptJobFiles {
  return {
    manifest: resolveResearchScriptPathInsideRoot(rootDir, files.manifest),
    readme: resolveResearchScriptPathInsideRoot(rootDir, files.readme),
    script: resolveResearchScriptPathInsideRoot(rootDir, files.script),
    input: resolveResearchScriptPathInsideRoot(rootDir, files.input),
    output: resolveResearchScriptPathInsideRoot(rootDir, files.output),
    stdout: resolveResearchScriptPathInsideRoot(rootDir, files.stdout),
    stderr: resolveResearchScriptPathInsideRoot(rootDir, files.stderr),
    summary: resolveResearchScriptPathInsideRoot(rootDir, files.summary),
  };
}

export function resolveResearchScriptPathInsideRoot(rootDir: string, relativePath: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const normalizedRoot = normalizeForCompare(resolvedRoot);
  const normalizedPath = normalizeForCompare(resolvedPath);
  if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Research script artifact path escapes root: ${relativePath}`);
  }
  return resolvedPath;
}

function normalizeForCompare(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

async function writeFile(filePath: string, content: string, flag: 'w' | 'wx'): Promise<void> {
  await fs.writeFile(filePath, `${content}\n`, { encoding: 'utf8', flag });
}

function renderMaterializationSummary(job: ResearchScriptJobArtifact, note: string | undefined): string {
  const lines = [
    `# Materialized Research Script Job: ${job.title}`,
    '',
    `Job id: ${job.id}`,
    `Status: not_run`,
    `Reason: ${NOT_RUN_REASON}`,
    `Command preview: ${[job.command.executable, ...job.command.args].join(' ')}`,
    '',
    '## Review Checklist',
    ...job.assertions.map((assertion) => `- [${assertion.required ? 'required' : 'optional'}] ${assertion.description}`),
  ];

  if (note?.trim()) {
    lines.push('', '## Note', note.trim());
  }

  return lines.join('\n');
}

function renderReviewOnlyScript(job: ResearchScriptJobArtifact): string {
  const commentPrefix = job.language === 'python' || job.language === 'shell' ? '#' : '//';
  return [
    `${commentPrefix} ${NOT_RUN_REASON}`,
    `${commentPrefix} Supply a reviewed scriptSource before executing this job.`,
    '',
  ].join('\n');
}
