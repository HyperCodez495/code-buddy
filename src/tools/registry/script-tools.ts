import { ITool } from './types.js';
import { ExecuteCodeTool } from './execute-code-tools.js';
import { RunScriptTool } from '../run-script-tool.js';

export function createScriptTools(): ITool[] {
  return [
    new ExecuteCodeTool(),
    new RunScriptTool(),
  ];
}
