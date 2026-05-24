import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getBrowserManager, BrowserManager } from './browser-manager.js';
import type { BrowserOperatorSessionDraft, BrowserOperatorActionLogEntry } from './browser-operator-session.js';
import { logger } from '../utils/logger.js';
import { getBrowserTool } from './browser-tool.js';

export class BrowserOperatorExecutor {
  private session: BrowserOperatorSessionDraft;
  private manager: BrowserManager | null = null;
  private isStopped = false;

  constructor(session: BrowserOperatorSessionDraft) {
    this.session = session;
  }

  /**
   * Grant consent for the session
   */
  grantConsent(reviewer: string = 'human-operator'): void {
    this.session.consent.granted = true;
    this.session.consent.grantedBy = reviewer;
    this.session.consent.grantedAt = new Date().toISOString();
    logger.info(`BrowserOperatorExecutor: Consent granted for session ${this.session.sessionId} by ${reviewer}`);
  }

  /**
   * Stop the session execution
   */
  stop(): void {
    this.isStopped = true;
    logger.info(`BrowserOperatorExecutor: Stop signal received for session ${this.session.sessionId}`);
  }

  /**
   * Run the planned browser actions sequentially
   */
  async execute(cwd: string = process.cwd()): Promise<{ success: boolean; stopped: boolean; actionLog: BrowserOperatorActionLogEntry[] }> {
    // 1. Consent Gate Check
    if (!this.session.consent.granted) {
      logger.error('BrowserOperatorExecutor: Execution blocked. Consent required.');
      throw new Error('BrowserOperatorConsentRequired: Execution blocked. Local browser operator requires human consent.');
    }

    logger.info(`BrowserOperatorExecutor: Starting execution for session ${this.session.sessionId} (mode: ${this.session.mode})`);
    
    // 2. Initialize Browser Manager
    // Visible tab if local, headless if isolated
    const isHeadless = this.session.mode === 'isolated';
    this.manager = getBrowserManager({
      headless: isHeadless,
    });

    try {
      await this.manager.launch();
    } catch (err) {
      logger.error('BrowserOperatorExecutor: Failed to launch browser', err as Error);
      throw err;
    }

    // 3. Execute steps sequentially
    for (let i = 0; i < this.session.actionLog.length; i++) {
      const entry = this.session.actionLog[i]!;

      // If stop was requested mid-run
      if (this.isStopped) {
        entry.status = 'stopped';
        entry.evidence = 'Session stopped by operator request.';
        continue;
      }

      entry.status = 'running';
      logger.info(`BrowserOperatorExecutor: Running action ${entry.sequence}: ${entry.title}`);

      try {
        let actionResult = '';
        if (entry.tool === 'navigate') {
          const url = entry.inputs?.url || this.session.query;
          if (url) {
            const res = await getBrowserTool().execute({
              action: 'navigate',
              url,
            });
            if (!res.success) throw new Error(res.error || 'Navigation failed');
            actionResult = res.output || `Successfully navigated to ${url}`;
          }
        } else if (entry.tool === 'click') {
          const ref = entry.inputs?.ref;
          if (ref !== undefined) {
            const res = await getBrowserTool().execute({
              action: 'click',
              ref: typeof ref === 'string' ? parseInt(ref, 10) : ref,
            });
            if (!res.success) throw new Error(res.error || 'Click failed');
            actionResult = res.output || `Clicked element: ${ref}`;
          }
        } else if (entry.tool === 'type') {
          const ref = entry.inputs?.ref;
          const text = entry.inputs?.text;
          if (ref !== undefined && text !== undefined) {
            const res = await getBrowserTool().execute({
              action: 'type',
              ref: typeof ref === 'string' ? parseInt(ref, 10) : ref,
              text,
            });
            if (!res.success) throw new Error(res.error || 'Type failed');
            actionResult = res.output || `Typed into ${ref}`;
          }
        } else {
          // Dynamic execution via BrowserTool
          const res = await getBrowserTool().execute({
            action: entry.tool as any,
            ...(entry.inputs || {}),
          });
          if (!res.success) throw new Error(res.error || `Execution of ${entry.tool} failed`);
          actionResult = res.output || `Executed ${entry.tool}`;
        }

        entry.status = 'completed';
        entry.evidence = actionResult;

        // Take evidence screenshot if visible/local
        if (!isHeadless) {
          const screenshotName = `evidence_${entry.id}.png`;
          const screenshotPath = path.join(cwd, '.codebuddy', 'runs', this.session.sessionId, 'artifacts', screenshotName);
          fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
          try {
            const buffer = await this.manager.screenshot({});
            fs.writeFileSync(screenshotPath, buffer);
            entry.evidence += `\n[Screenshot saved: ${screenshotName}]`;
          } catch {
            // Ignore screenshot failures
          }
        }

      } catch (err: any) {
        entry.status = 'blocked';
        entry.evidence = `Failed: ${err.message}`;
        logger.error(`BrowserOperatorExecutor: Action failed`, err as Error);
        
        // Stop execution on failure
        this.isStopped = true;
      }

      // Check stop conditions (automatic stop-patterns search)
      if (entry.evidence) {
        for (const cond of this.session.stopControl.stopConditions) {
          if (entry.evidence.toLowerCase().includes(cond.toLowerCase())) {
            logger.warn(`BrowserOperatorExecutor: Stop condition met: "${cond}"`);
            this.isStopped = true;
            entry.status = 'stopped';
            entry.evidence += `\n[Stopped: Stop condition "${cond}" matched]`;
            break;
          }
        }
      }
    }

    // Clean up browser
    try {
      await this.manager.close();
    } catch {
      // Ignore
    }

    // 4. Save proof file
    const proofArtifact = {
      sessionId: this.session.sessionId,
      generatedAt: new Date().toISOString(),
      goal: this.session.goal,
      mode: this.session.mode,
      consent: this.session.consent,
      actionLog: this.session.actionLog,
      success: !this.isStopped && this.session.actionLog.every(e => e.status === 'completed'),
      stopped: this.isStopped,
    };

    const proofFileName = `${this.session.sessionId}.browser-operator.json`;
    const proofPath = path.join(cwd, '.codebuddy', 'runs', this.session.sessionId, 'artifacts', proofFileName);
    fs.mkdirSync(path.dirname(proofPath), { recursive: true });
    fs.writeFileSync(proofPath, JSON.stringify(proofArtifact, null, 2), 'utf-8');

    logger.info(`BrowserOperatorExecutor: Execution complete. Proof written to ${proofFileName}`);

    return {
      success: proofArtifact.success,
      stopped: proofArtifact.stopped,
      actionLog: this.session.actionLog,
    };
  }
}
