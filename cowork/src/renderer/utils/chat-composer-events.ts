export const CHAT_COMPOSER_INSERT_EVENT = 'chat:composer-insert';

export interface ChatComposerInsertDetail {
  body: string;
}

export function dispatchChatComposerInsert(body: string): boolean {
  if (!body.trim()) return false;

  window.dispatchEvent(
    new CustomEvent<ChatComposerInsertDetail>(CHAT_COMPOSER_INSERT_EVENT, {
      detail: { body },
    })
  );
  return true;
}
