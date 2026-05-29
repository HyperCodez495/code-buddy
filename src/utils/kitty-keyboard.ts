/**
 * Kitty Keyboard Protocol
 *
 * Enables progressive enhancement of keyboard input in terminals
 * that support the Kitty keyboard protocol (CSI u encoding).
 *
 * Supported terminals: kitty, WezTerm, ghostty, foot
 *
 * @see https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 */

/**
 * Enable Kitty keyboard protocol at progressive enhancement level 1.
 * This enables disambiguate escape codes and report event types.
 * Call this at startup — it is safe to call on unsupported terminals
 * (the escape sequence will simply be ignored).
 */
export function enableKittyKeyboard(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[>1u'); // Progressive enhancement level 1
  }
}

/**
 * Disable Kitty keyboard protocol, restoring the terminal to its
 * default keyboard mode. Call this before exit.
 */
export function disableKittyKeyboard(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[<u');
  }
}

/**
 * Parsed key event from the Kitty keyboard protocol.
 */
export interface KittyKeyEvent {
  key: string;
  modifiers: { shift: boolean; alt: boolean; ctrl: boolean; super: boolean };
  eventType: 'press' | 'repeat' | 'release';
}

/**
 * Parse a CSI u key sequence from the Kitty keyboard protocol.
 *
 * Format: ESC [ <keycode> ; <modifiers> u
 * The modifiers field is 1-based (1 = no modifiers).
 *
 * @param sequence - Raw escape sequence string
 * @returns Parsed key event, or null if the sequence is not a valid CSI u sequence
 */
export function parseKittyKey(sequence: string): KittyKeyEvent | null {
  // Match CSI u format: ESC [ <keycode> ; <modifiers> [;eventType] u
  // eslint-disable-next-line no-control-regex
  const match = sequence.match(/\x1b\[(\d+);(\d+)(?::(\d+))?u/);
  if (!match) return null;

  const keycodeStr = match[1];
  const modsStr = match[2];
  // Both groups use `(\d+)` (non-optional), so a successful match always
  // populates them; guard anyway to satisfy noUncheckedIndexedAccess and
  // preserve the "not a valid CSI u sequence" → null contract.
  if (keycodeStr === undefined || modsStr === undefined) return null;

  const keycode = parseInt(keycodeStr);
  const mods = parseInt(modsStr) - 1; // 1-based → 0-based
  const eventTypeCode = match[3] ? parseInt(match[3]) : 1;

  let eventType: 'press' | 'repeat' | 'release';
  switch (eventTypeCode) {
    case 2:
      eventType = 'repeat';
      break;
    case 3:
      eventType = 'release';
      break;
    default:
      eventType = 'press';
      break;
  }

  return {
    key: String.fromCodePoint(keycode),
    modifiers: {
      shift: (mods & 1) !== 0,
      alt: (mods & 2) !== 0,
      ctrl: (mods & 4) !== 0,
      super: (mods & 8) !== 0,
    },
    eventType,
  };
}

/**
 * Check whether the current terminal is known to support the Kitty
 * keyboard protocol, based on the TERM_PROGRAM environment variable.
 *
 * This is a heuristic — some terminals may support the protocol
 * without being listed here, and feature detection is always preferable.
 */
export function isKittySupported(): boolean {
  const term = process.env.TERM_PROGRAM || '';
  return ['kitty', 'WezTerm', 'ghostty', 'foot'].some(
    t => term.toLowerCase().includes(t.toLowerCase())
  );
}
