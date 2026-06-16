import React, { useEffect, useState } from 'react';
import { Play, Square, RefreshCw, Server, AlertTriangle } from 'lucide-react';

export const WorkflowProPanel: React.FC = () => {
  const [status, setStatus] = useState<{ running: boolean; port: number }>({ running: false, port: 8080 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = async () => {
    try {
      const s = await window.electronAPI.workflowBuilder.status();
      setStatus(s);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.electronAPI.workflowBuilder.start();
      if (!res.success) setError(res.error || 'Failed to start WorkflowBuilder');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      checkStatus();
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await window.electronAPI.workflowBuilder.stop();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      checkStatus();
    }
  };

  return (
    <div className="flex flex-col w-full h-full bg-surface">
      <div className="flex items-center justify-between p-2 bg-surface-hover border-b border-border">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-accent" />
          <h2 className="text-sm font-semibold text-text-primary">WorkflowBuilder Pro</h2>
          {status.running ? (
            <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded-full flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Running (Port {status.port})
            </span>
          ) : (
            <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded-full flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-400" />
              Stopped
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-xs text-red-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {error}
            </span>
          )}
          {!status.running ? (
            <button
              onClick={handleStart}
              disabled={loading}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {loading ? 'Starting...' : 'Start Server'}
            </button>
          ) : (
            <button
              onClick={handleStop}
              disabled={loading}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-surface-hover text-text-primary rounded hover:bg-surface-active disabled:opacity-50 transition-colors"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
              Stop
            </button>
          )}
        </div>
      </div>
      
      <div className="flex-1 relative bg-surface-active">
        {status.running ? (
          <iframe
            src={`http://localhost:${status.port}`}
            className="absolute inset-0 w-full h-full border-none bg-surface"
            title="WorkflowBuilder Pro"
            allow="clipboard-read; clipboard-write"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted">
            <Server className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg font-medium">WorkflowBuilder Pro is not running</p>
            <p className="text-sm mt-2">Click "Start Server" to launch the self-hosted visual workflow editor.</p>
          </div>
        )}
      </div>
    </div>
  );
};
