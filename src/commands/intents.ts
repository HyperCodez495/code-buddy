/** `buddy intents` — opt-in CLI for durable, replayable task specifications. */

import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import { IntentStore, serializeIntent, type Intent } from '../intents/intent-store.js';
import { checkIntent, drift } from '../intents/intent-checker.js';
import { generateIntent } from '../intents/intent-generator.js';

export interface IntentsCommandDeps {
  rootDir?: string;
  store?: IntentStore;
  generate?: typeof generateIntent;
}

function ensureEnabled(): boolean {
  if (process.env.CODEBUDDY_INTENTS === 'true') return true;
  logger.error(
    'Intent Ledger is an experimental opt-in feature and is off by default.\n' +
      'Enable it explicitly for this command:\n\n' +
      '  CODEBUDDY_INTENTS=true buddy intents <command>',
  );
  process.exitCode = 1;
  return false;
}

function reportError(error: unknown): void {
  logger.error(`[intents] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

function formatIntentLine(intent: Intent): string {
  return `${intent.id}\t${intent.status}\t${intent.title}`;
}

export function createIntentsCommand(deps: IntentsCommandDeps = {}): Command {
  const store = deps.store ?? new IntentStore({ rootDir: deps.rootDir });
  const generate = deps.generate ?? generateIntent;
  const command = new Command('intents')
    .description('Manage replayable intent specifications (opt-in CODEBUDDY_INTENTS=true)')
    .action(() => {
      if (!ensureEnabled()) return;
      logger.info('Choose a subcommand: new, list, show, check, drift, done, or archive.');
      process.exitCode = 1;
    });

  command
    .command('new')
    .description('Generate and store an intent from a natural-language task')
    .argument('<description>', 'Task description')
    .action(async (description: string) => {
      if (!ensureEnabled()) return;
      try {
        const generated = await generate(description);
        const intent = await store.create(generated);
        logger.info(intent.id);
      } catch (error) {
        reportError(error);
      }
    });

  command
    .command('list')
    .description('List stored intents')
    .action(async () => {
      if (!ensureEnabled()) return;
      try {
        const intents = await store.list();
        if (intents.length === 0) {
          logger.info('No intents found.');
          return;
        }
        for (const intent of intents) logger.info(formatIntentLine(intent));
      } catch (error) {
        reportError(error);
      }
    });

  command
    .command('show')
    .description('Show one intent as Markdown')
    .argument('<id>', 'Intent id')
    .action(async (id: string) => {
      if (!ensureEnabled()) return;
      try {
        const intent = await store.get(id);
        if (!intent) throw new Error(`Intent "${id}" not found.`);
        logger.info(serializeIntent(intent));
      } catch (error) {
        reportError(error);
      }
    });

  command
    .command('check')
    .description('Replay every verification criterion for an intent')
    .argument('<id>', 'Intent id')
    .action(async (id: string) => {
      if (!ensureEnabled()) return;
      try {
        const intent = await store.get(id);
        if (!intent) throw new Error(`Intent "${id}" not found.`);
        const result = await checkIntent(intent, { store });
        for (const entry of result.results) {
          logger.info(
            `${entry.ok ? 'PASS' : 'FAIL'} ${entry.criterion.desc} (exit ${entry.exitCode ?? 'none'}, expected ${entry.criterion.expectExit})` +
              (entry.tail ? `\n${entry.tail}` : ''),
          );
        }
        logger.info(result.ok ? `Intent ${id}: PASS` : `Intent ${id}: FAIL`);
        if (!result.ok) process.exitCode = 1;
      } catch (error) {
        reportError(error);
      }
    });

  command
    .command('drift')
    .description('Re-check done intents and their referenced files')
    .action(async () => {
      if (!ensureEnabled()) return;
      try {
        const drifted = await drift(store);
        if (drifted.length === 0) {
          logger.info('No intent drift detected.');
          return;
        }
        for (const entry of drifted) {
          logger.error(`${entry.id}: DRIFT\n${entry.reasons.map((reason) => `  - ${reason}`).join('\n')}`);
        }
        process.exitCode = 1;
      } catch (error) {
        reportError(error);
      }
    });

  command
    .command('done')
    .description('Mark an intent done')
    .argument('<id>', 'Intent id')
    .action(async (id: string) => {
      if (!ensureEnabled()) return;
      try {
        await store.setStatus(id, 'done');
        logger.info(`Intent ${id} marked done.`);
      } catch (error) {
        reportError(error);
      }
    });

  command
    .command('archive')
    .description('Archive an intent')
    .argument('<id>', 'Intent id')
    .action(async (id: string) => {
      if (!ensureEnabled()) return;
      try {
        await store.setStatus(id, 'archived');
        logger.info(`Intent ${id} archived.`);
      } catch (error) {
        reportError(error);
      }
    });

  return command;
}
