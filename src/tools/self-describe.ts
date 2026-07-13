/**
 * Self-description — the robot's model of the bricks it is made of.
 *
 * Answers "de quoi es-tu fait ? / quels sont tes composants ?" with a manifest
 * COMPUTED AT CALL TIME (never stale) from the sources that already exist:
 *   - the agent's own package.json (name / version / description);
 *   - the sibling bricks in the repo: buddy-sense (Rust nervous system / ears),
 *     buddy-vision (Python eyes + live ear), buddy-memory (Rust CKG — a stub in
 *     most checkouts), each with a one-line description read from its own
 *     manifest and a source/build STATUS (present? binary artifact detected?);
 *   - configured faculties: number of registered tools, provider configuration,
 *     and sensory feature flags. This tool does not infer runtime liveness.
 *
 * Pure + injectable (root / env / toolNames / persona) so it is unit-testable
 * without the whole registry. Never throws — an unreadable source is reported
 * as "unknown", not a crash.
 *
 * @module tools/self-describe
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export interface BrickInfo {
  /** Stable id, e.g. "buddy-sense". */
  id: string;
  /** Human role, e.g. "les oreilles / le système nerveux". */
  role: string;
  /** One-line description read from the brick's own manifest. */
  description: string;
  /** Is the brick source present in this checkout? */
  present: boolean;
  /** Verified source/build status; runtime execution is never inferred. */
  status: string;
}

export interface SelfDescription {
  name: string;
  version: string;
  description: string;
  robotName?: string;
  bricks: BrickInfo[];
  faculties: {
    toolCount: number | null;
    /** Configuration evidence only (credential/endpoint present), not a liveness probe. */
    activeProviders: string[];
    /** Feature flags enabled in this process; hardware availability is not inferred. */
    sensory: string[];
    /** Read-only tools that let the agent inspect its own implementation. */
    selfInspectionTools: string[];
  };
  /** A speakable / readable rendering of everything above. */
  text: string;
}

export interface BuildSelfDescriptionOptions {
  /** Repo root (defaults to walking up from this module). */
  root?: string;
  env?: Record<string, string | undefined>;
  /** Live tool names (from the formal registry) — injected by the tool adapter. */
  toolNames?: string[];
  /** Active persona robot name (from getActivePersonaVoiceAsync). */
  personaRobotName?: string;
}

