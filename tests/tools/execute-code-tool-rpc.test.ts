import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeCode, type ExecuteCodeResult } from '../../src/tools/execute-code-runner.js';
import type {
  ExecuteCodeRpcInvoker,
  ExecuteCodeRpcInvokeRequest,
} from '../../src/tools/execute-code-rpc-invoker.js';
import { createExecuteCodeRpcInvoker } from '../../src/tools/execute-code-rpc-invoker.js';
import { getToolRegistry } from '../../src/tools/registry.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';

let tempWorkspace: string;
let idCounter: number;

function nextId(): string {
  idCounter += 1;
  return `execute-rpc-${idCounter}`;
}

/**
 * Script that calls a tool by RPC, then prints the RPC result as JSON so
 * the test can assert on the round-trip (`__RPC__:<json>`).
 */
function rpcScript(tool: string, args: Record<string, unknown>): string {
  return [
    `const r = globalThis.codebuddyToolCall(${JSON.stringify(tool)}, ${JSON.stringify(args)});`,
    "console.log('__RPC__:' + JSON.stringify(r));",
  ].join('\n');
}

function parseRpcLine(stdout: string): { ok: boolean; output?: string; error?: string } {
  const line = stdout.split('\n').find((l) => l.startsWith('__RPC__:'));
  expect(line, `no __RPC__ line in stdout:\n${stdout}`).toBeTruthy();
  return JSON.parse((line as string).slice('__RPC__:'.length));
}

