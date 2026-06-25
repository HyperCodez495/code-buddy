/**
 * Sensory alert — best-effort Telegram push (photo + caption) for the remote
 * watch. Token + chat id come from env (`CODEBUDDY_SENSORY_ALERT_TOKEN` /
 * `CODEBUDDY_SENSORY_ALERT_CHAT`). No-op when unconfigured; never throws.
 *
 * @module sensory/alert
 */
import { logger } from '../utils/logger.js';

export async function sendTelegramAlert(caption: string, imagePath?: string): Promise<void> {
  const token = process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
  const chat = process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
  if (!token || !chat) return;
  try {
    if (imagePath) {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const bytes = await fs.readFile(imagePath);
      const form = new FormData();
      form.append('chat_id', chat);
      form.append('caption', caption.slice(0, 1024));
      form.append('photo', new Blob([bytes], { type: 'image/jpeg' }), path.basename(imagePath));
      await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
    } else {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: caption }),
      });
    }
  } catch (err) {
    logger.warn(`[sensory] alert failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
