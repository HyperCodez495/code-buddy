/**
 * TelegramChannel — P6.4
 *
 * Minimal Telegram Bot API channel adapter. Polls getUpdates with long-
 * polling and forwards incoming messages to the message-router. Outbound
 * messages go through sendMessage.
 *
 * Configure with TELEGRAM_BOT_TOKEN env var or via remote-manager config.
 */

export interface TelegramConfig {
  botToken: string;
  pollIntervalMs?: number;
  apiBase?: string;
}

export interface TelegramIncomingMessage {
  updateId: number;
  chatId: number;
  fromUserId: number;
  fromUserName?: string;
  text?: string;
  date: number;
}

export type TelegramMessageHandler = (msg: TelegramIncomingMessage) => void | Promise<void>;

export class TelegramChannel {
  private offset = 0;
  private stopped = true;
  private handler: TelegramMessageHandler | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private cfg: TelegramConfig) {
    if (!cfg.botToken) {
      throw new Error('TelegramChannel: botToken required');
    }
    this.cfg.apiBase = cfg.apiBase ?? 'https://api.telegram.org';
    this.cfg.pollIntervalMs = cfg.pollIntervalMs ?? 30_000;
  }

  setHandler(h: TelegramMessageHandler) {
    this.handler = h;
  }

  start() {
    this.stopped = false;
    void this.pollLoop();
  }

  stop() {
    this.stopped = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    const url = `${this.cfg.apiBase}/bot${this.cfg.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
    }
  }

  private async pollLoop() {
    if (this.stopped) return;
    try {
      const url = `${this.cfg.apiBase}/bot${this.cfg.botToken}/getUpdates?timeout=25&offset=${this.offset}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as {
          ok: boolean;
          result?: Array<{
            update_id: number;
            message?: {
              message_id: number;
              chat: { id: number };
              from: { id: number; username?: string; first_name?: string };
              text?: string;
              date: number;
            };
          }>;
        };
        if (data.ok && data.result) {
          for (const upd of data.result) {
            this.offset = upd.update_id + 1;
            const m = upd.message;
            if (!m || !this.handler) continue;
            await this.handler({
              updateId: upd.update_id,
              chatId: m.chat.id,
              fromUserId: m.from.id,
              fromUserName: m.from.username ?? m.from.first_name,
              text: m.text,
              date: m.date,
            });
          }
        }
      }
    } catch {
      // Network blip — back off briefly before retry.
    }
    if (!this.stopped) {
      this.pollTimer = setTimeout(() => this.pollLoop(), 1000);
    }
  }
}
