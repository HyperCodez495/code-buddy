/**
 * Workflow Preview
 * Visual preview of generated workflow before applying
 */

import React from 'react';
import { WorkflowGenerationResult } from '../../../types/nlp';
import { Check, X, AlertTriangle, Info, ArrowRight, Zap } from 'lucide-react';

interface WorkflowPreviewProps {
  workflow: WorkflowGenerationResult;
  onApply: () => void;
  onClose: () => void;
}

export const WorkflowPreview: React.FC<WorkflowPreviewProps> = ({
  workflow,
  onApply,
  onClose
}) => {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-none px-6 py-4 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              Workflow Preview
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Review before applying to canvas
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg">
            <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              {workflow.nodes.length}
            </div>
            <div className="text-xs text-indigo-700 dark:text-indigo-300 mt-1">
              Nodes
            </div>
          </div>

          <div className="p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {workflow.edges.length}
            </div>
            <div className="text-xs text-purple-700 dark:text-purple-300 mt-1">
              Connections
            </div>
          </div>

          <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {Math.round(workflow.confidence * 100)}%
            </div>
            <div className="text-xs text-green-700 dark:text-green-300 mt-1">
              Confidence
            </div>
          </div>
        </div>

        {/* Workflow Name */}
        {workflow.intent.metadata?.suggestedName && (
          <div>
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Suggested Name
            </h4>
            <div className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
              <span className="text-sm text-slate-900 dark:text-white font-medium">
                {workflow.intent.metadata.suggestedName}
              </span>
            </div>
          </div>
        )}

        {/* Nodes Preview */}
        <div>
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
            Workflow Steps ({workflow.nodes.length})
          </h4>
          <div className="space-y-2">
            {workflow.nodes.map((node, index) => (
              <div key={node.id}>
                <div className="flex items-center gap-3 p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg">
                  {/* Step Number */}
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center">
                    <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                      {index + 1}
                    </span>
                  </div>

                  {/* Node Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        {node.data.label}
                      </span>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${node.data.color} bg-opacity-10`}>
                        {node.data.type}
                      </span>
                    </div>
                    {node.data.config && Object.keys(node.data.config).length > 0 && (
                      <div className="text-xs text-slate-600 dark:text-slate-400 mt-1 truncate">
                        {Object.entries(node.data.config).slice(0, 2).map(([key, value]) => (
                          <span key={key} className="mr-3">
                            {key}: {String(value).substring(0, 30)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Arrow */}
                  {index < workflow.nodes.length - 1 && (
                    <ArrowRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Warnings */}
        {workflow.warnings && workflow.warnings.length > 0 && (
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-2">
                  Warnings
                </h4>
                <ul className="space-y-1">
                  {workflow.warnings.map((warning, idx) => (
                    <li key={idx} className="text-sm text-amber-700 dark:text-amber-300">
                      • {warning}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Suggestions */}
        {workflow.suggestions && workflow.suggestions.length > 0 && (
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
                  Suggestions
                </h4>
                <ul className="space-y-1">
                  {workflow.suggestions.map((suggestion, idx) => (
                    <li key={idx} className="text-sm text-blue-700 dark:text-blue-300">
                      💡 {suggestion}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Missing Parameters */}
        {workflow.missingParameters && workflow.missingParameters.length > 0 && (
          <div className="p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-orange-900 dark:text-orange-100 mb-2">
                  Missing Parameters
                </h4>
                <p className="text-sm text-orange-700 dark:text-orange-300 mb-2">
                  The following parameters need to be configured before execution:
                </p>
                <ul className="space-y-1">
                  {workflow.missingParameters.map((param, idx) => (
                    <li key={idx} className="text-sm text-orange-700 dark:text-orange-300">
                      • {param}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex-none px-6 py-4 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
          >
            Back to Conversation
          </button>

          <button
            onClick={onApply}
            className="flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-600 to-purple-600 rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-colors shadow-lg hover:shadow-xl"
          >
            <Check className="w-4 h-4" />
            Apply to Canvas
            <Zap className="w-4 h-4" />
          </button>
        </div>

        {workflow.success && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 text-center">
            You can configure individual nodes after applying the workflow
          </p>
        )}
      </div>
    </div>
  );
};

export default WorkflowPreview;
