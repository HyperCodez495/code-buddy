import { ChannelBase, withRetry } from '../channel-base';
import { log, logError, logWarn } from '../../../utils/logger';
import type { 
  ChannelType, 
  RemoteMessage, 
  RemoteResponse,
  TelegramChannelConfig
} from '../../types';

export class TelegramChannel extends ChannelBase {
  readonly type: ChannelType = 'telegram';
  
  private offset = 0;
  private stopped = true;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private botUsername?: string;
  private botId?: number;

  constructor(private config: TelegramChannelConfig) {
    super();
    if (!config.botToken) {
      throw new Error('TelegramChannel: botToken required');
    }
  }

  async start(): Promise<void> {
    if (this._connected) return;
    
    try {
      // Get bot info
      const me = await this.apiCall<{ id: number; username: string }>('getMe');
      if (me) {
        this.botId = me.id;
        this.botUsername = me.username;
        log(`[Telegram] Bot started: @${this.botUsername} (${this.botId})`);
      }
      
      this._connected = true;
      this.stopped = false;
      this.logStatus('connected');
      void this.pollLoop();
    } catch (err) {
      logError('[Telegram] Failed to start:', err);
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this._connected = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.logStatus('disconnected');
  }

  async send(response: RemoteResponse): Promise<void> {
    if (!this._connected) {
      throw new Error('Channel not connected');
    }
    const { channelId, content, replyTo } = response;
    
    let text = '';
    if (content.type === 'markdown') {
      text = content.markdown ?? '';
    } else {
      text = content.text ?? '';
    }
    
    log(`[Telegram] Sending message:`, { channelId, contentType: content.type });

    await withRetry(
      async () => {
        const chunks = text ? this.splitMessage(text, 4000) : [''];
        for (const chunk of chunks) {
          const body: Record<string, unknown> = {
            chat_id: channelId,
            text: chunk,
          };
          if (replyTo) {
            body.reply_to_message_id = Number(replyTo);
          }
          
          if (content.type === 'markdown') {
            body.parse_mode = 'Markdown';
          }

          try {
             await this.apiCall('sendMessage', body, 'POST');
          } catch (e: unknown) {
             // If parse error (like unclosed tags), fallback to no parse mode
             const message = e instanceof Error ? e.message : '';
             if (message.includes('parse') || message.includes('can\'t parse entities')) {
                 delete body.parse_mode;
                 await this.apiCall('sendMessage', body, 'POST');
             } else {
                 throw e;
             }
          }
          if (chunks.length > 1) {
            await new Promise(r => setTimeout(r, 200));
          }
        }
      },
      {
        maxRetries: 3,
        delayMs: 1000,
        onRetry: (attempt, error) => logWarn(`[Telegram] Send retry ${attempt}:`, error.message)
      }
    );
  }

  private async apiCall<T>(method: string, body?: Record<string, unknown>, httpMethod: string = 'GET'): Promise<T> {
    const url = `https://api.telegram.org/bot${this.config.botToken}/${method}`;
    const init: RequestInit = { method: httpMethod };
    
    if (body) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    
    const res = await fetch(url, init);
    const data = (await res.json()) as { ok?: boolean; description?: string; result: T };
    
    if (!res.ok || !data.ok) {
      throw new Error(`Telegram API Error: ${data.description || res.statusText}`);
    }
    
    return data.result as T;
  }

  private async pollLoop(): Promise<void> {
    if (this.stopped) return;
    try {
      const updates = await this.apiCall<Array<{ update_id: number; message?: { message_id: number; chat: { id: number; type: string }; from: { id: number; username?: string; first_name?: string; is_bot?: boolean }; text?: string; reply_to_message?: { message_id: number }; date: number } }>>(`getUpdates?timeout=25&offset=${this.offset}`);
      
      for (const upd of updates) {
        this.offset = upd.update_id + 1;
        const msg = upd.message;
        if (!msg) continue;
        
        const isGroup = msg.chat.type !== 'private';
        
        let isMentioned = false;
        if (msg.text && this.botUsername) {
          isMentioned = msg.text.includes(`@${this.botUsername}`);
        }
        
        const remoteMessage: RemoteMessage = {
          id: String(msg.message_id),
          channelType: 'telegram',
          channelId: String(msg.chat.id),
          sender: {
            id: String(msg.from.id),
            name: msg.from.username ?? msg.from.first_name,
            isBot: msg.from.is_bot ?? false,
          },
          content: { type: 'text', text: msg.text || '' },
          replyTo: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
          timestamp: msg.date * 1000,
          isGroup,
          isMentioned,
          raw: msg,
        };
        
        if (remoteMessage.content.text && this.botUsername) {
           remoteMessage.content.text = remoteMessage.content.text
              .replace(new RegExp(`@${this.botUsername}`, 'g'), '')
              .trim();
        }
        
        this.emitMessage(remoteMessage);
      }
    } catch (err) {
      // Network blip, back off briefly
    }
    
    if (!this.stopped) {
      this.pollTimer = setTimeout(() => this.pollLoop(), 1000);
    }
  }
}
