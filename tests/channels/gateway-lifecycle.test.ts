/**
 * Gateway Lifecycle Manager & Slash Parity Tests
 */

import {
  MockChannel,
  ChannelManager,
  type ChannelType,
} from '../../src/channels/index.js';
import {
  GatewayLifecycleManager,
  resetGatewayLifecycle,
} from '../../src/channels/gateway-lifecycle.js';
import {
  buildSlashParityManifest,
  buildPlatformParityReport,
  extractActualCommands,
  renderSlashParityManifest,
  EXPECTED_SLASH_COMMANDS,
  type SlashCommandProvider,
} from '../../src/channels/slash-parity.js';
import { DiscordChannel } from '../../src/channels/discord/client.js';
import { TelegramChannel } from '../../src/channels/telegram/client.js';

describe('GatewayLifecycleManager', () => {
  let manager: ChannelManager;
  let lifecycle: GatewayLifecycleManager;

  beforeEach(() => {
    manager = new ChannelManager();
    lifecycle = new GatewayLifecycleManager(manager);
  });

  afterEach(async () => {
    await manager.shutdown();
    resetGatewayLifecycle();
  });

  describe('status()', () => {
    it('should return empty status when no channels registered', () => {
      const status = lifecycle.status();

      expect(status.ok).toBe(false); // no channels = not ok
      expect(status.totalChannels).toBe(0);
      expect(status.connectedCount).toBe(0);
      expect(status.errorCount).toBe(0);
      expect(status.disconnectedCount).toBe(0);
      expect(status.channels).toEqual([]);
      expect(status.generatedAt).toBeDefined();
    });

    it('should report per-channel readiness for disconnected channels', () => {
      const channel = new MockChannel({ type: 'telegram' });
      manager.registerChannel(channel);

      const status = lifecycle.status();

      expect(status.totalChannels).toBe(1);
      expect(status.disconnectedCount).toBe(1);
      expect(status.connectedCount).toBe(0);
      expect(status.channels).toHaveLength(1);
      expect(status.channels[0].channelId).toBe('telegram');
      expect(status.channels[0].readiness).toBe('disconnected');
      expect(status.channels[0].authenticated).toBe(false);
    });

    it('should report per-channel readiness for connected channels', async () => {
      const channel = new MockChannel({ type: 'discord' });
      manager.registerChannel(channel);
      await lifecycle.start('discord');

      const status = lifecycle.status();

      expect(status.ok).toBe(true);
      expect(status.totalChannels).toBe(1);
      expect(status.connectedCount).toBe(1);
      expect(status.disconnectedCount).toBe(0);
      expect(status.channels[0].readiness).toBe('connected');
      expect(status.channels[0].authenticated).toBe(true);
    });

    it('should report multiple channels with mixed states', async () => {
      const discord = new MockChannel({ type: 'discord' });
      const telegram = new MockChannel({ type: 'telegram' });
      const slack = new MockChannel({ type: 'slack' });

      manager.registerChannel(discord);
      manager.registerChannel(telegram);
      manager.registerChannel(slack);

      await lifecycle.start('discord');
      // telegram and slack remain disconnected

      const status = lifecycle.status();

      expect(status.totalChannels).toBe(3);
      expect(status.connectedCount).toBe(1);
      expect(status.disconnectedCount).toBe(2);

      const discordStatus = status.channels.find((c) => c.channelId === 'discord');
      expect(discordStatus?.readiness).toBe('connected');

      const telegramStatus = status.channels.find((c) => c.channelId === 'telegram');
      expect(telegramStatus?.readiness).toBe('disconnected');
    });
  });

  describe('start() / stop() lifecycle transitions', () => {
    it('should start a registered channel', async () => {
      const channel = new MockChannel({ type: 'telegram' });
      manager.registerChannel(channel);

      await lifecycle.start('telegram');

      expect(lifecycle.isActive('telegram')).toBe(true);
      expect(channel.getStatus().connected).toBe(true);
    });

    it('should stop a started channel', async () => {
      const channel = new MockChannel({ type: 'telegram' });
      manager.registerChannel(channel);

      await lifecycle.start('telegram');
      expect(lifecycle.isActive('telegram')).toBe(true);

      await lifecycle.stop('telegram');
      expect(lifecycle.isActive('telegram')).toBe(false);
    });

    it('should throw when starting an unregistered channel', async () => {
      await expect(lifecycle.start('discord')).rejects.toThrow(
        "Channel 'discord' is not registered",
      );
    });

    it('should throw when stopping an unregistered channel', async () => {
      await expect(lifecycle.stop('discord')).rejects.toThrow(
        "Channel 'discord' is not registered",
      );
    });

    it('should restart a channel (stop + start)', async () => {
      const channel = new MockChannel({ type: 'slack' });
      manager.registerChannel(channel);

      await lifecycle.start('slack');
      expect(lifecycle.isActive('slack')).toBe(true);

      await lifecycle.restart('slack');
      expect(lifecycle.isActive('slack')).toBe(true);
      expect(channel.getStatus().connected).toBe(true);
    });

    it('should restart a channel that was never started', async () => {
      const channel = new MockChannel({ type: 'slack' });
      manager.registerChannel(channel);

      await lifecycle.restart('slack');
      expect(lifecycle.isActive('slack')).toBe(true);
    });

    it('should emit channel:started and channel:stopped events', async () => {
      const channel = new MockChannel({ type: 'matrix' });
      manager.registerChannel(channel);

      const events: string[] = [];
      lifecycle.on('channel:started', (id) => events.push(`started:${id}`));
      lifecycle.on('channel:stopped', (id) => events.push(`stopped:${id}`));

      await lifecycle.start('matrix');
      await lifecycle.stop('matrix');

      expect(events).toEqual(['started:matrix', 'stopped:matrix']);
    });
  });

  describe('startAll() / stopAll()', () => {
    it('should start all registered channels', async () => {
      manager.registerChannel(new MockChannel({ type: 'discord' }));
      manager.registerChannel(new MockChannel({ type: 'telegram' }));

      await lifecycle.startAll();

      expect(lifecycle.getActiveChannels()).toHaveLength(2);
      expect(lifecycle.isActive('discord')).toBe(true);
      expect(lifecycle.isActive('telegram')).toBe(true);
    });

    it('should stop all active channels', async () => {
      manager.registerChannel(new MockChannel({ type: 'discord' }));
      manager.registerChannel(new MockChannel({ type: 'telegram' }));

      await lifecycle.startAll();
      await lifecycle.stopAll();

      expect(lifecycle.getActiveChannels()).toHaveLength(0);
    });

    it('should emit gateway:started and gateway:stopped events', async () => {
      manager.registerChannel(new MockChannel({ type: 'discord' }));

      const events: string[] = [];
      lifecycle.on('gateway:started', () => events.push('gateway:started'));
      lifecycle.on('gateway:stopped', () => events.push('gateway:stopped'));

      await lifecycle.startAll();
      await lifecycle.stopAll();

      expect(events).toEqual(['gateway:started', 'gateway:stopped']);
    });

    it('should continue starting other channels when one fails', async () => {
      const good = new MockChannel({ type: 'discord' });
      const bad = new MockChannel({ type: 'telegram' });

      // Make the bad channel's connect() reject
      bad.connect = async () => {
        throw new Error('Connection failed');
      };

      manager.registerChannel(bad);
      manager.registerChannel(good);

      await lifecycle.startAll();

      // Discord should still be active
      expect(lifecycle.isActive('discord')).toBe(true);
      // Telegram should not be active
      expect(lifecycle.isActive('telegram')).toBe(false);

      const status = lifecycle.status();
      const telegramStatus = status.channels.find((c) => c.channelId === 'telegram');
      expect(telegramStatus?.readiness).toBe('error');
      expect(telegramStatus?.error).toBe('Connection failed');
    });
  });

  describe('error handling', () => {
    it('should record error when start fails and report it in status', async () => {
      const channel = new MockChannel({ type: 'slack' });
      channel.connect = async () => {
        throw new Error('Auth failed');
      };
      manager.registerChannel(channel);

      await expect(lifecycle.start('slack')).rejects.toThrow('Auth failed');

      const status = lifecycle.status();
      expect(status.errorCount).toBe(1);
      expect(status.channels[0].readiness).toBe('error');
      expect(status.channels[0].error).toBe('Auth failed');
    });

    it('should emit channel:error when start fails', async () => {
      const channel = new MockChannel({ type: 'slack' });
      channel.connect = async () => {
        throw new Error('Auth failed');
      };
      manager.registerChannel(channel);

      const errors: Array<{ id: ChannelType; message: string }> = [];
      lifecycle.on('channel:error', (id, err) => errors.push({ id, message: err.message }));

      try {
        await lifecycle.start('slack');
      } catch {
        // expected
      }

      expect(errors).toHaveLength(1);
      expect(errors[0].id).toBe('slack');
      expect(errors[0].message).toBe('Auth failed');
    });

    it('should clear error after successful restart', async () => {
      const channel = new MockChannel({ type: 'slack' });
      let shouldFail = true;

      const originalConnect = channel.connect.bind(channel);
      channel.connect = async () => {
        if (shouldFail) {
          throw new Error('Temporary failure');
        }
        return originalConnect();
      };

      manager.registerChannel(channel);

      // First attempt fails
      try {
        await lifecycle.start('slack');
      } catch {
        // expected
      }
      expect(lifecycle.status().channels[0].readiness).toBe('error');

      // Second attempt succeeds
      shouldFail = false;
      await lifecycle.restart('slack');

      expect(lifecycle.status().channels[0].readiness).toBe('connected');
      expect(lifecycle.status().channels[0].error).toBeUndefined();
    });
  });
});

