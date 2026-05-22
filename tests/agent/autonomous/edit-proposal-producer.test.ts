import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { generateEditProposal, extractJson } from '../../../src/agent/autonomous/edit-proposal-producer.js';
import type { AgenticCodingEditProposalProducerDispatch } from '../../../src/agent/autonomous/agentic-coding-runner.js';
import type { CodeBuddyClient } from '../../../src/codebuddy/client.js';

describe('extractJson', () => {
  it('extracts JSON code block', () => {
    const text = 'Here is the result:\n```json\n{"summary": "test", "edits": []}\n```\nHope it helps!';
    expect(extractJson(text)).toBe('{"summary": "test", "edits": []}');
  });

  it('extracts generic block if it parses as JSON', () => {
    const text = 'Here is the block:\n```\n{"summary": "test", "edits": []}\n```';
    expect(extractJson(text)).toBe('{"summary": "test", "edits": []}');
  });

  it('extracts using braces if no markdown block found', () => {
    const text = 'Some text {"summary": "test", "edits": []} more text';
    expect(extractJson(text)).toBe('{"summary": "test", "edits": []}');
  });

  it('falls back to full trimmed text', () => {
    const text = '  {"summary": "test", "edits": []}  ';
    expect(extractJson(text)).toBe('{"summary": "test", "edits": []}');
  });
});

describe('generateEditProposal', () => {
  const repoPath = path.resolve('D:/CascadeProjects/grok-cli-weekend');
  const allowedPaths = ['docs/example.md', 'src/hello.ts'];

  beforeEach(async () => {
    await fs.mkdir(repoPath, { recursive: true });
    await fs.writeFile(
      path.join(repoPath, 'task.json'),
      JSON.stringify({ allowedPaths }),
      'utf8'
    );
  });

  afterEach(async () => {
    await fs.rm(path.join(repoPath, 'task.json'), { force: true });
  });

  const dispatch: AgenticCodingEditProposalProducerDispatch = {
    kind: 'agentic-coding-edit-proposal-producer-dispatch',
    generatedAt: new Date().toISOString(),
    allowedTools: ['file_read', 'rg', 'git_status'],
    disallowedActions: [],
    input: {
      repo: repoPath,
      taskFile: path.join(repoPath, 'task.json'),
      proposalPromptFile: path.join(repoPath, 'prompt.md'),
    },
    output: {
      editProposalFile: path.join(repoPath, 'edit-proposal.json'),
      reviewCommand: { executable: 'buddy', args: [] },
      schema: {},
    },
    currentState: {
      approvalState: 'draft',
      workflow: {
        nodeErrors: [],
        blockedNodeIds: [],
        nodes: [],
        edges: [],
      },
    },
    runPolicy: {
      cwd: repoPath,
      maxToolRounds: 5,
      mode: 'data_only_edit_proposal',
    },
    messages: [
      { role: 'user', content: 'Generate edits.' }
    ],
  };

  it('runs a tool loop and returns a valid edit proposal', async () => {
    // We will simulate 2 chat calls:
    // Call 1: requesting a file_read tool call
    // Call 2: returning the final valid JSON
    let callCount = 0;
    const mockClient = {
      chat: vi.fn().mockImplementation(async (messages, tools) => {
        callCount++;
        if (callCount === 1) {
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: {
                        name: 'file_read',
                        arguments: JSON.stringify({ path: 'docs/example.md' }),
                      },
                    },
                  ],
                },
              },
            ],
          };
        } else {
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '```json\n{\n  "summary": "Fix typos",\n  "edits": [\n    {\n      "type": "replace_text",\n      "path": "docs/example.md",\n      "find": "typo",\n      "replace": "correct",\n      "expectedOccurrences": 1\n    }\n  ],\n  "risks": [],\n  "verificationNotes": []\n}\n```',
                },
              },
            ],
          };
        }
      }),
    } as unknown as CodeBuddyClient;

    // Create the allowed file
    const docPath = path.join(repoPath, 'docs/example.md');
    await fs.mkdir(path.dirname(docPath), { recursive: true });
    await fs.writeFile(docPath, 'This is a typo content.', 'utf8');

    const result = await generateEditProposal(dispatch, mockClient);

    expect(result.summary).toBe('Fix typos');
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0].path).toBe('docs/example.md');
    expect(result.edits[0].find).toBe('typo');
    expect(result.edits[0].replace).toBe('correct');

    // Clean up
    await fs.rm(docPath, { force: true });
  });

  it('rejects file reads outside allowedPaths', async () => {
    let callCount = 0;
    const mockClient = {
      chat: vi.fn().mockImplementation(async (messages) => {
        callCount++;
        if (callCount === 1) {
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_secret',
                      type: 'function',
                      function: {
                        name: 'file_read',
                        arguments: JSON.stringify({ path: 'src/secret.ts' }), // Not allowed
                      },
                    },
                  ],
                },
              },
            ],
          };
        } else {
          // The last message in messages should be the tool response with the error
          const lastMsg = messages[messages.length - 1];
          expect(lastMsg.role).toBe('tool');
          expect(lastMsg.content).toContain('outside the allowed contract paths');

          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '```json\n{\n  "summary": "Fix secret",\n  "edits": [\n    {\n      "type": "replace_text",\n      "path": "docs/example.md",\n      "find": "a",\n      "replace": "b"\n    }\n  ]\n}\n```',
                },
              },
            ],
          };
        }
      }),
    } as unknown as CodeBuddyClient;

    const result = await generateEditProposal(
      {
        ...dispatch,
        currentState: {
          ...dispatch.currentState,
          workflow: {
            ...dispatch.currentState.workflow,
            contract: {
              ...dispatch.currentState.workflow.contract,
              allowedPaths: ['docs/example.md'], // explicitly restrict
            } as any,
          },
        },
      },
      mockClient
    );

    expect(result.summary).toBe('Fix secret');
  });

  it('handles git_status and ripgrep mock tool calls', async () => {
    let callCount = 0;
    const mockClient = {
      chat: vi.fn().mockImplementation(async (messages) => {
        callCount++;
        if (callCount === 1) {
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_status',
                      type: 'function',
                      function: {
                        name: 'git_status',
                        arguments: '{}',
                      },
                    },
                    {
                      id: 'call_rg',
                      type: 'function',
                      function: {
                        name: 'rg',
                        arguments: JSON.stringify({ query: 'hello' }),
                      },
                    },
                  ],
                },
              },
            ],
          };
        } else {
          // Ensure both tools got responses
          const toolResponses = messages.filter((m: any) => m.role === 'tool');
          expect(toolResponses).toHaveLength(2);
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '```json\n{\n  "summary": "Mocks complete",\n  "edits": [\n    {\n      "type": "replace_text",\n      "path": "docs/example.md",\n      "find": "a",\n      "replace": "b"\n    }\n  ]\n}\n```',
                },
              },
            ],
          };
        }
      }),
    } as unknown as CodeBuddyClient;

    const result = await generateEditProposal(dispatch, mockClient);
    expect(result.summary).toBe('Mocks complete');
  });

  it('throws an error if final proposal schema is invalid', async () => {
    const mockClient = {
      chat: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '```json\n{\n  "summary": "Missing edits",\n  "edits": []\n}\n```', // edits cannot be empty
            },
          },
        ],
      }),
    } as unknown as CodeBuddyClient;

    await expect(generateEditProposal(dispatch, mockClient)).rejects.toThrow('Edit proposal validation failed');
  });
});
