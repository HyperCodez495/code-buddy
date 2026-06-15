/**
 * Execution Retry Panel
 * Configure retry settings for failed executions (like n8n)
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  X,
  AlertTriangle,
  Clock,
  ArrowRight,
  Play,
  Settings,
  History,
  CheckCircle,
  XCircle,
  Timer,
  TrendingUp,
  BarChart3,
} from 'lucide-react';
import { useWorkflowStore } from '../../../store/workflowStore';

interface ExecutionRetryPanelProps {
  executionId: string;
  isOpen: boolean;
  onClose: () => void;
  onRetry: (config: RetryConfig) => Promise<void>;
}

interface RetryConfig {
  strategy: 'fixed' | 'exponential' | 'linear' | 'custom';
  maxAttempts: number;
  initialDelay: number; // in seconds
  maxDelay: number; // in seconds
  multiplier: number; // for exponential backoff
  retryOn: ('error' | 'timeout' | 'rate_limit' | 'network')[];
  skipSuccessful: boolean;
  startFromNode?: string;
}

interface RetryAttempt {
  attempt: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  delay: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  strategy: 'exponential',
  maxAttempts: 3,
  initialDelay: 5,
  maxDelay: 300,
  multiplier: 2,
  retryOn: ['error', 'timeout'],
  skipSuccessful: true,
};

const RETRY_STRATEGIES = [
  {
    id: 'fixed',
    name: 'Fixed Delay',
    description: 'Wait the same amount of time between each retry',
    icon: <Timer size={16} />,
  },
  {
    id: 'exponential',
    name: 'Exponential Backoff',
    description: 'Double the delay after each failure',
    icon: <TrendingUp size={16} />,
  },
  {
    id: 'linear',
    name: 'Linear Backoff',
    description: 'Increase delay by a fixed amount each time',
    icon: <BarChart3 size={16} />,
  },
];

const ERROR_TYPES = [
  { id: 'error', label: 'Execution Error', description: 'Node execution fails' },
  { id: 'timeout', label: 'Timeout', description: 'Request times out' },
  { id: 'rate_limit', label: 'Rate Limit', description: 'API rate limit reached' },
  { id: 'network', label: 'Network Error', description: 'Connection issues' },
];

const ExecutionRetryPanel: React.FC<ExecutionRetryPanelProps> = ({
  _executionId,
  isOpen,
  onClose,
  onRetry,
}) => {
  const { nodes, nodeExecutionStatus } = useWorkflowStore();
  const [config, setConfig] = useState<RetryConfig>(DEFAULT_CONFIG);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryAttempts, setRetryAttempts] = useState<RetryAttempt[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Get failed nodes
  const failedNodes = useMemo(() => {
    return nodes.filter(n => nodeExecutionStatus[n.id] === 'error');
  }, [nodes, nodeExecutionStatus]);

  // Calculate retry delays preview
  const delayPreview = useMemo(() => {
    const delays: number[] = [];
    let delay = config.initialDelay;

    for (let i = 0; i < config.maxAttempts; i++) {
      delays.push(Math.min(delay, config.maxDelay));

      switch (config.strategy) {
        case 'exponential':
          delay = delay * config.multiplier;
          break;
        case 'linear':
          delay = delay + config.initialDelay;
          break;
        // fixed stays the same
      }
    }

    return delays;
  }, [config]);

  // Format delay for display
  const formatDelay = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  // Handle retry
  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    setRetryAttempts([]);

    try {
      // Initialize attempts
      const attempts: RetryAttempt[] = delayPreview.map((delay, i) => ({
        attempt: i + 1,
        status: 'pending' as const,
        delay,
      }));
      setRetryAttempts(attempts);

      await onRetry(config);
    } catch (error) {
      console.error('Retry failed:', error);
    } finally {
      setIsRetrying(false);
    }
  }, [config, delayPreview, onRetry]);

  // Update config
  const updateConfig = useCallback(<K extends keyof RetryConfig>(
    key: K,
    value: RetryConfig[K]
  ) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  // Toggle error type
  const toggleErrorType = useCallback((errorType: string) => {
    const current = config.retryOn;
    const updated = current.includes(errorType as typeof current[number])
      ? current.filter(t => t !== errorType)
      : [...current, errorType as typeof current[number]];
    updateConfig('retryOn', updated);
  }, [config.retryOn, updateConfig]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg mx-4 bg-white rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-orange-50 to-amber-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <RefreshCw size={20} className="text-orange-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Retry Execution</h2>
              <p className="text-sm text-gray-500">
                {failedNodes.length} failed node{failedNodes.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Failed nodes summary */}
          {failedNodes.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center gap-2 text-red-700 mb-2">
                <AlertTriangle size={16} />
                <span className="font-medium">Failed Nodes</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {failedNodes.map(node => (
                  <span
                    key={node.id}
                    className="px-2 py-1 bg-red-100 text-red-700 rounded text-sm"
                  >
                    {node.data?.label || node.data?.type}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Retry Strategy */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Settings size={16} className="text-gray-500" />
              Retry Strategy
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {RETRY_STRATEGIES.map(strategy => (
                <button
                  key={strategy.id}
                  onClick={() => updateConfig('strategy', strategy.id as RetryConfig['strategy'])}
                  className={`p-3 rounded-lg border-2 transition-all text-left ${
                    config.strategy === strategy.id
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className={`mb-1 ${
                    config.strategy === strategy.id ? 'text-orange-600' : 'text-gray-400'
                  }`}>
                    {strategy.icon}
                  </div>
                  <p className="text-sm font-medium text-gray-900">{strategy.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{strategy.description}</p>
                </button>
              ))}
            </div>
          </section>

          {/* Retry Settings */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Clock size={16} className="text-gray-500" />
              Retry Settings
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Attempts
                </label>
                <input
                  type="number"
                  value={config.maxAttempts}
                  onChange={(e) => updateConfig('maxAttempts', parseInt(e.target.value))}
                  min={1}
                  max={10}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Initial Delay (seconds)
                </label>
                <input
                  type="number"
                  value={config.initialDelay}
                  onChange={(e) => updateConfig('initialDelay', parseInt(e.target.value))}
                  min={1}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              {config.strategy === 'exponential' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Multiplier
                  </label>
                  <input
                    type="number"
                    value={config.multiplier}
                    onChange={(e) => updateConfig('multiplier', parseFloat(e.target.value))}
                    min={1.1}
                    max={4}
                    step={0.1}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Delay (seconds)
                </label>
                <input
                  type="number"
                  value={config.maxDelay}
                  onChange={(e) => updateConfig('maxDelay', parseInt(e.target.value))}
                  min={config.initialDelay}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>
          </section>

          {/* Delay Preview */}
          <section className="p-3 bg-gray-50 rounded-lg">
            <h4 className="text-xs font-semibold text-gray-600 mb-2">Retry Schedule Preview</h4>
            <div className="flex items-center gap-2 flex-wrap">
              {delayPreview.map((delay, i) => (
                <React.Fragment key={i}>
                  <div className="flex items-center gap-1 px-2 py-1 bg-white rounded border border-gray-200">
                    <span className="text-xs text-gray-500">#{i + 1}</span>
                    <span className="text-sm font-mono text-gray-900">{formatDelay(delay)}</span>
                  </div>
                  {i < delayPreview.length - 1 && (
                    <ArrowRight size={14} className="text-gray-400" />
                  )}
                </React.Fragment>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Total time: {formatDelay(delayPreview.reduce((a, b) => a + b, 0))}
            </p>
          </section>

          {/* Advanced Options */}
          <section>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
            >
              <Settings size={14} />
              Advanced Options
              <ArrowRight size={14} className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-4 pl-6">
                {/* Retry conditions */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Retry On
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {ERROR_TYPES.map(type => (
                      <button
                        key={type.id}
                        onClick={() => toggleErrorType(type.id)}
                        className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                          config.retryOn.includes(type.id as typeof config.retryOn[number])
                            ? 'bg-orange-100 text-orange-700 border border-orange-300'
                            : 'bg-gray-100 text-gray-600 border border-gray-200'
                        }`}
                        title={type.description}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Skip successful */}
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={config.skipSuccessful}
                    onChange={(e) => updateConfig('skipSuccessful', e.target.checked)}
                    className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
                  />
                  <div>
                    <span className="text-sm text-gray-700">Skip successful nodes</span>
                    <p className="text-xs text-gray-500">Only re-execute failed nodes</p>
                  </div>
                </label>

                {/* Start from node */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start From Node
                  </label>
                  <select
                    value={config.startFromNode || ''}
                    onChange={(e) => updateConfig('startFromNode', e.target.value || undefined)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="">First failed node</option>
                    {failedNodes.map(node => (
                      <option key={node.id} value={node.id}>
                        {node.data?.label || node.data?.type}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </section>

          {/* Retry Progress */}
          {retryAttempts.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <History size={16} className="text-gray-500" />
                Retry Progress
              </h3>
              <div className="space-y-2">
                {retryAttempts.map((attempt) => (
                  <div
                    key={attempt.attempt}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${
                      attempt.status === 'success'
                        ? 'bg-green-50 border-green-200'
                        : attempt.status === 'failed'
                        ? 'bg-red-50 border-red-200'
                        : attempt.status === 'running'
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className={`p-1 rounded-full ${
                      attempt.status === 'success'
                        ? 'bg-green-100'
                        : attempt.status === 'failed'
                        ? 'bg-red-100'
                        : attempt.status === 'running'
                        ? 'bg-blue-100'
                        : 'bg-gray-100'
                    }`}>
                      {attempt.status === 'success' ? (
                        <CheckCircle size={14} className="text-green-600" />
                      ) : attempt.status === 'failed' ? (
                        <XCircle size={14} className="text-red-600" />
                      ) : attempt.status === 'running' ? (
                        <RefreshCw size={14} className="text-blue-600 animate-spin" />
                      ) : (
                        <Clock size={14} className="text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        Attempt #{attempt.attempt}
                      </p>
                      {attempt.error && (
                        <p className="text-xs text-red-600">{attempt.error}</p>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">
                      {formatDelay(attempt.delay)} delay
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleRetry}
            disabled={isRetrying || failedNodes.length === 0}
            className={`px-4 py-2 text-sm rounded-lg transition-colors flex items-center gap-2 ${
              isRetrying || failedNodes.length === 0
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-orange-600 text-white hover:bg-orange-700'
            }`}
          >
            {isRetrying ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                Retrying...
              </>
            ) : (
              <>
                <Play size={16} />
                Start Retry
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExecutionRetryPanel;