/** Walk up from `startDir` to the repo root — the dir that holds `buddy-sense`. */
export function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    try {
      if (fs.existsSync(path.join(dir, 'buddy-sense')) && fs.existsSync(path.join(dir, 'package.json'))) {
        return dir;
      }
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

function safeReadFile(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function safeIsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** First non-empty markdown heading/line of a README, stripped of leading `# `. */
function firstReadmeLine(content: string | null): string | null {
  if (!content) return null;
  for (const raw of content.split('\n')) {
    const line = raw.replace(/^#+\s*/, '').trim();
    if (line) return line;
  }
  return null;
}

/** Read a TOML `description = "..."` field (buddy-sense/Cargo.toml). */
function tomlDescription(content: string | null): string | null {
  if (!content) return null;
  const m = content.match(/^\s*description\s*=\s*"([^"]*)"/m);
  return m?.[1]?.trim() || null;
}

function describeSense(root: string): BrickInfo {
  const dir = path.join(root, 'buddy-sense');
  const present = safeExists(path.join(dir, 'Cargo.toml'));
  const description = tomlDescription(safeReadFile(path.join(dir, 'Cargo.toml')))
    ?? 'système nerveux multi-sensoriel (audio, vision, écran, vitalité)';
  let status = 'non présent';
  if (present) {
    const releaseBinary = ['buddy-sense', 'buddy-sense.exe']
      .some((name) => safeIsFile(path.join(dir, 'target', 'release', name)));
    const debugBinary = ['buddy-sense', 'buddy-sense.exe']
      .some((name) => safeIsFile(path.join(dir, 'target', 'debug', name)));
    status = releaseBinary
      ? 'binaire release présent (exécution non sondée)'
      : debugBinary
        ? 'binaire debug présent (exécution non sondée)'
        : 'source présente (aucun binaire détecté)';
  }
  return { id: 'buddy-sense', role: 'les oreilles / le système nerveux (Rust)', description, present, status };
}

function describeVision(root: string): BrickInfo {
  const dir = path.join(root, 'buddy-vision');
  const readme = firstReadmeLine(safeReadFile(path.join(dir, 'README.md')));
  const scripts = ['watch.py', 'ear.py']
    .filter((name) => safeIsFile(path.join(dir, name)));
  const present = scripts.length > 0 || safeExists(path.join(dir, 'README.md'));
  return {
    id: 'buddy-vision',
    role: 'les yeux et l’oreille live (Python)',
    description: readme?.replace(/^buddy-vision\s*[—-]\s*/i, '') ?? 'caméra + micro, événements sémantiques (person_entered / drowsy)',
    present,
    status: scripts.length > 0
      ? `source présente (${scripts.join(', ')} ; exécution non sondée)`
      : present
        ? 'source présente (scripts watch.py/ear.py non détectés)'
        : 'non présent',
  };
}

function describeMemory(root: string): BrickInfo {
  const dir = path.join(root, 'buddy-memory');
  const hasSource = safeExists(path.join(dir, 'Cargo.toml')) || safeExists(path.join(dir, 'src'));
  const dirExists = safeExists(dir);
  return {
    id: 'buddy-memory',
    role: 'la mémoire collective (Rust CKG)',
    description: 'moteur de mémoire/graphe de connaissance dédié (sidecar opt-in du CKG)',
    present: hasSource,
    status: hasSource ? 'présent' : dirExists ? 'stub (planifié — pas de source dans ce checkout)' : 'non présent',
  };
}

/** Provider configurations detectable from the environment (best-effort, no network). */
function detectConfiguredProviders(env: Record<string, string | undefined>): string[] {
  const providers: string[] = [];
  if (env.GROK_API_KEY || env.XAI_API_KEY) providers.push('Grok/xAI');
  if (env.OPENAI_API_KEY) providers.push('OpenAI/ChatGPT');
  if (env.ANTHROPIC_API_KEY) providers.push('Claude');
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) providers.push('Gemini');
  if (env.GROQ_API_KEY) providers.push('Groq');
  if (env.MISTRAL_API_KEY) providers.push('Mistral');
  if (env.OPENROUTER_API_KEY) providers.push('OpenRouter');
  if (env.OLLAMA_HOST || env.OLLAMA_BASE_URL) providers.push('Ollama (local)');
  if (env.LMSTUDIO_BASE_URL || env.LM_STUDIO_BASE_URL) providers.push('LM Studio (local)');
  return providers;
}

/** Sensory faculties enabled by configuration; this does not probe their hardware. */
function detectConfiguredSensory(env: Record<string, string | undefined>): string[] {
  const on: string[] = [];
  if (env.CODEBUDDY_SENSORY_CAMERA === 'true') on.push('vision (caméra)');
  if (env.CODEBUDDY_SENSORY_SCREEN === 'true') on.push('écran');
  if (env.CODEBUDDY_SENSORY_SPEECH === 'true') on.push('écoute (STT)');
  if (env.CODEBUDDY_SENSORY_SPEAK === 'true') on.push('voix (TTS)');
  if (env.CODEBUDDY_REMINDERS === 'true') on.push('rappels');
  return on;
}

const SELF_INSPECTION_TOOLS = [
  'self_describe',
  'view_file',
  'read_file',
  'search',
  'codebase_map',
  'code_graph',
  'git',
] as const;

export function buildSelfDescription(opts: BuildSelfDescriptionOptions = {}): SelfDescription {
  const here = (() => {
    try {
      return path.dirname(fileURLToPath(import.meta.url));
    } catch {
      return process.cwd();
    }
  })();
  const root = opts.root ?? findRepoRoot(here);
  const env = opts.env ?? process.env;

  let name = 'code-buddy';
  let version = 'inconnue';
  let description = '';
  try {
    const pkgRaw = safeReadFile(path.join(root, 'package.json'));
    if (pkgRaw) {
      const pkg = JSON.parse(pkgRaw) as { name?: string; version?: string; description?: string };
      name = pkg.name ?? name;
      version = pkg.version ?? version;
      description = pkg.description ?? '';
    }
  } catch {
    /* keep defaults */
  }

  const bricks = [describeSense(root), describeVision(root), describeMemory(root)];
  const faculties = {
    toolCount: opts.toolNames ? opts.toolNames.length : null,
    activeProviders: detectConfiguredProviders(env),
    sensory: detectConfiguredSensory(env),
    selfInspectionTools: opts.toolNames
      ? SELF_INSPECTION_TOOLS.filter((name) => opts.toolNames!.includes(name))
      : [],
  };

  const text = renderText({ name, version, description, robotName: opts.personaRobotName, bricks, faculties });
  return { name, version, description, robotName: opts.personaRobotName, bricks, faculties, text };
}

function renderText(d: Omit<SelfDescription, 'text'>): string {
  const who = d.robotName ? `Je suis ${d.robotName}` : `Je suis ${d.name}`;
  const lines: string[] = [
    `${who} (${d.name} v${d.version}).`,
    d.description ? `En bref : ${d.description}` : '',
    '',
    'Mes briques :',
  ];
  for (const b of d.bricks) {
    lines.push(`- ${b.id} — ${b.role} : ${b.description} [${b.status}]`);
  }
  lines.push('');
  const facultyBits: string[] = [];
  if (d.faculties.toolCount !== null) facultyBits.push(`${d.faculties.toolCount} outils`);
  if (d.faculties.activeProviders.length) {
    facultyBits.push(
      `providers configurés (disponibilité non sondée) : ${d.faculties.activeProviders.join(', ')}`,
    );
  }
  if (d.faculties.sensory.length) {
    facultyBits.push(
      `facultés sensorielles activées (matériel non sondé) : ${d.faculties.sensory.join(', ')}`,
    );
  }
  if (facultyBits.length) lines.push(`Facultés : ${facultyBits.join(' · ')}.`);
  if (d.faculties.selfInspectionTools.length) {
    lines.push(
      `Auto-inspection technique : ${d.faculties.selfInspectionTools.join(', ')}. ` +
      'Je peux examiner mon code et mon état vérifiable ; cela ne constitue pas une conscience subjective.',
    );
  }
  return lines.filter((l) => l !== '' || true).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
