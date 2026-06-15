import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, ArrowRight, Loader2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWorkflowStore } from '../../../store/workflowStore';
import { notificationService } from '../../../services/NotificationService';
import { nodeTypes } from '../../../data/nodeTypes';

/** Simple NLP: extract intent + node type from user command */
function parseCommand(input: string): { action: string; nodeType?: string; param?: string } {
  const cmd = input.toLowerCase().trim();

  // Add node commands
  const addPatterns = [
    /(?:add|create|insert|put)\s+(?:a\s+)?(\w[\w\s]*?)(?:\s+node)?$/,
    /(?:i need|give me)\s+(?:a\s+)?(\w[\w\s]*?)(?:\s+node)?$/,
  ];
  for (const pattern of addPatterns) {
    const match = cmd.match(pattern);
    if (match) {
      const query = match[1].trim();
      const found = Object.values(nodeTypes).find(n =>
        n.label.toLowerCase().includes(query) || n.type.toLowerCase().includes(query)
      );
      if (found) return { action: 'add', nodeType: found.type };
    }
  }

  // Layout
  if (/layout|clean|organiz|tidy|align/i.test(cmd)) return { action: 'layout' };
  // Execute
  if (/run|execute|start|trigger/i.test(cmd)) return { action: 'execute' };
  // Delete
  if (/delete|remove|clear/i.test(cmd) && /all|nodes|workflow/i.test(cmd)) return { action: 'clear' };
  // Connect
  if (/connect|link|wire/i.test(cmd)) return { action: 'connect' };

  // Fallback: try to find any node type mentioned
  const found = Object.values(nodeTypes).find(n =>
    cmd.includes(n.label.toLowerCase()) || cmd.includes(n.type.toLowerCase())
  );
  if (found) return { action: 'add', nodeType: found.type };

  return { action: 'unknown', param: input };
}

export const AICopilotBar: React.FC = () => {
  const [input, setInput] = useState('');
  const [isProcessing, setIsExecuting] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const { darkMode } = useWorkflowStore();
  const inputRef = useRef<HTMLInputElement>(null);

  // Global shortcut Alt+C to focus copilot
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isProcessing) return;

    setIsExecuting(true);

    try {
      const { action, nodeType, _param } = parseCommand(input);

      switch (action) {
        case 'add': {
          if (!nodeType) {
            notificationService.warning('Copilot', 'Could not determine which node to add. Try: "add HTTP Request"');
            break;
          }
          const nt = nodeTypes[nodeType];
          // Dispatch add-node event — same as sidebar quick-add
          window.dispatchEvent(new CustomEvent('add-node-from-sidebar', { detail: { nodeType } }));
          notificationService.success('Copilot', `Added "${nt?.label || nodeType}" node to the workflow`);
          break;
        }
        case 'layout':
          // Dispatch auto-layout via keyboard shortcut simulation
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, shiftKey: true, bubbles: true }));
          notificationService.info('Copilot', 'Auto-layouting your workflow');
          break;
        case 'execute':
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
          notificationService.info('Copilot', 'Starting workflow execution');
          break;
        case 'clear': {
          const store = useWorkflowStore.getState();
          store.addToHistory(store.nodes, store.edges);
          store.setNodes([]);
          store.setEdges([]);
          notificationService.info('Copilot', 'Workflow cleared');
          break;
        }
        default:
          notificationService.info('Copilot', `I understood: "${input}". Try commands like "add Slack", "add HTTP Request", "run workflow", "layout", or "clear all".`);
      }

      setInput('');
    } catch (_error) {
      notificationService.error('Copilot Error', 'Failed to process command');
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-40 w-full max-w-2xl px-4">
      <AnimatePresence>
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className={`
            relative flex items-center gap-3 p-1.5 rounded-2xl shadow-2xl border
            transition-all duration-300
            ${isFocused
              ? 'ring-2 ring-purple-500/50 border-purple-500/50 scale-[1.02]'
              : darkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}
          `}
        >
          <div className={`
            p-2 rounded-xl
            ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}
            ${isProcessing ? 'animate-pulse text-purple-500' : 'text-gray-400'}
          `}>
            {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
          </div>

          <form onSubmit={handleSubmit} className="flex-1">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="Ask Copilot to build, edit or optimize your workflow... (Alt+C)"
              className={`
                w-full bg-transparent border-none outline-none text-sm font-medium
                ${darkMode ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'}
              `}
            />
          </form>

          <div className="flex items-center gap-2 pr-2">
            {!input && !isProcessing && (
              <div className="flex items-center gap-1 opacity-40">
                <kbd className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
                  ALT
                </kbd>
                <span className="text-[10px] font-bold">+</span>
                <kbd className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
                  C
                </kbd>
              </div>
            )}
            
            {input && (
              <button
                onClick={() => setInput('')}
                className={`p-1 rounded-lg hover:bg-gray-500/10 transition-colors`}
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}

            <button
              onClick={() => handleSubmit()}
              disabled={!input.trim() || isProcessing}
              className={`
                p-2 rounded-xl transition-all
                ${input.trim() && !isProcessing
                  ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25 hover:bg-purple-600'
                  : 'text-gray-500 bg-transparent opacity-50'}
              `}
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