describe('execute_code → tool RPC (opt-in, OFF by default)', () => {
  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-execute-code-rpc-'));
    idCounter = 0;
    delete process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC;
  });

  afterEach(async () => {
    delete process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC;
    await fs.rm(tempWorkspace, { recursive: true, force: true });
  });

  it('OFF by default: script RPC attempt is refused and no tool runs', async () => {
    const invoke = vi.fn<[ExecuteCodeRpcInvokeRequest], ReturnType<ExecuteCodeRpcInvoker>>(
      async () => ({ ok: true, output: 'should-never-run' }),
    );

    const result = await executeCode(
      {
        language: 'javascript',
        code: rpcScript('view_file', { file_path: 'secret.txt' }),
      },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke },
      // rpcEnabled left to default (env unset) → OFF
    );

    expect(result.ok).toBe(true); // script itself exits cleanly
    // Strong assertion: the invoker (real tool execution) was NEVER called.
    expect(invoke).not.toHaveBeenCalled();
    const rpc = parseRpcLine(result.stdout);
    expect(rpc.ok).toBe(false);
    expect(rpc.error).toContain('EXECUTE_CODE_TOOL_RPC_DISABLED');
  });

  it('ON (flag): allowlisted view_file round-trips real file content into script stdout', async () => {
    process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC = 'true';
    const secretPath = path.join(tempWorkspace, 'secret.txt');
    const secret = 'TOP-SECRET-ROUNDTRIP-9f3a';
    await fs.writeFile(secretPath, secret, 'utf8');

    // Real invoker → real read-only tool execution (honest round-trip).
    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      isFleetSafe: (name) => name === 'view_file' || name === 'list_directory' || name === 'search',
    });

    const result = await executeCode(
      {
        language: 'javascript',
        code: rpcScript('view_file', { file_path: secretPath }),
      },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke },
    );

    expect(result.ok, result.error).toBe(true);
    const rpc = parseRpcLine(result.stdout);
    expect(rpc.ok).toBe(true);
    // The actual file content, read by the real tool, appears in script output.
    expect(rpc.output).toContain(secret);
  });

  it('ON but tool not allowlisted is refused (even though enabled)', async () => {
    process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC = 'true';
    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      allowlist: new Set(['view_file']),
      isFleetSafe: () => true,
    });

    const result = await executeCode(
      {
        language: 'javascript',
        code: rpcScript('write_file', { file_path: path.join(tempWorkspace, 'evil.txt'), content: 'x' }),
      },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke },
    );

    expect(result.ok).toBe(true);
    const rpc = parseRpcLine(result.stdout);
    expect(rpc.ok).toBe(false);
    expect(rpc.error).toContain('TOOL_NOT_ALLOWED_FOR_EXECUTE_CODE_RPC');
    // And no file was written.
    await expect(fs.stat(path.join(tempWorkspace, 'evil.txt'))).rejects.toBeTruthy();
  });

  it('ON but tool lacks fleetSafe metadata is refused', async () => {
    process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC = 'true';
    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      allowlist: new Set(['view_file']),
      isFleetSafe: () => false, // simulate a non-fleetSafe registry entry
    });

    const result = await executeCode(
      {
        language: 'javascript',
        code: rpcScript('view_file', { file_path: path.join(tempWorkspace, 'x') }),
      },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke },
    );

    const rpc = parseRpcLine(result.stdout);
    expect(rpc.ok).toBe(false);
    expect(rpc.error).toContain('TOOL_NOT_FLEET_SAFE');
  });

  it('enforces the per-execution RPC call bound (anti-loop)', async () => {
    process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC = 'true';
    const filePath = path.join(tempWorkspace, 'f.txt');
    await fs.writeFile(filePath, 'hello', 'utf8');
    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      isFleetSafe: () => true,
    });

    const code = [
      'const out = [];',
      'for (let i = 0; i < 3; i++) {',
      `  out.push(globalThis.codebuddyToolCall('view_file', { file_path: ${JSON.stringify(filePath)} }));`,
      '}',
      "console.log('__RPC__:' + JSON.stringify(out));",
    ].join('\n');

    const result = await executeCode(
      { language: 'javascript', code },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke, rpcMaxCalls: 2 },
    );

    expect(result.ok, result.error).toBe(true);
    const results = JSON.parse(
      (result.stdout.split('\n').find((l) => l.startsWith('__RPC__:')) as string).slice('__RPC__:'.length),
    ) as Array<{ ok: boolean; error?: string }>;
    expect(results).toHaveLength(3);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(true);
    expect(results[2]!.ok).toBe(false);
    expect(results[2]!.error).toContain('RPC_CALL_LIMIT_EXCEEDED');
  });

  it('uses the REAL registry fleetSafe gate by default (view_file safe, write_file unsafe)', async () => {
    process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC = 'true';
    // Register real metadata so getToolRegistry().isFleetSafe reflects production wiring.
    const registry = getToolRegistry();
    for (const name of ['view_file', 'write_file']) {
      const meta = TOOL_METADATA.find((m) => m.name === name);
      expect(meta, `metadata for ${name}`).toBeTruthy();
      registry.registerTool(
        { type: 'function', function: { name, description: meta!.description, parameters: { type: 'object', properties: {} } } },
        meta!,
      );
    }
    expect(registry.isFleetSafe('view_file')).toBe(true);
    expect(registry.isFleetSafe('write_file')).toBe(false);

    const filePath = path.join(tempWorkspace, 'real.txt');
    const secret = 'REAL-REGISTRY-GATE-c41d';
    await fs.writeFile(filePath, secret, 'utf8');

    // Default invoker → real registry fleetSafe + real allowlist.
    const invoke = createExecuteCodeRpcInvoker({ workspaceRoot: tempWorkspace });

    const okResult = await executeCode(
      { language: 'javascript', code: rpcScript('view_file', { file_path: filePath }) },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke },
    );
    const okRpc = parseRpcLine(okResult.stdout);
    expect(okRpc.ok).toBe(true);
    expect(okRpc.output).toContain(secret);

    // write_file is blocked by the allowlist first (read-only-only channel).
    const denyResult = await executeCode(
      { language: 'javascript', code: rpcScript('write_file', { file_path: filePath, content: 'x' }) },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke },
    );
    const denyRpc = parseRpcLine(denyResult.stdout);
    expect(denyRpc.ok).toBe(false);
  });

  it('python scripts can round-trip via codebuddy_tool_call when enabled', async () => {
    process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC = 'true';
    const secretPath = path.join(tempWorkspace, 'py-secret.txt');
    const secret = 'PY-ROUNDTRIP-7b2c';
    await fs.writeFile(secretPath, secret, 'utf8');
    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      isFleetSafe: () => true,
    });

    const code = [
      'import json',
      `r = codebuddy_tool_call('view_file', {'file_path': ${JSON.stringify(secretPath)}})`,
      "print('__RPC__:' + json.dumps(r))",
    ].join('\n');

    const result: ExecuteCodeResult = await executeCode(
      { language: 'python', code },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke },
    );

    expect(result.ok, result.error).toBe(true);
    const rpc = parseRpcLine(result.stdout);
    expect(rpc.ok).toBe(true);
    expect(rpc.output).toContain(secret);
  });
});
