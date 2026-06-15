/**
 * Workflow Debugger Component
 * Main UI for debugging workflows with breakpoints, stepping, and inspection
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Square,
  StepForward,
  Bug,
  Circle,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
  Trash2,
  Plus,
  Download,
  Variable,
  Layers,
  FileText
} from 'lucide-react';

// Define Stack icon alias for Layers (used in tabs)
const Stack = Layers;
import { workflowDebugger } from '../../../services/WorkflowDebuggerService';
import { useWorkflowStore } from '../../../store/workflowStore';
import type {
  DebugSession,
  BreakpointConfig,
  VariableWatch,
} from '../../../types/debugging';
import { logger } from '../../../services/SimpleLogger';

interface WorkflowDebuggerProps {
  workflowId: string;
  onClose?: () => void;
}

type DebuggerTab = 'breakpoints' | 'variables' | 'callstack' | 'logs' | 'settings';

export const WorkflowDebugger: React.FC<WorkflowDebuggerProps> = ({
  workflowId,
  onClose
}) => {
  const [session, setSession] = useState<DebugSession | null>(null);
  const [breakpoints, setBreakpoints] = useState<BreakpointConfig[]>([]);
  const [watches, setWatches] = useState<VariableWatch[]>([]);
  const [activeTab, setActiveTab] = useState<DebuggerTab>('breakpoints');
  const [_isRunning, setIsRunning] = useState(false);  
  const [showBreakpointDialog, setShowBreakpointDialog] = useState(false);
  const [_selectedNodeId, setSelectedNodeId] = useState<string>('');  
  const [evaluationExpression, setEvaluationExpression] = useState('');
  const [evaluationResult, setEvaluationResult] = useState<{ value: unknown; error?: string } | null>(null);

  // Breakpoint dialog state
  const [breakpointForm, setBreakpointForm] = useState({
    nodeId: '',
    condition: '',
    logMessage: '',
    enabled: true
  });

  const { nodes } = useWorkflowStore();

  // Load breakpoints and setup event listeners functions
  const loadBreakpoints = useCallback(async () => {
    try {
      const _loaded = await workflowDebugger.setBreakpoint(workflowId, '', {});
      // Note: This is a placeholder - the actual implementation should get all breakpoints
      setBreakpoints([]);
    } catch (error) {
      logger.error('Failed to load breakpoints:', error);
    }
  }, [workflowId]);

  // Setup event listeners
  const setupEventListeners = useCallback(() => {
    // Placeholder for setting up event listeners
    return () => {};
  }, []);

  // Load breakpoints on mount
  useEffect(() => {
    loadBreakpoints();
    setupEventListeners();

    return () => {
      // Cleanup session if exists
      if (session) {
        workflowDebugger.stopDebugSession(session.id).catch((err) => logger.error('Error', err));
      }
    };
  }, [workflowId, loadBreakpoints, setupEventListeners, session]);

  // Update session when debugger state changes
  useEffect(() => {
    const currentSession = workflowDebugger.getActiveSession();
    if (currentSession && currentSession.workflowId === workflowId) {
      setSession({ ...currentSession });
    }
  }, [workflowId]);

  useEffect(() => {
    const handleDebugEvent = (event: { sessionId?: string; type: string; data?: Record<string, unknown> }) => {
      if (event.sessionId === session?.id) {
        switch (event.type) {
          case 'session-paused':
            setIsRunning(false);
            break;
          case 'session-resumed':
            setIsRunning(true);
            break;
          case 'session-stopped':
            setIsRunning(false);
            setSession(null);
            break;
          case 'breakpoint-hit':
            setIsRunning(false);
            // Highlight the node with breakpoint
            if (event.data?.nodeId) {
              setSelectedNodeId(event.data.nodeId as string);
            }
            break;
        }
      }
    };

    // Subscribe to debug events
    const unsubscribes = [
      workflowDebugger.addEventListener('session-paused', handleDebugEvent),
      workflowDebugger.addEventListener('session-resumed', handleDebugEvent),
      workflowDebugger.addEventListener('session-stopped', handleDebugEvent),
      workflowDebugger.addEventListener('breakpoint-hit', handleDebugEvent)
    ];

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [session?.id]);

  // Start debugging session
  const startDebugSession = async () => {
    try {
      setIsRunning(true);
      const result = await workflowDebugger.startDebugSession(
        workflowId,
        `exec-${Date.now()}`,
        {
          breakpoints,
          stepMode: 'step-into',
          pauseOnStart: true
        }
      );
      if (result.success && result.data) {
        setSession(result.data);
      } else {
        throw new Error(result.error || 'Failed to start debug session');
      }
    } catch (error) {
      logger.error('Failed to start debugging:', error);
      setIsRunning(false);
    }
  };

  // Stop debugging session
  const stopDebugSession = async () => {
    if (!session) return;

    try {
      await workflowDebugger.stopDebugSession(session.id);
      setSession(null);
      setIsRunning(false);
      setSelectedNodeId('');
    } catch (error) {
      logger.error('Failed to stop debugging:', error);
    }
  };

  // Pause execution
  const pauseSession = async () => {
    if (!session) return;

    try {
      await workflowDebugger.pauseSession(session.id);
      setIsRunning(false);
    } catch (error) {
      logger.error('Failed to pause execution:', error);
    }
  };

  // Resume execution
  const resumeSession = async () => {
    if (!session) return;

    try {
      await workflowDebugger.resumeSession(session.id);
      setIsRunning(true);
    } catch (error) {
      logger.error('Failed to resume execution:', error);
    }
  };

  // Step to next node
  const stepToNextNode = async () => {
    if (!session) return;

    try {
      setIsRunning(false);
    } catch (error) {
      logger.error('Failed to step:', error);
    }
  };

  // Create breakpoint
  const createBreakpoint = async () => {
    try {
      if (!breakpointForm.nodeId) {
        logger.error('Node ID is required for breakpoint');
        return;
      }

      const result = await workflowDebugger.setBreakpoint(
        workflowId,
        breakpointForm.nodeId,
        {
          condition: breakpointForm.condition || undefined,
          logMessage: breakpointForm.logMessage || undefined,
          enabled: breakpointForm.enabled
        }
      );

      if (result.success && result.data) {
        setBreakpoints([...breakpoints, result.data]);
        setShowBreakpointDialog(false);
        resetBreakpointForm();
      } else {
        throw new Error(result.error || 'Failed to create breakpoint');
      }
    } catch (error) {
      logger.error('Failed to create breakpoint:', error);
    }
  };

  // Remove breakpoint
  const removeBreakpoint = async (breakpointId: string) => {
    try {
      await workflowDebugger.removeBreakpoint(breakpointId);
      setBreakpoints(breakpoints.filter(bp => bp.id !== breakpointId));
    } catch (error) {
      logger.error('Failed to remove breakpoint:', error);
    }
  };

  // Toggle breakpoint
  const toggleBreakpoint = (breakpoint: BreakpointConfig) => {
    if (!breakpoint) return;

    const updated = breakpoints.map(bp =>
      bp.id === breakpoint.id ? { ...bp, enabled: !bp.enabled } : bp
    );
    setBreakpoints(updated);
  };

  // Evaluate expression
  const evaluateExpression = async () => {
    if (!session || !evaluationExpression.trim()) return;

    try {
      const result = await workflowDebugger.evaluateExpression(
        session.id,
        evaluationExpression
      );
      if (result.success && result.data) {
        setEvaluationResult(result.data);
      } else {
        setEvaluationResult({
          value: null,
          error: result.error || 'Evaluation failed'
        });
      }
    } catch (error) {
      setEvaluationResult({
        value: null,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  // Add variable watch
  const addVariableWatch = (expression: string) => {
    const watch: VariableWatch = {
      id: `watch-${Date.now()}`,
      expression,
      value: undefined,
      lastUpdated: new Date()
    };
    setWatches([...watches, watch]);
  };

  // Remove variable watch
  const removeVariableWatch = (watchId: string) => {
    setWatches(watches.filter(w => w.id !== watchId));
  };

  // Reset breakpoint form
  const resetBreakpointForm = () => {
    setBreakpointForm({
      nodeId: '',
      condition: '',
      logMessage: '',
      enabled: true
    });
  };

  // Export debug data
  const exportDebugData = async () => {
    if (!session) return;

    try {
      const data = JSON.stringify(session, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `debug-session-${session.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      logger.error('Failed to export debug data:', error);
    }
  };

  // Get node name from workflow
  const getNodeName = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    return node?.data?.label || nodeId;
  };

  // Get status icon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Play className="w-4 h-4 text-green-500" />;
      case 'paused':
        return <Pause className="w-4 h-4 text-yellow-500" />;
      case 'stopped':
        return <Square className="w-4 h-4 text-red-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Circle className="w-4 h-4 text-gray-400" />;
    }
  };

  // Render breakpoints panel
  const renderBreakpointsPanel = () => {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Breakpoints</h3>
          <button
            onClick={() => setShowBreakpointDialog(true)}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Breakpoint
          </button>
        </div>

        <div className="space-y-2">
          {breakpoints.map((breakpoint) => (
            <div
              key={breakpoint.id}
              className={`border rounded-lg p-3 ${
                breakpoint.enabled ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <button
                    onClick={() => toggleBreakpoint(breakpoint)}
                    className={`w-4 h-4 rounded-full mr-2 ${
                      breakpoint.enabled ? 'bg-red-500' : 'bg-gray-400'
                    }`}
                  />
                  <span className="font-medium">{getNodeName(breakpoint.nodeId)}</span>
                </div>
                <button
                  onClick={() => removeBreakpoint(breakpoint.id)}
                  className="text-red-600 hover:text-red-800"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {breakpoint.condition && (
                <div className="mt-2 text-sm text-gray-600">
                  <strong>Condition:</strong> {breakpoint.condition}
                </div>
              )}

              {breakpoint.logMessage && (
                <div className="mt-1 text-sm text-gray-600">
                  <strong>Log:</strong> {breakpoint.logMessage}
                </div>
              )}

              {breakpoint.hitCount && breakpoint.hitCount > 0 && (
                <div className="mt-1 text-sm text-gray-500">
                  Hit {breakpoint.hitCount} time{breakpoint.hitCount !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          ))}

          {breakpoints.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Bug className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p>No breakpoints set</p>
              <p className="text-sm mt-1">Add breakpoints to pause execution at specific nodes</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render variables panel
  const renderVariablesPanel = () => {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Variables</h3>
        </div>

        {/* Expression Evaluation */}
        <div className="border rounded-lg p-3">
          <h4 className="text-sm font-medium mb-2">Evaluate Expression</h4>
          <div className="flex space-x-2">
            <input
              type="text"
              value={evaluationExpression}
              onChange={(e) => setEvaluationExpression(e.target.value)}
              placeholder="Enter expression (e.g., variables.count)"
              className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
              onKeyPress={(e) => e.key === 'Enter' && evaluateExpression()}
            />
            <button
              onClick={evaluateExpression}
              disabled={!session || !evaluationExpression.trim()}
              className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:bg-gray-300"
            >
              Evaluate
            </button>
          </div>

          {evaluationResult && (
            <div className="mt-2 p-2 border rounded text-sm font-mono">
              {evaluationResult.error ? (
                <span className="text-red-600">Error: {evaluationResult.error}</span>
              ) : (
                <span className="text-green-600">
                  {String(evaluationResult.value)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Current Variables */}
        {session && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Current Variables</h4>
            {Object.entries({
              ...session.variables.workflowVariables,
              ...session.variables.nodeInput,
              ...session.variables.nodeOutput
            }).map(([name, value]) => (
              <div key={name} className="border rounded p-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm">{name}</span>
                  <button
                    onClick={() => addVariableWatch(name)}
                    className="text-blue-600 hover:text-blue-800 text-xs"
                  >
                    <Eye className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-sm text-gray-600 font-mono mt-1">
                  {String(value)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Watches */}
        {watches.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Watches</h4>
            {watches.map((watch) => (
              <div key={watch.id} className="border rounded p-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm">{watch.expression}</span>
                  <button
                    onClick={() => removeVariableWatch(watch.id)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <EyeOff className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-sm text-gray-600 font-mono mt-1">
                  {String(watch.value)}
                </div>
              </div>
            ))}
          </div>
        )}

        {!session && (
          <div className="text-center py-8 text-gray-500">
            <Variable className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p>No active debug session</p>
            <p className="text-sm mt-1">Start debugging to view variables</p>
          </div>
        )}
      </div>
    );
  };

  // Render call stack panel
  const renderCallStackPanel = () => {
    return (
      <div className="space-y-4">
        <h3 className="font-medium">Call Stack</h3>

        {session && session.callStack.length > 0 ? (
          <div className="space-y-2">
            {session.callStack.map((frame, index) => (
              <div
                key={index}
                className={`border rounded p-3 ${
                  index === session.callStack.length - 1 ? 'border-blue-300 bg-blue-50' : 'border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{frame.nodeName || getNodeName(frame.nodeId)}</div>
                    <div className="text-sm text-gray-600">{frame.workflowName}</div>
                  </div>
                  <div className="text-right text-sm text-gray-500">
                    Depth: {frame.depth}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <Layers className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p>No call stack available</p>
            <p className="text-sm mt-1">Start debugging to view execution stack</p>
          </div>
        )}
      </div>
    );
  };

  // Render logs panel
  const renderLogsPanel = () => {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Debug Logs</h3>
          {session && session.logs.length > 0 && (
            <button
              onClick={() => setSession({ ...session, logs: [] })}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Clear Logs
            </button>
          )}
        </div>

        {session && session.logs.length > 0 ? (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {session.logs.map((log) => (
              <div
                key={log.id}
                className={`text-xs p-2 rounded ${
                  log.level === 'error' ? 'bg-red-50 text-red-800' :
                  log.level === 'warn' ? 'bg-yellow-50 text-yellow-800' :
                  log.level === 'info' ? 'bg-blue-50 text-blue-800' :
                  'bg-gray-50 text-gray-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono">
                    {log.timestamp.toLocaleTimeString()}
                  </span>
                  <span className="uppercase font-medium">
                    {log.level}
                  </span>
                </div>
                <div className="mt-1">{log.message}</div>
                {log.data && (
                  <div className="mt-1 font-mono text-xs opacity-75">
                    {JSON.stringify(log.data, null, 2)}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <FileText className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p>No debug logs</p>
            <p className="text-sm mt-1">Logs will appear here during debugging</p>
          </div>
        )}
      </div>
    );
  };

  // Render breakpoint dialog
  const renderBreakpointDialog = () => {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4">Add Breakpoint</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Node
                </label>
                <select
                  value={breakpointForm.nodeId}
                  onChange={(e) => setBreakpointForm({ ...breakpointForm, nodeId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a node</option>
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.data?.label || node.id}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Condition (optional)
                </label>
                <input
                  type="text"
                  value={breakpointForm.condition}
                  onChange={(e) => setBreakpointForm({ ...breakpointForm, condition: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., variables.count > 5"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Log Message (optional)
                </label>
                <input
                  type="text"
                  value={breakpointForm.logMessage}
                  onChange={(e) => setBreakpointForm({ ...breakpointForm, logMessage: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Message to log when breakpoint hits"
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="enabled"
                  checked={breakpointForm.enabled}
                  onChange={(e) => setBreakpointForm({ ...breakpointForm, enabled: e.target.checked })}
                  className="mr-2"
                />
                <label htmlFor="enabled" className="text-sm text-gray-700">
                  Enabled
                </label>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowBreakpointDialog(false);
                  resetBreakpointForm();
                }}
                className="px-4 py-2 text-gray-700 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={createBreakpoint}
                disabled={!breakpointForm.nodeId}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300"
              >
                Add Breakpoint
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Bug className="w-6 h-6 text-gray-700 mr-3" />
            <h2 className="text-lg font-semibold">Workflow Debugger</h2>
            {session && (
              <div className="ml-4 flex items-center">
                {getStatusIcon(session.status)}
                <span className="ml-2 text-sm capitalize">{session.status}</span>
              </div>
            )}
          </div>
          
          <div className="flex items-center space-x-2">
            {/* Debug Controls */}
            {!session ? (
              <button
                onClick={startDebugSession}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center"
              >
                <Play className="w-4 h-4 mr-2" />
                Start Debug
              </button>
            ) : (
              <>
                {session.status === 'paused' ? (
                  <button
                    onClick={resumeSession}
                    className="px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                    title="Resume"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={pauseSession}
                    className="px-3 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700"
                    title="Pause"
                  >
                    <Pause className="w-4 h-4" />
                  </button>
                )}

                <button
                  onClick={stepToNextNode}
                  disabled={session.status !== 'paused'}
                  className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300"
                  title="Step Next"
                >
                  <StepForward className="w-4 h-4" />
                </button>

                <button
                  onClick={stopDebugSession}
                  className="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                  title="Stop Debug"
                >
                  <Square className="w-4 h-4" />
                </button>
              </>
            )}
            
            {session && (
              <button
                onClick={exportDebugData}
                className="px-3 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
                title="Export Debug Data"
              >
                <Download className="w-4 h-4" />
              </button>
            )}
            
            {onClose && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex">
          {[
            { id: 'breakpoints', label: 'Breakpoints', icon: Circle },
            { id: 'variables', label: 'Variables', icon: Variable },
            { id: 'callstack', label: 'Call Stack', icon: Stack },
            { id: 'logs', label: 'Logs', icon: FileText }
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as DebuggerTab)}
              className={`px-4 py-2 flex items-center space-x-2 border-b-2 ${
                activeTab === id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'breakpoints' && renderBreakpointsPanel()}
        {activeTab === 'variables' && renderVariablesPanel()}
        {activeTab === 'callstack' && renderCallStackPanel()}
        {activeTab === 'logs' && renderLogsPanel()}
      </div>

      {/* Modals */}
      {showBreakpointDialog && renderBreakpointDialog()}
    </div>
  );
};

export default WorkflowDebugger;