/**
 * Shared process-level runtime switches.
 *
 * Keep these tiny and dependency-free so low-level modules can check whether a
 * one-shot CLI run is allowed to persist project-local runtime files.
 */
export function isHeadlessRuntime(): boolean {
  return process.env.CODEBUDDY_HEADLESS === 'true';
}

export function shouldWriteProjectRuntimeFiles(): boolean {
  return !isHeadlessRuntime()
    && process.env.CODEBUDDY_PROJECT_RUNTIME_READONLY !== 'true';
}
