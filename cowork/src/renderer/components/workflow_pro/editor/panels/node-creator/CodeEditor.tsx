/**
 * Code Editor Component
 * Code editing panel with test functionality for custom nodes
 */

import React from 'react';
import { Play, Check, AlertCircle } from 'lucide-react';
import { CustomNodeDefinition, TestResult } from './types';

interface CodeEditorProps {
  formData: Partial<CustomNodeDefinition>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<CustomNodeDefinition>>>;
  darkMode: boolean;
  testResult: TestResult | null;
  onTest: () => Promise<void>;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  formData,
  setFormData,
  darkMode,
  testResult,
  onTest,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Node Code</span>
        <button
          onClick={onTest}
          className="px-2 py-1 text-xs rounded bg-green-500 text-white flex items-center gap-1"
        >
          <Play className="w-3 h-3" />
          Test
        </button>
      </div>
      <textarea
        value={formData.code || ''}
        onChange={(e) => setFormData({ ...formData, code: e.target.value })}
        className={`w-full h-64 p-3 rounded-lg font-mono text-sm resize-none ${
          darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
        } border`}
        spellCheck={false}
      />
      {testResult && (
        <div
          className={`p-3 rounded-lg ${
            testResult.success
              ? 'bg-green-500/10 border border-green-500/30'
              : 'bg-red-500/10 border border-red-500/30'
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            {testResult.success ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-500" />
            )}
            <span className={testResult.success ? 'text-green-500' : 'text-red-500'}>
              {testResult.success ? 'Test Passed' : 'Test Failed'}
            </span>
          </div>
          <pre className="text-xs overflow-auto max-h-24">
            {testResult.success
              ? JSON.stringify(testResult.output, null, 2)
              : testResult.error}
          </pre>
        </div>
      )}
    </div>
  );
};

export default CodeEditor;
