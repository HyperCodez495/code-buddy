import { ContextExpandTool } from '../context-expand-tool.js';
import type { ITool } from './types.js';

export { ContextExpandTool } from '../context-expand-tool.js';

export function createContextExpandTools(): ITool[] {
  return [new ContextExpandTool()];
}
