import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { withSessionLock } from '../../persistence/session-lock.js';
import { logger } from '../../utils/logger.js';

export interface AcpPersistedSession {
  sessionId: string;
  cwd: string;
  title?: string;
  history: unknown[];
  mcpServers?: unknown;
  updatedAt: string;
}

export interface AcpSessionStoreConfig {
  storeDir?: string;
}

export class AcpSessionStore {
  private readonly dir: string;

  constructor(config: AcpSessionStoreConfig = {}) {
    this.dir = config.storeDir ?? this.defaultDir();
    this.ensureDir();
  }

  async save(session: AcpPersistedSession): Promise<void> {
    const file = this.fileFor(session.sessionId);
    await withSessionLock(file, async () => {
      await this.writeUnlocked(session);
    });
  }

  async load(sessionId: string): Promise<AcpPersistedSession | null> {
    const file = this.fileFor(sessionId);
    if (!fs.existsSync(file)) return null;
    try {
      const raw = await fs.promises.readFile(file, 'utf-8');
      return JSON.parse(raw) as AcpPersistedSession;
    } catch (err) {
      logger.warn?.('[acp-session-store] failed to read session', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async delete(sessionId: string): Promise<void> {
    const file = this.fileFor(sessionId);
    await withSessionLock(file, async () => {
      if (fs.existsSync(file)) {
        await fs.promises.unlink(file);
      }
    });
  }

  async listAll(): Promise<AcpPersistedSession[]> {
    if (!fs.existsSync(this.dir)) return [];
    const files = await fs.promises.readdir(this.dir);
    const sessions: AcpPersistedSession[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const sessionId = f.slice(0, -5);
      const s = await this.load(sessionId);
      if (s) sessions.push(s);
    }
    return sessions;
  }

  private async writeUnlocked(session: AcpPersistedSession): Promise<void> {
    const file = this.fileFor(session.sessionId);
    const temp = `${file}.tmp.${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.promises.writeFile(temp, JSON.stringify(session, null, 2), 'utf-8');
    await fs.promises.rename(temp, file);
  }

  private fileFor(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  private defaultDir(): string {
    const home = os.homedir();
    return path.join(home, '.codebuddy', 'acp-sessions');
  }
}
