import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';

import { CodeBuddyClient, CodeBuddyMessage, CodeBuddyTool } from '../../codebuddy/client.js';
import { detectProviderFromEnv } from '../../utils/provider-detector.js';
import {
  isPathAllowedByContract,
  resolveRepoPath,
} from './agentic-coding-runner.js';
import {
  AgenticCodingEditProposal,
  validateAgenticCodingEditProposal,
} from './agentic-coding-contract.js';
import type { AgenticCodingEditProposalProducerDispatch } from './agentic-coding-runner.js';

export function extractJson(text: string): string {
  // First look for json code blocks
  const blockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (blockMatch && blockMatch[1]) {
    return blockMatch[1].trim();
  }
  const genericBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/);
  if (genericBlockMatch && genericBlockMatch[1]) {
    try {
      JSON.parse(genericBlockMatch[1].trim());
      return genericBlockMatch[1].trim();
    } catch {
      // not JSON, fall through
    }
  }

  // Find the first '{' and last '}'
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return text.substring(start, end + 1);
  }

  return text.trim();
}

export async function generateEditProposal(
  dispatch: AgenticCodingEditProposalProducerDispatch,
  customClient?: CodeBuddyClient
): Promise<AgenticCodingEditProposal> {
  const repo = dispatch.input.repo;
  let allowedPaths: string[] = [];
  try {
    const taskContent = await fs.readFile(dispatch.input.taskFile, 'utf8');
    const parsedTask = JSON.parse(taskContent);
    allowedPaths = parsedTask.allowedPaths || [];
  } catch (err) {
    throw new Error(`Failed to read allowedPaths from taskFile: ${err instanceof Error ? err.message : String(err)}`);
  }
  const maxToolRounds = dispatch.runPolicy.maxToolRounds ?? 50;

  // 1. Setup client
  let client: CodeBuddyClient;
  if (customClient) {
    client = customClient;
  } else {
    const detected = detectProviderFromEnv();
    if (!detected) {
      throw new Error('No LLM provider configuration found in environment.');
    }
    client = new CodeBuddyClient(detected.apiKey, detected.defaultModel, detected.baseURL);
  }

  // 2. Expose the 3 allowed read-only tools
  const tools: CodeBuddyTool[] = [
    {
      type: 'function',
      function: {
        name: 'file_read',
        description: 'Read the contents of a file in the repository (relative path inside allowedPaths).',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The relative path of the file to read (must be inside allowedPaths).'
            }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'rg',
        description: 'Run ripgrep (rg) to search for a query or regex pattern in the repository files.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The query string or regex pattern to search for.'
            }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'git_status',
        description: 'Get the current status of the git repository (running git status --short --branch).',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    }
  ];

  const messages: CodeBuddyMessage[] = [...dispatch.messages];
  let rounds = 0;

  while (rounds < maxToolRounds) {
    const response = await client.chat(messages, tools);
    const choice = response.choices?.[0];
    if (!choice) {
      throw new Error('No choices returned from Code Buddy client');
    }

    const message = choice.message;
    messages.push(message as CodeBuddyMessage);

    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        let resultStr = '';
        try {
          if (toolCall.function.name === 'file_read') {
            const args = JSON.parse(toolCall.function.arguments);
            const filePath = args.path;
            if (!isPathAllowedByContract(filePath, allowedPaths)) {
              resultStr = `Error: Path "${filePath}" is outside the allowed contract paths: ${allowedPaths.join(', ')}`;
            } else {
              const resolved = resolveRepoPath(repo, filePath);
              if (resolved.reason || !resolved.path) {
                resultStr = `Error: Cannot resolve path "${filePath}": ${resolved.reason || 'Unknown error'}`;
              } else {
                resultStr = await fs.readFile(resolved.path, 'utf8');
              }
            }
          } else if (toolCall.function.name === 'rg') {
            const args = JSON.parse(toolCall.function.arguments);
            const query = args.query;
            const rgArgs = [
              '--json',
              '--no-require-git',
              '--follow',
              '--glob',
              '!.git/**',
              '--glob',
              '!node_modules/**',
              '--glob',
              '!*.log',
              query,
              '.'
            ];
            const rgBinary = rgPath.replace(/\.asar([\\/])/, '.asar.unpacked$1');
            const rgProcResult = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
              const proc = spawn(rgBinary, rgArgs, { cwd: repo });
              let stdout = '';
              let stderr = '';
              proc.stdout.on('data', (d) => { if (stdout.length < 2_000_000) stdout += d.toString(); });
              proc.stderr.on('data', (d) => { if (stderr.length < 100_000) stderr += d.toString(); });
              proc.on('close', (code) => resolve({ stdout, stderr, code }));
              proc.on('error', (err) => resolve({ stdout: '', stderr: err.message, code: -1 }));
            });

            if (rgProcResult.code === 0 || rgProcResult.code === 1) {
              const parsedResults = [];
              const lines = rgProcResult.stdout.split('\n').filter((l) => l.trim().length > 0);
              for (const line of lines) {
                try {
                  const parsed = JSON.parse(line);
                  if (parsed.type === 'match') {
                    const data = parsed.data;
                    parsedResults.push({
                      file: data.path.text,
                      line: data.line_number,
                      content: data.lines.text.trim(),
                    });
                    if (parsedResults.length >= 50) {
                      break;
                    }
                  }
                } catch {
                  // skip
                }
              }
              resultStr = JSON.stringify(parsedResults, null, 2);
            } else {
              resultStr = `Error running ripgrep: ${rgProcResult.stderr}`;
            }
          } else if (toolCall.function.name === 'git_status') {
            const gitResult = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
              const proc = spawn('git', ['status', '--short', '--branch'], { cwd: repo });
              let stdout = '';
              let stderr = '';
              proc.stdout.on('data', (d) => { stdout += d.toString(); });
              proc.stderr.on('data', (d) => { stderr += d.toString(); });
              proc.on('close', (code) => resolve({ stdout, stderr, code }));
              proc.on('error', (err) => resolve({ stdout: '', stderr: err.message, code: -1 }));
            });
            resultStr = gitResult.code === 0 ? gitResult.stdout : `Error: ${gitResult.stderr}`;
          } else {
            resultStr = `Error: Tool "${toolCall.function.name}" is not allowed.`;
          }
        } catch (err) {
          resultStr = `Error executing tool: ${err instanceof Error ? err.message : String(err)}`;
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: resultStr,
        });
      }
      rounds++;
    } else {
      break;
    }
  }

  const finalMessage = messages[messages.length - 1];
  if (!finalMessage || finalMessage.role !== 'assistant' || typeof finalMessage.content !== 'string') {
    throw new Error('LLM did not return a final response containing text');
  }

  const jsonText = extractJson(finalMessage.content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Failed to parse LLM response as JSON: ${err instanceof Error ? err.message : String(err)}\nRaw content: ${finalMessage.content}`);
  }

  const validation = validateAgenticCodingEditProposal(parsed);
  if (!validation.success) {
    throw new Error(`Edit proposal validation failed: ${validation.errors.join(' | ')}`);
  }

  return validation.proposal;
}
