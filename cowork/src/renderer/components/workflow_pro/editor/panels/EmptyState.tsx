/**
 * EmptyState Component
 * n8n-style empty state: trigger-first, centered with action button
 */

import React from 'react';
import { Plus, Keyboard, Zap, MousePointerClick } from 'lucide-react';

const EmptyStateComponent: React.FC = () => {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="text-center animate-fadeIn pointer-events-auto">
        {/* Icon with n8n coral accent */}
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg"
          style={{
            background: 'linear-gradient(135deg, var(--n8n-color-primary, #ff6d5a) 0%, #ff8a75 100%)',
          }}
        >
          <Zap className="w-10 h-10 text-white" />
        </div>

        <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2">
          Start building your workflow
        </h3>
        <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-sm mx-auto text-sm leading-relaxed">
          Add a trigger to start, then connect actions to automate your tasks.
        </p>

        {/* Add trigger button */}
        <button
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white shadow-md hover:shadow-lg transition-all hover:scale-105 active:scale-95"
          style={{
            background: 'var(--n8n-color-primary, #ff6d5a)',
          }}
          onClick={() => {
            // Dispatch Tab key to open node picker
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
          }}
        >
          <Plus className="w-4 h-4" />
          Add first step
        </button>

        {/* Hints */}
        <div className="flex items-center justify-center gap-5 mt-6 text-xs text-gray-400 dark:text-gray-500">
          <div className="flex items-center gap-1.5">
            <Keyboard className="w-3.5 h-3.5" />
            <span>Press</span>
            <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-mono text-[10px] border border-gray-200 dark:border-gray-700">
              Tab
            </kbd>
            <span>for node picker</span>
          </div>
          <div className="flex items-center gap-1.5">
            <MousePointerClick className="w-3.5 h-3.5" />
            <span>Drag from sidebar</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const EmptyState = React.memo(EmptyStateComponent);

export default EmptyState;
