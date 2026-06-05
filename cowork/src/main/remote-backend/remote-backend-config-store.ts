/**
 * Remote Backend Config Store
 *
 * Persists the connection details for a REMOTE Code Buddy backend
 * (the `buddy server --desktop` endpoint). Kept deliberately separate
 * from `remote/remote-config-store.ts` (which is the inbound gateway /
 * channels feature) — these are two unrelated "remote" concepts.
 *
 * The JWT token is stored via the same encrypted electron-store helper
 * used by the gateway config so it never lands on disk in plaintext.
 */

import Store from 'electron-store';
import { log, logWarn } from '../utils/logger';
import {
  createEncryptedStoreWithKeyRotation,
  getLegacyDerivedKeyHexes,
} from '../utils/store-encryption';

export interface RemoteBackendConfig {
  /** Base URL of the remote backend, e.g. `ws://host:3001` or `http://host:3000`. */
  url: string;
  /** JWT used for the `/desktop` handshake. Never logged. */
  token: string;
  /** Whether the app should auto-connect on boot. */
  autoConnect: boolean;
}

const DEFAULT_REMOTE_BACKEND_CONFIG: RemoteBackendConfig = {
  url: '',
  token: '',
  autoConnect: false,
};

type RemoteBackendConfigRecord = RemoteBackendConfig & Record<string, unknown>;

class RemoteBackendConfigStore {
  private store: Store<RemoteBackendConfig>;

  constructor() {
    this.store = createEncryptedStoreWithKeyRotation<RemoteBackendConfigRecord>({
      stableKey: 'open-cowork-remote-backend-stable-v1',
      legacyKeys: [
        ...getLegacyDerivedKeyHexes({
          moduleDirname: __dirname,
          stableSeed: 'open-cowork-remote-backend-stable-v1',
          legacySeed: 'open-cowork-remote-backend-v1',
          salt: 'open-cowork-remote-backend-salt',
        }),
      ],
      storeOptions: {
        name: 'remote-backend-config',
        projectName: 'open-cowork',
        defaults: { ...DEFAULT_REMOTE_BACKEND_CONFIG },
      },
      logPrefix: '[RemoteBackendConfigStore]',
      log,
      warn: logWarn,
    }) as unknown as Store<RemoteBackendConfig>;
  }

  getConfig(): RemoteBackendConfig {
    return {
      url: this.store.get('url', ''),
      token: this.store.get('token', ''),
      autoConnect: this.store.get('autoConnect', false),
    };
  }

  setConfig(config: Partial<RemoteBackendConfig>): void {
    if (config.url !== undefined) this.store.set('url', config.url.trim());
    if (config.token !== undefined) this.store.set('token', config.token);
    if (config.autoConnect !== undefined) this.store.set('autoConnect', config.autoConnect);
    // Note: token intentionally omitted from the log line.
    log('[RemoteBackendConfig] Updated (url set:', !!config.url, ')');
  }

  clear(): void {
    this.store.clear();
    log('[RemoteBackendConfig] Cleared');
  }
}

export const remoteBackendConfigStore = new RemoteBackendConfigStore();