describe('Slash Parity Manifest', () => {
  describe('EXPECTED_SLASH_COMMANDS', () => {
    it('should define commands for discord, telegram, slack, and matrix', () => {
      expect(EXPECTED_SLASH_COMMANDS.discord).toBeDefined();
      expect(EXPECTED_SLASH_COMMANDS.telegram).toBeDefined();
      expect(EXPECTED_SLASH_COMMANDS.slack).toBeDefined();
      expect(EXPECTED_SLASH_COMMANDS.matrix).toBeDefined();
    });

    it('should have at least ask, status, clear, help as required commands on each platform', () => {
      const coreCommands = ['ask', 'status', 'clear', 'help'];
      for (const platform of ['discord', 'telegram', 'slack', 'matrix']) {
        const cmds = EXPECTED_SLASH_COMMANDS[platform];
        for (const name of coreCommands) {
          const cmd = cmds.find((c) => c.name === name);
          expect(cmd).toBeDefined();
          expect(cmd!.required).not.toBe(false); // required by default
        }
      }
    });
  });

  describe('buildPlatformParityReport', () => {
    it('should report full parity when all commands are present', () => {
      const expected = [
        { name: 'ask', description: 'Ask a question' },
        { name: 'status', description: 'Show status' },
      ];
      const actual = ['ask', 'status'];

      const report = buildPlatformParityReport('discord', expected, actual, true);

      expect(report.status).toBe('full');
      expect(report.presentCount).toBe(2);
      expect(report.missingRequiredCount).toBe(0);
      expect(report.adapterRegistered).toBe(true);
    });

    it('should report partial parity when some commands are missing', () => {
      const expected = [
        { name: 'ask', description: 'Ask a question' },
        { name: 'status', description: 'Show status' },
        { name: 'help', description: 'Show help' },
      ];
      const actual = ['ask'];

      const report = buildPlatformParityReport('telegram', expected, actual, true);

      expect(report.status).toBe('partial');
      expect(report.presentCount).toBe(1);
      expect(report.missingRequiredCount).toBe(2);
    });

    it('should report no-adapter when adapter is not registered', () => {
      const expected = [
        { name: 'ask', description: 'Ask a question' },
      ];

      const report = buildPlatformParityReport('slack', expected, [], false);

      expect(report.status).toBe('no-adapter');
      expect(report.adapterRegistered).toBe(false);
      expect(report.missingRequiredCount).toBe(1);
    });

    it('should distinguish required vs optional missing commands', () => {
      const expected = [
        { name: 'ask', description: 'Ask', required: true },
        { name: 'think', description: 'Think', required: false },
      ];
      const actual: string[] = [];

      const report = buildPlatformParityReport('discord', expected, actual, true);

      expect(report.missingRequiredCount).toBe(1);
      expect(report.missingOptionalCount).toBe(1);
    });

    it('should be case-insensitive when matching commands', () => {
      const expected = [
        { name: 'Ask', description: 'Ask' },
      ];
      const actual = ['ask'];

      const report = buildPlatformParityReport('discord', expected, actual, true);

      expect(report.presentCount).toBe(1);
      expect(report.status).toBe('full');
    });
  });

  describe('buildSlashParityManifest', () => {
    it('should build a manifest with no-adapter for all platforms when no channels registered', () => {
      const emptyManager = new ChannelManager();
      const manifest = buildSlashParityManifest(emptyManager);

      expect(manifest.totalPlatforms).toBe(4); // discord, telegram, slack, matrix
      expect(manifest.noAdapterCount).toBe(4);
      expect(manifest.ok).toBe(false);

      for (const platform of manifest.platforms) {
        expect(platform.status).toBe('no-adapter');
      }
    });

    it('should report a registered adapter with no command provider', () => {
      const mgr = new ChannelManager();
      const channel = new MockChannel({ type: 'discord' });
      mgr.registerChannel(channel);

      const manifest = buildSlashParityManifest(mgr);

      const discordReport = manifest.platforms.find((p) => p.platform === 'discord');
      expect(discordReport).toBeDefined();
      expect(discordReport!.adapterRegistered).toBe(true);
      // MockChannel doesn't implement SlashCommandProvider, so none present
      expect(discordReport!.presentCount).toBe(0);
      expect(discordReport!.status).toBe('none');
    });

    it('should report full parity when adapter provides all expected commands', () => {
      const mgr = new ChannelManager();
      const channel = new MockChannel({ type: 'discord' }) as MockChannel & SlashCommandProvider;
      // Add SlashCommandProvider method
      (channel as unknown as SlashCommandProvider).getRegisteredCommands = () =>
        EXPECTED_SLASH_COMMANDS.discord.map((c) => c.name);
      mgr.registerChannel(channel);

      const manifest = buildSlashParityManifest(mgr);

      const discordReport = manifest.platforms.find((p) => p.platform === 'discord');
      expect(discordReport!.status).toBe('full');
      expect(discordReport!.missingRequiredCount).toBe(0);
    });
  });

  describe('extractActualCommands', () => {
    it('should return empty array for channel without SlashCommandProvider', () => {
      const channel = new MockChannel();
      expect(extractActualCommands(channel)).toEqual([]);
    });

    it('should return commands from SlashCommandProvider', () => {
      const channel = new MockChannel() as MockChannel & SlashCommandProvider;
      (channel as unknown as SlashCommandProvider).getRegisteredCommands = () => ['ask', 'help'];
      expect(extractActualCommands(channel)).toEqual(['ask', 'help']);
    });
  });

  describe('adapter SlashCommandProvider implementations', () => {
    it('DiscordChannel.getRegisteredCommands returns configured command names (slash-stripped)', () => {
      const channel = new DiscordChannel({
        type: 'discord',
        token: 'bot-token',
        applicationId: 'app-1',
        commands: [
          { name: 'ask', description: 'Ask Code Buddy a question' },
          { name: '/status', description: 'Show status' },
          { name: 'help', description: 'Help' },
        ],
      });

      // Implements the provider contract the parity checker probes for.
      expect(extractActualCommands(channel)).toEqual(['ask', 'status', 'help']);
    });

    it('DiscordChannel.getRegisteredCommands returns [] when no commands configured', () => {
      const channel = new DiscordChannel({ type: 'discord', token: 'bot-token' });
      expect(channel.getRegisteredCommands()).toEqual([]);
    });

    it('TelegramChannel.getRegisteredCommands returns configured command names (slash-stripped)', () => {
      const channel = new TelegramChannel({
        type: 'telegram',
        token: 'bot-token',
        commands: [
          { command: 'ask', description: 'Ask Code Buddy a question' },
          { command: '/status', description: 'Show status' },
          { command: 'clear', description: 'Clear' },
        ],
      });

      expect(extractActualCommands(channel)).toEqual(['ask', 'status', 'clear']);
    });

    it('the parity manifest reports real present commands for a registered Discord adapter', () => {
      const mgr = new ChannelManager();
      // Configure every required Discord command so parity is full.
      const channel = new DiscordChannel({
        type: 'discord',
        token: 'bot-token',
        applicationId: 'app-1',
        commands: EXPECTED_SLASH_COMMANDS.discord.map((c) => ({
          name: c.name,
          description: c.description,
        })),
      });
      mgr.registerChannel(channel);

      const manifest = buildSlashParityManifest(mgr);
      const discordReport = manifest.platforms.find((p) => p.platform === 'discord');

      expect(discordReport).toBeDefined();
      expect(discordReport!.adapterRegistered).toBe(true);
      // Real provider now surfaces commands instead of the empty fallback.
      expect(discordReport!.presentCount).toBe(EXPECTED_SLASH_COMMANDS.discord.length);
      expect(discordReport!.missingRequiredCount).toBe(0);
      expect(discordReport!.status).toBe('full');
    });
  });

  describe('renderSlashParityManifest', () => {
    it('should render a human-readable report', () => {
      const emptyManager = new ChannelManager();
      const manifest = buildSlashParityManifest(emptyManager);

      const output = renderSlashParityManifest(manifest);

      expect(output).toContain('Slash-command parity report');
      expect(output).toContain('discord');
      expect(output).toContain('telegram');
      expect(output).toContain('slack');
      expect(output).toContain('matrix');
      expect(output).toContain('no-adapter');
    });
  });
});
