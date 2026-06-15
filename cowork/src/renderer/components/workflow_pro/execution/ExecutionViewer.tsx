import React, { useState, memo, useMemo } from 'react';
import { useWorkflowStore } from '../../../store/workflowStore';
import { Download, Eye, Code, Clock, AlertTriangle, CheckCircle, BarChart3 } from 'lucide-react';
import ExecutionGanttChart from './ExecutionGanttChart';

// Type definitions for execution data
interface ExecutionResultData {
  status?: string;
  duration?: number;
  timestamp?: string;
  data?: {
    sent?: boolean;
    url?: string;
    to?: string;
    channel?: string;
    statusCode?: number;
    rowsAffected?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ExecutionErrorData {
  message?: string;
  code?: string;
  timestamp?: string;
  [key: string]: unknown;
}

// ExecutionHistory type matching the store definition
interface ExecutionHistoryItem {
  id?: string;
  workflowId?: string;
  status: string;
  startTime?: string;
  endTime?: string;
  timestamp?: string;
  duration?: number;
  nodesExecuted?: number;
  results?: unknown;
  errors?: unknown[] | unknown;
}

const ExecutionViewer = memo(function ExecutionViewer() {
  const {
    executionResults,
    executionErrors,
    executionHistory,
    // currentExecutingNode, // eslint-disable-line @typescript-eslint/no-unused-vars
    isExecuting,
    darkMode
  } = useWorkflowStore();

  const [_selectedExecution, setSelectedExecution] = useState<string | null>(null);  
  const [showRawData, setShowRawData] = useState(false);
  const [activeTab, setActiveTab] = useState('results');

  // Memoize computed values
  const hasResults = useMemo(() => Object.keys(executionResults).length > 0, [executionResults]);
  const hasErrors = useMemo(() => Object.keys(executionErrors).length > 0, [executionErrors]);
  const recentExecution = useMemo(() => executionHistory[0] as ExecutionHistoryItem | undefined, [executionHistory]);

  return (
    <div className={`fixed right-0 top-16 h-[calc(100vh-4rem)] w-[350px] ${
      darkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
    } border-l shadow-lg overflow-hidden flex flex-col z-20`}>
      {/* Header */}
      <div className={`p-5 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'} border-b`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">🔍 Execution Viewer</h2>
          <div className="flex items-center space-x-2">
            {isExecuting && (
              <div className="flex items-center space-x-2 text-blue-500">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                <span className="text-sm">Running...</span>
              </div>
            )}
          </div>
        </div>

        {/* Status Summary */}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className={`p-2 rounded text-center ${
            hasResults && !hasErrors ? 'bg-green-100 text-green-800' : 
            hasErrors ? 'bg-red-100 text-red-800' : 
            'bg-gray-100 text-gray-600'
          }`}>
            <div className="font-medium">
              {hasResults && !hasErrors ? '✅' : hasErrors ? '❌' : '⏸️'}
            </div>
            <div className="text-xs">
              {hasResults && !hasErrors ? 'Success' : hasErrors ? 'Failed' : 'Ready'}
            </div>
          </div>
          <div className={`p-2 rounded text-center ${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
            <div className="font-medium">{Object.keys(executionResults).length}</div>
            <div className="text-xs">Nodes</div>
          </div>
          <div className={`p-2 rounded text-center ${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
            <div className="font-medium">
              {recentExecution?.duration ? `${recentExecution.duration}ms` : '-'}
            </div>
            <div className="text-xs">Duration</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 mt-4">
          {['results', 'timeline', 'errors', 'history'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 rounded text-sm transition-colors flex items-center gap-1 ${
                activeTab === tab
                  ? 'bg-blue-500 text-white'
                  : darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'
              }`}
            >
              {tab === 'timeline' && <BarChart3 size={12} />}
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'results' && (
          <div className="space-y-4">
            {Object.keys(executionResults).length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Eye size={48} className="mx-auto mb-4 opacity-50" />
                <p>No execution results yet</p>
                <p className="text-sm">Run a workflow to see results</p>
              </div>
            ) : (
              Object.entries(executionResults).map(([nodeId, result]: [string, unknown]) => {
                const typedResult = result as ExecutionResultData;
                return (
                  <div key={nodeId} className={`p-3 rounded-lg border ${
                    darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">Node: {nodeId.slice(-4)}</span>
                      <div className="flex items-center space-x-2">
                        <span className={`text-xs px-2 py-1 rounded ${
                          typedResult.status === 'success'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {typedResult.status || 'unknown'}
                        </span>
                        <button
                          onClick={() => setShowRawData(!showRawData)}
                          className="text-gray-500 hover:text-gray-700"
                        >
                          <Code size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="text-xs text-gray-500 mb-2">
                      Duration: {typedResult.duration || 0}ms | {typedResult.timestamp || 'N/A'}
                    </div>

                    {showRawData ? (
                      <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                        {JSON.stringify(typedResult.data, null, 2)}
                      </pre>
                    ) : (
                      <div className="text-sm">
                        {typedResult.data?.sent && <div>✅ Sent successfully</div>}
                        {typedResult.data?.url && <div>🌐 URL: {typedResult.data.url}</div>}
                        {typedResult.data?.to && <div>📧 To: {typedResult.data.to}</div>}
                        {typedResult.data?.channel && <div>💬 Channel: {typedResult.data.channel}</div>}
                        {typedResult.data?.statusCode && <div>📊 Status: {typedResult.data.statusCode}</div>}
                        {typedResult.data?.rowsAffected && <div>📊 Rows: {typedResult.data.rowsAffected}</div>}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="space-y-4">
            <ExecutionGanttChart
              minWidth={300}
              rowHeight={32}
              onNodeClick={(nodeId) => {
                // Could integrate with node selection in the future
                console.log('Node clicked:', nodeId);
              }}
            />
          </div>
        )}

        {activeTab === 'errors' && (
          <div className="space-y-4">
            {Object.keys(executionErrors).length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <CheckCircle size={48} className="mx-auto mb-4 opacity-50" />
                <p>No errors</p>
                <p className="text-sm">All executions completed successfully</p>
              </div>
            ) : (
              Object.entries(executionErrors).map(([nodeId, error]: [string, unknown]) => {
                const typedError = error as ExecutionErrorData;
                return (
                  <div key={nodeId} className="p-3 rounded-lg border border-red-200 bg-red-50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm text-red-800">Node: {nodeId.slice(-4)}</span>
                      <AlertTriangle size={16} className="text-red-500" />
                    </div>
                    <div className="text-sm text-red-700">
                      <div className="font-medium">{typedError.message || 'Unknown error'}</div>
                      {typedError.code && <div className="text-xs mt-1">Code: {typedError.code}</div>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-4">
            {executionHistory.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Clock size={48} className="mx-auto mb-4 opacity-50" />
                <p>No execution history</p>
                <p className="text-sm">Past executions will appear here</p>
              </div>
            ) : (
              executionHistory.slice(0, 10).map((execution: unknown, index: number) => {
                const typedExecution = execution as ExecutionHistoryItem;
                const displayTime = typedExecution.timestamp || typedExecution.startTime || '';
                return (
                  <div
                    key={`execution-${index}`}
                    className={`p-3 rounded-lg border cursor-pointer ${
                      darkMode ? 'border-gray-700 bg-gray-800 hover:bg-gray-700' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                    }`}
                    onClick={() => setSelectedExecution(displayTime)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">
                        {displayTime ? new Date(displayTime).toLocaleString() : 'N/A'}
                      </span>
                      <span className={`text-xs px-2 py-1 rounded ${
                        typedExecution.status === 'success'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {typedExecution.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 space-y-1">
                      <div>Duration: {typedExecution.duration || 0}ms</div>
                      <div>Nodes: {typedExecution.nodesExecuted || 0}</div>
                      {typedExecution.errors && Array.isArray(typedExecution.errors) && typedExecution.errors.length > 0 && (
                        <div className="text-red-500">Errors: {typedExecution.errors.length}</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      {(hasResults || hasErrors) && (
        <div className={`p-4 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'} border-t`}>
          <div className="flex space-x-2">
            <button
              onClick={() => {
                const exportData = {
                  results: executionResults,
                  errors: executionErrors,
                  history: executionHistory,
                  timestamp: new Date().toISOString()
                };
                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `execution-${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="flex-1 bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600 text-sm flex items-center justify-center space-x-2"
            >
              <Download size={14} />
              <span>Export</span>
            </button>
            <button
              onClick={() => setShowRawData(!showRawData)}
              className={`flex-1 py-2 rounded-lg text-sm flex items-center justify-center space-x-2 ${
                showRawData 
                  ? 'bg-gray-500 text-white' 
                  : darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
              }`}
            >
              <Code size={14} />
              <span>{showRawData ? 'Simple' : 'Raw'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default ExecutionViewer;