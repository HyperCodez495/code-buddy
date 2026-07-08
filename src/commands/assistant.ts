/**
 * `buddy assistant` — manage the voice assistant (Lisa).
 *
 * For now the headline subcommand is `improve`: run one MySoulmate-inspired
 * improvement cycle (reflect on recent conversation → learned reply-guidance +
 * bounded trait drift + proposed user preferences). Dry-run by default; `--apply`
 * is the explicit human review that also accepts the proposed preferences.
 *
 * @module commands/assistant
 */
import { execFileSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import type { Command } from 'commander';
import {
  ASSISTANT_SETTINGS,
  envFilePath,
  listPocketVoices,
  previewVoice,
  readAssistantConfig,
  restartAssistantServices,
  writeAssistantConfig,
  type AssistantSetting,
  type AssistantSettingGroup,
} from '../companion/assistant-config.js';
import { logger } from '../utils/logger.js';

const GROUPS: AssistantSettingGroup[] = ['voice', 'speech', 'behavior', 'companion'];
const GROUP_LABELS: Record<AssistantSettingGroup, string> = {
  voice: 'Voix',
  speech: 'Parole',
  behavior: 'Ecoute / reponse',
  companion: 'Compagnon',
};

function findSetting(key: string): AssistantSetting | undefined {
  return ASSISTANT_SETTINGS.find((setting) => setting.key === key);
}

function validateCliValue(setting: AssistantSetting, value: string): boolean {
  if (setting.type !== 'enum') return true;
  return setting.options?.includes(value) ?? false;
}

function printWriteResult(result: { vision: string[]; lisa: string[] }): void {
  const files: string[] = [];
  if (result.vision.length > 0) files.push(`vision (${envFilePath('vision')})`);
  if (result.lisa.length > 0) files.push(`lisa (${envFilePath('lisa')})`);
  if (files.length === 0) {
    console.log('Aucune valeur ecrite (cle inconnue ou valeur invalide).');
    return;
  }
  console.log(`Ecrit dans : ${files.join(', ')}`);
}

function playAudioFile(path: string): boolean {
  const players =
    process.platform === 'darwin'
      ? [{ command: 'afplay', args: [path] }]
      : [
          { command: 'aplay', args: [path] },
          { command: 'paplay', args: [path] },
          { command: 'ffplay', args: ['-nodisp', '-autoexit', path] },
        ];

  for (const player of players) {
    try {
      execFileSync(player.command, player.args, { stdio: 'inherit' });
      return true;
    } catch (error) {
      logger.debug('Audio player unavailable', { player: player.command, error });
    }
  }

  return false;
}

export function registerAssistantCommand(program: Command): void {
  const assistant = program
    .command('assistant')
    .description('Manage the voice assistant (Lisa): improvement loop, voice, config');

  assistant
    .command('show')
    .description('Show the effective voice assistant config')
    .action(() => {
      const config = readAssistantConfig();
      for (const group of GROUPS) {
        console.log(`\n${GROUP_LABELS[group]}`);
        for (const setting of ASSISTANT_SETTINGS.filter((item) => item.group === group)) {
          console.log(`  ${setting.label}: ${config[setting.key] ?? setting.default}`);
        }
      }
    });

  assistant
    .command('set')
    .description('Set one voice assistant environment value')
    .argument('<key>', 'Environment key to update')
    .argument('<value>', 'Value to write')
    .action((key: string, value: string) => {
      const setting = findSetting(key);
      if (!setting) {
        console.error(`Cle inconnue : ${key}`);
        process.exitCode = 1;
        return;
      }
      if (!validateCliValue(setting, value)) {
        console.error(
          `Valeur invalide pour ${key}. Valeurs autorisees : ${(setting.options ?? []).join(', ')}`
        );
        process.exitCode = 1;
        return;
      }
      printWriteResult(writeAssistantConfig({ [key]: value }));
    });

  assistant
    .command('voice')
    .description('Use Pocket TTS with the given voice')
    .argument('<name>', 'Pocket voice name or clone sample path')
    .action((name: string) => {
      printWriteResult(
        writeAssistantConfig({
          CODEBUDDY_TTS_ENGINE: 'pocket',
          CODEBUDDY_POCKET_VOICE: name,
        })
      );
    });

  assistant
    .command('voices')
    .description('List Pocket TTS preset voices')
    .action(() => {
      for (const voice of listPocketVoices()) console.log(voice);
    });

  assistant
    .command('preview')
    .description('Synthesize and play a Pocket TTS voice preview')
    .argument('<name>', 'Pocket voice name or clone sample path')
    .action(async (name: string) => {
      const wavPath = await previewVoice(name);
      if (!wavPath) {
        console.error('Pocket TTS indisponible ou impossible de synthetiser cet apercu.');
        process.exitCode = 1;
        return;
      }

      let played = false;
      try {
        played = playAudioFile(wavPath);
        if (!played) {
          console.log(`Audio genere : ${wavPath}`);
          console.error('Aucun lecteur audio trouve. Installe aplay, paplay ou ffplay.');
        }
      } finally {
        if (played) {
          try {
            unlinkSync(wavPath);
          } catch (error) {
            logger.debug('Failed to remove temporary audio file', { wavPath, error });
          }
        }
      }
    });

  assistant
    .command('apply')
    .description('Restart assistant user services so systemd reloads the env files')
    .action(async () => {
      const results = await restartAssistantServices(['buddy-vision-brain', 'lisa-telegram']);
      for (const result of results) {
        if (result.ok) {
          console.log(`ok ${result.service}`);
        } else {
          console.log(`failed ${result.service}: ${result.error ?? 'unknown error'}`);
          process.exitCode = 1;
        }
      }
    });

  assistant
    .command('improve')
    .description(
      'Run one improvement cycle: reflect on recent conversation and adapt (MySoulmate-style)'
    )
    .option(
      '--apply',
      'Persist ALL learnings, incl. accepting proposed user preferences (human review)'
    )
    .option('--limit <n>', 'How many recent heard utterances to reflect on', '20')
    .action(async (opts: { apply?: boolean; limit: string }) => {
      const { runVoiceImprovementCycle } = await import('../companion/voice-improvement-loop.js');
      const limit = Math.max(2, Number(opts.limit) || 20);
      const mode = opts.apply ? 'all' : 'dry';
      const res = await runVoiceImprovementCycle({ mode, limit });
      if (!res) {
        console.log(
          'Rien à améliorer : pas assez de conversation récente, ou aucun modèle LLM configuré ' +
            '(lance `buddy login` pour le mode ChatGPT $0).'
        );
        return;
      }
      const { reflection } = res;
      console.log(
        `\n🎙️  Cycle d'amélioration (${res.heardCount} phrases entendues, mode ${mode})\n`
      );
      console.log(`  Ton détecté : ${reflection.signal}`);
      console.log(`  Consigne apprise : ${reflection.guidance || '(aucune)'}`);
      console.log(
        `  Préférences repérées : ${reflection.facts.length ? '\n    - ' + reflection.facts.join('\n    - ') : '(aucune)'}`
      );
      if (mode === 'dry') {
        console.log(
          '\n  (dry-run — rien enregistré. Relance avec --apply pour appliquer et accepter les préférences.)'
        );
      } else {
        console.log('\n  Appliqué :');
        console.log(`    - consigne vocale : ${res.guidanceApplied ? 'ajoutée' : 'non'}`);
        console.log(`    - dérive de personnalité : ${res.driftApplied ? 'oui' : 'non'}`);
        console.log(
          `    - préférences acceptées : ${res.acceptedFacts.length ? res.acceptedFacts.join(' ; ') : '(aucune)'}`
        );
        console.log(
          '\n  Astuce : active `CODEBUDDY_COMPANION_RELATIONAL=true` pour que ces apprentissages soient injectés dans les réponses.'
        );
      }
    });
}

export default registerAssistantCommand;
