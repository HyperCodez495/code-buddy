/**
 * Base Device Transport Interface
 *
 * Defines the contract for device communication transports.
 * Implementations: SSH, ADB, Local.
 */

// ============================================================================
// Types
// ============================================================================

export type DeviceCapability =
  | 'camera' | 'camera_list' | 'camera_snap'
  | 'screen_record' | 'screenshot'
  | 'location' | 'location_tracking'
  | 'notifications' | 'notification_send' | 'notification_list'
  | 'system_run' | 'system_info'
  | 'file_transfer' | 'file_browse'
  | 'contacts' | 'contacts_search'
  | 'calendar' | 'calendar_events'
  | 'sensors' | 'sensor_data'
  | 'battery' | 'network_info'
  | 'clipboard' | 'input_text'
  | 'app_list' | 'app_launch';

export interface ExecuteResult {
  /** Exit code (0 = success) */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
}

export interface ExecuteOptions {
  /** Timeout in milliseconds */
  timeout?: number;
  /** Working directory on the device */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
}

export interface DeviceCalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  location?: string;
}

export interface TransportConfig {
  /** Device identifier */
  deviceId: string;
  /** Display name */
  name?: string;
  /** Connection address (host, serial, etc.) */
  address?: string;
  /** Connection port */
  port?: number;
  /** Username for authentication */
  username?: string;
  /** Path to SSH key or auth credential */
  keyPath?: string;
}

// ============================================================================
// DeviceTransport Interface
// ============================================================================

export interface DeviceTransport {
  /** Transport type identifier */
  readonly type: 'ssh' | 'adb' | 'local';

  /** Connect to the device */
  connect(): Promise<void>;

  /** Disconnect from the device */
  disconnect(): Promise<void>;

  /** Execute a command on the device */
  execute(command: string, options?: ExecuteOptions): Promise<ExecuteResult>;

  /** Upload a file from local to remote */
  uploadFile(localPath: string, remotePath: string): Promise<void>;

  /** Download a file from remote to local */
  downloadFile(remotePath: string, localPath: string): Promise<void>;

  /** Check if currently connected */
  isConnected(): boolean;

  /** Detect available capabilities on the device */
  getCapabilities(): Promise<DeviceCapability[]>;

  /** Optional structured calendar reader exposed by capable transports. */
  getCalendarEvents?(days?: number): Promise<DeviceCalendarEvent[] | null>;
}
